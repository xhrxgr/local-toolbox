/**
 * 文档滤镜：原图 / 黑白 / 增强
 * 输入输出均为 ImageData（原地修改后返回）
 */
import { toGray, otsuThreshold } from './lib/imgutils.js';

export function applyFilter(imageData, mode) {
  switch (mode) {
    case 'bw': return applyBw(imageData);
    case 'enhance': return applyEnhance(imageData);
    default: return imageData;
  }
}

/** 黑白：灰度 + Otsu 自适应阈值 → 纯黑白 */
function applyBw(imageData) {
  const { data, width, height } = imageData;
  const gray = toGray(imageData);
  const t = otsuThreshold(gray);
  for (let j = 0; j < width * height; j++) {
    const v = gray[j] >= t ? 255 : 0;
    const i = j * 4;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  return imageData;
}

/** 增强：灰度 + 2%/98% 分位对比度拉伸 + 轻度 gamma */
function applyEnhance(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;
  const gray = toGray(imageData);

  // 直方图
  const hist = new Array(256).fill(0);
  for (let j = 0; j < n; j++) hist[gray[j]]++;

  // 2% / 98% 分位作为拉伸区间
  const clip = Math.floor(n * 0.02);
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let t = 0; t < 256; t++) {
    acc += hist[t];
    if (acc > clip) { lo = t; break; }
  }
  acc = 0;
  for (let t = 255; t >= 0; t--) {
    acc += hist[t];
    if (acc > clip) { hi = t; break; }
  }
  if (hi <= lo) { lo = 0; hi = 255; }

  // 查找表：线性拉伸 + gamma 0.9 提亮
  const lut = new Uint8ClampedArray(256);
  const range = hi - lo;
  for (let v = 0; v < 256; v++) {
    let x = (v - lo) / range;
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    lut[v] = 255 * Math.pow(x, 0.9);
  }

  for (let j = 0; j < n; j++) {
    const v = lut[gray[j]];
    const i = j * 4;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  return imageData;
}
