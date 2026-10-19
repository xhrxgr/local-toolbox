/**
 * 笔迹自动检测：颜色特征法（零模型，手机无压力）
 *
 * 能力边界（必须如实告知用户）：
 *  - 只针对彩色笔迹（红笔批改、蓝笔批注）。这类笔迹与黑白印刷体在色彩上有明确区分，
 *    因此可以可靠分离；
 *  - 不处理黑笔与铅笔——它们与印刷体同为深色，颜色法无法区分，
 *    若按亮度一刀切会把印刷文字、表格线、公式一起误删，故不提供该能力。
 */

/** 可检测的笔迹类型 */
export const DETECTORS = [
  { id: 'red', label: '红笔批改', hint: '教师红笔批注、勾叉、评分' },
  { id: 'blue', label: '蓝笔批注', hint: '蓝色笔迹的补充批注与标记' },
];

/**
 * 检测彩色笔迹并写入掩码
 * @param {Uint8ClampedArray} rgba 原图 RGBA
 * @param {Uint8ClampedArray} mask 输出掩码（255 = 待擦除），原地写入
 * @param {string} type 'red' | 'blue'
 * @param {number} sensitivity 0-100，越大判定越宽松（抓到的笔迹越多）
 */
export function detectColoredInk(rgba, mask, type, sensitivity) {
  // 灵敏度映射到最小饱和度阈值：低灵敏度要求颜色更纯
  const minSat = 90 - (sensitivity / 100) * 70; // 90 → 20
  const minVal = 40; // 太暗的深红/深蓝不算，避免把阴影误判为笔迹

  const hueRange = type === 'red' ? [-18, 18] : [170, 225];
  let hits = 0;

  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d < 12) continue; // 灰阶像素（印刷体、纸面）直接跳过

    const sat = (d / max) * 255;
    if (sat < minSat || max < minVal) continue;

    let hue;
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;

    if (inHueRange(hue, hueRange)) {
      mask[i] = 255;
      hits++;
    }
  }
  return hits;
}

function inHueRange(hue, [lo, hi]) {
  // 红色区间跨 0/360 边界，拆成两段判断
  if (lo < 0) return hue >= lo + 360 || hue <= hi;
  return hue >= lo && hue <= hi;
}

/** 清除掩码中孤立的噪点（8 邻域计数，少数邻居的像素视为噪点） */
export function despeckle(mask, w, h, minNeighbors = 2) {
  const src = mask.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!src[i]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (src[i + dy * w + dx]) n++;
        }
      }
      if (n < minNeighbors) mask[i] = 0;
    }
  }
}

/** 形态学膨胀：把掩码向外扩张 radius 像素，覆盖笔迹边缘残留 */
export function dilate(mask, w, h, radius) {
  if (radius <= 0) return;
  const src = mask.slice();
  const r2 = radius * radius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i]) continue;
      let hit = false;
      for (let dy = -radius; dy <= radius && !hit; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const ddx = dx * dx + dy * dy;
          if (ddx > r2) continue;
          if (src[yy * w + xx]) { hit = true; break; }
        }
      }
      if (hit) mask[i] = 255;
    }
  }
}

/** 统计掩码覆盖率（0-1） */
export function maskRatio(mask) {
  if (!mask.length) return 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n / mask.length;
}