/**
 * 二维码解码增强模块（共享）
 *
 * 纯前端、无网络、无新增依赖。基于 jsQR 的定位与解码能力，
 * 在其前面加一层几何 + 光度预处理，提升变形码识别率。
 *
 * 直接 jsQR 单次直调在合成变形测试集上成功率 58.6%，失败原因分四类且互相独立：
 *   光度类 —— 低对比、光照渐变、重噪声
 *   尺度类 —— 码太小，每模块像素不足
 *   几何类 —— 强透视、桶形弯曲
 *   区域类 —— 大图里的小码
 * 因此用正交策略级联覆盖，而不是简单堆阈值。
 *
 * 矫正后的定位结果会用逆单应性映射回原图坐标，调用方拿到的 location 始终是原图坐标。
 */

import jsQR from 'jsqr';

/* ========== 基础：像素与灰度 ========== */

export function toImageData(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** RGBA ImageData → 单通道灰度 */
export function toGray(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  return { gray, w: width, h: height };
}

/** 灰度数组 → 画布（RGB 三通道等值，交给 jsQR 自行二值化） */
export function grayToCanvas(gray, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const v = gray[i];
    out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255;
  }
  ctx.putImageData(new ImageData(out, w, h), 0, 0);
  return c;
}

/** Otsu 全局阈值 */
export function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, maxVar = 0, thr = 128;
  // 记录所有并列最优阈值：双峰图像（如纯黑纯白的二值图）会让整段阈值
  // 的类间方差完全相同，此时取中位数比取最左边的 0 稳健得多。
  const plateau = [];
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar * 1.0000001) {
      maxVar = between;
      plateau.length = 0;
      plateau.push(t);
    } else if (between > maxVar * 0.9999999 && plateau.length) {
      plateau.push(t);
    }
  }
  if (plateau.length) {
    thr = plateau[Math.floor(plateau.length / 2)];
  }
  return thr;
}

/** 灰度 → 二值（1 = 暗） */
export function binarize(gray, thr) {
  const bin = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) bin[i] = gray[i] <= thr ? 1 : 0;
  return bin;
}

/* ========== 光度处理 ========== */

/**
 * Sauvola 局部自适应二值化。
 *
 * 背景：全局 Otsu 阈值有一个硬性前提 —— 前景与背景的对比度在整幅图里一致。
 * 一旦画面存在光照渐变或阴影，这个前提就崩了：
 * 阈值只能取一个数，而画面里不同位置的对比度天差地别。
 *
 * 实测（640×480 场景，码 200px，叠加渐变+重噪声+2px 模糊）：
 *   全局 Otsu   暗像素占比 43%，定位图案召回率 1/3（140px 码上是 0/3）
 *   Sauvola     暗像素占比 22%，定位图案召回率 3/3
 * 召回率是「三个真定位图案有没有被 findFinderPatterns 检出」，
 * 用同几何、无光度退化的干净图作参考答案逐一比对得出。
 *
 * 为什么有效：Sauvola 的阈值是逐窗口的
 *   T = m · (1 + k · (σ/R − 1))
 * 亮区（σ 小）阈值贴近均值 → 判暗；暗区（σ 大）阈值抬高 → 判亮。
 * 这让「局部比周围亮/暗」成为判据，而不是「比某个固定灰度暗」。
 * 于是渐变造成的极性反转（局部背景比码的白模块还暗）不再致命 ——
 * 实测该场景左侧背景灰度 88、码的白模块 217，全局阈值无解，局部阈值无碍。
 *
 * 代价：需要两个积分图（和与平方和），O(w·h) 时间与空间。
 *
 * @param {Uint8ClampedArray} gray 灰度
 * @param {number} w 宽
 * @param {number} h 高
 * @param {object} opts
 *   win  窗口边长（奇数），应略大于码的模块尺寸
 *   k    阈值调节系数（0.2 为常用值；越大越保守，判暗越少）
 *   R    动态范围上限（标准差归一化用，灰度图取 128）
 * @returns {Uint8Array} 1 = 暗
 */
export function sauvolaBinarize(gray, w, h, opts = {}) {
  const win = opts.win ?? 25;
  const k = opts.k ?? 0.2;
  const R = opts.R ?? 128;
  const r = Math.max(1, win >> 1);

  // 两个积分图：像素和、像素平方和
  const I1 = new Float64Array((w + 1) * (h + 1));
  const I2 = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rs2 = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      rs += v;
      rs2 += v * v;
      I1[(y + 1) * (w + 1) + (x + 1)] = I1[y * (w + 1) + (x + 1)] + rs;
      I2[(y + 1) * (w + 1) + (x + 1)] = I2[y * (w + 1) + (x + 1)] + rs2;
    }
  }

  const out = new Uint8Array(gray.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s1 = I1[(y1 + 1) * (w + 1) + (x1 + 1)] - I1[y0 * (w + 1) + (x1 + 1)]
        - I1[(y1 + 1) * (w + 1) + x0] + I1[y0 * (w + 1) + x0];
      const s2 = I2[(y1 + 1) * (w + 1) + (x1 + 1)] - I2[y0 * (w + 1) + (x1 + 1)]
        - I2[(y1 + 1) * (w + 1) + x0] + I2[y0 * (w + 1) + x0];
      const m = s1 / area;
      const varr = s2 / area - m * m;
      const sd = varr > 0 ? Math.sqrt(varr) : 0;
      const T = m * (1 + k * (sd / R - 1));
      out[y * w + x] = gray[y * w + x] < T ? 1 : 0;
    }
  }
  return out;
}

/**
 * 分位数对比拉伸：把 [lo, hi] 区间拉到满量程。
 * 低对比、光照渐变、阴影类失效的主因是动态范围被压缩。
 */
export function normalizeGray(gray, w, h, lowP = 0.02, highP = 0.98) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  const loTarget = total * lowP, hiTarget = total * highP;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= loTarget) { lo = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= hiTarget) { hi = v; break; } }
  if (hi - lo < 8) return { gray, w, h, lo, hi, changed: false };
  const out = new Uint8ClampedArray(gray.length);
  const scale = 255 / (hi - lo);
  for (let i = 0; i < gray.length; i++) {
    const v = (gray[i] - lo) * scale;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return { gray: out, w, h, lo, hi, changed: true };
}

/** 3×3 中值滤波：抑制椒盐类重噪声 */
export function medianFilter(gray, w, h) {
  const out = new Uint8ClampedArray(gray.length);
  const buf = new Array(9);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0;
    const y1 = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x1 = x < w - 1 ? x + 1 : w - 1;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          buf[n++] = gray[(y0 + dy) * w + (x0 + dx)];
        }
      }
      // 9 元素插入排序取中位
      for (let i = 1; i < 9; i++) {
        const v = buf[i];
        let j = i - 1;
        while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
        buf[j + 1] = v;
      }
      out[y * w + x] = buf[4];
    }
  }
  return out;
}

/** 3×3 盒式模糊（可分离） */
function boxBlur3(gray, w, h) {
  const tmp = new Uint8ClampedArray(gray.length);
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = gray[y * w + Math.max(0, x - 1)];
      const b = gray[y * w + x];
      const c = gray[y * w + Math.min(w - 1, x + 1)];
      tmp[y * w + x] = (a + b + c) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(h -  1, y + 1);
    for (let x = 0; x < w; x++) {
      const a = tmp[y0 * w + x], b = tmp[y * w + x], c = tmp[y1 * w + x];
      out[y * w + x] = (a + b + c) / 3;
    }
  }
  return out;
}

/** 反锐化掩模：提亮边缘锐度，对付运动模糊与失焦 */
export function unsharpMask(gray, w, h, amount = 0.8) {
  const blur = boxBlur3(gray, w, h);
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i] + amount * (gray[i] - blur[i]);
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/**
 * 逆径向（反桶形）重采样：抵消弯曲类变形。
 *
 * 参考系（中心与半径）决定畸变的相对强度：
 * 桶形弯曲总是相对「被拍摄的那个物体」施加的，而不是相对整幅画面。
 * 若用整幅画布当参考系，同一个 k 在「码占满画面」与「码占画面一小块」
 * 两种场景下的实际效果会相差几十倍 —— 后者会弱到完全无效。
 *
 * 所以这里允许传入自定义参考系：cx/cy 是畸变中心，R 是归一化半径。
 * 不传时退回整幅画布（保持旧行为）。
 */
export function unbarrel(gray, w, h, k, ref = null) {
  if (!k) return gray;
  const out = new Uint8ClampedArray(gray.length);
  const cx = ref && ref.cx != null ? ref.cx : w / 2;
  const cy = ref && ref.cy != null ? ref.cy : h / 2;
  // 参考半径：给定则用它，否则取画布半对角线
  const R = ref && ref.R ? ref.R : Math.sqrt((w / 2) * (w / 2) + (h / 2) * (h / 2));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / R;
      const f = 1 + k * r * r;
      const sx = cx + dx / f, sy = cy + dy / f;
      out[y * w + x] = bilinear(gray, w, h, sx, sy);
    }
  }
  return out;
}

/**
 * 归一化桶形撤销：按绝对像素半径的二次项做径向重采样。
 *
 * 与 unbarrel 的区别有三点，都是实测逼出来的：
 *
 * 1) 参数是「绝对」而非相对半径。
 *    桶形畸变的实际强度等于「码边缘处的径向缩放量」，用相对半径归一化时
 *    参考半径 R 必须准确 —— 而 R 在畸变图上根本估不准
 *    （实测同一场景检测值 262px、真值 141px）。
 *    改成绝对二次项 α（单位 px⁻²）后，畸变强度与参考半径解耦。
 *
 * 2) 撤销方向：采样点必须落在「更内侧」。
 *    施加畸变时输出像素取的是更外侧的输入（内容被压向中心），
 *    撤销就要取回更内侧的点，于是缩放因子 f = 1 + α r² 中 α 必须为负。
 *
 * 3) 有效撤销强度约为施加强度的一半。
 *    五个场景实测 α_undo · R_code² 全部落在 −k_bench/2 上：
 *    sc-hard −6.25e-6×141²=−0.124（施加 0.25）、
 *    sc-curve −8.75e-6×141²=−0.174（施加 0.35）、
 *    sc-corner-curve −1.37e-5×113²=−0.175（施加 0.35）。
 *
 * @param {Uint8ClampedArray} gray 源灰度
 * @param {number} w 宽
 * @param {number} h 高
 * @param {number} alpha 二次项系数（px⁻²，撤销取负值）
 * @param {number} cx 畸变中心 x
 * @param {number} cy 畸变中心 y
 * @returns {Uint8ClampedArray} 撤销后的灰度
 */
export function unbarrelAlpha(gray, w, h, alpha, cx, cy) {
  if (!alpha) return gray;
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const f = 1 + alpha * (dx * dx + dy * dy);
      out[y * w + x] = bilinear(gray, w, h, cx + dx * f, cy + dy * f);
    }
  }
  return out;
}

/**
 * 桶形撤销（局部输出）。
 *
 * 与 unbarrelAlpha 的唯一区别是「只算一块区域，但采样仍用整幅图」：
 *   输出区域 = [rx, ry, rw, rh]（整图坐标）
 *   采样源   = 整幅 gray
 *
 * 为什么要这么做：畸变中心通常不在码上。
 * 真实镜头畸变以画面中心为心，而码可能在角落；
 * 此时若把画面裁到码附近，撤销所需的采样点就落在裁剪区之外，
 * 整图撤销又会因为画面大而昂贵（每候选 O(整图像素)）。
 * 只算局部、采样用整图，两个问题同时解决 ——
 * 数学上与整图撤销在区域内完全等价（同一套公式、同一份源数据）。
 */
export function unbarrelRegion(src, w, h, rx, ry, rw, rh, alpha, cx, cy) {
  const out = new Uint8ClampedArray(rw * rh);
  if (!alpha) {
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) out[y * rw + x] = src[(ry + y) * w + rx + x];
    }
    return out;
  }
  for (let y = 0; y < rh; y++) {
    const dy = ry + y - cy;
    for (let x = 0; x < rw; x++) {
      const dx = rx + x - cx;
      const f = 1 + alpha * (dx * dx + dy * dy);
      out[y * rw + x] = bilinear(src, w, h, cx + dx * f, cy + dy * f);
    }
  }
  return out;
}

/**
 * 桶形撤销候选的评分：版本一致性 + 时序图案交替率。
 *
 * 两个信号都只看「网格是否已经恢复规整」，不需要解码。
 *
 * 版本一致性（pen）：
 *   定位图案中心距 ÷ 平均模块尺寸 应当是 4v+10（v 为版本号）。
 *   桶形残余会让两条直角边同时偏离且互不相等，
 *   于是「让两条边落在同一个 4v+10 上」的最小误差可作为评分。
 *
 * 时序图案交替率（geo）：
 *   QR 的第 6 行与第 6 列是黑白交替的长条，横跨整个符号。
 *   撤销正确时整条线严格交替（接近 100%）；
 *   残余畸变会把它破坏（随机数据区约 50%）。
 *   三个定位图案拟合出仿射变换后即可采样，无需第四个对应点、无需解码。
 *
 * 实测：分参考中心各自排序时，可解候选在 geo 下的最好排名为 1~7，
 * 在 pen 下为 1~7 —— 两者都不完美，所以生产实现取两者的并集。
 */
export function barrelCandidateScore(gray, w, h, patterns, thr) {
  let minPen = Infinity;
  let maxGeo = 0;
  const n = Math.min(patterns.length, 24);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        const t = [patterns[a], patterns[b], patterns[c]];
        for (let tl = 0; tl < 3; tl++) {
          const TL = t[tl], P = t[(tl + 1) % 3], Q = t[(tl + 2) % 3];
          const mss = [TL.moduleSize, P.moduleSize, Q.moduleSize].sort((x, y) => x - y);
          if (mss[0] <= 0) continue;
          // 模块尺寸一致性
          const msSpread = (mss[2] - mss[0]) / mss[2];
          if (msSpread > 0.35) continue;
          const l1 = Math.hypot(P.x - TL.x, P.y - TL.y);
          const l2 = Math.hypot(Q.x - TL.x, Q.y - TL.y);
          if (l1 < 8 || l2 < 8) continue;
          // 直角
          const cos = ((P.x - TL.x) * (Q.x - TL.x) + (P.y - TL.y) * (Q.y - TL.y)) / (l1 * l2);
          const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
          if (Math.abs(ang - 90) > 22) continue;
          // 两条直角边等长
          const lenSpread = Math.abs(l1 - l2) / Math.max(l1, l2);
          if (lenSpread > 0.3) continue;

          const avgMs = (mss[0] + mss[1] + mss[2]) / 3;
          const n1 = l1 / avgMs, n2 = l2 / avgMs;
          let pen = Infinity, ver = 0;
          for (let v = 1; v <= 40; v++) {
            const target = 4 * v + 10;
            const p = Math.abs(n1 - target) + Math.abs(n2 - target);
            if (p < pen) { pen = p; ver = v; }
          }
          if (pen < minPen) minPen = pen;

          // 时序图案交替率
          //
          // 只在版本一致性足够好的三元组上算：
          // 版本对不上的三元组，其「模块坐标 → 图像坐标」映射本身就不成立，
          // 采出来的交替率是噪声。pen ≤ 4 意味着两条直角边都能对上同一个 4v+10。
          if (pen > 4) continue;
          const dim = 4 * ver + 17;
          if (dim < 21 || dim > 45) continue;
          const geo = timingAlternation(gray, w, h, thr, TL, P, Q, dim);
          if (geo > maxGeo) maxGeo = geo;
          if (maxGeo >= 0.95 && minPen <= 0.5) return { pen: minPen, geo: maxGeo };
        }
      }
    }
  }
  return { pen: isFinite(minPen) ? minPen : Infinity, geo: maxGeo };
}

/**
 * 由三个定位图案拟合仿射变换，采样时序图案并计算交替率。
 * 返回 0~1，越接近 1 表示网格越规整。
 */function timingAlternation(gray, w, h, thr, TL, P, Q, dim) {
  const dst = [[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5]];
  const src = [[TL.x, TL.y], [P.x, P.y], [Q.x, Q.y]];
  const du = [], dv = [], dx = [], dy = [];
  for (let i = 1; i < 3; i++) {
    du.push(dst[i][0] - dst[0][0]); dv.push(dst[i][1] - dst[0][1]);
    dx.push(src[i][0] - src[0][0]); dy.push(src[i][1] - src[0][1]);
  }
  const det = du[0] * dv[1] - du[1] * dv[0];
  if (Math.abs(det) < 1e-9) return 0;
  const a = (dx[0] * dv[1] - dx[1] * dv[0]) / det;
  const b = (du[0] * dy[1] - du[1] * dy[0]) / det;
  const c = (dy[0] * dv[1] - dy[1] * dv[0]) / det;
  const d = (du[0] * dy[1] - du[1] * dy[0]) / det;
  // 仿射映射：模块坐标 → 图像坐标。
  //
  // 上面解出的是「差分关系」src[i] - src[0] = M·(dst[i] - dst[0])，
  // 所以还原成坐标形式是 src[0] + M·(u - dst[0])。
  //
  // 这里曾经写成 dst[0] + M·u —— 少了一项平移，
  // 误差 = dst[0] - src[0] + M·dst[0]。
  // 码越大（M 大）误差被摊薄、影响越小；
  // 模块越小时这个偏移占模块的比例越大，采样直接落到隔壁模块上，
  // 交替率被彻底破坏 ——
  // 实测修正前场景用例（640×480、码 140~200px、每模块 3~5 像素）
  // 的 geo 全部是 0，修正后是 0.75~1.0；
  // 主用例里 rotate-arbit 从 0 变 1、persp-45 从 0.75 变 1。
  const f = (u, v) => [
    src[0][0] + a * (u - dst[0][0]) + b * (v - dst[0][1]),
    src[0][1] + c * (u - dst[0][0]) + d * (v - dst[0][1]),
  ];
  const alt = (fixed, along) => {
    const bits = [];
    for (let i = 8; i <= dim - 9; i++) {
      const mx = along === 'x' ? i + 0.5 : fixed + 0.5;
      const my = along === 'y' ? i + 0.5 : fixed + 0.5;
      const [sx, sy] = f(mx, my);
      if (!isFinite(sx) || !isFinite(sy)) return 0;
      if (sx < -w || sy < -h || sx > w * 2 || sy > h * 2) return 0;
      bits.push(bilinear(gray, w, h, sx, sy) <= thr ? 1 : 0);
    }
    if (bits.length < 8) return 0;
    let d2 = 0;
    for (let i = 1; i < bits.length; i++) if (bits[i] !== bits[i - 1]) d2++;
    return d2 / (bits.length - 1);
  };
  return Math.max(alt(6, 'x'), alt(6, 'y'));
}

function bilinear(gray, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) {
    const cx = Math.min(w - 1, Math.max(0, Math.round(x)));
    const cy = Math.min(h - 1, Math.max(0, Math.round(y)));
    return gray[cy * w + cx];
  }
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const i = y0 * w + x0;
  const a = gray[i], b = gray[i + 1], c = gray[i + w], d = gray[i + w + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/* ========== 几何：定位图案检测 ========== */

/**
 * 检测三个定位图案（finder pattern）。
 *
 * 定位图案是 7×7 的同心环，横向扫描时明暗交替比例为 1:1:3:1:1。
 * 找出比例吻合的连续 5 段，再做垂直交叉验证。
 */
export function findFinderPatterns(bin, w, h) {
  const found = [];

  // —— 横向扫描 ——
  // 强透视下图案的横向切片比例会失真，纵向扫描作为补充通道
  const runs = [];
  for (let y = 0; y < h; y++) {
    runs.length = 0;
    let x = 0;
    while (x < w) {
      const v = bin[y * w + x];
      let x1 = x;
      while (x1 < w && bin[y * w + x1] === v) x1++;
      runs.push({ v, x0: x, len: x1 - x });
      x = x1;
    }
    for (let i = 0; i + 4 < runs.length; i++) {
      // 必须从暗开始：暗(1) 亮(1) 暗(3) 亮(1) 暗(1)
      if (runs[i].v !== 1) continue;
      const lens = [runs[i].len, runs[i + 1].len, runs[i + 2].len, runs[i + 3].len, runs[i + 4].len];
      const total = lens[0] + lens[1] + lens[2] + lens[3] + lens[4];
      if (total < 7) continue;
      const ms = total / 7;
      if (!matchRatio(lens, ms, 0.55)) continue;
      const cx = runs[i].x0 + lens[0] + lens[1] + lens[2] / 2;
      const cy = crossCheckVertical(bin, w, h, Math.round(cx), y, ms);
      if (cy === null) continue;
      found.push({ x: cx, y: cy, moduleSize: ms, hits: 1, quality: ratioQuality(lens, ms) });
    }
  }

  // —— 纵向扫描 ——
  // 强透视时纵向切片的比例往往比横向更接近理论值，能捞回横向漏掉的图案
  const colRuns = [];
  for (let x = 0; x < w; x++) {
    colRuns.length = 0;
    let y = 0;
    while (y < h) {
      const v = bin[y * w + x];
      let y1 = y;
      while (y1 < h && bin[y1 * w + x] === v) y1++;
      colRuns.push({ v, y0: y, len: y1 - y });
      y = y1;
    }
    for (let i = 0; i + 4 < colRuns.length; i++) {
      if (colRuns[i].v !== 1) continue;
      const lens = [colRuns[i].len, colRuns[i + 1].len, colRuns[i + 2].len, colRuns[i + 3].len, colRuns[i + 4].len];
      const total = lens[0] + lens[1] + lens[2] + lens[3] + lens[4];
      if (total < 7) continue;
      const ms = total / 7;
      if (!matchRatio(lens, ms, 0.55)) continue;
      const cy = colRuns[i].y0 + lens[0] + lens[1] + lens[2] / 2;
      const cx = crossCheckHorizontal(bin, w, h, Math.round(cy), x, ms);
      if (cx === null) continue;
      found.push({ x: cx, y: cy, moduleSize: ms, hits: 1, quality: ratioQuality(lens, ms) });
    }
  }

  return dedupe(found);
}

/**
 * 几何管线统一的定位图案检测入口。
 *
 * 为什么要有这一层：
 *   几何策略都要先找到定位图案才能凑三元组，而图案的来源直接决定成败。
 *   早期实现各处都用「全局 Otsu 阈值 + 找图案」，在重噪声 + 光照渐变下
 *   全局阈值会把分割切坏 —— 实测同一张场景图（640×480，18% 噪声 + 渐变）：
 *     全局 Otsu      检出 1069 个图案（几乎全是噪声碎块）
 *     局部 Sauvola   检出  178 个图案（仍被噪声淹没）
 *     中值 + Sauvola 检出   19 个图案（真图案排在最前，quality 完全保持）
 *
 *   图案池被噪声灌满的代价不只是「多」：
 *     · 三元组枚举是 O(n³)，178 个图案时组合数上百万，是纯浪费
 *     · 候选池按数量截断（取前 20/24 个）时真图案被整批切掉
 *
 * 所以判据不是「哪种方法更好」，而是「当前结果是否可信」：
 *   正常图的图案数稳定在 8~36 个（29 个合成用例 + 12 个场景用例实测），
 *   超过 60 个就说明分割已经坏了 —— 这时改用「中值滤波 + 局部阈值」。
 *   中值滤波把碎块噪声压掉，局部阈值不受光照渐变影响，两者合起来才能
 *   在噪声场景下保住真图案。
 *
 * 代价：中值滤波在 640×480 上约 55ms。只在「结果可疑」时才付。
 *
 * 第二个降级信号是模块尺寸：噪声碎块凑出的假阳性定位图案，
 * 它的模块尺寸只有 1~2 像素（实测噪声图案的模块尺寸中位数为 1），
 * 而真实码的定位图案在 200px 的画面上就有 4 像素左右。
 * 所以「最好的三个图案的模块尺寸中位数 < 2.2」也判定结果不可信。
 * 两个信号取或 —— 数量爆炸与尺寸过小都是噪声的特征。
 *
 * @param {Uint8ClampedArray} gray 源灰度
 * @param {number} w 宽
 * @param {number} h 高
 * @param {number} noisyLimit 图案数超过此值判定分割已坏
 * @returns {Array} 定位图案列表
 */
export function detectFinderPatterns(gray, w, h, opts = {}) {
  const noisyLimit = opts.noisyLimit ?? 60;
  const bin = binarize(gray, otsuThreshold(gray));
  const pats = findFinderPatterns(bin, w, h);
  if (!pats.length) return pats;

  // 结果是否可信：图案太多，或最好的几个图案模块尺寸过小
  let suspicious = pats.length > noisyLimit;
  if (!suspicious) {
    const top = pats.slice().sort((a, b) => a.quality - b.quality).slice(0, 3);
    const ms = top.map((p) => p.moduleSize).sort((a, b) => a - b);
    if (ms[Math.floor(ms.length / 2)] < 2.2) suspicious = true;
  }
  if (!suspicious) return pats;

  // 结果可疑：改用中值 + 局部阈值重试
  const med = medianFilter(gray, w, h);
  const clean = findFinderPatterns(sauvolaBinarize(med, w, h), w, h);
  // 局部阈值在极低对比图上会一个图案都检不出（实测 lowcontrast / faint），
  // 此时宁可留着噪声图案，也不空手而归
  return clean.length >= 3 ? clean : pats;
}

/**
 * 图案检测的结果缓存。
 *
 * 同一次解码里，多个策略会对同一张灰度图各检一次图案
 * （估模块尺寸、几何矫正、桶形扫描…）。
 * 每次检测都是几十毫秒（噪声场景还要额外付中值滤波），
 * 而同一张图的检测结果完全确定 —— 缓存后只算一次。
 *
 * 键是灰度数组本身（WeakMap 不阻止回收）。
 */
const patCache = new WeakMap();

/**
 * 带缓存的图案检测。同一张灰度图只检测一次。
 *
 * @param {Uint8ClampedArray} gray 源灰度
 * @param {number} w 宽
 * @param {number} h 高
 * @returns {Array} 定位图案列表
 */
export function detectFinderPatternsCached(gray, w, h) {
  let hit = patCache.get(gray);
  if (!hit) {
    hit = detectFinderPatterns(gray, w, h);
    patCache.set(gray, hit);
  }
  return hit;
}

/**
 * 由定位图案推出码所在的区域。
 *
 * 区域取「所有检出的图案」的包围盒，而不是单个三元组的 ——
 * 后者不可靠：数据区偶然形成的假阳性图案同样能凑出自洽三元组，
 * 实测一张真实照片上（强透视梯形码）三元组就选错了，
 * 裁出来的区域只有整幅图的 27% 且完全裁歪。
 *
 * 用全部图案的包围盒，代价是区域可能偏大（数据区的假阳性也在里面），
 * 但不会把真正的码裁掉 —— 而「裁掉真码」是不可接受的，
 * 「区域偏大」只是少省一点时间。
 *
 * 外扩量按包围盒尺寸的比例给，固定比例比按模块尺寸推算更稳：
 * 强透视下模块尺寸本身就被压扁了，推不准。
 *
 * @param {Array} patterns 检出的定位图案
 * @param {number} w 图宽
 * @param {number} h 图高
 * @param {number} ext 外扩比例（包围盒尺寸的倍数）
 * @returns {{x, y, w, h}|null}
 */
export function symbolRegion(patterns, w, h, ext = 0.3) {
  if (!patterns || !patterns.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of patterns) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const bw = x1 - x0, bh = y1 - y0;
  const mx = Math.max(20, bw * ext), my = Math.max(20, bh * ext);
  const x = Math.max(0, Math.floor(x0 - mx));
  const y = Math.max(0, Math.floor(y0 - my));
  const rw = Math.min(w - x, Math.ceil(bw + 2 * mx));
  const rh = Math.min(h - y, Math.ceil(bh + 2 * my));
  if (rw < 8 || rh < 8) return null;
  return { x, y, w: rw, h: rh };
}

/**
 * 码在画面里的位置 —— 用于把解码范围从整幅图缩到码附近。
 *
 * 动机：jsQR 自己要在整幅图上找定位图案。
 * 在重噪声场景里（640×480、18% 噪声），一次 jsQR 要 200~960ms；
 * 而码只占画面 10~30% 的面积，裁到码附近后只要 3~90ms。
 * 光度组有 6 个变体，每个变体都要跑一次 jsQR ——
 * 裁剪带来的收益是乘以变体数的。
 *
 * 三元组找不准时（反色码上图案检测不可靠）返回 null，
 * 调用方应退回整幅图 —— 宁可慢，也不能丢命中。
 *
 * @returns {{x, y, w, h, pct}|null} pct 是面积占全图的比例
 */
export function locateSymbol(gray, w, h, opts = {}) {
  const pats = detectFinderPatternsCached(gray, w, h);
  if (pats.length < 3) return null;
  const region = symbolRegion(pats, w, h, opts.ext ?? 0.3);
  if (!region) return null;
  const pct = (region.w * region.h) / (w * h);
  // 裁不到 60% 以下就没有省的意义，只是白裁一次
  if (pct > (opts.minGain ?? 0.6)) return null;
  return { ...region, pct };
}

/**
 * 估码的每模块像素数。
 *
 * 依据是定位图案的模块尺寸：定位图案是 7×7 的结构，
 * 检测器给出的 moduleSize 就是「一个模块占多少像素」。
 *
 * 取 quality 最好的三个图案的模块尺寸中位数 ——
 * 这三个最可能是真正的三个定位图案，它们的模块尺寸相互一致。
 *
 * @returns {number} 每模块像素数；检不出图案时返回 0（表示「未知」）
 */
export function estimateModuleSize(gray, w, h) {
  if (!gray) return 0;
  const pats = detectFinderPatternsCached(gray, w, h);
  if (!pats.length) return 0;
  const top = pats.slice().sort((a, b) => a.quality - b.quality).slice(0, 3);
  const ms = top.map((p) => p.moduleSize).sort((a, b) => a - b);
  return ms[Math.floor(ms.length / 2)];
}

/**
 * 5 段游程与理论比例 1:1:3:1:1 的拟合优度（0 = 完全吻合，越大越偏离）。
 * 用于在候选众多时优先采信高质量的定位图案。
 */
function ratioQuality(lens, ms) {
  const ideal = [ms, ms, 3 * ms, ms, ms];
  let err = 0;
  for (let i = 0; i < 5; i++) {
    err += Math.abs(lens[i] - ideal[i]) / ideal[i];
  }
  return err / 5;
}

/**
 * 判断 5 段游程是否吻合 1:1:3:1:1。
 * tol 越大越宽松 —— 强透视下比例会偏离理论值。
 */
function matchRatio(lens, ms, tol) {
  const maxVar = ms * tol;
  return Math.abs(ms - lens[0]) < maxVar &&
    Math.abs(ms - lens[1]) < maxVar &&
    Math.abs(3 * ms - lens[2]) < 3 * maxVar &&
    Math.abs(ms - lens[3]) < maxVar &&
    Math.abs(ms - lens[4]) < maxVar;
}

/** 垂直方向交叉验证：确认中心列也是接近 1:1:3:1:1 */
function crossCheckVertical(bin, w, h, cx, cy, ms) {
  let up = cy;
  while (up > 0 && bin[(up - 1) * w + cx]) up--;
  let down = cy;
  while (down < h - 1 && bin[(down + 1) * w + cx]) down++;
  const centerLen = down - up + 1;
  // 中心暗段应约为 3 个模块，放宽容差以适配透视
  if (Math.abs(centerLen - 3 * ms) > Math.max(3, ms * 1.2)) return null;
  let u = up;
  while (u > 0 && !bin[(u - 1) * w + cx]) u--;
  const upLen = up - u;
  if (upLen < ms * 0.3) return null;
  let d = down;
  while (d < h - 1 && !bin[(d + 1) * w + cx]) d++;
  const downLen = d - down;
  if (downLen < ms * 0.3) return null;
  return (up + down) / 2;
}

/** 水平方向交叉验证（纵向扫描通道用） */
function crossCheckHorizontal(bin, w, h, cy, cx, ms) {
  let left = cx;
  while (left > 0 && bin[cy * w + left - 1]) left--;
  let right = cx;
  while (right < w - 1 && bin[cy * w + right + 1]) right++;
  const centerLen = right - left + 1;
  if (Math.abs(centerLen - 3 * ms) > Math.max(3, ms * 1.2)) return null;
  let l = left;
  while (l > 0 && !bin[cy * w + l - 1]) l--;
  if (left - l < ms * 0.3) return null;
  let r = right;
  while (r < w - 1 && !bin[cy * w + r + 1]) r++;
  if (r - right < ms * 0.3) return null;
  return (left + right) / 2;
}

/** 合并邻近候选，保留模块尺寸更接近众数的 */
function dedupe(list) {
  const out = [];
  for (const p of list) {
    let merged = false;
    for (const q of out) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < Math.max(p.moduleSize, q.moduleSize) * 2.5) {
        q.hits++;
        if (Math.abs(p.moduleSize - q.moduleSize) < Math.abs(q.moduleSize - q.averageModule)) {
          q.averageModule = p.moduleSize;
        }
        // 保留拟合最好的一次观测作为质量分
        if (p.quality < q.quality) q.quality = p.quality;
        merged = true;
        break;
      }
    }
    if (!merged) out.push({ ...p, averageModule: p.moduleSize });
  }
  // 质量越好越靠前，供后续挑选候选三元组
  out.sort((a, b) => (a.quality - b.quality) || (b.hits - a.hits));
  return out;
}

/* ========== 几何：单应性 ========== */

/** 解 8 元线性方程组，返回 3×3 单应性矩阵（行主序） */
function solveHomography(src, dst) {
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
    [A[i], A[piv]] = [A[piv], A[i]];
    [b[i], b[piv]] = [b[piv], b[i]];
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

function applyH(H, x, y) {
  const W = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / W, (H[3] * x + H[4] * y + H[5]) / W];
}

/**
 * 由三个定位图案推断第四角并做透视矫正。
 * 返回候选矫正结果数组（按可信度排序），空数组表示定位图案不足或几何不可信。
 */
export function rectifyFromFinders(gray, w, h, patterns) {
  return Array.from(rectifyCandidates(gray, w, h, patterns));
}

/**
 * 检测对齐图案（alignment pattern）。
 *
 * 对齐图案是 5×5 的同心方环：
 *   X X X X X
 *   X . . . X
 *   X . X . X
 *   X . . . X
 *   X X X X X
 * 中心行与中心列的明暗游程都是 1:1:1:1:1（暗亮暗亮暗），
 * 与定位图案的 1:1:3:1:1 明显不同。
 *
 * 它的价值在于：版本 ≥ 2 的码，其右下角对齐图案中心在模块坐标里
 * 固定为 (dim - 6.5, dim - 6.5) —— 这是一个已知的对应点。
 * 只用三个定位图案推第四角时，「平行四边形近似」在强透视下会整体错位，
 * 而对齐图案能提供第四个精确对应点，单应性因此被唯一确定。
 *
 * @param {object} opts
 *   tolMid   中间三段长度的相对容差（透视会压缩游程，默认放宽到 0.85）
 *   tolSide  两侧暗段的相对容差
 * @returns {Array<{x:number,y:number,moduleSize:number}>}
 */
export function findAlignmentPatterns(bin, w, h, opts = {}) {
  const tolMid = opts.tolMid ?? 0.55;
  const tolSide = opts.tolSide ?? 0.6;
  const found = [];
  // 逐行找「暗亮暗亮暗」五段
  const runs = [];
  for (let y = 0; y < h; y++) {
    runs.length = 0;
    let x = 0;
    while (x < w) {
      const v = bin[y * w + x];
      let x1 = x;
      while (x1 < w && bin[y * w + x1] === v) x1++;
      runs.push({ v, x0: x, len: x1 - x });
      x = x1;
    }
    for (let i = 0; i + 4 < runs.length; i++) {
      if (runs[i].v !== 1) continue;
      if (runs[i + 1].v !== 0 || runs[i + 2].v !== 1 || runs[i + 3].v !== 0 || runs[i + 4].v !== 1) continue;
      const l0 = runs[i].len, l1 = runs[i + 1].len, l2 = runs[i + 2].len, l3 = runs[i + 3].len, l4 = runs[i + 4].len;
      // 中间三段应各约等于 1 个模块
      const m = (l1 + l2 + l3) / 3;
      if (m < 1.5) continue;
      if (Math.abs(l2 - m) > m * tolMid) continue;
      if (Math.abs(l1 - m) > m * tolMid) continue;
      if (Math.abs(l3 - m) > m * tolMid) continue;
      // 两侧暗段允许与相邻模块连成一片，但不能比 1 模块还窄
      if (l0 < m * tolSide || l4 < m * tolSide) continue;
      const cx = runs[i + 2].x0 + l2 / 2;
      // 纵向交叉验证：中心列也应呈现 1:1:1:1:1
      if (!alignmentVerticalCheck(bin, w, h, Math.round(cx), y, m, opts)) continue;
      // 5×5 网格结构校验：外环暗、中环亮、中心暗
      if (!alignmentGridOk(bin, w, h, cx, y, m, opts)) continue;
      found.push({ x: cx, y, moduleSize: m });
    }
  }
  // 同一位置可能被多行命中，按位置聚类
  const out = [];
  for (const p of found) {
    const hit = out.find((q) => Math.abs(q.x - p.x) < p.moduleSize * 1.5 && Math.abs(q.y - p.y) < p.moduleSize * 1.5);
    if (hit) {
      hit.x = (hit.x + p.x) / 2;
      hit.y = (hit.y + p.y) / 2;
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

/** 纵向验证：中心列上的游程也应接近 1:1:1:1:1 */
function alignmentVerticalCheck(bin, w, h, cx, y, m, opts = {}) {
  const tol = opts.tolVert ?? 0.7;
  // 从 y 附近往上、往下扫，收集中心列游程
  const runs = [];
  let start = Math.max(0, y - Math.round(m * 4));
  let end = Math.min(h, y + Math.round(m * 4) + 1);
  let cur = bin[start * w + cx];
  let st = start;
  for (let yy = start + 1; yy < end; yy++) {
    const v = bin[yy * w + cx];
    if (v !== cur) { runs.push({ v, st, len: yy - st }); cur = v; st = yy; }
  }
  runs.push({ v: cur, st, len: end - st });
  // 找以暗段为中心、左右各一段亮、两侧还有暗的五段组合
  for (let i = 0; i + 4 < runs.length; i++) {
    if (runs[i].v !== 0) continue;
    const l = [runs[i].len, runs[i + 1].len, runs[i + 2].len, runs[i + 3].len, runs[i + 4].len];
    if (runs[i + 1].v !== 1 || runs[i + 2].v !== 0 || runs[i + 3].v !== 1 || runs[i + 4].v !== 0) continue;
    if (Math.abs(l[2] - m) > m * tol) continue;
    if (Math.abs(l[1] - m) > m * tol || Math.abs(l[3] - m) > m * tol) continue;
    // 中心暗段位置应接近 y
    const cy = runs[i + 2].st + l[2] / 2;
    if (Math.abs(cy - y) > m * 1.6) continue;
    return true;
  }
  return false;
}

/** 5×5 网格结构校验 */
function alignmentGridOk(bin, w, h, cx, y, m, opts = {}) {
  const minRatio = opts.gridMin ?? 0.8;
  let ok = 0;
  let total = 0;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const x = Math.round(cx + i * m);
      const yy = Math.round(y + j * m);
      if (x < 0 || yy < 0 || x >= w || yy >= h) return false;
      const r = Math.max(Math.abs(i), Math.abs(j));
      const want = r === 1 ? 0 : 1; // 中环亮，其余暗
      if (bin[yy * w + x] === want) ok++;
      total++;
    }
  }
  return ok >= total * minRatio;
}

/**
 * 在矫正图上寻找对齐图案（alignment pattern）。
 *
 * 对齐图案是 5×5 的同心方环：外环暗、中间环亮、中心暗。
 * 它的位置在模块坐标里是已知的 —— 版本 ≥ 2 的码，其右下角对齐图案
 * 中心固定在 (dim - 6.5, dim - 6.5)。
 *
 * 这解决了透视矫正的关键难题：只用三个定位图案推第四角时，
 * 「平行四边形近似」(BR = P + Q - TL) 只在仿射变换下成立，
 * 强透视下会整体错位。有了对齐图案这个第四对应点，
 * 单应性就能被唯一确定，无需任何猜测。
 *
 * @param {object} rect 矫正结果（含 gray / side / outModule / margin）
 * @param {number} dim  符号模块数
 * @returns {{x:number, y:number, score:number} | null} 模块坐标下的中心
 */
export function findAlignmentInRect(rect, dim, opts = {}) {
  const { gray, side, outModule, margin } = rect;
  if (!gray || dim < 25) return null; // 版本 1 没有对齐图案
  const radius = opts.radius ?? 10;
  const step = opts.step ?? 1;
  const thr = opts.threshold ?? otsuThreshold(gray);

  const toPx = (m) => Math.round((m + margin) * outModule);
  const sample = (mx, my) => {
    const x = toPx(mx), y = toPx(my);
    if (x < 0 || y < 0 || x >= side || y >= side) return -1;
    return gray[y * side + x] <= thr ? 1 : 0;
  };

  const ex = dim - 6.5;
  const ey = dim - 6.5;
  let best = null;
  for (let cy = ey - radius; cy <= ey + radius; cy += step) {
    for (let cx = ex - radius; cx <= ex + radius; cx += step) {
      let score = 0;
      let valid = true;
      for (let j = -2; j <= 2 && valid; j++) {
        for (let i = -2; i <= 2; i++) {
          const v = sample(cx + i, cy + j);
          if (v < 0) { valid = false; break; }
          const r = Math.max(Math.abs(i), Math.abs(j));
          // 外环暗、中环亮、中心暗
          const want = r === 1 ? 0 : 1;
          if (v === want) score++;
        }
      }
      if (!valid) continue;
      if (!best || score > best.score) best = { x: cx, y: cy, score };
    }
  }
  // 25 个采样点里至少 21 个吻合才算真对齐图案
  // （定位图案是 7×7 同心环，在此判据下只能得 17 分，不会混淆）
  return best && best.score >= 21 ? best : null;
}

/**
 * 四点定出的单应性是否与「一个正方形符号」相符。
 *
 * 背景：QR 符号本身是正方形。给定三个定位图案 TL/TR/BL 与一个对齐图案 A，
 * 解出的单应性 H 会把理想正方形的右下角 (dim-3.5, dim-3.5) 映射到源图某点 B。
 * 若这四个点确实来自同一个正方形符号，则
 *   - |B - TR| 与 |TL - TR| 都是正方形边长的投影，比值应在 1 附近
 *     （透视只造成有限偏差）
 *   - |B - BL| 与 |TL - BL| 同理
 *   - |B - A| 应约等于 3 个模块（B 比右下角对齐图案靠外 3 个模块）
 *
 * 这三条检验极其廉价（几次乘加），却能剔掉绝大多数假阳性组合 ——
 * 没有它们，真实组合会被上万个假阳性挤到 warp 预算之外，
 * 于是「检测正确、数学正确」的路径根本没被执行到。
 */
function squareConsistent(H, dim, TL, TR, BL, A, avgMs) {
  const m = 3.5;
  const bp = applyH(H, dim - m, dim - m);
  const B = { x: bp[0], y: bp[1] };
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const eTR = d(TL, TR), eBL = d(TL, BL);
  if (eTR < 1 || eBL < 1) return false;
  const r1 = d(B, TR) / eTR;
  const r2 = d(B, BL) / eBL;
  if (!(r1 > 0.35 && r1 < 2.6)) return false;
  if (!(r2 > 0.35 && r2 < 2.6)) return false;
  // B 与对齐图案相距约 3 个模块
  const r3 = d(B, A) / avgMs;
  if (!(r3 > 0.8 && r3 < 8)) return false;
  return true;
}

/**
 * 单应性在理想点处导出的「1 模块 = 多少源像素」。
 *
 * 数值微分：对理想坐标 (x,y) 求 H 的两个偏导的模长。
 * 透视下这两个方向的长度不等（sx ≠ sy），而检测器给出的
 * moduleSize 是单一标量（来自某一条扫描线的游程），
 * 所以比对时要取两个方向里更接近的那个。
 */
function localScale(H, x, y) {
  const p = applyH(H, x, y);
  const px = applyH(H, x + 1, y);
  const py = applyH(H, x, y + 1);
  return [
    Math.hypot(px[0] - p[0], px[1] - p[1]),
    Math.hypot(py[0] - p[0], py[1] - p[1]),
  ];
}

/**
 * 给「三个定位图案 + 一个对齐图案」构成的候选打分（越小越可信）。
 *
 * 判别原理 —— 尺度场一致性：
 *   单应性一旦确定，它在四个对应点处就各自规定了「1 模块 = 多少像素」。
 *   而检测器在每个点都独立量出了一个 moduleSize。
 *   若四点确实来自同一个码，这些独立测量必须与单应性预测值吻合。
 *
 *   假阳性组合（三元组凑巧成直角、假对齐图案凑巧落在第四角区域）
 *   也能解出一个单应性，但那个单应性给出的尺度场与实测值对不上 ——
 *   这就是把它们挡在重采样之前的关键信号。
 *
 * 真实组合的实测值（强透视 60° 实测）：
 *   TL 预测 12.77/17.70 实测 12.71；TR 9.30/14.32 实测 14.71；
 *   BL 7.53/6.69 实测 7.71；  A 6.56/6.62 实测 6.67
 *   → 总误差 0.068
 */
function squareScore(H, dim, obs) {
  const m = 3.5;
  const ideals = [[m, m], [dim - m, m], [m, dim - m], [dim - 6.5, dim - 6.5]];
  let err = 0;
  for (let i = 0; i < 4; i++) {
    const o = obs[i].moduleSize;
    if (!isFinite(o) || o <= 0) return Infinity;
    const [sx, sy] = localScale(H, ideals[i][0], ideals[i][1]);
    if (!isFinite(sx) || !isFinite(sy)) return Infinity;
    const e = Math.min(Math.abs(sx - o), Math.abs(sy - o)) / o;
    err += e;
  }
  return err;
}

/**
 * 在定位图案候选里找「最像同一个 QR 符号的三元组」，返回其残差。
 *
 * 残差由三项构成：
 *   1) 直角偏差 —— 三个定位图案构成直角三角形
 *   2) 模块尺寸离散度 —— 同一符号的模块尺寸必然一致
 *   3) 版本整数性 —— 两条直角边的模块数都应落在同一个 4v+10 上
 *
 * 用于给「反弯曲系数 k」排序：正确的 k 会让码恢复成规整正方形，
 * 残差最小。实测桶形弯曲场景下，正确系数 +0.2 的残差 0.171 为全场最低。
 *
 * 代价是纯算术（不重采样），比试错一个 k 便宜得多。
 */
export function bestTripleQuality(patterns, opts = {}) {
  const maxP = opts.maxPatterns ?? 20;
  const n = Math.min(patterns.length, maxP);
  let best = Infinity;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        const t = [patterns[a], patterns[b], patterns[c]];
        for (let tl = 0; tl < 3; tl++) {
          const TL = t[tl], P = t[(tl + 1) % 3], Q = t[(tl + 2) % 3];
          const v1 = { x: P.x - TL.x, y: P.y - TL.y };
          const v2 = { x: Q.x - TL.x, y: Q.y - TL.y };
          const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
          if (l1 < 1 || l2 < 1) continue;
          const msArr = [TL.moduleSize, P.moduleSize, Q.moduleSize].sort((x, y) => x - y);
          if (msArr[0] <= 0) continue;
          const msSpread = (msArr[2] - msArr[0]) / msArr[2];
          const cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
          const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
          const n1 = l1 / ((TL.moduleSize + P.moduleSize) / 2);
          const n2 = l2 / ((TL.moduleSize + Q.moduleSize) / 2);
          if (!(n1 > 0) || !(n2 > 0)) continue;
          // 版本整数性：取让两条边同时最接近 4v+10 的版本
          let vp = Infinity;
          for (let v = 1; v <= 40; v++) {
            const target = 4 * v + 10;
            vp = Math.min(vp, Math.abs(n1 - target) + Math.abs(n2 - target));
          }
          const lenSpread = Math.abs(n1 - n2) / Math.max(n1, n2);
          const q = Math.abs(ang - 90) / 90 + msSpread + lenSpread + vp * 0.5;
          if (q < best) best = q;
        }
      }
    }
  }
  return best;
}

/**
 * 从定位图案三元组反推码符号的中心与尺度。
 *
 * 用途：给畸变矫正（反桶形）提供正确的参考系。
 *
 * 背景：桶形弯曲是相对「被拍摄的那个码」施加的，不是相对整幅画面。
 * 同一张照片里，码占满画面时 k=0.3 能矫回来的畸变，
 * 码只占画面 1/4 时需要 k≈1.35 才等效 —— 差四倍多。
 * 若矫正时用整幅画布当参考系，码越小矫正越弱，最后彻底失效。
 *
 * 做法：从三个定位图案的相对位置反推符号中心与边长。
 *   - 三个定位图案分别在符号的左上、右上、左下角
 *   - 它们构成直角等腰三角形，直角顶点即符号的左上角
 *   - 图案中心离符号角点 3.5 个模块
 *   - 图案中心之间的边长 = (4v+10) 个模块
 * 于是「符号边长（像素）= 图案中心边长 + 7 × 模块尺寸」，
 * 「符号中心 = 直角顶点 + (边长/2 - 3.5×模块) 沿两条边的方向」。
 *
 * @returns {{cx, cy, R, side, score, tl, p, q}|null}
 */
export function estimateSymbolFrame(patterns, opts = {}) {
  const maxP = opts.maxPatterns ?? 20;
  const n = Math.min(patterns.length, maxP);
  let best = null;

  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        const t = [patterns[a], patterns[b], patterns[c]];
        for (let tl = 0; tl < 3; tl++) {
          const TL = t[tl], P = t[(tl + 1) % 3], Q = t[(tl + 2) % 3];
          const v1 = { x: P.x - TL.x, y: P.y - TL.y };
          const v2 = { x: Q.x - TL.x, y: Q.y - TL.y };
          const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
          if (l1 < 8 || l2 < 8) continue;

          const msArr = [TL.moduleSize, P.moduleSize, Q.moduleSize].sort((x, y) => x - y);
          if (msArr[0] <= 0) continue;
          const msSpread = (msArr[2] - msArr[0]) / msArr[2];
          const cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
          const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
          const lenSpread = Math.abs(l1 - l2) / Math.max(l1, l2);
          // 几何一致性过滤：模块尺寸接近、构成直角、两边等长
          if (msSpread > 0.55 || Math.abs(ang - 90) > 40 || lenSpread > 0.55) continue;

          const q = (TL.quality || 0) + (P.quality || 0) + (Q.quality || 0);
          const score = Math.abs(ang - 90) / 40 + msSpread / 0.55 + lenSpread / 0.55 + q * 0.5;

          const avgMs = msArr[1];
          // 图案中心之间的边 = (4v+10) 个模块，符号边长比它多 7 个模块
          const side = Math.max(l1, l2) + 7 * avgMs;
          // 直角顶点在符号角内侧 3.5 个模块处
          const off = side / 2 - 3.5 * avgMs;
          const u1 = { x: v1.x / l1, y: v1.y / l1 };
          const u2 = { x: v2.x / l2, y: v2.y / l2 };
          const cx = TL.x + off * u1.x + off * u2.x;
          const cy = TL.y + off * u1.y + off * u2.y;
          // 参考半径取符号半对角线 —— 与「桶形弯曲相对码自身施加」的模型一致
          const R = side * Math.SQRT2 / 2;

          if (!best || score < best.score) {
            best = { cx, cy, R, side, score, tl: TL, p: P, q: Q };
          }
        }
      }
    }
  }
  return best;
}

/**
 * 边长与版本的一致性（QR 符号尺寸的强约束）。
 *
 * 一个 QR 符号里，任意两个定位图案中心之间的模块数是有确定值的：
 * 相邻两个定位图案（如 TL 与 TR）之间恰好是 dim - 7 = 4v + 10 个模块
 * （符号边长 dim = 4v + 17，两端各留 3.5 个模块的定位图案）。
 *
 * 于是「实测边长 ÷ 该边两端的平均模块尺寸」应当落在一个 4v+10 上，
 * 而且两条直角边必须落在**同一个** v 上。
 *
 * 这个约束极强：假三元组的两条边几乎不可能同时对上同一个版本号。
 * 实测（桶形弯曲 +0.2，版本 4）：两条边分别给出 26.0 与 26.3 模块，
 * 而 4×4+10 = 26 —— 精确吻合。
 *
 * @returns {{version:number, penalty:number}} penalty 越小越可信
 */
function edgeVersionScore(l1, l2, ms1a, ms1b, ms2a, ms2b) {
  const n1 = l1 / ((ms1a + ms1b) / 2);
  const n2 = l2 / ((ms2a + ms2b) / 2);
  let best = { version: 0, penalty: Infinity };
  for (let v = 1; v <= 40; v++) {
    const target = 4 * v + 10;
    const p = Math.abs(n1 - target) + Math.abs(n2 - target);
    if (p < best.penalty) best = { version: v, penalty: p };
  }
  return best;
}

/**
 * 尺度场一致性打分的三点版本（路径 B 用）。
 *
 * 路径 B 只有三个定位图案作对应点，没有对齐图案，
 * 所以只能在三个定位图案处检查尺度一致性。
 * 判别力弱于四点版本，但足以把绝大多数假阳性排到后面。
 */
function squareScore3(H, dim, obs) {
  const m = 3.5;
  const ideals = [[m, m], [dim - m, m], [m, dim - m]];
  let err = 0;
  for (let i = 0; i < 3; i++) {
    const o = obs[i].moduleSize;
    if (!isFinite(o) || o <= 0) return Infinity;
    const [sx, sy] = localScale(H, ideals[i][0], ideals[i][1]);
    if (!isFinite(sx) || !isFinite(sy)) return Infinity;
    const e = Math.min(Math.abs(sx - o), Math.abs(sy - o)) / o;
    err += e;
  }
  return err;
}

/**
 * 判断点 X 是否落在由三个定位图案 TL/TR/BL 张成的「第四角区域」。
 *
 * 几何依据（与旋转、镜像无关的射影不变性质）：
 * 一个码的三个定位图案位于符号的三个角，第四角（右下角）在图像上
 * 恰好是这三个角所围成四边形的缺失角。因此：
 *   - X 与 TL 必须位于对角线 TR–BL 的两侧
 *   - X 与 BL 必须位于边 TL–TR 的同侧
 *   - X 与 TR 必须位于边 TL–BL 的同侧
 * 三条同时成立，X 才落在第四角区域。
 */
function inFourthCorner(TL, TR, BL, X) {
  const area = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const a1 = area(TL, TR, X), b1 = area(TL, TR, BL);
  if (a1 * b1 <= 0) return false;
  const a2 = area(TL, BL, X), b2 = area(TL, BL, TR);
  if (a2 * b2 <= 0) return false;
  const a3 = area(TR, BL, X), b3 = area(TR, BL, TL);
  if (a3 * b3 >= 0) return false;
  return true;
}

/**
 * 惰性生成矫正候选。
 *
 * 用生成器而非一次性数组，原因有二：
 *   1) 正确性 —— 候选可能多达数十个，一次性全部重采样既慢又无必要，
 *      而下游只要第一个能解码成功的候选；
 *   2) 性能 —— 每个候选的重采样成本与输出分辨率成正比，
 *      早停能把最坏情况的耗时压下来。
 */
export function* rectifyCandidates(gray, w, h, patterns, opts = {}) {
  if (patterns.length < 3) return;

  // 源图中的对齐图案候选（透视下会变形，故容差放宽）
  let srcAligns = null;
  const getSrcAligns = () => {
    if (!srcAligns) {
      const bin = binarize(gray, otsuThreshold(gray));
      srcAligns = findAlignmentPatterns(bin, w, h, {
        tolMid: 0.85, tolSide: 0.9, tolVert: 0.85, gridMin: 0.68,
      });
    }
    return srcAligns;
  };

  // 几何一致性筛选：真实的三定位图案满足
  //   1) 三个模块尺寸接近（同一个码的模块尺寸必然一致）
  //   2) 构成直角三角形
  //   3) 两条直角边长度接近
  // 假阳性（数据模块偶然形成的 1:1:3:1:1）通常模块尺寸分散，难以同时满足三条。
  //
  // 候选池不能太小：真实定位图案未必排在检测结果的前几位
  // （桶形弯曲等场景下会有大量质量更高的假阳性混在前面）。
  // 这里放开到 20 个，靠几何筛选而非数量截断来控制质量。
  const MAX_PATTERNS = opts.maxPatterns ?? 20;
  const MAX_WARPS = opts.maxWarps ?? 240;
  // 阶段一（对齐图案路径）单独预算：它是原理性解法，
  // 命中即成功，不该与阶段二的暴力枚举抢额度。
  const MAX_WARPS_ALIGN = opts.maxWarpsAlign ?? 120;
  // 单个组合最多试几个对齐图案候选（见下方排序说明）
  const MAX_ALIGNS_PER_COMBO = opts.maxAlignsPerCombo ?? 2;
  // 筛选阈值：强透视下三个定位图案的模块尺寸与边长天然差异很大，
  // 阈值太紧会把真实三元组直接筛掉（persp-60 就是这么失败的），
  // 太松则候选爆炸。默认值在实测中兼顾两者。
  const MAX_MS_SPREAD = opts.maxMsSpread ?? 0.55;
  const MAX_ANGLE_DEV = opts.maxAngleDev ?? 40;
  const MAX_LEN_SPREAD = opts.maxLenSpread ?? 0.55;
  const combos = [];
  const n = Math.min(patterns.length, MAX_PATTERNS);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        const t = [patterns[a], patterns[b], patterns[c]];
        for (let tl = 0; tl < 3; tl++) {
          const TL = t[tl], P = t[(tl + 1) % 3], Q = t[(tl + 2) % 3];
          const v1 = { x: P.x - TL.x, y: P.y - TL.y };
          const v2 = { x: Q.x - TL.x, y: Q.y - TL.y };
          const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
          if (l1 < 1 || l2 < 1) continue;
          // 模块尺寸一致性：三个图案的 ms 相对偏差不超过阈值
          const msArr = [TL.moduleSize, P.moduleSize, Q.moduleSize].sort((x, y) => x - y);
          if ((msArr[2] - msArr[0]) / msArr[2] > MAX_MS_SPREAD) continue;
          const cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
          const angle = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
          if (Math.abs(angle - 90) > MAX_ANGLE_DEV) continue;
          // 两条直角边长度应大致相等
          if (Math.abs(l1 - l2) / Math.max(l1, l2) > MAX_LEN_SPREAD) continue;
          // 可信度：直角越准、ms 越一致、边长越接近、比例拟合越好 → 分越高
          const msSpread = (msArr[2] - msArr[0]) / msArr[2];
          const lenSpread = Math.abs(l1 - l2) / Math.max(l1, l2);
          const q = (TL.quality || 0) + (P.quality || 0) + (Q.quality || 0);
          const score = Math.abs(angle - 90) / MAX_ANGLE_DEV + msSpread / MAX_MS_SPREAD + lenSpread / MAX_LEN_SPREAD + q * 0.5;
          // 版本号推断：定位图案中心距符号边缘 3.5 个模块，
          // 故 直角边长 / 模块尺寸 + 7 = 该边的模块数（即 dim = 4*version + 17）。
          // 透视会让这个推断有偏差，所以枚举相邻几个版本，让下游解码来裁决。
          const avgMs = msArr[1];
          const edgeModules = Math.min(l1, l2) / avgMs + 7;
          const baseVer = Math.round((edgeModules - 17) / 4);
          const versions = [];
          for (const dv of [0, -1, 1]) {
            const v = baseVer + dv;
            if (v >= 1 && v <= 40 && !versions.includes(v)) versions.push(v);
          }
          combos.push({ TL, P, Q, angle, l1, l2, score, msArr, avgMs, versions });
        }
      }
    }
  }
  if (!combos.length) return;

  // 对齐图案候选（源图）：透视会让 1:1:1:1:1 游程比例失真，
  // 故这里的容差比常规情况宽得多，宁可多收候选，靠几何筛选兜住。
  const aligns = getSrcAligns();

  // 关键排序：能配上一个「第四角区域内的对齐图案」的组合，
  // 几乎一定是真实的三定位图案组合 ——
  // 第四角区域是由三个定位图案唯一决定的狭窄区域，
  // 随机数据模块偶然形成的假阳性定位图案几乎不可能同时满足。
  //
  // 不做这个排序会付出高昂代价：定位图案一多（如强透视场景 28 个），
  // 三元组可达上万个，真实组合往往排在 warp 预算之外，
  // 于是「检测完全正确、数学完全正确」的路径根本没被执行到。
  for (const combo of combos) {
    combo.aligns = [];
    if (aligns.length && combo.versions.some((v) => 4 * v + 17 >= 25)) {
      for (const A of aligns) {
        // 尺度合理性：透视会让远端模块变小，但不应差出一个数量级
        if (A.moduleSize < combo.avgMs * 0.3 || A.moduleSize > combo.avgMs * 3.5) continue;
        // 第四角关系：TR/BL 互换两种解释都要看
        if (inFourthCorner(combo.TL, combo.Q, combo.P, A) || inFourthCorner(combo.TL, combo.P, combo.Q, A)) {
          combo.aligns.push(A);
        }
      }
      // 同一个组合可能配上多个对齐图案（假阳性定位图案会连带多个候选）。
      // 全部试一遍的话，单个组合就能吃掉几十次 warp 预算，
      // 排在后面的真实组合根本没机会执行 —— 实测正是如此：
      // 真实组合排在第 3 位，却因预算被前两个组合耗尽而从未被试到。
      //
      // 排序依据：模块尺寸与组合平均值的接近程度。
      // 透视下模块尺寸沿对角线单调变化，
      // 而「右下角对齐图案」恰好是整个符号里最小的那一个，
      // 所以优先试尺寸偏小、但仍在合理范围内的候选。
      combo.aligns.sort((a, b) => a.moduleSize - b.moduleSize);
      if (combo.aligns.length > MAX_ALIGNS_PER_COMBO) {
        combo.aligns.length = MAX_ALIGNS_PER_COMBO;
      }
    }
  }
  // 有对齐图案配合的组合优先；同等条件下仍按几何可信度排序
  combos.sort((a, b) => (a.aligns.length ? 0 : 1) - (b.aligns.length ? 0 : 1) || a.score - b.score);

  const tried = new Set();
  let warps = 0;

  // ——— 阶段一：路径 A（对齐图案作第四对应点）———
  //
  // 这是原理性解法：版本 ≥ 2 的码，右下角对齐图案中心在模块坐标里
  // 固定为 (dim - 6.5, dim - 6.5)，位置精确已知。
  // 它与三个定位图案一起唯一确定单应性，
  // 不再依赖「平行四边形近似」这个只在仿射变换下成立的第四角猜测 ——
  // 强透视下那个猜测必然错位。
  //
  // 关键在枚举顺序。
  // 定位图案一多（如强透视场景 28 个），三元组可达数百上千，
  // 真实组合在纯几何可信度排序里未必靠前。
  // 若按枚举顺序直接做重采样（warp），前面的假阳性会先把预算耗光，
  // 于是「检测完全正确、数学完全正确」的路径根本没被执行到。
  //
  // 解决办法：重采样之前先做一次廉价的「尺度场一致性」打分，
  // 把全部候选排好序，再从最可信的开始做重采样。
  // 打分只解单应性（8 元方程组）+ 几次求值，比重采样便宜两个数量级。
  const scored = [];
  for (const combo of combos) {
    if (!combo.aligns.length) continue;
    const { TL, P, Q } = combo;
    const m = 3.5;
    for (const version of combo.versions) {
      const dim = 4 * version + 17;
      if (dim < 25) continue;
      // 两种角点对应关系（TR/BL 互换）都试
      //
      // 注意：ideal 必须保持不变、只交换 src 中 P/Q 的位置。
      // 早先把 ideal 也跟着转置，结果两个分支产生的是同一个映射 ——
      // 「TR/BL 互换」这一路从未真正被尝试，白白花掉一半 warp 预算。
      for (const swap of [false, true]) {
        const TR = swap ? P : Q;
        const BL = swap ? Q : P;
        for (const A of combo.aligns) {
          const idealA = [[m, m], [dim - m, m], [m, dim - m], [dim - 6.5, dim - 6.5]];
          const srcA = [[TL.x, TL.y], [TR.x, TR.y], [BL.x, BL.y], [A.x, A.y]];
          const keyA = idealA.map((p, i) => p.join(',') + '>' + srcA[i].join(',')).join('|');
          if (tried.has(keyA)) continue;
          tried.add(keyA);
          const HA = solveHomography(idealA, srcA);
          if (!HA) continue;
          // 正方形一致性检验：廉价但判别力强，
          // 把绝大多数假阳性组合挡在 warp 之前。
          if (!squareConsistent(HA, dim, TL, TR, BL, A, combo.avgMs)) continue;
          // 尺度场一致性打分：越小越可信
          const score = squareScore(HA, dim, [TL, TR, BL, A]);
          if (!isFinite(score)) continue;
          scored.push({ H: HA, dim, avgMs: combo.avgMs, score });
        }
      }
    }
  }
  scored.sort((a, b) => a.score - b.score);
  // 分数明显离谱的候选直接放弃（实测真实组合约 0.07）
  const SCORE_LIMIT = opts.scoreLimit ?? 1.2;
  // 路径 B 只有三个对应点，判别力较弱，阈值相应放宽
  const SCORE_LIMIT_B = opts.scoreLimitB ?? 1.6;
  // 前置几何闸门：在源图上直接采样 7×7 网格验证定位图案，
  // 通过了才付出重采样的代价。这是把总耗时压下来的关键 ——
  // 实测候选常有上百个，全量重采样要数秒，而绝大多数候选
  // 在采样阶段就能看出角上根本没有定位图案。
  const preGate = opts.preGate !== false;
  const thr = preGate ? otsuThreshold(gray) : 0;
  const needCorners = opts.gateCorners ?? 3;
  const TIMING_MIN = opts.timingMin ?? 0.95;
  const useTiming = opts.timing !== false;
  const gate = (H, dim) => {
    if (!preGate) return true;
    if (useTiming && timingLooksRightAt(gray, w, h, H, thr, dim) < TIMING_MIN) return false;
    if (finderLooksRightAt(gray, w, h, H, thr, dim, needCorners)) return true;
    // 严格闸门不通过时再试宽松档：
    // 反弯曲场景残余形变会让采样位置偏移，两角判定会误杀真候选；
    // 但完全放弃闸门又会放进大量假阳性。
    // 两级闸门兼顾两头（实测保住成功率的同时把失败场景耗时压到 1 秒内）。
    for (let need = needCorners; need >= 1; need--) {
      if (finderLooksRightAt(gray, w, h, H, thr, dim, need)) return true;
    }
    return false;
  };
  for (const cand of scored) {
    if (warps >= MAX_WARPS_ALIGN) break;
    if (cand.score > SCORE_LIMIT) break;
    if (!gate(cand.H, cand.dim)) continue;
    warps++;
    const resA = warpByH(gray, w, h, cand.H, cand.dim, cand.avgMs);
    if (resA) {
      yield resA;
    }
  }
  // ——— 阶段二：路径 B（第四角几何猜测）———
  // 对齐图案缺失或不可靠时兜底。
  //
  // 同样先打分排序再重采样：路径 B 的候选数量与路径 A 同量级，
  // 若按枚举顺序直接重采样，预算照样会被假阳性吃光。
  // 路径 B 只有三个对应点，打分用「尺度场一致性」的三点版本。
  const scoredB = [];
  for (const combo of combos) {
    const { TL, P, Q } = combo;
    const avgMs = combo.avgMs;

    const angP = Math.atan2(P.y - TL.y, P.x - TL.x);
    const angQ = Math.atan2(Q.y - TL.y, Q.x - TL.x);
    const rP = Math.hypot(P.x - TL.x, P.y - TL.y);
    const rQ = Math.hypot(Q.x - TL.x, Q.y - TL.y);

    for (const version of combo.versions) {
      const dim = 4 * version + 17;
      const m = 3.5; // 定位图案中心距符号边缘 3.5 个模块

      // 第四角的两种推法都试
      const BRs = [
        { x: P.x + Q.x - TL.x, y: P.y + Q.y - TL.y },
        {
          x: TL.x + rP * Math.cos(angQ) + rQ * Math.cos(angP),
          y: TL.y + rP * Math.sin(angQ) + rQ * Math.sin(angP),
        },
      ];

      for (const swap of [false, true]) {
        const ideal = [[m, m], [dim - m, m], [m, dim - m], [dim - m, dim - m]];
        for (const BR of BRs) {
          // 目标点（源图像素坐标）必须用检测到的定位图案中心，
          // 不能写成理想模块坐标 —— 否则单应性映射的起点是错的，矫正图整体错位。
          const src = swap
            ? [[TL.x, TL.y], [P.x, P.y], [Q.x, Q.y], [BR.x, BR.y]]
            : [[TL.x, TL.y], [Q.x, Q.y], [P.x, P.y], [BR.x, BR.y]];
          const key = ideal.map((p, i) => p.join(',') + '>' + src[i].join(',')).join('|');
          if (tried.has(key)) continue;
          tried.add(key);
          const H = solveHomography(ideal, src);
          if (!H) continue;
          const score = squareScore3(H, dim, [TL, swap ? P : Q, swap ? Q : P]);
          if (!isFinite(score)) continue;
          scoredB.push({ H, dim, avgMs, score });
        }
      }
    }
  }
  scoredB.sort((a, b) => a.score - b.score);
  for (const cand of scoredB) {
    if (warps >= MAX_WARPS) break;
    if (cand.score > SCORE_LIMIT_B) break;
    if (!gate(cand.H, cand.dim)) continue;
    warps++;
    const res = warpByH(gray, w, h, cand.H, cand.dim, cand.avgMs);
    if (res) {
      yield res;
    }
  }
}

/** 按单应性把灰度图重采样为正方形（模块坐标 → 源坐标） */
export function warpByH(gray, w, h, H, dim, moduleSize, outModuleOverride) {
  const margin = 4; // 静区
  // 每模块至少 4 像素，否则 jsQR 也读不出；同时避免输出过大拖慢速度
  const outModule = outModuleOverride
    ? Math.max(3, outModuleOverride)
    : Math.max(4, Math.min(8, Math.round(moduleSize * 5)));
  const side = (dim + margin * 2) * outModule;
  if (side < 32 || side > 3000) return null;
  const out = new Uint8ClampedArray(side * side);
  for (let v = 0; v < side; v++) {
    const my = v / outModule - margin;
    for (let u = 0; u < side; u++) {
      const mx = u / outModule - margin;
      const [sx, sy] = applyH(H, mx, my);
      out[v * side + u] = bilinear(gray, w, h, sx, sy);
    }
  }
  // 灰度数组一并返回：后续闸门直接在它上面采样，
  // 不必再把画布取回像素重算一遍灰度（这是此前的主要耗时来源）。
  return { canvas: grayToCanvas(out, side, side), gray: out, H, side, outModule, margin, dim };
}

/* ========== 策略级联 ========== */

/**
 * 定位图案的外接区域（外扩一圈），用作桶形扫描的工作窗口。
 *
 * 为什么要裁：桶形扫描要试几十个参数，每个候选都得跑一遍
 * 「撤销 → 局部阈值二值化 → 定位图案检测」。
 * 全图做这三步是 O(整图像素)，在 640×480 上单候选就要 8~12ms，
 * 几十个候选直接上秒。裁到码附近后单候选降到 1~2ms。
 *
 * 为什么要外扩：撤销会把内容往中心压，图案位置会移动；
 * 扩得太少会切掉图案，太多是浪费。实测 40% 外扩足够。
 */
function roiAroundPatterns(patterns, w, h) {
  if (!patterns || patterns.length < 3) return { x: 0, y: 0, w, h };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of patterns) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const bw = x1 - x0, bh = y1 - y0;
  const mx = Math.max(30, bw * 0.4), my = Math.max(30, bh * 0.4);
  const x = Math.max(0, Math.floor(x0 - mx));
  const y = Math.max(0, Math.floor(y0 - my));
  const rw = Math.min(w - x, Math.ceil(bw + 2 * mx));
  const rh = Math.min(h - y, Math.ceil(bh + 2 * my));
  return { x, y, w: rw, h: rh };
}

/**
 * 桶形撤销系数 α 的几何级数阶梯（单位 px⁻²，取负值）。
 *
 * 用几何级数而不是等差：可解窗口的「相对宽度」是固定的
 * （实测约 26%~30%），等差网格在强畸变端会过密、在弱畸变端会过疏。
 *
 * @param {number} from 起始幅度（最大 |α|）
 * @param {number} to 终止幅度（最小 |α|）
 * @param {number} ratio 公比
 */
function buildAlphaLadder(from, to, ratio) {
  const out = [];
  let a = from;
  while (a >= to) {
    out.push(-a);
    a /= ratio;
  }
  return out;
}

export const STRATEGY_LABELS = {
  direct: '直接识别',
  'roi-direct': '区域识别',
  'roi-normalize': '区域对比拉伸',
  'roi-denoise': '区域去噪',
  'roi-binarize': '区域全局二值化',
  'roi-upscale': '区域放大',
  'roi-adaptive-bin': '区域局部自适应二值化',
  normalize: '对比拉伸',
  denoise: '去噪',
  sharpen: '锐化',
  upscale: '放大',
  binarize: '全局二值化',
  'adaptive-bin': '局部自适应二值化',
  rectify: '透视矫正',
  unbarrel: '弯曲矫正',
  'rectify-then-unbarrel': '透视矫正后消弯曲',
  'adaptive-rectify': '局部阈值检出后透视矫正',
  'barrel-sweep': '桶形畸变参数扫描',
  tile: '分块搜索',
  zxing: 'zxing 解码',
  'zxing-normalized': 'zxing 解码（对比拉伸）',
  'zxing-geometry': 'zxing 解码（几何矫正）',
  'zxing-geometry-reverse': 'zxing 解码（透视矫正后消弯曲）',
};

/**
 * 把裁剪区域里的定位点平移回整幅图的坐标。
 *
 * jsQR 返回的 location 是四个具名角点（topLeftCorner 等），
 * 各自是 {x, y} 对象。
 */
function shiftLocation(location, shift) {
  if (!location || !shift) return location;
  const out = {};
  for (const k of Object.keys(location)) {
    const p = location[k];
    if (p && typeof p.x === 'number' && typeof p.y === 'number') {
      out[k] = { x: p.x + shift.x, y: p.y + shift.y };
    } else {
      out[k] = p;
    }
  }
  return out;
}

/** 图像统计：判断哪些预处理值得做 */
export function analyzeGray(gray, w, h) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let acc = 0, p2 = 0, p98 = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { p2 = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.98) { p98 = v; break; } }
  // 噪声度量：拉普拉斯响应的均值
  let noise = 0, cnt = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const c = gray[y * w + x];
      const lap = 4 * c - gray[(y - 1) * w + x] - gray[(y + 1) * w + x] - gray[y * w + x - 1] - gray[y * w + x + 1];
      noise += Math.abs(lap);
      cnt++;
    }
  }
  noise = cnt ? noise / cnt : 0;
  return { p2, p98, contrast: p98 - p2, noise };
}

/** 在给定 ImageData 上跑 jsQR */
function runJsQR(imageData) {
  const r = jsQR(imageData.data, imageData.width, imageData.height);
  return r && r.data ? r : null;
}

/**
 * 把矫正图上的定位点映射回原图坐标。
 *
 * jsQR 的 location 是四个具名角点（topLeftCorner / topRightCorner /
 * bottomRightCorner / bottomLeftCorner），各自是 {x, y} 对象，
 * 不是数组 —— 需要逐个映射回去，调用方拿到的始终是原图坐标。
 */
function mapLocation(location, rect) {
  if (!location || !rect) return null;
  const { H, outModule, margin } = rect;
  // 矫正图可能是在源图的裁剪区域上生成的（局部几何策略），
  // 此时 H 给出的是裁剪区坐标，必须加回裁剪原点才是原图坐标。
  const ox = rect.origin ? rect.origin.x : 0;
  const oy = rect.origin ? rect.origin.y : 0;
  // 桶形撤销后的坐标还要反变换回原图：
  // 撤销的定义是「输出像素 x 取原图 c+(x-c)(1+α|x-c|²) 处的内容」，
  // 所以从撤销图坐标 p 回到原图坐标，用的是同一个公式。
  const warp = rect.warp || null;
  const mapPt = (pt) => {
    if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') return null;
    const mx = pt.x / outModule - margin;
    const my = pt.y / outModule - margin;
    let [x, y] = applyH(H, mx, my);
    x += ox; y += oy;
    if (warp) {
      const dx = x - warp.cx, dy = y - warp.cy;
      const f = 1 + warp.alpha * (dx * dx + dy * dy);
      x = warp.cx + dx * f;
      y = warp.cy + dy * f;
    }
    return { x, y };
  };
  const keys = ['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'];
  const out = {};
  let mapped = 0;
  for (const k of keys) {
    const p = mapPt(location[k]);
    if (p) { out[k] = p; mapped++; }
  }
  // 一个角点都映射不出来时返回 null，让调用方退化为「无位置信息」
  if (!mapped) return null;
  // 保留定位图案中心（若存在），便于调用方画框
  for (const k of ['topLeftFinderPattern', 'topRightFinderPattern', 'bottomLeftFinderPattern', 'bottomRightFinderPattern']) {
    const p = mapPt(location[k]);
    if (p) out[k] = p;
  }
  return out;
}

/**
 * 快速校验矫正图左上角是否真的是定位图案。
 *
 * 用途是性能闸门：矫正候选可能有几十个，但绝大多数选错了三元组或版本号。
 * 若先跑 jsQR（开销大）再判断，等于把最贵的操作做了几十次。
 *
 * 判据用「模块网格」而非像素游程：定位图案是 7×7 的同心方环，
 * 采样 7×7 个模块中心，只要绝大多数模块与理论图案吻合（明暗极性不限，
 * 因为反色码也合法）即认为该候选正确。
 *
 * 复杂度 O(49)，且直接读矫正时已经算好的灰度数组，不必把画布取回像素重算。
 */
const FINDER_GRID = [
  1, 1, 1, 1, 1, 1, 1,
  1, 0, 0, 0, 0, 0, 1,
  1, 0, 1, 1, 1, 0, 1,
  1, 0, 1, 0, 1, 0, 1,
  1, 0, 1, 1, 1, 0, 1,
  1, 0, 0, 0, 0, 0, 1,
  1, 1, 1, 1, 1, 1, 1,
];

/**
 * 不重采样就验证「这个单应性解出来的码角上是不是真的有定位图案」。
 *
 * 背景：候选动辄上百个，每个都重采样整张图（输出边长常在 300 上下，
 * 即 9 万像素）代价极高 —— 实测 1280 次重采样要 3.2 秒。
 * 而几何闸门其实只需要看 7×7 个模块中心的明暗。
 * 于是先在源图上直接采样这 49 个点：
 *   - 采样失败或图案不像 → 立刻淘汰，一个像素都不用重采样
 *   - 采样通过 → 才付出重采样的代价
 *
 * 检查三个角（左上、右上、左下）而不只检查一个：
 * 单角通过率约 5%（一个 7×7 图案偶然吻合的概率不低），
 * 三角同时通过后假阳性大幅减少 ——
 * 而每个通过闸门的候选都要付一次 jsQR 的代价（实测约 12 毫秒），
 * 这是失败场景耗时的主因。
 *
 * 实际用「三个角里至少两个通过」：在源图上单点采样受噪声与插值影响，
 * 要求三角全过会把真实候选也误杀（实测成功率从 25 掉到 22）。
 * 两角通过已能把假阳性压到可接受水平。
 *
 * 但严格度需要分场景：
 *   透视矫正场景 —— 源图到矫正图是精确的单应性映射，采样位置准，两角闸门可靠。
 *   反弯曲场景 —— 反弯曲后仍残留形变，采样位置有偏差，两角闸门会误杀真候选
 *     （实测成功率从 25 掉到 23）。这里退回单角闸门。
 *
 * 阈值取源图灰度的 Otsu 全局阈值（局部自适应在重采样图上才有意义，
 * 源图上是原图光照，用全局阈值足够做形状判定）。
 */
function finderLooksRightAt(gray, w, h, H, thr, dim, needCorners) {
  const m = 3.5;
  // 三个定位图案中心在理想模块坐标里的位置
  const corners = [
    [m, m],
    [dim - m, m],
    [m, dim - m],
  ];
  let passed = 0;
  for (const [ox, oy] of corners) {
    const bits = new Uint8Array(49);
    for (let my = 0; my < 7; my++) {
      for (let mx = 0; mx < 7; mx++) {
        // 模块 (mx,my) 的中心在理想坐标 (ox + mx - 3, oy + my - 3)
        // 定位图案中心在 3.5，第 0 个模块的中心就是 3.5-3+0.5 = 1.0，
        // 与矫正图侧的采样口径（(mx + 0.5 + margin) * outModule）保持一致。
        const [sx, sy] = applyH(H, ox + mx - 3, oy + my - 3);
        if (!isFinite(sx) || !isFinite(sy)) continue;
        if (sx < -w || sy < -h || sx > w * 2 || sy > h * 2) continue;
        const v = bilinear(gray, w, h, sx, sy);
        bits[my * 7 + mx] = v <= thr ? 1 : 0;
      }
    }
    let normal = 0, inverted = 0;
    for (let i = 0; i < 49; i++) {
      if (bits[i] === FINDER_GRID[i]) normal++;
      else if (bits[i] === 1 - FINDER_GRID[i]) inverted++;
    }
    // 单角允许少量偏差（重采样与阈值带来的个别失真）
    if (Math.max(normal, inverted) >= 38) passed++;
    if (passed >= needCorners) return true;
  }
  return false;
}

/**
 * 时序图案（timing pattern）检验。
 *
 * QR 符号的第 6 行与第 6 列是黑白交替的时序图案，
 * 它横跨整条横轴与纵轴（从第 8 个模块到倒数第 8 个模块）。
 *
 * 这是一个非常强的额外约束：
 *   - 定位图案是局部的 7×7 方环，偶然出现的概率不低；
 *   - 时序图案是一条长达 2(dim-16) 个模块的交替序列，
 *     随机数据区几乎不可能凑出来。
 *
 * 判据用「相邻模块明暗不同的比例」而不是「是否符合某个固定相位」，
 * 这样既不受起始相位影响，也不受反色影响 —— 真码必然接近 100% 交替，
 * 假阳性接近 50%（随机）。
 */
function timingLooksRightAt(gray, w, h, H, thr, dim) {
  const alternation = (fixed, along) => {
    // fixed: 固定的行(y)或列(x)；along: 沿该行/列变化的模块索引
    const from = 8;
    const to = dim - 9;
    let bits = [];
    for (let i = from; i <= to; i++) {
      const mx = along === 'x' ? i : fixed;
      const my = along === 'y' ? i : fixed;
      const [sx, sy] = applyH(H, mx + 0.5, my + 0.5);
      if (!isFinite(sx) || !isFinite(sy)) return 0;
      if (sx < -w || sy < -h || sx > w * 2 || sy > h * 2) return 0;
      bits.push(bilinear(gray, w, h, sx, sy) <= thr ? 1 : 0);
    }
    if (bits.length < 8) return 0;
    let diff = 0;
    for (let i = 1; i < bits.length; i++) if (bits[i] !== bits[i - 1]) diff++;
    return diff / (bits.length - 1);
  };
  // 第 6 行与第 6 列（模块索引 6，中心坐标 6.5）
  const row = alternation(6, 'x');
  const col = alternation(6, 'y');
  return Math.max(row, col);
}

export function looksLikeFinderPattern(rect) {
  if (!rect || !rect.gray || !rect.outModule) return false;
  const { gray, side, outModule, margin } = rect;
  // 符号模块 m 的中心像素为 (m + 0.5 + margin) * outModule
  const thr = otsuThreshold(gray);
  const half = Math.max(1, Math.floor(outModule / 2) - 1);
  const bits = new Uint8Array(49);
  for (let my = 0; my < 7; my++) {
    for (let mx = 0; mx < 7; mx++) {
      const cx = Math.floor((mx + 0.5 + margin) * outModule);
      const cy = Math.floor((my + 0.5 + margin) * outModule);
      if (cx < 0 || cy < 0 || cx >= side || cy >= side) return false;
      // 模块内取一小块多数表决，抗重采样模糊
      let dark = 0;
      let cnt = 0;
      for (let dy = -half; dy <= half; dy++) {
        const py = cy + dy;
        if (py < 0 || py >= side) continue;
        for (let dx = -half; dx <= half; dx++) {
          const px = cx + dx;
          if (px < 0 || px >= side) continue;
          if (gray[py * side + px] <= thr) dark++;
          cnt++;
        }
      }
      bits[my * 7 + mx] = dark * 2 > cnt ? 1 : 0;
    }
  }
  // 明暗极性可能相反（反色码），两种极性分别算吻合数取大者
  let normal = 0;
  let inverted = 0;
  for (let i = 0; i < 49; i++) {
    if (bits[i] === FINDER_GRID[i]) normal++;
    else if (bits[i] === 1 - FINDER_GRID[i]) inverted++;
  }
  // 允许少量模块偏差（重采样与阈值带来的个别失真）
  return Math.max(normal, inverted) >= 42;
}

/**
 * 核心：多策略级联解码。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 *   maxSide      预处理时的最长边限制（性能与精度的平衡）
 *   deep         是否启用重策略（透视矫正、分块），关掉则只做光度与尺度处理
 *   allowTile    是否允许分块搜索（大图小码）
 * @returns {{ data, location, strategy } | null}
 */
export function decodeCanvas(canvas, opts = {}) {
  const maxSide = opts.maxSide ?? 1400;
  const deep = opts.deep !== false;
  const allowTile = opts.allowTile !== false;
  // 策略分组：'fast' 是光度与尺度类（毫秒级），'deep' 是几何类（百毫秒到秒级）。
  // 拆开是为了让异步入口能把 zxing 插在中间：
  // 主管线的深档动辄几百毫秒，而 zxing 只要十几毫秒 ——
  // 先跑完深档再问 zxing，等于让最慢的那条路挡住最快的那条。
  const only = opts.only || 'all';

  // 惰性策略序列：每项是一个「生成候选画布」的函数，
  // 只有前面的策略全部失败才会执行后面的。避免为一次成功的直查付出全部代价。
  const plan = [];

  // 准备基准画布（限制最长边）
  const base = limitSize(canvas, maxSide);

  let ctxCache = null;
  // 灰度与统计量按需计算并缓存
  const getCtx = () => {
    if (!ctxCache) {
      const { gray, w, h } = toGray(toImageData(base));
      const stats = analyzeGray(gray, w, h);
      const norm = normalizeGray(gray, w, h);
      ctxCache = { gray, w, h, stats, norm };
    }
    return ctxCache;
  };

  // —— 码的定位区域 ——
  //
  // jsQR 自己要在整幅图上找定位图案，图越大越慢。
  // 重噪声场景里（640×480、18% 噪声），一次 jsQR 要 200~960ms；
  // 而码通常只占画面 10~30% 的面积，裁到码附近后只要 3~90ms。
  //
  // 所以光度组的每个变体都跑两遍：先在码附近跑，全都不行再在整幅图上跑。
  // 收益是乘以变体数的（光度组有 6 个变体），
  // 代价是最坏情况多付一遍 —— 但那一遍本来也要付。
  //
  // 定位本身有风险：三元组找错就会裁掉真正的码（实测反色码上会丢命中）。
  // 所以整幅图那一遍必须留着 —— 命中不会丢。
  //
  // 实测收益（41 个用例）：
  //   sc-grad-noise   裁剪 42ms  vs 整图 223ms
  //   sc-hard-small   裁剪 33ms  vs 整图 442ms
  //   sc-hard         裁剪 28ms  vs 整图 441ms
  const regionCache = { value: undefined };
  const getRegion = () => {
    if (regionCache.value === undefined) {
      const { gray, w, h } = getCtx();
      regionCache.value = opts.roi === false ? null : locateSymbol(gray, w, h);
    }
    return regionCache.value;
  };

  // 变体画布的两种形态：码附近 / 整幅图
  const variant = (name, build) => {
    plan.push({
      name,
      group: 'fast',
      make: () => {
        const region = getRegion();
        if (!region) return null;
        const built = build(region);
        if (!built) return null;
        return { cv: built, shift: { x: region.x, y: region.y } };
      },
    });
  };
  // 整幅图形态（裁剪不可用或裁剪版失败后的兜底）
  //
  // 只在「定位不可用」或「定位可用但直查也失败」时才需要跑完整的整幅图组。
  // 定位可用时，其余光度变体在区域里已经试过了 ——
  // 再在整幅图上重跑一遍是纯浪费（实测 sc-hard 上要多付 1.4 秒）。
  // 只有 direct 需要在整幅图上再试一次：
  // 实测 12 个场景用例里，区域版与整幅图版的命中结果只有 sc-invert 不同
  // （反色码上定位图案检测不可靠，区域版裁错了位置）。
  const variantFull = (name, build, opts = {}) => {
    plan.push({
      name,
      group: 'fast',
      make: () => {
        // 定位可用时，只保留 direct 的整幅图兜底
        if (opts.directOnly && getRegion()) return null;
        const built = build(null);
        if (!built) return null;
        return { cv: built };
      },
    });
  };

  // —— 区域版：各光度变体在码附近跑 ——
  variant('roi-direct', (r) => cropCanvas(base, r.x, r.y, r.w, r.h));
  variant('roi-normalize', (r) => {
    const { norm, w, h } = getCtx();
    if (!norm.changed) return null;
    return cropCanvas(grayToCanvas(norm.gray, w, h), r.x, r.y, r.w, r.h);
  });
  variant('roi-denoise', (r) => {
    const { norm, stats, w, h } = getCtx();
    if (!norm.changed || stats.noise <= 12) return null;
    return cropCanvas(grayToCanvas(medianFilter(norm.gray, w, h), w, h), r.x, r.y, r.w, r.h);
  });
  variant('roi-binarize', (r) => {
    const { gray, w, h } = getCtx();
    if (getCtx().stats.noise < 10) return null;
    const bin = binarize(gray, otsuThreshold(gray));
    const out = new Uint8ClampedArray(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin[i] ? 0 : 255;
    return cropCanvas(grayToCanvas(out, w, h), r.x, r.y, r.w, r.h);
  });

  // —— 整幅图版：兜底，保证命中不会因为裁剪丢失 ——
  variantFull('direct', () => base);
  variantFull('normalize', () => {
    const { norm, w, h } = getCtx();
    return norm.changed ? grayToCanvas(norm.gray, w, h) : null;
  }, { directOnly: true });
  variantFull('denoise', () => {
    const { norm, stats, w, h } = getCtx();
    if (!norm.changed || stats.noise <= 12) return null;
    return grayToCanvas(medianFilter(norm.gray, w, h), w, h);
  }, { directOnly: true });
  variantFull('sharpen', () => {
    const { norm, stats, w, h } = getCtx();
    if (!norm.changed || stats.noise > 12) return null;
    return grayToCanvas(unsharpMask(norm.gray, w, h), w, h);
  }, { directOnly: true });
  variantFull('upscale', () => {
    const b = buildUpscale(null);
    return b ? b.cv : null;
  }, { directOnly: true });
  variantFull('binarize', () => {
    const { gray, stats, w, h } = getCtx();
    if (stats.noise < 10) return null;
    const bin = binarize(gray, otsuThreshold(gray));
    const out = new Uint8ClampedArray(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin[i] ? 0 : 255;
    return grayToCanvas(out, w, h);
  }, { directOnly: true });
  variantFull('adaptive-bin', () => {
    const b = buildAdaptiveBin(null);
    return b;
  }, { directOnly: true });

  // —— 尺度策略：每模块像素不足时放大 ——
  //
  // 门槛不是「整图边长」，而是「码的每模块有多少像素」。
  //
  // 原门槛是 maxDim < 900，这与「码有多小」无关 ——
  // 640×480 的摄像头画面也会触发，而那种画面里的码往往有 200 像素宽，
  // 每模块 3~5 像素，放大纯属浪费：实测 sc-hard 上放大后 jsQR 要 962ms，
  // 而原图只要 610ms，且两者都读不出来（几何畸变不是放大能解决的）。
  //
  // 改用模块尺寸后判据才与问题对齐：
  //   scale-64   每模块 1.86 像素 → 放大（命中）
  //   scale-48   每模块 1.57 像素 → 放大（命中）
  //   sc-hard    每模块 3.71 像素 → 不放大
  //
  // 门槛 2.6 像素：低于它每模块的信息量不足以稳定采样。
  // 放大只在码小的时候有意义 —— 判据用「每模块多少像素」，
  // 而不是整幅图的边长。区域版里按区域自身的尺寸判断更准。
  const buildUpscale = (region) => {
    const { gray, w, h } = getCtx();
    const src = region ? cropCanvas(base, region.x, region.y, region.w, region.h) : base;
    const sw = region ? region.w : w;
    const sh = region ? region.h : h;
    const maxDim = Math.max(sw, sh);
    if (maxDim >= 900) return null;
    // 估模块尺寸：靠定位图案的模块尺寸中位数。
    // 检不出图案时退回按整图尺寸判断（保持原有行为）。
    const ms = estimateModuleSize(gray, w, h);
    if (ms > 0 && ms >= 2.6) return null;
    const scale = Math.min(4, Math.ceil(900 / maxDim));
    const up = scaleCanvas(src, scale);
    const upG = toGray(toImageData(up));
    const upN = normalizeGray(upG.gray, upG.w, upG.h);
    return { cv: upN.changed ? grayToCanvas(upG.changed ? upN.gray : upG.gray, upG.w, upG.h) : up };
  };
  variant('roi-upscale', (r) => {
    const b = buildUpscale(r);
    if (!b) return null;
    // 放大后坐标要按比例平移回原图
    const scale = Math.max(b.cv.width / r.w, 1);
    return { cv: b.cv, shift: { x: r.x * scale, y: r.y * scale } };
  });

  // —— 二值化策略：全局阈值 ——
  // jsQR 自带的是局部自适应二值化，在重噪声下会被噪声带偏。
  // 先用全局阈值（Otsu）压成纯黑白再交给它，反而更稳。
  plan.push({
    name: 'binarize',
    group: 'fast',
    make: () => {
      const { gray, stats, w, h } = getCtx();
      // 只在图像本身噪声较多时才值得做，正常图像直接二值化会丢细节
      if (stats.noise < 10) return null;
      const thr = otsuThreshold(gray);
      const bin = binarize(gray, thr);
      const out = new Uint8ClampedArray(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin[i] ? 0 : 255;
      return { cv: grayToCanvas(out, w, h) };
    },
  });

  // —— 二值化策略：局部自适应阈值（Sauvola）——
  //
  // 全局阈值的前提是「前景背景对比度在整幅图里一致」。
  // 有光照渐变或阴影时这个前提不成立，阈值只能取一个数，
  // 而画面不同位置的对比度天差地别 —— 实测最坏情况下
  // 局部背景比码的白模块还暗（88 vs 217），全局阈值必然切错。
  //
  // 局部阈值逐窗口判断「比周围亮还是暗」，不受极性反转影响。
  // 实测定位图案召回率：全局 Otsu 1/3（140px 码上 0/3），Sauvola 3/3。
  //
  // 放在 binarize 之后：全局阈值够用时不必付这个代价。
  const buildAdaptiveBin = (region) => {
    const { gray, stats, w, h } = getCtx();
    // 只有在全局分割确实可疑时才试：
    // 判据是「暗像素占比偏离正常范围」——
    // 正常码的暗像素占比约 4%（黑白相间），超过 20% 说明分割已经崩了。
    const thr = otsuThreshold(gray);
    const bin = binarize(gray, thr);
    let dark = 0;
    for (let i = 0; i < bin.length; i++) if (bin[i]) dark++;
    const ratio = dark / bin.length;
    if (ratio < 0.15) return null;
    const sbin = sauvolaBinarize(gray, w, h);
    const out = new Uint8ClampedArray(sbin.length);
    for (let i = 0; i < sbin.length; i++) out[i] = sbin[i] ? 0 : 255;
    const cv = grayToCanvas(out, w, h);
    return region ? cropCanvas(cv, region.x, region.y, region.w, region.h) : cv;
  };
  variant('roi-adaptive-bin', (r) => buildAdaptiveBin(r));

  // —— 几何策略：透视矫正 ——
  if (deep) {
    plan.push({
      name: 'rectify',
      group: 'deep',
      make: () => {
        const { gray, norm, w, h } = getCtx();
        for (const g of [norm.changed ? norm.gray : null, gray]) {
          if (!g) continue;
          const patterns = detectFinderPatternsCached(g, w, h);
          if (patterns.length < 3) continue;
          // 惰性遍历候选：第一个能解码出来的即返回，避免全量重采样
          for (const rect of rectifyCandidates(g, w, h, patterns)) {
            // 先用几何闸门筛掉绝大多数错误候选，再付 jsQR 的代价
            if (!looksLikeFinderPattern(rect)) continue;
            const res = runJsQR(toImageData(rect.canvas));
            if (res) return { cv: rect.canvas, rect, hit: res };
          }
        }
        return null;
      },
    });

    // —— 几何策略：径向弯曲 ——
    // 桶形/枕形弯曲不是单应变换能表达的，必须先反弯曲再矫正，
    // 所以这条策略独立于 rectify。
    //
    // 关键在于别把 8 个系数平等对待 ——
    // 每个系数下都要跑一遍候选枚举，代价高昂。
    // 先用「三元组残差」给系数排序（纯算术，��便），
    // 残差最小者就是最可能把码恢复成规整正方形的那个。
    //
    // 但残差不是万能的：强透视叠加弯曲时它也会看走眼，
    // 所以仍需保留「全部系数各试少量候选」的一遍，
    // 用来兜住残差判断失手的情况。
    plan.push({
      name: 'unbarrel',
      group: 'deep',
      make: () => {
        const { gray, norm, w, h } = getCtx();
        const src = norm.changed ? norm.gray : gray;
        const ks = opts.unbarrelKs ?? [-0.45, -0.3, -0.2, -0.1, 0.1, 0.2, 0.3, 0.45];
        const probe = opts.unbarrelProbe ?? 10;
        const full = opts.unbarrelWarps ?? 80;

        // 参考系：畸变是相对「码自身」施加的，不是相对整幅画面。
        //
        // 桶形弯曲在拍摄时以被摄物为中心、以物的大小为尺度，
        // 所以同一个 k 在「码占满画面」与「码占画面 1/4」两种情况下
        // 实际强度相差四倍多。用整幅画布当参考系时，
        // 码越小矫正越弱，最后彻底失效 —— 这是「码在画面里偏小就认不出」的主因。
        //
        // 做法：先在源图上找定位图案，反推符号的中心与半对角线，
        // 用它当参考系。这样 k 的含义就与「码占画面多大」无关了。
        const srcPatterns = detectFinderPatternsCached(src, w, h);
        const frame = srcPatterns.length >= 3 ? estimateSymbolFrame(srcPatterns) : null;
        const ref = frame ? { cx: frame.cx, cy: frame.cy, R: frame.R } : null;

        // 第一步：给每个系数打分（只做定位图案检测与几何残差，不重采样）
        const ranked = [];
        for (const k of ks) {
          const ub = unbarrel(src, w, h, k, ref);
          const bin = binarize(ub, otsuThreshold(ub));
          const patterns = findFinderPatterns(bin, w, h);
          if (patterns.length < 3) continue;
          ranked.push({ k, ub, patterns, q: bestTripleQuality(patterns) });
        }
        if (!ranked.length) return null;
        ranked.sort((a, b) => a.q - b.q);

        // 第二步：残差最好的少数系数给足预算，其余只做浅探。
        //
        // 残差法会失手：强透视叠加弯曲时，透视本身带来的形变与弯曲
        // 带来的形变难以区分，残差可能指向错误的系数。
        // 所以浅探（每个系数少量候选）必须覆盖全部系数，
        // 深挖只给残差最好的那几个 —— 两者互补。
        const topN = opts.unbarrelTop ?? 3;        for (let i = 0; i < ranked.length; i++) {
          const { ub, patterns } = ranked[i];
          const deep = i < topN;
          const budget = deep ? full : probe;
          let n = 0;
          for (const rect of rectifyCandidates(ub, w, h, patterns, {
            maxWarpsAlign: budget,
            maxWarps: budget * 2,
            // 反弯曲后仍有残余形变，源图采样的位置不够准，
            // 严格闸门会误杀真候选（详见 finderLooksRightAt 的说明）
            gateCorners: 2,
          })) {
            if (++n > budget * 2) break;
            if (!looksLikeFinderPattern(rect)) continue;
            const res = runJsQR(toImageData(rect.canvas));
            if (res) return { cv: rect.canvas, rect, hit: res };
          }
        }
        return null;
      },
    });
    // —— 几何策略：反向串联（先透视矫正，再消残余弯曲）——
    //
    // 为什么需要这一条：
    //
    // 上面两条几何策略是单向串联 —— 只能「先反弯曲，再透视矫正」。
    // 但桶形弯曲与透视是两种独立的形变，先做哪一个效果完全不同：
    //
    //   · 先反弯曲：弯曲校正到整幅画布上，码还带着透视变形，
    //     反弯曲的参考系（码的中心与尺度）也只能从带透视的图上粗估，
    //     透视越强这个估计越不准（实测透视 30° 时估出的半对角是真实值的 68%）。
    //
    //   · 先透视矫正：把码掰成正方形，弯曲就变成正视图上「边缘外凸」的
    //     残余形变，此时码的中心与尺度是确定的（就是正视图本身），
    //     反弯曲的参考系最准。
    //
    // 两种顺序各有胜场。实测「透视 30° + 桶形弯曲」这一类，
    // 单向串联读不出，反向串联仅 14 次尝试就命中。
    //
    // 代价：透视矫正本身很贵（要枚举候选并重采样）。
    // 所以放在最后，只在前面全部失败后才跑。
    plan.push({
      name: 'rectify-then-unbarrel',
      group: 'deep',
      make: () => {
        const { gray, norm, w, h } = getCtx();
        const src = norm.changed ? norm.gray : gray;

        // 第一步：透视矫正，收集正视图候选。
        // 闸门放宽到 1 个角 —— 重度变形下正视图的角上定位图案
        // 往往已经被拉变形，严格闸门会把真候选全杀光。
        const bin = binarize(src, otsuThreshold(src));
        const patterns = detectFinderPatternsCached(src, w, h);
        if (patterns.length < 3) return null;

        const rects = [];
        for (const rect of rectifyCandidates(src, w, h, patterns, {
          gateCorners: 1,
          maxWarps: 80,
          maxWarpsAlign: 60,
        })) {
          rects.push(rect);
          // 候选正视图取够 8 个即可 —— 真实解通常在前面几个里，
          // 更多的候选只是线性地增加后面的网格开销。
          if (rects.length >= 8) break;
        }
        if (!rects.length) return null;

        // 第二步：对每个正视图做残余弯曲扫描。
        //
        // 正视图上的码已摆正，畸变参考系就是正视图本身
        // （中心在正中、半对角约等于正视图边长的一半）。
        // 这比在原图上从带透视的定位图案反推准得多。
        const ks = opts.residualKs ?? [-0.45, -0.3, -0.2, -0.1, 0.1, 0.2, 0.3, 0.45];
        for (const rect of rects) {
          const cv0 = rect.canvas;
          const g0 = toGray(toImageData(cv0));
          const rbin = binarize(g0.gray, otsuThreshold(g0.gray));
          const rpats = findFinderPatterns(rbin, g0.w, g0.h);
          // 参考系：优先用正视图上定位图案反推的码范围；
          // 反推不出就退回正视图自身（此时码大致居中铺满，误差可接受）。
          const rframe = rpats.length >= 3 ? estimateSymbolFrame(rpats) : null;
          const ref = rframe
            ? { cx: rframe.cx, cy: rframe.cy, R: rframe.R }
            : { cx: g0.w / 2, cy: g0.h / 2, R: Math.min(g0.w, g0.h) * 0.5 };

          for (const k of ks) {
            const ub = unbarrel(g0.gray, g0.w, g0.h, k, ref);
            const b2 = binarize(ub, otsuThreshold(ub));
            const out = new Uint8ClampedArray(ub.length);
            for (let i = 0; i < ub.length; i++) out[i] = b2[i] ? 0 : 255;
            const cv = grayToCanvas(out, g0.w, g0.h);
            const res = runJsQR(toImageData(cv));
            if (res) return { cv, rect, hit: res };
          }
        }
        return null;
      },
    });

    // —— 几何策略：局部阈值检出 + 透视矫正 ——
    //
    // 前面所有几何策略的定位图案都来自全局 Otsu 阈值。
    // 而全局阈值在「光照渐变 + 重噪声」下会把分割切坏：
    // 实测（640×480 场景，码 200px，渐变+噪声+2px 模糊）
    // 暗像素占比高达 43%，三个真定位图案只检出 1 个（140px 码上 0 个），
    // 几何管线因此全线崩溃 —— 图案不够，三元组就凑不出来。
    //
    // 局部阈值（Sauvola）在同一场景下召回率 3/3。
    // 所以这条策略换的是「图案的来源」，几何矫正本身完全复用。
    //
    // 为什么放在深档末尾：局部阈值要算两个积分图，
    // 且在正常图像上并无增益（实测正常场景召回率本来就是 3/3），
    // 只该在全局阈值失败时才付这个代价。
    plan.push({
      name: 'adaptive-rectify',
      group: 'deep',
      make: () => {
        const { gray, norm, w, h } = getCtx();
        const src = norm.changed ? norm.gray : gray;

        // 先确认全局分割确实坏了 —— 好的话没必要走这条路
        const gbin = binarize(src, otsuThreshold(src));
        let dark = 0;
        for (let i = 0; i < gbin.length; i++) if (gbin[i]) dark++;
        if (dark / gbin.length < 0.15) return null;

        // 局部阈值分割
        const sbin = sauvolaBinarize(src, w, h);
        const patterns = findFinderPatterns(sbin, w, h);
        if (patterns.length < 3) return null;

        // 几何矫正用的重采样源有两个选择：
        //   · 原灰度 —— 保留灰度渐变，但噪声也一并带进矫正图
        //   · 局部阈值图 —— 干净的黑白，但丢失了抗模糊的灰度过渡
        // 两者各试一遍：模糊重的场景前者好，噪声重的场景后者好。
        const binSrc = new Uint8ClampedArray(sbin.length);
        for (let i = 0; i < sbin.length; i++) binSrc[i] = sbin[i] ? 0 : 255;

        for (const sampleSrc of [src, binSrc]) {
          let n = 0;
          for (const rect of rectifyCandidates(sampleSrc, w, h, patterns, {
            gateCorners: 1,
            maxWarps: 80,
            maxWarpsAlign: 60,
          })) {
            n++;
            const res = runJsQR(toImageData(rect.canvas));
            if (res) return { cv: rect.canvas, rect, hit: res };
            if (n >= 12) break;
          }
        }
        return null;
      },
    });
  }

    // —— 几何策略：桶形畸变参数扫描 ——
    //
    // 前面所有几何策略都建立在同一个前提上：
    // 码在画面里的形变可以用单应性（透视）加上一个固定系数的径向弯曲描述，
    // 而那个系数是「猜」的 —— 从少数几个经验值里试。
    //
    // 这条策略换的是这件事本身：把桶形畸变当成一个待搜索的参数，
    // 系统性地扫一遍，而不是猜几个值。
    //
    // 模型（全部由实测确定，不是拍脑袋）：
    //
    //   1) 畸变是二次径向的：撤销时按 f = 1 + α r²（α 为负，单位 px⁻²）重采样，
    //      采样点落在更内侧。方向不能反 —— 施加强度越大，撤销 α 越负。
    //   2) 有效撤销强度约为施加强度的一半：
    //      α_undo · R_code² = −k/2。五个场景全部吻合此式。
    //   3) α 是绝对像素量，与码在画面里占多大无关 ——
    //      所以参数化用绝对 α，而不是「相对码半径的系数」。
    //   4) 参考中心有两个候选，都必须试：
    //      图像中心（真实镜头畸变以光轴为中心）与检测到的码中心
    //     （拍摄时畸变相对被摄物施加）。实测两类场景各有胜负。
    //
    // 剪枝：扫描阶段只做「撤销 → 局部阈值二值化 → 定位图案检测 → 打分」，
    // 打分用两个不需 warp、不需解码的信号：
    //   geo —— 时序图案交替率（整条时序图案是否严格黑白交替）
    //   pen —— 版本一致性残差（两条直角边是否落在同一个 4v+10 上）
    // 实测可解候选在 geo 下的最好排名为 1~7，在 pen 下为 2~25，
    // 两者都不完美 —— 所以取两者的并集入选，而不是只看一个。
    //
    // 重要教训：geo 只能用于「排序」，绝不能当硬门槛。
    // 早期版本用 geo ≥ 0.55 做门槛，直接把两个本可解的场景判成无解
    // （它们的可解候选在那个场景下 geo 值恰好偏低）。
    if (deep) {
      plan.push({
        name: 'barrel-sweep',
        group: 'deep',
        make: () => {
          const { gray, w, h } = getCtx();

          // 参考中心候选
          const centers = [{ cx: w / 2, cy: h / 2 }];

          // 初始定位：与其它几何策略共用同一份图案检测结果。
          //
          // 关键在于「检测到的是不是真图案」：
          // 重噪声场景里，直接在原图上做 Sauvola 会检出 170~180 个图案，
          // 其中绝大多数是噪声碎块凑出的假阳性（实测 sc-hard 178 个、
          // sc-hard-small 183 个）。后果是「图案包围盒」被噪声撑满 ——
          // ROI 退化成整幅图，扫描阶段每个候选都要付全图像素的代价
          // （单候选 8~12ms）。
          //
          // 统一检测入口 detectFinderPatternsCached 会在结果可疑时
          // （图案数爆炸或模块尺寸过小）自动改用「3×3 中值滤波 + 局部阈值」：
          // 图案数降到 14~20 个，而真图案的 moduleSize 与 quality 完全保持
          // （真图案在结果里的索引从 92 降到 0~3）。
          //
          // 附带的好处：ROI 变小后噪声图案自然被裁掉，
          // ROI 内检出的图案降到 17~23 个 —— 候选池的数量截断
          // （取前 20/24 个）不再有切掉真图案的风险。
          const pats0 = detectFinderPatternsCached(gray, w, h);
          if (pats0.length >= 3) {
            const frame = estimateSymbolFrame(pats0);
            if (frame) centers.push({ cx: frame.cx, cy: frame.cy });
          }

          // 工作区域：码附近的一块。
          // 只在区域内做撤销与二值化 —— 单候选成本从 O(整图) 降到 O(码大小)，
          // 而采样仍取整幅原图（畸变中心常常在区域之外，采样必须能出区域）。
          const roi = roiAroundPatterns(pats0, w, h);

          // α 阶梯：绝对值（px⁻²），几何级数。
          // 公比 1.12 —— 实测可解窗口的相对宽度约 26%~30%，
          // 公比 1.12 保证窗口里至少落两三个点。
          // 覆盖范围 -4e-5（强畸变、小码）… -3e-7（真实照片的轻微镜头畸变）。
          //
          // 公比 1.08（实测选定，不是拍脑袋）：
          //   可解 α 窗口的「相对宽度」约 26%~30%，公比 1.12 时窗口里常常
          //   只落一个点，且那个点未必是最好的那一个 ——
          //   实测 sc-hard-small 在 1.12 下唯一可解的候选 geo=0、pen=0.81，
          //   在 geo 里排到第 25 位、在 pen 里排到第 36 位，被 top-K 剪枝整个刷掉。
          //   降到 1.08 后该场景的可解候选落在 geo 第 1 位，能被选中。
          //   1.06 更密反而更差（候选变多、可解点的排名被稀释），所以不是「越密越好」。
          const alphas = opts.barrelAlphas ?? buildAlphaLadder(4e-5, 3e-7, 1.08);

          const scan = (rx, ry, rw, rh) => {
            const out = [];
            for (const c of centers) {
              for (const alpha of alphas) {
                const ub = unbarrelRegion(gray, w, h, rx, ry, rw, rh, alpha, c.cx, c.cy);
                const bin = sauvolaBinarize(ub, rw, rh);
                const pats = findFinderPatterns(bin, rw, rh);
                if (pats.length < 3) continue;
                const thr = otsuThreshold(ub);
                const sc = barrelCandidateScore(ub, rw, rh, pats, thr);
                out.push({ c, alpha, geo: sc.geo, pen: sc.pen });
              }
            }
            return out;
          };

          let cands = scan(roi.x, roi.y, roi.w, roi.h);
          // 区域切错了的兜底：整段扫描一个候选都没产出，说明框没框住码，
          // 这时退回整幅图重扫一次。
          if (!cands.length && (roi.w !== w || roi.h !== h)) {
            cands = scan(0, 0, w, h);
          }
          if (!cands.length) return null;

          // 入选：按合并分数排序后取前 K 个，再补上两个信号各自的最佳候选。
          //
          // 合并分数：score = geo - w · (pen / penMax)
          //
          // 为什么需要合并而不是只看一个：
          //   geo 判别力强但是离散的 —— 它采样 17 个模块算交替率，粒度 1/16，
          //   同一档里的候选 geo 完全相同、无法区分。
          //   实测 sc-hard-small 前 6 个候选 geo 都是 0.917，
          //   真解（alpha=-2e-5）geo 只有 0.875，被压到第 7 位；
          //   而它在 pen 上排第 1（pen=0.05，其余 0.07~0.58）。
          //   pen 连续、分辨细，但只看三点，原理上比 geo 弱
          //   （桶形残余破坏的是整片网格，pen 感知不到）。
          //
          // 权重的定法（40 个参数化场景实测，不是拍脑袋）：
          //   w=0（纯 geo）  首个真解平均在第 2.7 位，40 个场景漏 2 个
          //   w=0.5         首个真解平均在第 1.3 位，漏 1 个
          //   w=1.5         首个真解平均在第 1.2 位，漏 1 个
          // 取 0.5：兼顾 geo 的强判别与 pen 的细分辨，两个硬场景上
          // sc-hard 的真解仍在第 1 位、sc-hard-small 的真解从第 7 位提到第 1 位。
          //
          // 为什么要跨参考中心统一排序：
          //   不同参考中心的分数尺度本来不同，混排会互相压制 ——
          //   但 pen 归一化后（除以全局 penMax）尺度问题就消了，
          //   而统一排序能利用「两个中心里哪个更可信」这个信息。
          //
          // 补上 geo/pen 各自的最佳候选是兜底：
          //   万一合并分数在某个场景把真解排到了 K 名之外，
          //   至少还有 geo 前列或 pen 前列的机会。
          const picked = [];
          const seen = new Set();
          const K = opts.barrelTop ?? 10;
          const W_PEN = opts.barrelPenWeight ?? 0.5;
          const penMax = Math.max(...cands.map((x) => x.pen), 1e-6);
          const scored = cands.map((x) => ({ x, s: x.geo - W_PEN * (x.pen / penMax) }));
          scored.sort((a, b) => b.s - a.s);
          const add = (x) => {
            const key = `${x.c.cx},${x.c.cy},${x.alpha}`;
            if (seen.has(key)) return;
            seen.add(key);
            picked.push(x);
          };
          for (const e of scored.slice(0, K)) add(e.x);
          // 兜底：两个信号各自的最佳候选
          const bestGeo = scored.reduce((a, b) => (b.x.geo > a.x.geo ? b : a), scored[0]);
          const bestPen = scored.reduce((a, b) => (b.x.pen < a.x.pen ? b : a), scored[0]);
          if (bestGeo) add(bestGeo.x);
          if (bestPen) add(bestPen.x);

          // 昂贵阶段：只对入选候选做透视矫正 + 解码
          const warps = opts.barrelWarps ?? 20;
          const aligns = opts.barrelWarpsAlign ?? 14;
          const rects = opts.barrelRects ?? 6;
          for (const x of picked) {
            const { c, alpha } = x;
            const ub = unbarrelRegion(gray, w, h, roi.x, roi.y, roi.w, roi.h, alpha, c.cx, c.cy);
            const bin = sauvolaBinarize(ub, roi.w, roi.h);
            const pats = findFinderPatterns(bin, roi.w, roi.h);
            if (pats.length < 3) continue;
            let n = 0;
            for (const rect of rectifyCandidates(ub, roi.w, roi.h, pats, {
              gateCorners: 1,
              maxWarps: warps,
              maxWarpsAlign: aligns,
            })) {
              if (++n > rects) break;
              // 位置映射需要知道矫正图是在哪张图上生成的：
              // 区域原点（裁剪偏移）与畸变参数（反变换回原图）。
              rect.origin = { x: roi.x, y: roi.y };
              rect.warp = { alpha, cx: c.cx, cy: c.cy };
              // 定位图案闸门：49 点采样，几乎免费，
              // 而 jsQR 要 12ms。实测 19 个入选候选产出 98 个矫正图，
              // 闸门能挡掉其中 56 个 —— 每次命中前的空跑大幅缩短。
              // 闸门只认「角上是不是定位图案」，不认极性（反色码也合法），
              // 实测首次命中的候选闸门一定通过，不会误杀正解。
              if (!looksLikeFinderPattern(rect)) continue;
              const res = runJsQR(toImageData(rect.canvas));
              if (res) return { cv: rect.canvas, rect, hit: res };
            }
          }
          return null;
        },
      });
    }

    // —— 区域策略：大图里的小码 ——
    if (allowTile && deep) {
    plan.push({
      name: 'tile',
      group: 'deep',
      make: () => {
        const { w, h } = getCtx();
        if (Math.max(w, h) < 1000) return null;
        for (const t of tileCandidates(w, h)) {
          const sub = cropCanvas(base, t.x, t.y, t.w, t.h);
          const up = scaleCanvas(sub, 2);
          const upG = toGray(toImageData(up));
          const upN = normalizeGray(upG.gray, upG.w, upG.h);
          const cv = upN.changed ? grayToCanvas(upN.gray, upG.w, upG.h) : up;
          const res = runJsQR(toImageData(cv));
          if (res) return { cv, hit: res };
        }
        return null;
      },
    });
  }

  // —— 逐个尝试 ——
  for (const at of plan) {
    // 分组过滤：'fast' 只跑光度与尺度策略，'deep' 只跑几何策略
    if (only !== 'all' && at.group !== only) continue;
    let built = null;
    try {
      built = at.make();
    } catch {
      built = null;
    }
    if (!built) continue;
    let res = built.hit || null;
    if (!res) {
      try {
        res = runJsQR(toImageData(built.cv));
      } catch {
        res = null;
      }
    }
    if (res) {
      let location = res.location || null;
      // 矫正图的定位点需要映射回原图
      if (built.rect) location = mapLocation(res.location, built.rect);
      // 区域裁剪的定位点要平移回整幅图的坐标
      else if (built.shift && location) location = shiftLocation(location, built.shift);
      return { data: res.data, location, strategy: at.name };
    }
  }
  return null;
}

/**
 * 异步解码入口：三级串联。
 *
 * 三级顺序不是随意排的，来源是实测（29 个合成变形用例）：
 *
 *   1. 主管线（decodeCanvas）
 *      几何 + 预处理路线。强透视、强弯曲、桶形畸变这类形变它能读出，
 *      zxing 读不出（zxing 依赖自身的检测器，对全局畸变无能为力）。
 *
 *   2. zxing 后端
 *      换的是「采样/解码后端」而不是「怎么更好地预处理同一张图」。
 *      它在每模块像素不足 2 的极小码上明显更强 —— 主管线在那种尺寸下
 *      会因双线性采样把相邻模块混在一起而误杀正确候选，
 *      zxing 用局部网格采样不受全局单应性误差影响。
 *
 *   3. 反弯曲矫正输出 → zxing
 *      前两级各自读不出的组合：主管线的几何矫正产出正视图，
 *      zxing 负责在正视图上做它擅长的采样解码。
 *
 * 实测覆盖：主管线 25/29，zxing 单跑 24/29，串联后 27/29。
 * 剩余两个（scale-32、occlude-25）卡在物理边界：
 * 前者每模块仅 1.57 像素，后者超出 M 级纠错约 15%。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 *   maxSide      最长边限制
 *   deep         是否启用重策略
 *   allowTile    是否允许分块搜索
 *   useZxing     是否启用 zxing 兜底（默认启用）
 *   useGeoZxing  是否启用「几何矫正输出喂 zxing」（默认启用）
 * @returns {Promise<{ data, location, strategy } | null>}
 */
export async function decodeCanvasAsync(canvas, opts = {}) {
  const useZxing = opts.useZxing !== false;
  const useGeoZxing = opts.useGeoZxing !== false;

  // —— 第一级：主管线快档（光度与尺度，毫秒级）——
  // 正常图片在这一档就命中了，不必惊动 wasm。
  const fast = decodeCanvas(canvas, { ...opts, only: 'fast' });
  if (fast) return fast;

  if (!useZxing) {
    // 不启用 zxing 时直接走主管线深档
    const deep = decodeCanvas(canvas, { ...opts, only: 'deep' });
    return deep;
  }

  // zxing 后端（惰性加载：首次会拉取并编译 wasm）
  const { decodeWithZxing, loadZxing } = await import('./qr-zxing.js');
  const zx = await loadZxing();
  if (!zx) {
    const deep = decodeCanvas(canvas, { ...opts, only: 'deep' });
    return deep;
  }

  // —— 第二级：zxing 直接读 ——
  // 原始图先试，再试对比拉伸后的版本（低对比码的关键路径）。
  // 实测 faint 用例只有归一化版本能被 zxing 读出。
  const baseId = toImageData(canvas);
  const direct = await decodeWithZxing(baseId, { tryHarder: true });
  if (direct) return { data: direct, location: null, strategy: 'zxing' };

  const { gray, w, h } = toGray(baseId);
  const norm = normalizeGray(gray, w, h);
  if (norm.changed) {
    const normId = toImageData(grayToCanvas(norm.gray, w, h));
    const normalized = await decodeWithZxing(normId, { tryHarder: true });
    if (normalized) return { data: normalized, location: null, strategy: 'zxing-normalized' };
  }

  // —— 第三级：主管线深档（透视矫正、弯曲矫正、分块）——
  // 强透视与桶形畸变是 zxing 的短板：它依赖自身的检测器，
  // 对全局畸变无能为力，而主管线能用单应性/径向变换把码掰回来。
  const deep = decodeCanvas(canvas, { ...opts, only: 'deep' });
  if (deep) return deep;

  // —— 第四级：几何矫正输出 → zxing ——
  // 主管线自己读不出、zxing 直接读也读不出，但两者互补的几何矫正产物能救回。
  if (useGeoZxing) {
    const geo = await decodeGeoWithZxing(canvas, opts);
    if (geo) return geo;
  }

  return null;
}

/**
 * 第三级：把主管线的几何矫正产物交给 zxing 解码。
 *
 * 走的是「反弯曲系数枚举 → 矫正 → 重采样」这条路：
 * 每个系数下产出正视图，交给 zxing 做它擅长的采样解码。
 * 主管线的 jsQR 在这些正视图上读不出（矫正后仍有残余形变），
 * 但 zxing 的局部网格采样能读出。
 */
async function decodeGeoWithZxing(canvas, opts) {
  const { decodeWithZxing } = await import('./qr-zxing.js');
  const maxSide = opts.maxSide ?? 1400;
  const base = limitSize(canvas, maxSide);
  const { gray, w, h } = toGray(toImageData(base));

  const ks = opts.unbarrelKs ?? [-0.45, -0.3, -0.2, -0.1, 0.1, 0.2, 0.3, 0.45];
  // 参考系与主管线保持一致：畸变相对码自身施加，用码的范围归一化，
  // 否则码在画面里偏小时矫正强度会差好几倍。
  const srcPatterns = detectFinderPatternsCached(gray, w, h);
  const frame = srcPatterns.length >= 3 ? estimateSymbolFrame(srcPatterns) : null;
  const ref = frame ? { cx: frame.cx, cy: frame.cy, R: frame.R } : null;

  for (const k of ks) {
    const ub = unbarrel(gray, w, h, k, ref);
    const bin = binarize(ub, otsuThreshold(ub));
    const patterns = findFinderPatterns(bin, w, h);
    if (patterns.length < 3) continue;
    for (const rect of rectifyCandidates(ub, w, h, patterns, { gateCorners: 2 })) {
      if (!looksLikeFinderPattern(rect)) continue;
      const text = await decodeWithZxing(toImageData(rect.canvas), { tryHarder: true });
      if (text) return { data: text, location: null, strategy: 'zxing-geometry' };
    }
  }

  // 反向串联：先透视矫正成正方形，再消残余弯曲。
  //
  // 与主管线的同名单策略是同一个道理 —— 畸变参考系在正视图上最准。
  // 这里多一层价值：zxing 的局部网格采样比 jsQR 更能容忍残余形变，
  // 所以正视图不必完全摆正也能读出。
  if (opts.geoReverse !== false && srcPatterns.length >= 3) {
    const rects = [];
    for (const rect of rectifyCandidates(gray, w, h, srcPatterns, {
      gateCorners: 1,
      maxWarps: 60,
      maxWarpsAlign: 40,
    })) {
      rects.push(rect);
      if (rects.length >= 6) break;
    }
    for (const rect of rects) {
      const g0 = toGray(toImageData(rect.canvas));
      const rbin = binarize(g0.gray, otsuThreshold(g0.gray));
      const rpats = findFinderPatterns(rbin, g0.w, g0.h);
      const rframe = rpats.length >= 3 ? estimateSymbolFrame(rpats) : null;
      const rref = rframe
        ? { cx: rframe.cx, cy: rframe.cy, R: rframe.R }
        : { cx: g0.w / 2, cy: g0.h / 2, R: Math.min(g0.w, g0.h) * 0.5 };
      for (const k of ks) {
        const ub = unbarrel(g0.gray, g0.w, g0.h, k, rref);
        const b2 = binarize(ub, otsuThreshold(ub));
        const out = new Uint8ClampedArray(ub.length);
        for (let i = 0; i < ub.length; i++) out[i] = b2[i] ? 0 : 255;
        const cv = grayToCanvas(out, g0.w, g0.h);
        const text = await decodeWithZxing(toImageData(cv), { tryHarder: true });
        if (text) return { data: text, location: null, strategy: 'zxing-geometry-reverse' };
      }
    }
  }
  return null;
}

/** 限制画布最长边 */
export function limitSize(canvas, maxSide) {
  const w = canvas.width, h = canvas.height;
  const max = Math.max(w, h);
  if (max <= maxSide) return canvas;
  const s = maxSide / max;
  return scaleCanvas(canvas, s);
}

/** 缩放画布（双线性） */
export function scaleCanvas(canvas, scale) {
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const src = toGray(toImageData(canvas));
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const sy = (y + 0.5) / scale - 0.5;
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / scale - 0.5;
      out[y * w + x] = bilinear(src.gray, src.w, src.h, sx, sy);
    }
  }
  return grayToCanvas(out, w, h);
}

/** 裁剪画布 */
export function cropCanvas(canvas, x, y, w, h) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}

/** 大图分块候选：2×2 重叠 + 中心 */
function tileCandidates(w, h) {
  const out = [];
  const hw = Math.round(w / 2), hh = Math.round(h / 2);
  const ox = Math.round(w * 0.12), oy = Math.round(h * 0.12);
  out.push({ x: 0, y: 0, w: hw + ox, h: hh + oy });
  out.push({ x: hw - ox, y: 0, w: hw + ox, h: hh + oy });
  out.push({ x: 0, y: hh - oy, w: hw + ox, h: hh + oy });
  out.push({ x: hw - ox, y: hh - oy, w: hw + ox, h: hh + oy });
  out.push({ x: Math.round(w * 0.25), y: Math.round(h * 0.25), w: Math.round(w * 0.5), h: Math.round(h * 0.5) });
  return out;
}

/** 解码文件（图片） */
export async function decodeFile(file, opts = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    // 走异步入口：主管线失败后自动降级到 zxing 后端
    return decodeCanvasAsync(canvas, opts);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ========== 摄像头实时扫描 ========== */

/**
 * 摄像头逐帧扫描器。
 *
 * 实时场景与批量识别的诉求不同：
 *   - 批量识别可以慢慢试各种策略，实时扫描每帧只有几十毫秒；
 *   - 但实时扫描的输入是连续视频流，同一个码会反复出现在画面里，
 *     完全可以利用「时间维度」来提高可靠性。
 *
 * 三项优化：
 *
 * 1. 多分辨率轮询
 *    画面里的码可能很大也可能很小。固定用一种缩放，
 *    小码（每模块不足 2 像素）在低分辨率下必然读不出，
 *    大码在高分辨率下又白白浪费算力。
 *    于是每帧轮换一个分辨率，让不同尺寸的码都有机会被采样到足够精度。
 *
 * 2. 帧间投票
 *    单帧的一次命中可能是噪声凑出来的假阳性。
 *    要求同一个结果连续出现两帧才确认，用一点点延迟换可靠性。
 *
 * 3. 区域跟踪（ROI）
 *    一旦某帧出现疑似命中，就把它所在区域记下来，
 *    后续帧只在这个区域附近采样 —— 相当于给扫描器加了个「注意力」，
 *    既省算力，也让小码的采样密度更高。
 *
 * 4. 多帧融合
 *    实时画面相对单张图片有一项独占优势：同一个码会连续出现很多帧，
 *    每帧的传感器噪声是不同的。噪声是零均值随机量，
 *    多帧平均后随机部分按 1/√N 衰减，而信号（码的结构）被保留 ——
 *    相当于在不影响对比度的前提下把信噪比提高 N 倍。
 *
 *    实测：一段低对比 + 模糊 + 噪声的场景，单帧读不出（3.1 秒超时），
 *    12 帧融合后由 zxing 解出（1.1 秒）。
 *
 *    只在所有单帧手段都失败时启用 —— 常规场景一秒内就命中了，
 *    不该为融合白等 12 帧。
 *
 * 同时每隔若干帧会跑一次完整的深度管线（透视矫正、弯曲矫正等），
 * 用来兜住变形二维码 —— 这类码单靠 jsQR 的直接识别是读不出的。
 *
 * 深度管线之后还会问一次 zxing 后端：实时画面里的小码
 * 每模块往往不足 2 像素，正是 jsQR 与主管线都读不出、
 * 而 zxing 的局部网格采样能读出的那一类。
 */
export function createVideoScanner(opts = {}) {
  // 每帧轮询的缩放档位：覆盖从「码很小」到「码很占满画面」的跨度
  const scales = opts.scales ?? [1, 0.75, 0.5, 1.25];
  // 帧间投票：同一结果连续出现几次才算确认
  const votes = opts.votes ?? 2;
  // 每隔几帧跑一次深度管线
  const deepEvery = opts.deepEvery ?? 4;
  // 投票窗口：几次帧之内出现同样的结果就算连续命中。
  // 深档与 zxing 都是隔帧运行的，要求严格连续会永远攒不满票数。
  const voteWindow = opts.voteWindow ?? 10;
  // 是否启用 zxing 兜底（摄像头里的小码靠它）
  const useZxing = opts.useZxing !== false;
  // 多帧融合：累积几帧后试一次融合解码
  const fuseFrames = opts.fuseFrames ?? 12;
  // 融合的试解码节奏：每几帧试一次（累积越多信噪比越好，但要等）
  const fuseEvery = opts.fuseEvery ?? 3;
  // 融合累积器至少累积几帧才值得试（太少则噪声没压下来）
  const fuseMin = opts.fuseMin ?? 3;
  // 融合试解码的上限次数：试这么多次还不行就放弃这一轮。
  // 融合图要重走一遍完整管线（几百毫秒到几秒），
  // 无限次重试会让「读不出」的场景变得极慢 —— 实测曾出现 40 帧耗 57 秒。
  const fuseTries = opts.fuseTries ?? 4;

  let canvas = null;
  let ctx = null;
  let zxCanvas = null; // zxing 专用画布：改尺寸会清空内容，不能与主管线共用
  let zxCtx = null;
  let scaleIdx = 0;
  let frameNo = 0;
  let missNo = 0; // 连续未命中帧数，独立于 frameNo
  let lastText = '';
  let lastCount = 0;
  let lastHitFrame = -99; // 上一次命中所在帧，用于给投票加窗口
  let roi = null; // { x, y, w, h } 相对原图的比例坐标
  let scratch = null;

  // —— 多帧融合状态 ——
  // 累积在整幅画面上（尺寸固定为 fuseW×fuseH），
  // 码的位置由累积图自身定位，不依赖跟踪 ROI ——
  // 跟踪 ROI 只在「某帧命中」后才建立，而融合要解决的
  // 恰恰是「一帧都命中不了」的场景，依赖它会循环依赖。
  let fuseAcc = null; // Float64Array，累加的灰度
  let fuseCnt = 0; // 已累积帧数
  let fuseTried = 0; // 已试解码次数
  let fuseW = 0; // 累积画布宽
  let fuseH = 0; // 累积画布高

  const makeCanvas = (w, h) => {
    if (!canvas) canvas = document.createElement('canvas');
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    return ctx || (ctx = canvas.getContext('2d', { willReadFrequently: true }));
  };

  const makeZxCanvas = (w, h) => {
    if (!zxCanvas) zxCanvas = document.createElement('canvas');
    if (zxCanvas.width !== w || zxCanvas.height !== h) {
      zxCanvas.width = w;
      zxCanvas.height = h;
      zxCtx = zxCanvas.getContext('2d', { willReadFrequently: true });
    }
    return zxCtx || (zxCtx = zxCanvas.getContext('2d', { willReadFrequently: true }));
  };

  // 融合专用画布：同样不能与主管线共用（改尺寸会清空内容）
  let fuseCanvas = null;
  let fuseCtx = null;
  const makeFuseCanvas = (w, h) => {
    if (!fuseCanvas) fuseCanvas = document.createElement('canvas');
    if (fuseCanvas.width !== w || fuseCanvas.height !== h) {
      fuseCanvas.width = w;
      fuseCanvas.height = h;
      fuseCtx = fuseCanvas.getContext('2d', { willReadFrequently: true });
    }
    return fuseCtx || (fuseCtx = fuseCanvas.getContext('2d', { willReadFrequently: true }));
  };

  /**
   * 处理一帧，返回 { data } | null
   *
   * @param {HTMLVideoElement} video
   */
  async function scanFrame(video) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    frameNo++;

    // —— 区域跟踪：优先在上一帧的疑似命中处采样 ——
    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;
    if (roi) {
      // ROI 四周留 30% 余量，容忍手抖导致的位移
      const pad = 0.3;
      sx = Math.max(0, Math.floor((roi.x - roi.w * pad) * vw));
      sy = Math.max(0, Math.floor((roi.y - roi.h * pad) * vh));
      sw = Math.min(vw - sx, Math.ceil(roi.w * (1 + 2 * pad) * vw));
      sh = Math.min(vh - sy, Math.ceil(roi.h * (1 + 2 * pad) * vh));
      if (sw < 32 || sh < 32) {
        sx = 0; sy = 0; sw = vw; sh = vh;
      }
    }

    // 本帧的缩放档位
    const scale = scales[scaleIdx % scales.length];
    scaleIdx++;

    const targetW = Math.max(32, Math.min(1600, Math.round(sw * scale)));
    const targetH = Math.max(32, Math.min(1600, Math.round(sh * scale)));
    const c = makeCanvas(targetW, targetH);
    c.drawImage(video, sx, sy, sw, sh, 0, 0, targetW, targetH);
    const imageData = c.getImageData(0, 0, targetW, targetH);

    // 快路径：直接 jsQR，单帧开销约 5–15 毫秒
    const quick = jsQR(imageData.data, targetW, targetH);
    let hit = quick && quick.data ? quick : null;

    // zxing 兜底：画面里的小码靠它，jsQR 与主管线都读不出。
    // 放在深档之前 —— zxing 只需十几毫秒，深档要几百毫秒，
    // 让快的先说话，慢的兜底。
    //
    // 关键：不能用上面那份缩放过的图。当前帧的缩放档位是轮换的，
    // 小码在 0.5 档只剩一半尺寸，zxing 的局部网格采样需要足够的
    // 每模块像素数，缩一半就前功尽弃。所以这里按 ROI 原尺寸重新采一次。
    //
    // 也必须用自己的画布：改 canvas.width 会清空内容，
    // 与主管线共用同一个画布会把主管线正在读的画面抹掉。
    if (!hit && useZxing) {
      try {
        const { decodeWithZxing } = await import('./qr-zxing.js');
        const zxW = Math.max(32, Math.min(1600, sw));
        const zxH = Math.max(32, Math.min(1600, sh));
        const zc = makeZxCanvas(zxW, zxH);
        zc.drawImage(video, sx, sy, sw, sh, 0, 0, zxW, zxH);
        const zxId = zc.getImageData(0, 0, zxW, zxH);
        const text = await decodeWithZxing(zxId, { tryHarder: true });
        if (text) hit = { data: text, strategy: 'zxing', location: null };
      } catch {
        /* zxing 不可用时静默跳过 */
      }
    }

    // 深度管线：每 deepEvery 帧跑一次，用于识别变形码
    if (!hit && deepEvery > 0 && frameNo % deepEvery === 0) {
      try {
        const deep = decodeCanvas(canvas, { deep: true, allowTile: false, maxSide: 1200 });
        if (deep && deep.data) hit = deep;
      } catch {
        /* 深档失败不算致命 */
      }
    }

    // 多帧融合：所有单帧手段都失败后才启用。
    //
    // 为什么放在这个位置：
    //   融合要等若干帧才有意义，而常规场景一两帧内就命中了。
    //   放在单帧手段之后，等于「常规路径零开销，
    //   只有真正读不出时才付出等待的代价」。
    if (!hit && fuseFrames > 0) {
      // 先把本帧采进累积器（累积是每帧都做的）
      // 不降采样：降采样会把码的模块细节抹掉，
      // 而融合的全部意义就是保留细节、只压噪声。
      // 内存代价是 Float64Array，约 2.5MB（640×480），可接受。
      const fw = vw;
      const fh = vh;
      if (fuseW !== fw || fuseH !== fh) {
        fuseW = fw; fuseH = fh;
        fuseAcc = new Float64Array(fw * fh);
        fuseCnt = 0;
        fuseTried = 0;
      }
      const fc = makeFuseCanvas(fw, fh);
      fc.drawImage(video, 0, 0, vw, vh, 0, 0, fw, fh);
      const fg = toGray(fc.getImageData(0, 0, fw, fh));
      for (let i = 0; i < fuseAcc.length; i++) fuseAcc[i] += fg.gray[i];
      fuseCnt++;

      // 试解码
      hit = await tryFuse();

      // 一轮累积结束仍未解出，且试次也用尽：放弃这一轮，重新攒。
      // 融合图要重走一遍解码管线，代价不小，
      // 无限重试会让「读不出」的场景变得极慢。
      //
      // 注意语义：试次上限只在「一轮累积结束」时生效。
      // 若提前放弃，会把「累积还没到帧数上限」的好局面掐掉 ——
      // 实测正是如此：3/6/9 帧试解码都失败（正常，噪声还没压够），
      // 到 12 帧就能解出，但试次在第 4 次就用完了。
      if (!hit && fuseCnt >= fuseFrames && fuseTried >= fuseTries) {
        // 清空时必须连 fuseW 一起清掉 ——
        // 否则下一帧的尺寸判断会认为「尺寸没变」而不重建累积器，
        // 累加时就会撞上 null。
        fuseAcc = null;
        fuseCnt = 0;
        fuseTried = 0;
        fuseW = 0;
        fuseH = 0;
      }
    }

    if (!hit || !hit.data) {
      // 连续多帧没有命中就丢弃 ROI，避免一直盯着一个已经不存在的码。
      // 注意用独立的 missNo 计数，不能碰 frameNo ——
      // frameNo 决定 zxing 与深度管线的触发节奏（frameNo % deepEvery），
      // 在这里自增会让它变成奇数序列，深档与 zxing 一次都跑不到。
      missNo++;
      if (roi && missNo % 30 === 0) roi = null;
      return null;
    }
    missNo = 0;

    // 记录疑似位置，供下一帧跟踪
    const loc = hit.location;
    if (loc && loc.topLeftCorner) {
      const minX = Math.min(loc.topLeftCorner.x, loc.bottomLeftCorner.x);
      const maxX = Math.max(loc.topRightCorner.x, loc.bottomRightCorner.x);
      const minY = Math.min(loc.topLeftCorner.y, loc.topRightCorner.y);
      const maxY = Math.max(loc.bottomLeftCorner.y, loc.bottomRightCorner.y);
      // 换算回原图比例坐标
      roi = {
        x: (sx + minX / scale) / vw,
        y: (sy + minY / scale) / vh,
        w: Math.max(1e-3, (maxX - minX) / scale / vw),
        h: Math.max(1e-3, (maxY - minY) / scale / vh),
      };
    }

    // 帧间投票：同一结果出现 votes 次才确认。
    //
    // 不是「严格连续」而是「窗口内出现」—— 深档与 zxing 只在部分帧运行，
    // 若要求连续，中间那些没跑的帧会把计数清零，永远攒不满。
    if (hit.data === lastText && frameNo - lastHitFrame <= voteWindow) {
      lastCount++;
    } else {
      lastText = hit.data;
      lastCount = 1;
    }
    lastHitFrame = frameNo;
    if (lastCount >= votes) return { data: hit.data, strategy: hit.strategy || 'direct' };
    return null;
  }

  /**
   * 多帧融合解码。
   *
   * 噪声是零均值随机量，多帧平均后按 1/√N 衰减，信号保留 ——
   * 等于在不损失对比度的前提下提高信噪比。
   *
   * 累积框一旦建立就锁定：跟踪逻辑逐帧微调 ROI，
   * 若跟着它变，平均出来的就是不同位置的图像 —— 糊的，不是干净的。
   *
   * @returns {{data: string, strategy: string}|null}
   */
  async function tryFuse() {
    const acc = fuseAcc;
    if (!acc) return null;
    const cnt = fuseCnt;
    if (cnt < fuseMin) return null;

    // 不是每次都试解码：融合图要重走一遍完整管线，有代价。
    // 累积越多信噪比越好，所以到节奏点才试。
    // 这个检查必须放在最前面 —— 跳过时就不该生成均值图、白跑一遍定位。
    if (cnt % fuseEvery !== 0 && cnt < fuseFrames) return null;
    fuseTried++;

    // —— 定位：从累积图自身找码 ——
    //
    // 不能依赖跟踪 ROI：ROI 只在「某帧命中」后才建立，
    // 而融合要解决的恰恰是「一帧都命中不了」的场景 —— 循环依赖。
    //
    // 改用累积图自身定位：平均之后噪声降到 1/√N，
    // 二值化的暗区就只剩码本身，包围盒即为码的位置。
    // 这比任何单帧检测器都稳。
    //
    // 生成均值图
    const mean = new Uint8ClampedArray(acc.length);
    for (let i = 0; i < acc.length; i++) mean[i] = acc[i] / cnt;

    // 定位码：取暗区包围盒。
    //
    // 阈值不能简单用均值：噪声残留会让画面里到处有略低于均值的像素，
    // 包围盒会膨胀到整幅画面，裁剪就等于没裁。
    // 用「均值减去一个噪声容差」作阈值，只取明显更暗的区域。
    let sum = 0;
    for (let i = 0; i < mean.length; i++) sum += mean[i];
    const avg = sum / mean.length;
    // 噪声容差：按平均值的 6% 估计，累积 12 帧后噪声标准差约为单帧的 1/3.5
    const thr = avg - Math.max(6, avg * 0.06);
    let minX = fuseW, minY = fuseH, maxX = -1, maxY = -1;
    for (let y = 0; y < fuseH; y++) {
      for (let x = 0; x < fuseW; x++) {
        if (mean[y * fuseW + x] < thr) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return null;
    // 包围盒不能大到离谱：超过画面 85% 说明定位失败，放弃这一轮
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (bw > fuseW * 0.85 || bh > fuseH * 0.85) return null;
    // 包围盒外扩，给码的静区留余量。
    //
    // 静区不能省：二维码标准要求四周留 4 个模块的白边，
    // 检测器需要靠它确认「这里是一个码的边界」。
    // 暗区包围盒只框住了码的黑部分，把静区切掉会让检测器失去依据。
    // 外扩量按包围盒尺寸的 18% 取，120 像素的码对应约 22 像素，
    // 覆盖 4 个模块绰绰有余。
    const padX = Math.ceil(bw * 0.18);
    const padY = Math.ceil(bh * 0.18);
    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);
    const cw = Math.min(fuseW - minX, bw + padX * 2);
    const ch = Math.min(fuseH - minY, bh + padY * 2);
    if (cw < 48 || ch < 48) return null;

    const fused = grayToCanvas(mean, fuseW, fuseH);
    // 裁到码区域并放大。
    //
    // 为什么要放大：包围盒框住的是码的暗区，不含静区，
    // 裁出来的图里码只占一部分，zxing 的局部网格采样密度不够。
    // 放大到「每模块至少 4 像素」，采样才有意义。
    const cropped = cropCanvas(fused, minX, minY, cw, ch);
    // 目标边长：暗区边长放大 2.2 倍（含静区并给采样留余量）
    const targetSide = Math.max(cw, Math.ceil(bw * 2.2));
    const zoom = Math.max(1, Math.min(4, targetSide / cw));
    const zoomed = zoom > 1.05 ? scaleCanvas(cropped, zoom) : cropped;

    // 只跑快档 + zxing，不跑完整深档。
    //
    // 理由有两层：
    //   1. 融合图已经把噪声压到 1/√N，剩下的瓶颈是对比度与模糊，
    //      几何矫正（透视/弯曲）对这两种退化帮助有限；
    //   2. 代价差着数量级 —— 深档要枚举候选并重采样，
    //      单次就要几百毫秒到几秒。融合要试很多次，
    //      每次都跑深档会让「读不出」的场景拖到几十秒。
    //
    // 实测救回的场景里命中的是 zxing（快档里没有它），
    // 主管线的 rectify 偶尔也能救回，但代价不值得每次都付。
    const fastOpts = {
      maxSide: 1400,
      deep: false,        // 不跑几何深档
      allowTile: false,
      useGeoZxing: false, // 不跑几何矫正喂 zxing
    };
    let res = null;
    try {
      res = await decodeCanvasAsync(zoomed, fastOpts);
    } catch {
      res = null;
    }
    // 裁剪版读不出时也试整幅融合图。
    //
    // zxing 自带检测器，能自己在整幅图里找到码；
    // 裁剪反而可能切掉它需要的上下文（尤其码在画面里偏小的时候）。
    // 两版都试，代价只是多一次快档解码（十几毫秒）。
    if (!res || !res.data) {
      try {
        res = await decodeCanvasAsync(fused, fastOpts);
      } catch {
        res = null;
      }
    }
    if (!res || !res.data) {
      // 失败时不清空 —— 「这一轮攒够了没解出」的判断交给调用方，
      // 由它统一决定是否重开一轮（它还要看试次上限）。
      return null;
    }
    // 解出后清空累积器：下一轮重新攒，避免用旧内容拖累后续帧。
    fuseAcc = null;
    fuseCnt = 0;
    fuseTried = 0;
    fuseW = 0;
    fuseH = 0;
    return { data: res.data, strategy: 'fuse-' + (res.strategy || 'direct'), location: null };
  }

  return { scanFrame, reset() { roi = null; lastText = ''; lastCount = 0; lastHitFrame = -99; frameNo = 0; missNo = 0; fuseAcc = null; fuseCnt = 0; fuseTried = 0; } };
}

/* ========== 批量识别 ========== */

/**
 * 批量解码：受控并发 + 进度回调 + 失败重试。
 *
 * 三个要点：
 *   1. 并发度控制。解码是 CPU 密集的纯计算，
 *      开太多并发反而因为主线程被切碎而变慢，还容易爆内存；
 *      同时并发也受浏览器标签页的后台节流影响。默认 3 路。
 *   2. 进度反馈。每完成一张就回调一次，界面可以显示「已完成 3/20」。
 *   3. 失败重试。第一遍用常规参数；失败的用更激进的参数再试一遍
 *      （更小 maxSide 换速度、更大 maxSide 换精度、开启分块搜索）。
 */
export async function decodeFiles(files, opts = {}) {
  const concurrency = opts.concurrency ?? 3;
  const onProgress = opts.onProgress;
  const items = Array.from(files).map((file) => ({ file, result: null, done: false }));

  let cursor = 0;
  let finished = 0;

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      const it = items[i];
      try {
        it.result = await decodeFile(it.file, opts.decodeOpts || {});
      } catch {
        it.result = null;
      }
      // 第一遍失败的，用更激进的参数重试
      if (!it.result) {
        const retry = opts.retryOpts || { maxSide: 2400, deep: true, allowTile: true };
        try {
          it.result = await decodeFile(it.file, { ...(opts.decodeOpts || {}), ...retry });
        } catch {
          it.result = null;
        }
      }
      it.done = true;
      finished++;
      if (onProgress) {
        try {
          onProgress(finished, items.length, it);
        } catch {
          /* 进度回调出错不影响主流程 */
        }
      }
    }
  };

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return items;
}

