/**
 * 渲染管线：旋转 → 滤镜 → 曲面矫正，组合为最终画布
 * 用于编辑器画布、缩略图、导出，保证所见即所得
 */
import { applyFilter } from './filters.js';
import { warpPerspective } from './warp.js';

/** 页面在当前旋转下的画布尺寸 */
export function rotatedSize(page) {
  const w = page.img.naturalWidth;
  const h = page.img.naturalHeight;
  return page.rotation % 180 === 90 ? { w: h, h: w } : { w, h };
}

/** 把相对角点（0-1，基于未旋转原图）映射到旋转后画布的绝对像素坐标 */
/** 旋转后角点的显示顺序（元素是该顺序下标对应的「原图角点序号」）。
 *  0° [0,1,2,3] / 90° [3,0,1,2] / 180° [2,3,0,1] / 270° [1,2,3,0] */
const CORNER_ORDER = { 0: [0, 1, 2, 3], 90: [3, 0, 1, 2], 180: [2, 3, 0, 1], 270: [1, 2, 3, 0] };

export function cornersToRotated(corners, page) {
  const w = page.img.naturalWidth;
  const h = page.img.naturalHeight;
  const rot = ((page.rotation % 360) + 360) % 360;
  const mapped = corners.map(p => {
    const x = p.x * w;
    const y = p.y * h;
    switch (rot) {
      case 90: return { x: h - y, y: x };        // 右旋 90：新 x = h-y, 新 y = x
      case 180: return { x: w - x, y: h - y };
      case 270: return { x: y, y: w - x };       // 左旋 90
      default: return { x, y };
    }
  });
  // 角点顺序必须随旋转一起调整：角点始终按原图的 TL/TR/BR/BL 存储，
  // 旋转后原 TL 可能跑到右上角，若不重排，矫正会把页面又转回去，
  // 表现为导出结果被转置（非正方形页面尤其明显）
  return CORNER_ORDER[rot].map(i => mapped[i]);
}

/** 旋转后「显示顺序」的角点序号 → 存储顺序（原图）的角点序号 */
export function rotatedIndexToCornerIndex(rotation, rotatedIdx) {
  const rot = ((rotation % 360) + 360) % 360;
  return (CORNER_ORDER[rot] || CORNER_ORDER[0])[rotatedIdx];
}

/** cornersToRotated 的逆变换：旋转后画布坐标 → 原图相对坐标 */
export function rotatedToCorners(points, page) {
  const w = page.img.naturalWidth;
  const h = page.img.naturalHeight;
  const rot = ((page.rotation % 360) + 360) % 360;
  return points.map(p => {
    switch (rot) {
      case 90: return { x: p.y / w, y: (h - p.x) / h };
      case 180: return { x: (w - p.x) / w, y: (h - p.y) / h };
      case 270: return { x: (w - p.y) / w, y: p.x / h };
      default: return { x: p.x / w, y: p.y / h };
    }
  });
}

/**
 * 渲染页面
 * @param page    页面对象
 * @param opts    { maxSize?: number, applyWarp?: boolean }
 * @returns HTMLCanvasElement
 */
export async function renderPage(page, opts = {}) {
  const { maxSize = Infinity, applyWarp = true } = opts;
  const img = page.img;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  // 1. 旋转后的中间画布
  const rot = ((page.rotation % 360) + 360) % 360;
  const rw = rot % 180 === 90 ? ih : iw;
  const rh = rot % 180 === 90 ? iw : ih;
  const rotated = document.createElement('canvas');
  rotated.width = rw;
  rotated.height = rh;
  const rctx = rotated.getContext('2d', { willReadFrequently: true });
  rctx.save();
  // 平移量必须用旋转后画布的对应边长：90° 时是 rw（=原图高），270° 时是 rh（=原图宽）。
  // 用错会导致非正方形图片错位，且四角映射（cornersToRotated）与实际绘制不一致，
  // 矫正时采样到空白区，导出会得到近乎空白的 PDF
  if (rot === 90) {
    rctx.translate(rw, 0);
    rctx.rotate(Math.PI / 2);
  } else if (rot === 180) {
    rctx.translate(rw, rh);
    rctx.rotate(Math.PI);
  } else if (rot === 270) {
    rctx.translate(0, rh);
    rctx.rotate(-Math.PI / 2);
  }
  rctx.drawImage(img, 0, 0);
  rctx.restore();

  // 2. 先按目标尺寸降采样，再跑滤镜。
  //    滤镜结果最终只用到 maxSize（编辑画布 1400 / 缩略图 200 / 导出 2200），
  //    而原图可能是 12MP——在原图分辨率上跑等于 97% 的算力被丢弃，
  //    期间主线程被占满，界面完全无响应（用户表现为「点了没反应」）。
  let work = rotated;
  let rctxWork = rctx;
  let scale = 1;
  if (Math.max(rw, rh) > maxSize) {
    scale = maxSize / Math.max(rw, rh);
    work = document.createElement('canvas');
    work.width = Math.max(1, Math.round(rw * scale));
    work.height = Math.max(1, Math.round(rh * scale));
    const wctx = work.getContext('2d', { willReadFrequently: true });
    wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(rotated, 0, 0, work.width, work.height);
    rctxWork = wctx;
  }

  // 3. 曲面矫正（有四角时）。角点按同一比例缩放到工作画布坐标。
  //    矫正放在滤镜之前：滤镜的白平衡与光照估计作用在「已拉直」的纸面上，
  //    比在带透视畸变的图上估计更准；也顺带让工具栏顺序与处理顺序一致。
  if (applyWarp && page.corners) {
    const absCorners = cornersToRotated(page.corners, page)
      .map(c => ({ x: c.x * scale, y: c.y * scale }));
    // 四角需在旋转后画布尺寸内
    const inside = absCorners.every(c =>
      c.x >= 0 && c.y >= 0 && c.x <= work.width && c.y <= work.height
    );
    if (inside) {
      try {
        work = warpPerspective(work, absCorners, Infinity);
        rctxWork = work.getContext('2d', { willReadFrequently: true });
      } catch (err) {
        // 四角退化（共线等）时退回未矫正图；留日志便于排查
        console.warn('[scandoc] 透视矫正失败，本次输出未拉直：', err);
      }
    }
  }

  // 4. 滤镜（跑在目标分辨率上）
  if (page.filter && page.filter !== 'original') {
    const imageData = rctxWork.getImageData(0, 0, work.width, work.height);
    await applyFilter(imageData, page.filter, opts.onProgress);
    rctxWork.putImageData(imageData, 0, 0);
  }

  return work;
}

/** 默认四角（内缩 2% 的整图矩形） */
export function defaultCorners(page) {
  return [
    { x: 0.02, y: 0.02 },
    { x: 0.98, y: 0.02 },
    { x: 0.98, y: 0.98 },
    { x: 0.02, y: 0.98 },
  ];
}
