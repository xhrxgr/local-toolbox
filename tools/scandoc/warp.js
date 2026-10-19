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
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);

  // 网格切分（三角形 affine 近似）
  const COLS = 24;
  const ROWS = 24;
  const cw = outW / COLS;
  const ch = outH / ROWS;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // 格四角（dst 坐标）
      const x0 = c * cw;
      const y0 = r * ch;
      const x1 = (c + 1) * cw;
      const y1 = (r + 1) * ch;
      // 反查到源图坐标
      const p00 = applyH(Hinv, x0, y0);
      const p10 = applyH(Hinv, x1, y0);
      const p11 = applyH(Hinv, x1, y1);
      const p01 = applyH(Hinv, x0, y1);
      // 两个三角形：dst 与 src 一一对应
      drawTexTriangle(ctx, srcCanvas, p00, p10, p11, { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 });
      drawTexTriangle(ctx, srcCanvas, p00, p11, p01, { x: x0, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 });
    }
  }
  return out;
}

/** 纹理三角形：把 src 中 (t0,t1,t2) 区域画到 dst 的 (d0,d1,d2) */
function drawTexTriangle(ctx, src, t0, t1, t2, d0, d1, d2) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();

  // 由三对点求 affine：dst = M · src
  const [a, b, c, d, e, f] = solveAffine(t0, t1, t2, d0, d1, d2);
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

/** 三对点求解 affine 变换（2x3 矩阵） */
function solveAffine(s0, s1, s2, d0, d1, d2) {
  const x0 = s0.x;
  const y0 = s0.y;
  const x1 = s1.x;
  const y1 = s1.y;
  const x2 = s2.x;
  const y2 = s2.y;
  const denom = x0 * (y1 - y2) - x1 * (y0 - y2) + x2 * (y0 - y1);
  if (Math.abs(denom) < 1e-9) return [1, 0, 0, 0, 1, 0];
  const u0 = d0.x;
  const v0 = d0.y;
  const u1 = d1.x;
  const v1 = d1.y;
  const u2 = d2.x;
  const v2 = d2.y;
  const a = (u0 * (y1 - y2) - u1 * (y0 - y2) + u2 * (y0 - y1)) / denom;
  const c = (v0 * (y1 - y2) - v1 * (y0 - y2) + v2 * (y0 - y1)) / denom;
  const b = (u0 * (x2 - x1) - u1 * (x2 - x0) + u2 * (x1 - x0)) / denom;
  const d = (v0 * (x2 - x1) - v1 * (x2 - x0) + v2 * (x1 - x0)) / denom;
  const e = (u0 * (x1 * y2 - x2 * y1) - u1 * (x0 * y2 - x2 * y0) + u2 * (x0 * y1 - x1 * y0)) / denom;
  const f = (v0 * (x1 * y2 - x2 * y1) - v1 * (x0 * y2 - x2 * y0) + v2 * (x0 * y1 - x1 * y0)) / denom;
  return [a, b, c, d, e, f];
}
