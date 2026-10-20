/**
 * 文档滤镜：原图 / 黑白 / 增强
 * 输入输出均为 ImageData（原地修改后返回）
 */
import { toGray } from './lib/imgutils.js';

export function applyFilter(imageData, mode) {
  switch (mode) {
    case 'bw': return applyBw(imageData);
    case 'enhance': return applyEnhance(imageData);
    default: return imageData;
  }
}

/**
 * 黑白：光照归一化 + 全局 Otsu + 暗背景抑制
 *
 * 翻拍文档的三个难点与对应处理：
 *   1. 阴影/光照梯度 —— 用大半径窗口估计局部光照，按增益还原到统一纸白，
 *      光照变平之后全局 Otsu 才可靠；
 *   2. 低对比（铅笔字、浅色印刷）—— 归一化后前景背景差距被拉开，
 *      Otsu 能正确分开（纯 Sauvola 在这里会失效：窗口均值被笔画拉低，
 *      阈值塌到笔画亮度以下，整段丢字）；
 *   3. 大片平坦暗区（桌面、深阴影角落）—— 局部均值显著低于纸面且方差≈0，
 *      判为背景强制置白。
 * 所有窗口统计在降采样工作图上用积分图完成，O(1)/像素。
 */
function applyBw(imageData) {
  const { data, width: w, height: h } = imageData;
  const gray = toGray(imageData);

  // 1. 工作分辨率（长边 ≤ 1024）
  const scale = Math.min(1, 1024 / Math.max(w, h));
  const ww = Math.max(8, Math.round(w * scale));
  const wh = Math.max(8, Math.round(h * scale));
  const small = boxBlurGray(downscaleGray(gray, w, h, ww, wh), ww, wh);

  // 2. 积分图：像素和 + 平方和
  const iw = ww + 1;
  const sum = new Float64Array(iw * (wh + 1));
  const sumSq = new Float64Array(iw * (wh + 1));
  for (let y = 0; y < wh; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < ww; x++) {
      const v = small[y * ww + x];
      rowSum += v;
      rowSq += v * v;
      const o = (y + 1) * iw + x + 1;
      sum[o] = sum[o - iw] + rowSum;
      sumSq[o] = sumSq[o - iw] + rowSq;
    }
  }

  // 3. 全局纸面亮度（亮度分布上四分之一的均值，抗深色背景占比高）
  const paperLevel = estimatePaperLevel(small);

  // 4. 双窗口统计
  //    大半径（≈短边 4%）：估计光照，窗口要大于字间距，否则均值被文字拉低，归一化失效
  //    小半径（≈短边 1%）：判断平坦暗区，背景判定必须细粒度，
  //      否则页面边界过渡带（大窗口跨在暗背景与亮纸之间，均值混合方差高）会残留黑边
  const bigR = Math.max(12, Math.round(Math.min(ww, wh) * 0.04));
  const smallR = Math.max(3, Math.round(Math.min(ww, wh) * 0.01));
  const gainMap = new Float32Array(ww * wh);
  const flatMap = new Uint8Array(ww * wh); // 1 = 平坦暗背景
  const darkCut = paperLevel * 0.5;
  const flatStd = 14;
  const MAX_GAIN = 3;
  for (let y = 0; y < wh; y++) {
    const yb0 = Math.max(0, y - bigR);
    const yb1 = Math.min(wh - 1, y + bigR);
    const ys0 = Math.max(0, y - smallR);
    const ys1 = Math.min(wh - 1, y + smallR);
    const rowUpB = yb0 * iw;
    const rowDnB = (yb1 + 1) * iw;
    const rowUpS = ys0 * iw;
    const rowDnS = (ys1 + 1) * iw;
    const rowsB = yb1 - yb0 + 1;
    const rowsS = ys1 - ys0 + 1;
    for (let x = 0; x < ww; x++) {
      const idx = y * ww + x;
      // 大窗口：局部光照 → 增益
      const xb0 = Math.max(0, x - bigR);
      const xb1 = Math.min(ww - 1, x + bigR);
      const ab = rowUpB + xb0;
      const bb = rowUpB + xb1 + 1;
      const cb = rowDnB + xb0;
      const db = rowDnB + xb1 + 1;
      const cntB = rowsB * (xb1 - xb0 + 1);
      const meanB = (sum[db] - sum[bb] - sum[cb] + sum[ab]) / cntB;
      gainMap[idx] = Math.min(MAX_GAIN, Math.max(0.5, paperLevel / Math.max(meanB, 8)));
      // 小窗口：平坦暗区判定
      const xs0 = Math.max(0, x - smallR);
      const xs1 = Math.min(ww - 1, x + smallR);
      const as = rowUpS + xs0;
      const bs = rowUpS + xs1 + 1;
      const cs = rowDnS + xs0;
      const ds = rowDnS + xs1 + 1;
      const cntS = rowsS * (xs1 - xs0 + 1);
      const meanS = (sum[ds] - sum[bs] - sum[cs] + sum[as]) / cntS;
      const s2S = (sumSq[ds] - sumSq[bs] - sumSq[cs] + sumSq[as]) / cntS;
      const stdS = Math.sqrt(Math.max(0, s2S - meanS * meanS));
      flatMap[idx] = (meanS < darkCut && stdS < flatStd) ? 1 : 0;
    }
  }

  // 5. 归一化后做全局 Otsu：光照已平，此时全局阈值才可靠
  const normalized = new Uint8ClampedArray(ww * wh);
  const hist = new Int32Array(256);
  for (let i = 0; i < ww * wh; i++) {
    const v = small[i] * gainMap[i];
    const c = v < 0 ? 0 : v > 255 ? 255 : v;
    normalized[i] = c;
    hist[c | 0]++;
  }
  const T = otsuFromHist(hist, ww * wh);

  // 6. 把全局阈值折回逐像素灰度阈值：gray <= T / gain 等价于 gray * gain <= T
  //    这样全分辨率热循环只需一次双线性采样
  const effThr = new Uint8ClampedArray(ww * wh);
  for (let i = 0; i < ww * wh; i++) {
    effThr[i] = flatMap[i] ? 0 : Math.min(255, T / gainMap[i]); // 0 = 强制白
  }

  // 7. 全分辨率二值化（列映射只算一次）
  const colX0 = new Int32Array(w);
  const colX1 = new Int32Array(w);
  const colFx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const sx = Math.min(ww - 1, Math.max(0, (x + 0.5) / w * ww - 0.5));
    const x0 = Math.floor(sx);
    colX0[x] = x0;
    colX1[x] = Math.min(ww - 1, x0 + 1);
    colFx[x] = sx - x0;
  }

  const bin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(wh - 1, Math.max(0, (y + 0.5) / h * wh - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(wh - 1, y0 + 1);
    const fy = sy - y0;
    const rowA = y0 * ww;
    const rowB = y1 * ww;
    const rowGray = y * w;
    for (let x = 0; x < w; x++) {
      const t = lerp2(effThr, rowA, rowB, colX0[x], colX1[x], colFx[x], fy);
      bin[rowGray + x] = gray[rowGray + x] <= t ? 1 : 0;
    }
  }

  // 8. 写回 RGBA
  for (let j = 0; j < w * h; j++) {
    const v = bin[j] ? 0 : 255;
    const o = j * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
  }
  return imageData;
}

/** 由直方图求 Otsu 阈值 */
function otsuFromHist(hist, total) {
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = v;
    }
  }
  return best;
}


/** 3×3 盒式平滑（可分离），在降采样工作图上去除 JPEG 噪点与纸纹 */
function boxBlurGray(src, w, h) {
  const tmp = new Float32Array(w * h);
  const dst = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const a = src[row + Math.max(0, x - 1)];
      const b = src[row + x];
      const c = src[row + Math.min(w - 1, x + 1)];
      tmp[row + x] = (a + b + c) / 3;
    }
  }
  // 垂直趟：三行滑窗，按行推进维护每列和
  const vAcc = new Float64Array(w);
  let curY0 = 0;
  let curY1 = 0;
  for (let y = 0; y < h; y++) {
    const ny0 = y > 0 ? y - 1 : 0;
    const ny1 = y < h - 1 ? y + 1 : h - 1;
    if (curY1 === 0 && curY0 === 0) {
      for (let i = ny0; i <= ny1; i++) {
        const srcRow = i * w;
        for (let x = 0; x < w; x++) vAcc[x] += tmp[srcRow + x];
      }
      curY1 = ny1 + 1;
    } else {
      for (; curY1 <= ny1; curY1++) {
        const srcRow = curY1 * w;
        for (let x = 0; x < w; x++) vAcc[x] += tmp[srcRow + x];
      }
      for (; curY0 < ny0; curY0++) {
        const srcRow = curY0 * w;
        for (let x = 0; x < w; x++) vAcc[x] -= tmp[srcRow + x];
      }
    }
    const out = y * w;
    for (let x = 0; x < w; x++) dst[out + x] = vAcc[x] / 3;
  }
  return dst;
}

/** 双线性采样（thr/mean/std 三张图共用同一套坐标） */
function lerp2(map, rowA, rowB, ax, bx, fx, fy) {
  const t0 = map[rowA + ax];
  const t1 = map[rowA + bx];
  const b0 = map[rowB + ax];
  const b1 = map[rowB + bx];
  const top = t0 + (t1 - t0) * fx;
  const bot = b0 + (b1 - b0) * fx;
  return top + (bot - top) * fy;
}

/** 估计纸面亮度：亮度分布上四分之一的均值（抗深色背景占比高的场景） */
function estimatePaperLevel(small) {
  const hist = new Int32Array(256);
  for (let i = 0; i < small.length; i++) hist[small[i]]++;
  const quarter = Math.floor(small.length * 0.25);
  let acc = 0;
  let cnt = 0;
  for (let v = 255; v >= 0; v--) {
    acc += v * hist[v];
    cnt += hist[v];
    if (cnt >= quarter) break;
  }
  return cnt > 0 ? acc / cnt : 200;
}

/** 灰度图面积平均降采样（水平/垂直两趟滑动窗口，顺序访问，比嵌套块平均快得多） */
function downscaleGray(src, w, h, dw, dh) {
  if (dw >= w && dh >= h) return src.slice(0);
  const tmp = new Float32Array(dw * h);
  const dst = new Uint8ClampedArray(dw * dh);

  // 水平趟
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const out = y * dw;
    let acc = 0;
    let x0 = 0;
    let x1 = 0;
    for (let x = 0; x < dw; x++) {
      const nx0 = Math.floor((x * w) / dw);
      let nx1 = Math.floor(((x + 1) * w) / dw);
      if (nx1 <= nx0) nx1 = nx0 + 1;
      while (x1 < nx1) { acc += src[row + x1]; x1++; }
      while (x0 < nx0) { acc -= src[row + x0]; x0++; }
      tmp[out + x] = acc / (x1 - x0);
    }
  }

  // 垂直趟：按输出行推进，每列维护滑动和（行顺序访问，缓存友好）
  const vAcc = new Float64Array(dw);
  let curY0 = 0;
  let curY1 = 0;
  for (let y = 0; y < dh; y++) {
    const ny0 = Math.floor((y * h) / dh);
    let ny1 = Math.floor(((y + 1) * h) / dh);
    if (ny1 <= ny0) ny1 = ny0 + 1;
    for (; curY1 < ny1; curY1++) {
      const srcRow = curY1 * dw;
      for (let x = 0; x < dw; x++) vAcc[x] += tmp[srcRow + x];
    }
    for (; curY0 < ny0; curY0++) {
      const srcRow = curY0 * dw;
      for (let x = 0; x < dw; x++) vAcc[x] -= tmp[srcRow + x];
    }
    const out = y * dw;
    const n = ny1 - ny0;
    for (let x = 0; x < dw; x++) dst[out + x] = vAcc[x] / n;
  }
  return dst;
}

/** 增强：灰度 + 2%/98% 分位对比度拉伸 + 轻度 gamma */
/**
 * 增强：保留彩色，做「白平衡 → 光照均匀化 → 对比度 → 锐化」
 *
 * 与扫描类 App 的「增强」一致：去掉纸张发黄与环境光不均，
 * 让纸面接近中性白、文字更锐利，同时保留原有颜色
 *（红笔批注不能被抹成灰色，黑白效果由「黑白」滤镜负责）。
 */
/**
 * 增强：保留彩色，做「白平衡 → 光照均匀化 → 对比度 → 锐化」
 *
 * 与扫描类 App 的「增强」一致：去掉纸张发黄与环境光不均，
 * 让纸面接近中性白、文字更锐利，同时保留原有颜色
 *（红笔批注不能被抹成灰色，黑白效果由「黑白」滤镜负责）。
 */
function applyEnhance(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;

  // 1. 白平衡：估计纸张白点，把纸面拉回中性
  const gains = estimateWhiteBalance(data, n);

  // 2. 光照均匀化：大半径估计背景光照后相除，消除阴影与暗角
  const illum = estimateIllumination(imageData, width, height);

  // 3. 校正后的亮度（白平衡 + 光照都算进去），后面分位数与锐化都用它
  const gray = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const i = j * 4;
    const r = data[i] * gains[0];
    const g = data[i + 1] * gains[1];
    const b = data[i + 2] * gains[2];
    gray[j] = (r * 0.299 + g * 0.587 + b * 0.114) * (illum[j] / 127.5);
  }

  // 4. 对比度：按「校正后」的亮度分位拉伸
  //    （必须在校正之后统计，否则阴影会把分位点拉偏，导致亮区被压暗）
  const { lo, hi } = percentilesOf(gray);
  const range = Math.max(1, hi - lo);

  // 5. 锐化（USM）：与 3×3 模糊的差值放大
  const blur = boxBlur3(gray, width, height);
  const SHARP = 0.7;

  for (let j = 0; j < n; j++) {
    const i = j * 4;
    const g = gray[j];
    // 把亮度映射到 lo..hi，再按比例缩放各通道以保留颜色
    const target = ((g - lo) / range) * 255;
    const scale = g > 1 ? target / g : 1;
    // 锐化只作用在亮度上，幅度按原亮度比例折算到各通道
    const sharp = g + SHARP * (g - blur[j]);
    const sf = g > 1 ? sharp / g : 1;
    const k = scale * sf;
    const il = illum[j] / 127.5;
    data[i] = clamp255(data[i] * gains[0] * il * k);
    data[i + 1] = clamp255(data[i + 1] * gains[1] * il * k);
    data[i + 2] = clamp255(data[i + 2] * gains[2] * il * k);
  }
  return imageData;
}

/**
 * 估计纸张白点，返回三通道增益。
 * 用「白点法」：三个通道里最亮的那个视为真实白，其余按比例拉到同一水平，
 * 泛黄的纸（248,236,204）会变成中性白（248,248,248）。
 */
function estimateWhiteBalance(data, n) {
  const hist = new Int32Array(256);
  const step = Math.max(1, Math.floor(n / 200000));
  let count = 0;
  for (let j = 0; j < n; j += step) {
    const i = j * 4;
    hist[((data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0)]++;
    count++;
  }
  // 取亮度最高的 8% 像素视为纸面
  const cut = count * 0.08;
  let acc = 0;
  let thresh = 250;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= cut) { thresh = v; break; }
  }
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let j = 0; j < n; j += step) {
    const i = j * 4;
    const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    if (lum >= thresh) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; sn++; }
  }
  if (sn === 0) return [1, 1, 1];
  const mr = sr / sn;
  const mg = sg / sn;
  const mb = sb / sn;
  const maxC = Math.max(mr, mg, mb);
  const minC = Math.min(mr, mg, mb);
  // 纸面应够亮且通道差异不悬殊，否则多半不是纸（暗场景、彩色封面），不做白平衡
  if (maxC < 90 || maxC > 252 || maxC / Math.max(1, minC) > 1.7) return [1, 1, 1];
  // 增益 = 最亮通道 / 各通道，限制幅度避免过冲
  const cl = (v) => Math.min(1.3, Math.max(0.75, maxC / Math.max(1, v)));
  return [cl(mr), cl(mg), cl(mb)];
}

/**
 * 估计光照场：把图缩到很小的尺寸后取局部最大亮度（忽略文字），
 * 再用 canvas 双线性放大回原尺寸，逐像素相除做归一化。
 * 重活在小图上做、放大交给 GPU，12MP 也只要百来毫秒。
 */
function estimateIllumination(imageData, width, height) {
  const n = width * height;
  const LONG = 96;
  const scale = Math.min(1, LONG / Math.max(width, height));
  const sw = Math.max(4, Math.round(width * scale));
  const sh = Math.max(4, Math.round(height * scale));

  // 降采样交给 canvas（GPU 面积平均），比手写逐块平均快一个量级
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  srcCtx.putImageData(imageData, 0, 0);
  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = sw;
  smallCanvas.height = sh;
  const smallCtx = smallCanvas.getContext('2d', { willReadFrequently: true });
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = 'high';
  smallCtx.drawImage(srcCanvas, 0, 0, sw, sh);
  const smallPixels = smallCtx.getImageData(0, 0, sw, sh).data;

  // 小图上的亮度
  const small = new Float32Array(sw * sh);
  for (let i = 0; i < small.length; i++) {
    const p = i * 4;
    small[i] = smallPixels[p] * 0.299 + smallPixels[p + 1] * 0.587 + smallPixels[p + 2] * 0.114;
  }
  srcCanvas.width = srcCanvas.height = 0;

  // 3×3 局部最大：滤掉文字的影响，只留纸面亮度
  const paper = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= sh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= sw) continue;
          const v = small[yy * sw + xx];
          if (v > m) m = v;
        }
      }
      paper[y * sw + x] = m;
    }
  }

  // 参考白：取偏亮的一档（避免个别高光把基准拉太高）
  const sorted = Array.from(paper).sort((a, b) => b - a);
  const P = sorted[Math.floor(sorted.length * 0.15)] || 255;

  // 归一化系数 P / L，限制在 [0.55, 1.8]
  const ratio = new Float32Array(sw * sh);
  for (let i = 0; i < ratio.length; i++) {
    const L = Math.max(20, paper[i]);
    ratio[i] = Math.min(1.8, Math.max(0.55, P / L));
  }

  // 交给 canvas 做双线性放大（GPU，比手写插值快得多）
  const ratioCanvas = document.createElement('canvas');
  ratioCanvas.width = sw;
  ratioCanvas.height = sh;
  const rctx = ratioCanvas.getContext('2d', { willReadFrequently: true });
  const rData = rctx.createImageData(sw, sh);
  for (let i = 0; i < ratio.length; i++) {
    const v = Math.min(255, ratio[i] * 127.5); // ratio 0.55~1.8 映射到 0~255
    rData.data[i * 4] = v;
    rData.data[i * 4 + 1] = v;
    rData.data[i * 4 + 2] = v;
    rData.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(rData, 0, 0);

  const bigCanvas = document.createElement('canvas');
  bigCanvas.width = width;
  bigCanvas.height = height;
  const bctx = bigCanvas.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(ratioCanvas, 0, 0, width, height);
  const up = bctx.getImageData(0, 0, width, height).data;

  // 还原为逐像素系数（用 Uint8 存，12MP 时省下约 36MB 内存）
  const out = new Uint8Array(n);
  for (let j = 0; j < n; j++) out[j] = up[j * 4];
  return out;
}

/** 亮度分位数（用于对比度拉伸），输入为已校正的亮度数组 */
function percentilesOf(values) {
  const hist = new Int32Array(256);
  const step = Math.max(1, Math.floor(values.length / 200000));
  let count = 0;
  for (let j = 0; j < values.length; j += step) {
    const v = values[j] < 0 ? 0 : values[j] > 255 ? 255 : values[j];
    hist[v | 0]++;
    count++;
  }
  const pick = (q) => {
    const target = count * q;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  return { lo: pick(0.02), hi: pick(0.98) };
}

/** 3×3 可分离盒式模糊（USM 的模糊项） */
function boxBlur3(src, width, height) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const a = src[row + (x > 0 ? x - 1 : 0)];
      const b = src[row + x];
      const c = src[row + (x < width - 1 ? x + 1 : width - 1)];
      tmp[row + x] = (a + b + c) / 3;
    }
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const up = (y > 0 ? y - 1 : 0) * width;
    const dn = (y < height - 1 ? y + 1 : height - 1) * width;
    for (let x = 0; x < width; x++) {
      out[row + x] = (tmp[up + x] + tmp[row + x] + tmp[dn + x]) / 3;
    }
  }
  return out;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}


/** 估计纸张白点，返回三通道增益（把偏黄的纸拉回中性） */
