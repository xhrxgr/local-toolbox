/**
 * 自动四角检测（零依赖，纯 Canvas 像素运算）
 *
 * 链路：缩放 → 灰度 → 高斯模糊 → Sobel 梯度 → Otsu 二值化 → 膨胀连接
 *      → 最大连通域 → 凸包 → 最小外接矩形（ rotating calipers ）→ 四角（相对坐标）
 *
 * 输入：HTMLImageElement / HTMLCanvasElement
 * 输出：[{x,y}×4] 相对坐标（0-1，TL/TR/BR/BL 序）或 null（检测失败）
 */
import { toGray, otsuThreshold, gaussianBlur3, sobelMagnitude } from './lib/imgutils.js';

const ANALYSIS_SIZE = 420; // 分析用缩放边长

export async function detectCorners(source) {
  const w0 = source.naturalWidth || source.width;
  const h0 = source.naturalHeight || source.height;
  if (!w0 || !h0) return null;

  // 1. 缩放绘制
  const scale = Math.min(1, ANALYSIS_SIZE / Math.max(w0, h0));
  const w = Math.max(8, Math.round(w0 * scale));
  const h = Math.max(8, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  // 2. 灰度 + 模糊 + Sobel
  const gray = toGray(imageData);
  const blurred = gaussianBlur3(gray, w, h);
  const mag = sobelMagnitude(blurred, w, h);

  // 3. Otsu 二值化边缘图
  const mag255 = new Uint8ClampedArray(w * h);
  for (let i = 0; i < mag.length; i++) mag255[i] = Math.min(255, mag[i]);
  const t = Math.max(20, otsuThreshold(mag255));
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < mag255.length; i++) bin[i] = mag255[i] >= t ? 1 : 0;
  // 4. 保留一份原始边缘图（供直线拟合求精），再膨胀连接文档区域
  const binOrig = bin.slice();
  // 3x3 膨胀三次：连接断裂的文档边框与内部文字边缘，形成整块文档区域
  for (let i = 0; i < 3; i++) dilate(bin, w, h);

  // 5. 连通域标记（8 连通，两遍法简化：迭代洪泛）
  const labels = labelComponents(bin, w, h);
  if (labels.count === 0) return null;

  // 6. 取最大连通域（面积需 > 2%，排除噪声）
  const best = largestComponent(labels, w, h);
  if (!best || best.size < w * h * 0.02) return null;

  // 7. 凸包（Andrew monotone chain）
  const hull = convexHull(best.points);
  if (hull.length < 3) return null;

  // 8. 近似四边形（膨胀 blob 的最小外接矩形）→ 沿四边拟合直线求精
  let quad = minAreaRect(hull);
  if (!quad) return null;
  quad = refineQuadWithEdgeLines(quad, binOrig, w, h) || quad;

  // 9. 向内收缩 1.5% 补偿检测边缘在文档外侧
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  const shrunk = quad.map(p => ({
    x: p.x + (cx - p.x) * 0.015,
    y: p.y + (cy - p.y) * 0.015,
  }));

  // 10. 归一化为相对坐标，限制在 [0,1]
  return shrunk.map(p => ({
    x: Math.min(1, Math.max(0, p.x / w)),
    y: Math.min(1, Math.max(0, p.y / h)),
  }));
}

/* ========== 形态学膨胀 ========== */
function dilate(bin, w, h) {
  const src = bin.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!src[i]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w) bin[ny * w + nx] = 1;
        }
      }
    }
  }
}

/* ========== 连通域标记（BFS 洪泛） ========== */
function labelComponents(bin, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  let count = 0;
  const queue = new Int32Array(w * h);
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || labels[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = count;
    while (head < tail) {
      const idx = queue[head++];
      const x = idx % w;
      const y = (idx - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (bin[ni] && labels[ni] === -1) {
            labels[ni] = count;
            queue[tail++] = ni;
          }
        }
      }
    }
    count++;
  }
  return { labels, count };
}

function largestComponent({ labels, count }, w, h) {
  const sizes = new Array(count).fill(0);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== -1) sizes[labels[i]]++;
  }
  let bestLabel = -1;
  let bestSize = 0;
  for (let l = 0; l < count; l++) {
    if (sizes[l] > bestSize) {
      bestSize = sizes[l];
      bestLabel = l;
    }
  }
  if (bestLabel === -1) return null;
  const points = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] === bestLabel) points.push({ x, y });
    }
  }
  return { size: bestSize, points };
}

/* ========== 凸包（Andrew monotone chain） ========== */
function convexHull(points) {
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length < 3) return pts;

  const cross = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/* ========== 沿四边拟合直线求精四角 ========== */
function refineQuadWithEdgeLines(quad, edgeBin, w, h) {
  const lines = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) return null;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy; // 边法向
    const ny = ux;
    const pts = [];
    const band = Math.max(4, Math.round(len * 0.06));
    // 只取边中部 80%，避开角区污染
    for (let s = len * 0.1; s <= len * 0.9; s += 1) {
      const px = a.x + ux * s;
      const py = a.y + uy * s;
      for (let d = -band; d <= band; d++) {
        const ex = Math.round(px + nx * d);
        const ey = Math.round(py + ny * d);
        if (ex < 0 || ex >= w || ey < 0 || ey >= h) continue;
        if (edgeBin[ey * w + ex]) pts.push({ x: ex, y: ey });
      }
    }
    if (pts.length < 8) return null;
    lines.push(fitLine(pts));
  }
  // 相邻直线求交得四角
  const corners = [];
  for (let i = 0; i < 4; i++) {
    const p = lineIntersect(lines[(i + 3) % 4], lines[i]);
    if (!p) return null;
    corners.push(p);
  }
  return corners;
}

/** PCA 直线拟合：返回 { px, py, dx, dy }（过质心的单位方向直线） */
function fitLine(pts) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(theta), dy: Math.sin(theta) };
}

/** 两直线求交（参数式），平行返回 null */
function lineIntersect(l1, l2) {
  const denom = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(denom) < 1e-6) return null;
  const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / denom;
  return { x: l1.px + l1.dx * t, y: l1.py + l1.dy * t };
}

/* ========== 最小外接矩形（rotating calipers，兜底） ========== */
function minAreaRect(hull) {
  if (hull.length < 3) return null;
  let bestArea = Infinity;
  let bestQuad = null;

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    // 边方向单位向量
    const ux = ex / len;
    const uy = ey / len;
    // 垂直方向
    const vx = -uy;
    const vy = ux;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const du = (p.x - a.x) * ux + (p.y - a.y) * uy;
      const dv = (p.x - a.x) * vx + (p.y - a.y) * vy;
      if (du < minU) minU = du;
      if (du > maxU) maxU = du;
      if (dv < minV) minV = dv;
      if (dv > maxV) maxV = dv;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      // 四角（相对 a 点，u/v 坐标系），注意方向保持连续性
      bestQuad = [
        { x: a.x + ux * minU + vx * minV, y: a.y + uy * minU + vy * minV },
        { x: a.x + ux * maxU + vx * minV, y: a.y + uy * maxU + vy * minV },
        { x: a.x + ux * maxU + vx * maxV, y: a.y + uy * maxU + vy * maxV },
        { x: a.x + ux * minU + vx * maxV, y: a.y + uy * minU + vy * maxV },
      ];
    }
  }
  if (!bestQuad) return null;
  return sortCorners(bestQuad);
}

/** 四角排序为 TL/TR/BR/BL（绕中心角度排序起点的规范化） */
export function sortCorners(corners) {
  const cx = corners.reduce((s, p) => s + p.x, 0) / corners.length;
  const cy = corners.reduce((s, p) => s + p.y, 0) / corners.length;
  const withAngle = corners.map(p => ({
    p,
    a: Math.atan2(p.y - cy, p.x - cx),
  }));
  // 从左上开始：找最靠左上的点作为起点（x+y 最小）
  let startIdx = 0;
  let bestSum = Infinity;
  withAngle.forEach((item, i) => {
    const s = item.p.x + item.p.y;
    if (s < bestSum) {
      bestSum = s;
      startIdx = i;
    }
  });
  // atan2 从 -pi 起逆时针；调整为从起点开始的顺时针序列（TL→TR→BR→BL）
  const ordered = [];
  for (let k = 0; k < 4; k++) {
    ordered.push(withAngle[(startIdx + k) % 4].p);
  }
  // 验证方向：TL→TR→BR→BL 应使相邻边先右后下；用叉积校正
  const cross =
    (ordered[1].x - ordered[0].x) * (ordered[2].y - ordered[1].y) -
    (ordered[1].y - ordered[0].y) * (ordered[2].x - ordered[1].x);
  if (cross < 0) {
    ordered.reverse();
    ordered.unshift(ordered.pop());
  }
  return ordered;
}

/**
 * 校验检测出的四边形是否可信。
 * 翻拍作业纸时经常出现「轮廓不明显」「纸张超出画面」等情况，
 * 此时检测可能返回一个畸形四边形（细长、非凸、角点重合），
 * 直接使用会把正文裁没，导出近乎空白的结果，必须拦截并回退。
 *
 * @returns {string|null} null 表示通过，否则返回拒绝原因
 */
export function validateQuad(corners, w, h) {
  if (!corners || corners.length !== 4) return '角点数量异常';

  // 1. 凸性：四条边叉积必须同号，否则会出现「一角内凹」的畸形
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return '四边形内凹（非凸）';
  }

  // 2. 面积占比：文档照片里纸张通常占画面主体，
  //    太小说明只框住了一小块，太接近满幅说明多半没找到纸边
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area / 2);
  const ratio = area / (w * h);
  if (ratio < 0.12) return '四边形面积过小';
  if (ratio > 0.985) return '四边形几乎覆盖全图，未识别出纸张边缘';

  // 3. 边长比例：排除细长条
  const lens = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    lens.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  const maxL = Math.max(...lens);
  const minL = Math.min(...lens);
  if (maxL <= 0) return '四边形退化';
  if (minL / maxL < 0.2) return '四边形过于细长';

  // 4. 内角：每角应在 25°~155° 之间
  for (let i = 0; i < 4; i++) {
    const prev = corners[(i + 3) % 4];
    const cur = corners[i];
    const next = corners[(i + 1) % 4];
    const v1x = prev.x - cur.x;
    const v1y = prev.y - cur.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const m1 = Math.hypot(v1x, v1y);
    const m2 = Math.hypot(v2x, v2y);
    if (m1 < 1 || m2 < 1) return '角点重合';
    const dot = (v1x * v2x + v1y * v2y) / (m1 * m2);
    const ang = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
    if (ang < 25 || ang > 155) return `内角异常（${Math.round(ang)}°）`;
  }

  return null;
}

/**
 * 纸张超出画面时，把贴边的角点外推到画面边缘。
 * 入参是 0-1 归一化坐标（与 detectCorners 一致），仅当角点距边缘很近（<1.5%）才推，
 * 避免把正常的背景边距也吃掉。
 */
export function snapToBorder(corners) {
  const m = 0.015;
  return corners.map(p => ({
    x: p.x <= m ? 0 : p.x >= 1 - m ? 1 : p.x,
    y: p.y <= m ? 0 : p.y >= 1 - m ? 1 : p.y,
  }));
}

/**
 * 边强度校验：判断四边是否真的落在「纸张与背景的交界」上。
 *
 * 轮廓不明显时，检测可能锁定在正文内部——此时四边形几何上完全合法，
 * 但边并不是真正的纸边，裁出来会把正文切掉。
 * 判据：沿每条边采样，比较内侧与外侧的平均亮度。
 *   - 真纸边：内外亮度差稳定（同一侧始终更亮或更暗），台阶明显；
 *   - 误框（穿过正文）：内外亮度差忽正忽负，方向不一致。
 *
 * @returns {string|null} null 表示通过
 */
export function checkEdgeStrength(corners, imageData, opt = {}) {
  const minStep = opt.minStep ?? 10;     // 亮度台阶下限
  const minConsistency = opt.minConsistency ?? 0.7; // 方向一致率下限
  const { data, width: w, height: h } = imageData;
  if (!data || w < 32 || h < 32) return null;

  const lum = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    const i = (y * w + x) * 4;
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  };

  const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4;

  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % 4];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const len = Math.hypot(ex, ey);
    if (len < 16) continue;

    // 外法线（背离中心）
    let nx = ey / len;
    let ny = -ex / len;
    const mx = (p.x + q.x) / 2 - cx;
    const my = (p.y + q.y) / 2 - cy;
    if (mx * nx + my * ny < 0) { nx = -nx; ny = -ny; }

    const steps = [];
    for (let t = 1; t <= 15; t++) {
      const bx = p.x + ex * (t / 16);
      const by = p.y + ey * (t / 16);
      const d = len * 0.025;
      // 内外各取 3 个点求均值，避开边缘抗锯齿带
      let inSum = 0, outSum = 0, inN = 0, outN = 0;
      for (let k = 1; k <= 3; k++) {
        const off = d * (0.6 + k * 0.5);
        const ai = lum(Math.round(bx - nx * off), Math.round(by - ny * off));
        const ao = lum(Math.round(bx + nx * off), Math.round(by + ny * off));
        if (ai !== null) { inSum += ai; inN++; }
        if (ao !== null) { outSum += ao; outN++; }
      }
      if (inN === 0 || outN === 0) continue;
      steps.push((inSum / inN) - (outSum / outN));
    }
    if (steps.length < 8) continue;

    const median = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)];
    const consistent = steps.filter(s => Math.sign(s) === Math.sign(median) && Math.abs(s) > minStep * 0.6).length / steps.length;

    if (Math.abs(median) < minStep || consistent < minConsistency) {
      return `第 ${i + 1} 条边不像纸张边缘（可能是识别到了正文）`;
    }
  }
  return null;
}
