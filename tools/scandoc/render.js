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
export function cornersToRotated(corners, page) {
  const w = page.img.naturalWidth;
  const h = page.img.naturalHeight;
  const rot = ((page.rotation % 360) + 360) % 360;
  return corners.map(p => {
    const x = p.x * w;
    const y = p.y * h;
    switch (rot) {
      case 90: return { x: h - y, y: x };        // 右旋 90：新 x = h-y, 新 y = x
      case 180: return { x: w - x, y: h - y };
      case 270: return { x: y, y: w - x };       // 左旋 90
      default: return { x, y };
    }
  });
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
export function renderPage(page, opts = {}) {
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
  if (rot === 90) {
    rctx.translate(rh, 0);
    rctx.rotate(Math.PI / 2);
  } else if (rot === 180) {
    rctx.translate(rw, rh);
    rctx.rotate(Math.PI);
  } else if (rot === 270) {
    rctx.translate(0, rw);
    rctx.rotate(-Math.PI / 2);
  }
  rctx.drawImage(img, 0, 0);
  rctx.restore();

  // 2. 滤镜
  if (page.filter && page.filter !== 'original') {
    const imageData = rctx.getImageData(0, 0, rw, rh);
    applyFilter(imageData, page.filter);
    rctx.putImageData(imageData, 0, 0);
  }

  // 3. 曲面矫正（有四角时）
  if (applyWarp && page.corners) {
    const absCorners = cornersToRotated(page.corners, page);
    // 四角需在旋转后画布尺寸内
    const inside = absCorners.every(c =>
      c.x >= 0 && c.y >= 0 && c.x <= rw && c.y <= rh
    );
    if (inside) {
      try {
        return warpPerspective(rotated, absCorners, maxSize);
      } catch (err) {
        // 四角退化（共线等）时退回未矫正图；留日志便于排查
        console.warn('[scandoc] 透视矫正失败，本次输出未拉直：', err);
      }
    }
  }

  // 4. 尺寸限制
  if (Math.max(rw, rh) > maxSize) {
    const s = maxSize / Math.max(rw, rh);
    const scaled = document.createElement('canvas');
    scaled.width = Math.round(rw * s);
    scaled.height = Math.round(rh * s);
    const sctx = scaled.getContext('2d');
    sctx.drawImage(rotated, 0, 0, scaled.width, scaled.height);
    return scaled;
  }
  return rotated;
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
