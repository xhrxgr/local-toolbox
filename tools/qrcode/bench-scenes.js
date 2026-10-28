/**
 * 二维码识别的测试场景生成器。
 *
 * 把「怎么造出各种畸变的码」与「怎么解码」分开：
 * 这一份只负责造图，基准页负责解码与计时。
 *
 * 单独成文件而不是塞在基准页里，有两个原因：
 *   · 基准页是开发期资产（不随工具发布），而这里是要长期保留的测试基建
 *   · 场景定义（哪些畸变、哪些参数）本身就是测试规格的一部分，
 *     放在可评审的文件里比埋在 HTML 脚本块里更容易被检查
 *
 * 所有形变都是「输出像素采样输入」的 warp：
 * 输出位置 (x,y) 取输入位置 (cx + dx·f, cy + dy·f)，
 * f 由各自的模型给出。
 */

/* ---------- 单应性（4 点透视映射） ---------- */

/** 解 8 元线性方程组，返回 3×3 单应性矩阵（行主序） */
export function solveH(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** 把源画布按四角映射到目标四边形，输出 outW×outH */
export function applyH(srcCanvas, dstCorners, outW, outH) {
  const s = srcCanvas.width;
  const src = [[0, 0], [s, 0], [s, s], [0, s]];
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = srcCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, s, s).data;
  const o = new Uint8ClampedArray(outW * outH * 4);
  // 目标四边形 → 源四边形的逆映射：
  // 对每个输出像素，反解它在源图里的位置再取值。
  // （正向映射会在四边形内部产生空洞，且边缘不精确）
  const inv = solveH(dstCorners, src);
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const X = inv[0] * x + inv[1] * y + inv[2];
    const Y = inv[3] * x + inv[4] * y + inv[5];
    const W = inv[6] * x + inv[7] * y + inv[8];
    const sx = X / W, sy = Y / W;
    const oi = (y * outW + x) * 4;
    if (sx < 0 || sy < 0 || sx >= s || sy >= s) { o[oi] = 255; o[oi+1] = 255; o[oi+2] = 255; o[oi+3] = 255; continue; }
    const si = ((Math.round(sy) * s) + Math.round(sx)) * 4;
    o[oi] = img[si]; o[oi+1] = img[si+1]; o[oi+2] = img[si+2]; o[oi+3] = 255;
  }
  ctx.putImageData(new ImageData(o, outW, outH), 0, 0);
  return out;
}

/* ---------- 径向形变 ---------- */

/**
 * 桶形弯曲，参考系是「被摄码自身」（中心 cx/cy、归一化半径 R），
 * 而不是整幅画面 —— 镜头畸变是相对被摄物施加的。
 *
 * 采样方向：输出位置取输入的更外侧（f > 1），内容被压向中心。
 */
export function barrel(canvas, cx, cy, R, k) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h).data;
  const o = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    const f = r === 0 ? 1 : 1 + k * (r / R) * (r / R);
    const sx = Math.round(cx + dx * f), sy = Math.round(cy + dy * f);
    const oi = (y * w + x) * 4;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) { o[oi]=255;o[oi+1]=255;o[oi+2]=255;o[oi+3]=255; continue; }
    const si = (sy * w + sx) * 4;
    o[oi]=img[si];o[oi+1]=img[si+1];o[oi+2]=img[si+2];o[oi+3]=255;
  }
  ctx.putImageData(new ImageData(o, w, h), 0, 0);
  return canvas;
}

/**
 * 非等向桶形：横向与纵向的弯曲强度不同。
 *
 * 标准桶形是径向的：f = 1 + k·(r/R)²，r 是到中心的欧氏距离。
 * 但真实镜头畸变未必各向同性 —— 横向与纵向可以不一样。
 * 这里按方向余弦的平方把两个方向的强度混合：
 *   k(θ) = kx·cos²θ + ky·sin²θ
 * cos²θ = dx²/r²，sin²θ = dy²/r²。
 * kx = ky 时退化为标准径向模型（用于验证测试台本身正确）。
 */
export function barrelAniso(canvas, cx, cy, R, kx, ky) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h).data;
  const o = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    let kk = 0;
    if (r > 0) {
      const ax = dx / r, ay = dy / r;
      kk = kx * ax * ax + ky * ay * ay;
    }
    const f = r === 0 ? 1 : 1 + kk * (r / R) * (r / R);
    const sx = Math.round(cx + dx * f), sy = Math.round(cy + dy * f);
    const oi = (y * w + x) * 4;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) { o[oi]=255;o[oi+1]=255;o[oi+2]=255;o[oi+3]=255; continue; }
    const si = (sy * w + sx) * 4;
    o[oi]=img[si];o[oi+1]=img[si+1];o[oi+2]=img[si+2];o[oi+3]=255;
  }
  ctx.putImageData(new ImageData(o, w, h), 0, 0);
  return canvas;
}

/**
 * 局部弯曲（正弦波），径向模型表达不了的形变。
 *
 * 径向桶形是「以某点为中心的二次缩放」，能表达镜头畸变，
 * 但表达不了「画面局部被弯折」这类形变 ——
 * 例如纸张弯曲、物体被轻微揉皱、镜头边缘的像差。
 *
 * 两个正交方向的正弦波叠加：
 *   dx' = dx + A·sin(2π·dx/λ)·cos(2π·dy/λ)
 *   dy' = dy + A·sin(2π·dy/λ)
 * A=0 时退化为无形变（用于验证测试台本身正确）。
 */
export function barrelLocal(canvas, cx, cy, R, A, lambda) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h).data;
  const o = new Uint8ClampedArray(w * h * 4);
  const k = 2 * Math.PI / lambda;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy;
    const sx = Math.round(cx + dx + A * Math.sin(k * dx) * Math.cos(k * dy));
    const sy = Math.round(cy + dy + A * Math.sin(k * dy));
    const oi = (y * w + x) * 4;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) { o[oi]=255;o[oi+1]=255;o[oi+2]=255;o[oi+3]=255; continue; }
    const si = (sy * w + sx) * 4;
    o[oi]=img[si];o[oi+1]=img[si+1];o[oi+2]=img[si+2];o[oi+3]=255;
  }
  ctx.putImageData(new ImageData(o, w, h), 0, 0);
  return canvas;
}

/* ---------- 光度退化 ---------- */

/** 光照渐变：右侧变暗（0.45~1.0 的横向系数） */
export function gradient(c) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4;
    const f = 0.45 + 0.55 * (x / c.width);
    d.data[i] *= f; d.data[i+1] *= f; d.data[i+2] *= f;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** 反色（白字黑底） */
export function invert(c) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = 255 - d.data[i]; d.data[i+1] = 255 - d.data[i+1]; d.data[i+2] = 255 - d.data[i+2];
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** 对比压缩：k 越小对比越低（0.18 → 低对比，0.08 → 极淡） */
export function contrast(c, k) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const v = d.data[i + ch];
      d.data[i + ch] = 255 - (255 - v) * k;
    }
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** 高斯模糊 */
export function blur(c, r) {
  const out = document.createElement('canvas');
  out.width = c.width; out.height = c.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.filter = `blur(${r}px)`;
  ctx.drawImage(c, 0, 0);
  ctx.filter = 'none';
  return out;
}

/* ---------- 可播种随机源 ----------
 *
 * 噪点原本用 Math.random，每次跑基准得到的图都不一样。
 * 后果很严重：同一个用例有时通过有时失败，
 * 于是「优化是否有效」根本无法判断。
 *
 * 改成可播种的伪随机数发生器（mulberry32），
 * 每个用例用固定种子，保证同一用例每次跑出的噪点完全一致，
 * 不同用例之间又互不相同。
 */
let _rngState = 0;
export function seedRng(seed) { _rngState = seed >>> 0; }
export function rng() {
  _rngState = (_rngState + 0x6D2B79F5) >>> 0;
  let t = _rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 加噪（amt 是相对 255 的幅度） */
export function noise(c, amt) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const amp = amt * 255;
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (rng() * 2 - 1) * amp;
    d.data[i] += n; d.data[i+1] += n; d.data[i+2] += n;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/* ---------- 整幅画面上的形变 ---------- */

/** 透视：k 是强度，0.15 轻、0.60 重 */
export function persp(c, k) {
  const w = c.width, h = c.height, m = Math.round(w * 0.06);
  const d = Math.round(w * k * 0.35);
  return applyH(c, [[m, m], [w - m, m + d], [w - m - d, h - m], [m + d, h - m]], w, h);
}

/** 绕中心旋转 */
export function rot(c, deg) {
  const w = c.width, h = c.height;
  const out = document.createElement('canvas');
  const s = Math.ceil(Math.sqrt(w * w + h * h));
  out.width = s; out.height = s;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s, s);
  ctx.translate(s / 2, s / 2); ctx.rotate(deg * Math.PI / 180);
  ctx.drawImage(c, -w / 2, -h / 2);
  return out;
}

/** 缩放到指定边长 */
export function resize(c, px) {
  const out = document.createElement('canvas');
  out.width = px; out.height = px;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, px, px);
  return out;
}

/** 遮挡：顶部一条 + 右下一块 */
export function occlude(c, frac) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const w = c.width, h = c.height;
  ctx.fillStyle = '#333';
  ctx.fillRect(0, 0, w, Math.round(h * frac * 0.5));
  ctx.fillRect(w * 0.6, h * 0.7, Math.round(w * frac), Math.round(h * frac));
  return c;
}

/**
 * 径向桶形弯曲，参考系是**整幅画面**（中心在画面中心、半径为画面对角线一半）。
 *
 * 与 barrel() 的区别在参考系：
 * barrel() 以被摄码自身为参考（镜头畸变是相对被摄物施加的），
 * curve() 以画面为参考（码铺满画面时两者等价）。
 */
export function curve(c, k) {
  const w = c.width, h = c.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const o = new Uint8ClampedArray(w * h * 4);
  const cx = w / 2, cy = h / 2, R = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    const f = r === 0 ? 1 : (1 + k * (r / R) * (r / R));
    const sx = Math.round(cx + dx * f), sy = Math.round(cy + dy * f);
    const oi = (y * w + x) * 4;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) { o[oi]=255;o[oi+1]=255;o[oi+2]=255;o[oi+3]=255; continue; }
    const si = (sy * w + sx) * 4;
    o[oi]=img[si];o[oi+1]=img[si+1];o[oi+2]=img[si+2];o[oi+3]=255;
  }
  ctx.putImageData(new ImageData(o, w, h), 0, 0);
  return out;
}

/* ---------- 摄像头场景 ---------- */

/**
 * 把码放进 640×480 场景，叠加各类退化。
 * 顺序：透视 → 桶形弯曲（相对码自身） → 光照渐变 → 噪声 → 模糊。
 */
export function scene(qr, o = {}) {
  const W = 640, H = 480;
  const size = o.size ?? 200;
  const cx = o.cx ?? W / 2, cy = o.cy ?? H / 2;
  const half = size / 2;
  const m = Math.round(size * 0.06);
  const d = Math.round(size * (o.persp ?? 0) * 0.35);
  const quad = [
    [cx - half + m, cy - half + m],
    [cx + half - m, cy - half + m + d],
    [cx + half - m - d, cy + half - m],
    [cx - half + m + d, cy + half - m],
  ];
  const out = applyH(qr, quad, W, H);
  if (o.curve) barrel(out, cx, cy, size * Math.SQRT2 / 2, o.curve);
  if (o.invert) invert(out);
  if (o.grad) gradient(out);
  // 播种：同一组参数永远得到同一张图，基准结果才可复现
  if (o.noise) {
    seedRng(o.seed ?? 12345);
    noise(out, o.noise);
  }
  if (o.blur) blur(out, o.blur);
  return out;
}

/**
 * 非等向桶形场景：与 scene() 相同，但桶形用各向异性的版本。
 */
export function sceneAniso(qr, o = {}) {
  const W = 640, H = 480;
  const size = o.size ?? 200;
  const cx = o.cx ?? W / 2, cy = o.cy ?? H / 2;
  const half = size / 2;
  const m = Math.round(size * 0.06);
  const d = Math.round(size * (o.persp ?? 0) * 0.35);
  const quad = [
    [cx - half + m, cy - half + m],
    [cx + half - m, cy - half + m + d],
    [cx + half - m - d, cy + half - m],
    [cx - half + m + d, cy + half - m],
  ];
  const out = applyH(qr, quad, W, H);
  barrelAniso(out, cx, cy, size * Math.SQRT2 / 2, o.kx ?? 0.35, o.ky ?? 0.35);
  if (o.grad) gradient(out);
  if (o.noise) { seedRng(o.seed ?? 12345); noise(out, o.noise); }
  if (o.blur) blur(out, o.blur);
  return out;
}

/**
 * 局部弯曲场景：径向模型表达不了的形变。
 */
export function sceneLocal(qr, o = {}) {
  const W = 640, H = 480;
  const size = o.size ?? 200;
  const cx = o.cx ?? W / 2, cy = o.cy ?? H / 2;
  const half = size / 2;
  const m = Math.round(size * 0.06);
  const quad = [
    [cx - half + m, cy - half + m],
    [cx + half - m, cy - half + m],
    [cx + half - m, cy + half - m],
    [cx - half + m, cy + half - m],
  ];
  const out = applyH(qr, quad, W, H);
  barrelLocal(out, cx, cy, size * Math.SQRT2 / 2, o.A ?? 0, o.lambda ?? 120);
  if (o.noise) { seedRng(o.seed ?? 12345); noise(out, o.noise); }
  if (o.blur) blur(out, o.blur);
  return out;
}

/* ---------- 用例集 ---------- */

/**
 * 非等向桶形场景：横向与纵向弯曲强度不同。
 * kx = ky 时与 SCENE_CASES 里的桶形用例等价。
 */
export const ANISO_CASES = [
  { name: 'an-equal', label: '非等向测试：各向同性 k=0.35', kx: 0.35, ky: 0.35 },
  { name: 'an-x', label: '非等向：横向强 0.35 / 纵向弱 0.10', kx: 0.35, ky: 0.10 },
  { name: 'an-y', label: '非等向：横向弱 0.10 / 纵向强 0.35', kx: 0.10, ky: 0.35 },
  { name: 'an-only-x', label: '非等向：仅横向 0.30', kx: 0.30, ky: 0.0 },
  { name: 'an-only-y', label: '非等向：仅纵向 0.30', kx: 0.0, ky: 0.30 },
  { name: 'an-hard', label: '非等向：0.30/0.12 + 透视 + 噪声', kx: 0.30, ky: 0.12, persp: 0.28, noise: 0.12 },
];

/**
 * 局部弯曲场景：径向模型表达不了的形变。
 *
 * 已知缺口（2026-10-28 实测）：
 *   波形弯曲 A=4px（码 200px 的 2%）就解不出来，
 *   而同强度的径向弯曲能解。
 *   根因已定位：三个定位图案的位置几乎没变（差 1px），
 *   但单应性模型表达不了局部弯曲 —— 矫正后模块网格仍然被弯着。
 *
 *   要解决需要能表达一般形变的模型（薄板样条等），
 *   而 QR 码上可靠的对应点只有 4 个（3 个定位图案 + 1 个对齐图案），
 *   4 个控制点的样条退化成仿射，起不到作用。
 *   补充控制点的路子（沿时序图案做模块级相位追踪）实测不稳定。
 *
 *   所以这一组是「已知缺口」的记录，不是待通过的用例。
 *   它保留在基准里，是为了让未来的改进有明确的对比基准。
 */
export const LOCAL_CASES = [
  { name: 'lc-none', label: '局部弯曲测试：无形变 A=0', A: 0 },
  { name: 'lc-4', label: '局部弯曲 A=4px λ=120', A: 4, lambda: 120 },
  { name: 'lc-8', label: '局部弯曲 A=8px λ=120', A: 8, lambda: 120 },
  { name: 'lc-12', label: '局部弯曲 A=12px λ=120', A: 12, lambda: 120 },
  { name: 'lc-8-l200', label: '局部弯曲 A=8px λ=200', A: 8, lambda: 200 },
  { name: 'lc-8-noise', label: '局部弯曲 A=8px + 噪声 12%', A: 8, lambda: 120, noise: 0.12 },
];
