/**
 * 曲面矫正（透视变换）：把任意四边形的文档区域拉直为标准矩形
 *
 * 实现：计算 4 对点的透视变换矩阵 H，网格化目标矩形，
 * 每个小格拆两个三角形，用 canvas affine 变换逐块绘制（经典 mesh warping）。
 */

/**
 * 求解透视变换矩阵（src 4 点 → dst 4 点）
 * 返回 3x3 矩阵的 9 个元素（行主序），映射关系：dst = H · src
 */
export function computeHomography(src, dst) {
  // 8 未知数线性方程组（齐次化后）
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }
  const h = solveLinear(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** 高斯消元解线性方程组 */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // 选主元
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    if (Math.abs(pv) < 1e-12) throw new Error('透视矩阵奇异，四角可能共线');
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map(row => row[n]);
}

/** 应用矩阵：点 (x,y) → 新点 */
function applyH(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / d,
    y: (H[3] * x + H[4] * y + H[5]) / d,
  };
}

/** 3x3 矩阵求逆 */
function invertH(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('透视矩阵不可逆');
  const invDet = 1 / det;
  return [
    A * invDet,
    -(b * i - c * h) * invDet,
    (b * f - c * e) * invDet,
    B * invDet,
    (a * i - c * g) * invDet,
    -(a * f - c * d) * invDet,
    C * invDet,
    -(a * h - b * g) * invDet,
    (a * e - b * d) * invDet,
  ];
}

/**
 * 透视矫正
 * @param srcCanvas 源画布（已应用滤镜/旋转后的图）
 * @param corners   四角（与 srcCanvas 尺寸对应的绝对像素坐标，TL/TR/BR/BL）
 * @param maxSize   输出最长边限制
 * @returns HTMLCanvasElement
 */
export function warpPerspective(srcCanvas, corners, maxSize = Infinity) {
  // 输出尺寸：四边平均长度
  const edgeLen = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
  const topW = edgeLen(corners[0], corners[1]);
  const bottomW = edgeLen(corners[3], corners[2]);
  const leftH = edgeLen(corners[0], corners[3]);
  const rightH = edgeLen(corners[1], corners[2]);
  let outW = Math.round((topW + bottomW) / 2);
  let outH = Math.round((leftH + rightH) / 2);
  if (outW < 2 || outH < 2) return srcCanvas;

  // 尺寸限制
  const longest = Math.max(outW, outH);
  if (longest > maxSize) {
    const s = maxSize / longest;
    outW = Math.round(outW * s);
    outH = Math.round(outH * s);
  }

  const dst = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];

  // dst → src 的逆矩阵（对每个目标网格点反查源坐标）
  const H = computeHomography(corners, dst);
  const Hinv = invertH(H);

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);

  const sw = srcCanvas.width;
  const sh = srcCanvas.height;

  // 快速路径：四角几乎构成轴对齐矩形时（多数平拍照片），
  // 直接裁剪绘制即可，没必要逐像素反查——省掉几百毫秒的 JS 计算
  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const tol = Math.max(1, Math.max(outW, outH) * 0.002);
  const axisAligned = corners.every((c, i) => {
    const wantX = (i === 1 || i === 2) ? maxX : minX;
    const wantY = (i === 2 || i === 3) ? maxY : minY;
    return Math.abs(c.x - wantX) <= tol && Math.abs(c.y - wantY) <= tol;
  });
  if (axisAligned) {
    const cw = maxX - minX;
    const chh = maxY - minY;
    if (cw > 2 && chh > 2) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(srcCanvas, minX, minY, cw, chh, 0, 0, outW, outH);
      return out;
    }
  }

  // 逐像素反查 + 双线性采样。
  // 早前用「网格切分为三角形 + 每块 affine 近似」实现：透视变换本身不是仿射的，
  // 相邻块在共享边上的反查源坐标不完全一致，会留下发丝状缝隙，
  // 在导出图上表现为规则网格线。逐像素反查是精确解，结构上不存在接缝。
  const srcData = srcCanvas.getContext('2d').getImageData(0, 0, sw, sh).data;
  const outData = ctx.createImageData(outW, outH);
  const px = outData.data;
  const h0 = Hinv[0], h1 = Hinv[1], h2 = Hinv[2];
  const h3 = Hinv[3], h4 = Hinv[4], h5 = Hinv[5];
  const h6 = Hinv[6], h7 = Hinv[7], h8 = Hinv[8];

  for (let y = 0; y < outH; y++) {
    // 按行预计算分子分母，x 方向增量累加，避免每像素重复乘法
    let nx = h1 * y + h2;
    let ny = h4 * y + h5;
    let nw = h7 * y + h8;
    let o = y * outW * 4;
    for (let x = 0; x < outW; x++) {
      // 一次倒数供两个坐标共用，比分别做两次除法省一半开销
      const dd = nw !== 0 ? nw : 1e-6;
      const inv = 1 / dd;
      const fx = nx * inv - 0.5;
      const fy = ny * inv - 0.5;
      nx += h0;
      ny += h3;
      nw += h6;

      if (fx < 0 || fy < 0 || fx > sw - 1 || fy > sh - 1) {
        px[o] = 255; px[o + 1] = 255; px[o + 2] = 255; px[o + 3] = 255;
        o += 4;
        continue;
      }
      const ix = fx | 0;
      const iy = fy | 0;
      const ax = fx - ix;
      const ay = fy - iy;
      const i0 = (iy * sw + ix) * 4;
      const i1 = i0 + 4;
      const i2 = i0 + sw * 4;
      const i3 = i2 + 4;
      const w00 = (1 - ax) * (1 - ay);
      const w10 = ax * (1 - ay);
      const w01 = (1 - ax) * ay;
      const w11 = ax * ay;
      px[o] = srcData[i0] * w00 + srcData[i1] * w10 + srcData[i2] * w01 + srcData[i3] * w11;
      px[o + 1] = srcData[i0 + 1] * w00 + srcData[i1 + 1] * w10 + srcData[i2 + 1] * w01 + srcData[i3 + 1] * w11;
      px[o + 2] = srcData[i0 + 2] * w00 + srcData[i1 + 2] * w10 + srcData[i2 + 2] * w01 + srcData[i3 + 2] * w11;
      px[o + 3] = 255;
      o += 4;
    }
  }
  ctx.putImageData(outData, 0, 0);
  return out;
}
