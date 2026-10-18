/**
 * 图像处理基础工具：灰度 / Otsu 阈值 / 高斯模糊 / Sobel 梯度
 * 全部纯函数操作 ImageData，零依赖
 */

/** 灰度化（Rec.601 加权），返回 Uint8ClampedArray 长度 w*h */
export function toGray(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return gray;
}

/** Otsu 自动阈值（0-255），灰度直方图输入 */
export function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

/** 3x3 高斯模糊（可分离近似），gray 数组 → 新数组 */
export function gaussianBlur3(gray, width, height) {
  const tmp = new Uint8ClampedArray(gray.length);
  const out = new Uint8ClampedArray(gray.length);
  // 水平 [1 2 1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const l = x > 0 ? gray[i - 1] : gray[i];
      const r = x < width - 1 ? gray[i + 1] : gray[i];
      tmp[i] = (l + 2 * gray[i] + r) / 4;
    }
  }
  // 垂直 [1 2 1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const u = y > 0 ? tmp[i - width] : tmp[i];
      const d = y < height - 1 ? tmp[i + width] : tmp[i];
      out[i] = (u + 2 * tmp[i] + d) / 4;
    }
  }
  return out;
}

/** Sobel 梯度幅值图，返回 Float32Array（0-255 量级） */
export function sobelMagnitude(gray, width, height) {
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1] +
        gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1];
      const gy =
        -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1] +
        gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return mag;
}
