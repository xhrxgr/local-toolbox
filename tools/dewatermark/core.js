/**
 * 水印检测与修复核心算法（纯 JavaScript，无 OpenCV 依赖）
 *
 * 背景：这一类水印（如「微信公众号:某某资料厂」）通常不是 PDF 的文字对象，
 * 而是已经烧进页面位图里的黑色文字。也就是说 pdf-lib 删不掉它，
 * 只能在像素层面处理。
 *
 * 两类形态，需要两套检测：
 *   A. 固定位水印（页眉/页脚/边栏）：每一页同一位置都有同样的字。
 *      特征极强 —— 用「跨页同位置墨迹共识」即可自动发现，无需用户干预。
 *   B. 变位水印（插在正文行里）：位置和字号逐页不同，字形也不同（不是同一渲染）。
 *      自动识别不可靠，改为「用户框选一处 → 模板追踪到其他页」。
 *
 * 修复用「邻域扩散填充」（diffusion inpainting）：
 * 从掩膜边界往内逐层扩散已知像素，几轮迭代后被遮住的区域会自然过渡。
 * 纯 JS 实现，无需 OpenCV，且对纯白背景的文档效果接近 OpenCV 的 Telea。
 */

/* ========== 基础：灰度与二值化 ========== */

/** 从 ImageData 取灰度数组（Rec.601 加权） */
export function toGray(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return gray;
}

/**
 * 二值化：墨迹为 1（暗），背景为 0
 * Otsu 阈值自动选取；样本太少时退回固定阈值
 */
export function binarize(gray, width, height) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  // Otsu 阈值偏低时兜底抬高，避免把浅色底纹当墨迹
  const threshold = best < 100 ? 100 : best;

  const ink = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) ink[i] = gray[i] < threshold ? 1 : 0;
  return { ink, threshold };
}

/* ========== 连通域分析（两遍扫描 + 并查集） ========== */

/**
 * 8 邻域连通域标记
 * @returns {{boxes: Array<{x,y,w,h,area}>, labels: Int32Array}}
 */
export function connectedComponents(ink, width, height) {
  const labels = new Int32Array(width * height).fill(-1);
  const parent = [];

  function find(a) {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  }
  function union(a, b) {
    a = find(a); b = find(b);
    if (a !== b) parent[b] = a;
  }

  let next = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!ink[p] || labels[p] !== -1) continue;
      // 新建一个标签
      const label = next++;
      parent[label] = label;
      labels[p] = label;
      const stack = [p];
      while (stack.length) {
        const q = stack.pop();
        const qx = q % width, qy = (q / width) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = qy + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = qx + dx;
            if (nx < 0 || nx >= width) continue;
            const r = ny * width + nx;
            if (!ink[r]) continue;
            if (labels[r] === -1) {
              labels[r] = label;
              stack.push(r);
            } else {
              union(label, labels[r]);
            }
          }
        }
      }
    }
  }

  // 汇总每个根的包围盒
  const acc = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (labels[p] === -1) continue;
      const root = find(labels[p]);
      let a = acc.get(root);
      if (!a) { a = { x0: x, y0: y, x1: x, y1: y, area: 0 }; acc.set(root, a); }
      if (x < a.x0) a.x0 = x;
      if (x > a.x1) a.x1 = x;
      if (y < a.y0) a.y0 = y;
      if (y > a.y1) a.y1 = y;
      a.area++;
    }
  }
  const boxes = [];
  for (const a of acc.values()) {
    boxes.push({ x: a.x0, y: a.y0, w: a.x1 - a.x0 + 1, h: a.y1 - a.y0 + 1, area: a.area });
  }
  return { boxes, labels };
}

/* ========== 检测 A：跨页同位置墨迹共识 ========== */

/**
 * 找出在所有页同一位置都出现的墨迹（固定位水印）
 *
 * 原理：水印每页都画在同一坐标，于是该坐标在每一页都有墨迹；
 * 正文内容逐页不同，坐标不固定。逐像素累加各页的墨迹计数，
 * 计数达到页数的区域就是固定位水印。
 *
 * @param {Array<Uint8Array>} inks 各页二值图（长度一致）
 * @returns {Array<{x0,y0,x1,y1}>} 共识区域（已按行合并成条带）
 */
export function detectFixedWatermark(inks, width, height) {
  const pageCount = inks.length;
  if (pageCount < 2) return [];

  const count = new Uint8Array(width * height);
  for (const ink of inks) {
    for (let i = 0; i < ink.length; i++) if (ink[i]) count[i]++;
  }

  // 共识判据：绝大多数页都有墨迹即可。
  // 不用「每页都有」是因为水印偶尔会被本页正文压住，
  // 严格要求会让笔画被切成一段一段，擦不干净。
  const need = Math.max(2, Math.ceil(pageCount * 0.8));
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < count.length; i++) mask[i] = count[i] >= need ? 1 : 0;

  const { boxes } = connectedComponents(mask, width, height);

  // 过滤噪点与表格线：阈值取「自适应」而非固定值，
  // 因为分析分辨率会随 DPI 变化，固定面积阈值换一张纸就失效
  const cands = boxes.filter(b => b.area >= 8 && b.h >= 5 && b.h <= 120 && b.w <= 200);
  if (!cands.length) return [];
  const heights = cands.map(b => b.h).sort((a, b) => a - b);
  const medH = heights[heights.length >> 1];
  const chars = cands.filter(b =>
    b.h >= medH * 0.4 && b.h <= medH * 1.8 && b.w <= medH * 2.5 && b.area >= 8);

  // 按 y 聚成行
  chars.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
  const lines = [];
  for (const c of chars) {
    const cy = c.y + c.h / 2;
    const line = lines.find(l => Math.abs(l.cy - cy) <= 10);
    if (line) { line.items.push(c); line.cy = (line.cy + cy) / 2; }
    else lines.push({ cy, items: [c] });
  }

  // 同行字符合并为一条带。
  // 不按 x 间隙再分组：水印是词组，字距常大于阈值，
  // 按间隙分组会把一句话拆成几段，段间的笔画就漏擦了。
  // 框画大一点无害 —— 擦除时只涂墨迹像素，不涂整块矩形。
  const strips = [];
  for (const line of lines) {
    if (line.items.length < 3) continue; // 单个字不算水印串
    strips.push({
      x0: Math.min(...line.items.map(c => c.x)),
      y0: Math.min(...line.items.map(c => c.y)),
      x1: Math.max(...line.items.map(c => c.x + c.w)),
      y1: Math.max(...line.items.map(c => c.y + c.h)),
      charCount: line.items.length,
    });
  }
  return strips;
}

/**
 * 跨页图案一致性：同一矩形内，各页二值图彼此的重合率
 *
 * 用来把「固定位水印」和「固定位正文」区分开。
 * 页码「第 1 页 共 10 页」每页都在同一位置，跨页共识检测会把它当成水印，
 * 但它每个字都不同（数字变了），与首页的图案重合率只有 0.11；
 * 而真正的水印是同一张位图贴到各页，重合率高达 0.92。
 *
 * 取所有页对的**最小值**而不是中位数：
 *   页码的中位重合率仍有 0.81（「第」「页」「共」「页」四个字没变），
 *   只有最小值才能把它压下来。
 *
 * @param {Array<Uint8Array>} inks 各页二值图
 * @param {number} width @param {number} height
 * @param {{x,y,w,h}} box 待检矩形
 * @returns {number} 最小一致性 [0,1]
 */
export function crossPageConsistency(inks, width, height, box) {
  if (inks.length < 2) return 0;
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.w));
  const y1 = Math.min(height, Math.ceil(box.y + box.h));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return 0;

  const first = inks[0];
  const scores = [];
  for (let i = 1; i < inks.length; i++) {
    const ink = inks[i];
    let inter = 0, uni = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const a = first[y * width + x], b = ink[y * width + x];
        if (a || b) uni++;
        if (a && b) inter++;
      }
    }
    scores.push(uni ? inter / uni : 0);
  }
  if (!scores.length) return 0;
  return Math.min(...scores);
}

/* ========== 检测 B：模板追踪（变位水印） ========== */

/**
 * 把二值图按 k×k 块聚合成「块墨量」网格
 *
 * 动机：模板追踪要在整页上滑动匹配，逐像素运算的复杂度是
 * 位置数 × 模板墨点数。1389×1964 的页面上模板若有 2000 个墨点，
 * 单页就是 50 亿次 —— 纯 JS 跑不动。
 *
 * 降采样到 k×k 块（块内墨点求和）后，位置数降到 1/k²，
 * 模板墨点数也降到 1/k²，总量降为 1/k⁴。k=4 时快 256 倍。
 *
 * @param {Uint8Array} ink
 * @returns {{vals: Float32Array, w: number, h: number}} vals 为每块的墨点数
 */
export function buildBlockGrid(ink, width, height, k = 4) {
  const gw = Math.ceil(width / k), gh = Math.ceil(height / k);
  const vals = new Float32Array(gw * gh);
  for (let y = 0; y < height; y++) {
    const gy = (y / k) | 0;
    const rowBase = gy * gw;
    for (let x = 0; x < width; x++) {
      if (ink[y * width + x]) vals[rowBase + ((x / k) | 0)]++;
    }
  }
  return { vals, w: gw, h: gh };
}

/**
 * 模板块描述：哪些块含水印笔画，以及每块的墨量
 *
 * 只保留含笔画的块 —— 背景块（全白）在任何位置都能对上，
 * 留着会把分数稀释成没有区分度的常数。
 */
function buildTemplateBlocks(tplInk, tplW, tplH, k) {
  const bw = Math.ceil(tplW / k), bh = Math.ceil(tplH / k);
  const ink = new Float32Array(bw * bh);
  const hasInk = new Uint8Array(bw * bh);
  for (let y = 0; y < tplH; y++) {
    for (let x = 0; x < tplW; x++) {
      const bx = (x / k) | 0, by = (y / k) | 0;
      const i = by * bw + bx;
      if (tplInk[y * tplW + x]) { ink[i]++; hasInk[i] = 1; }
    }
  }
  const blocks = [];
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const i = by * bw + bx;
      if (!hasInk[i]) continue;
      blocks.push({ bx, by, val: ink[i] });
    }
  }
  return { blocks, bw, bh };
}

/**
 * 块级余弦相似度相关图
 *
 * 为什么用余弦而不是标准 NCC：
 *   - 二值墨迹模板在「有笔画」的位置上取值全是 1，方差为 0，
 *     标准 NCC 的分母直接塌掉，分数毫无意义（早期版本正是栽在这里）；
 *   - 余弦相似度对称、有界 [0,1]，对亮度整体缩放不敏感，
 *     而这正是我们要的 —— 只要「笔画分布形状像」就算命中。
 *
 * @param {{vals:Float32Array,w:number,h:number}} img 图像块网格
 * @param {{blocks:Array,bw:number,bh:number}} tpl 模板
 * @returns {Float32Array} (gw-bw+1)*(gh-bh+1) 的相似度图
 */
function blockCosineGrid(img, tpl) {
  const outW = img.w - tpl.bw + 1;
  const outH = img.h - tpl.bh + 1;
  const out = new Float32Array(Math.max(0, outW * outH));
  if (outW <= 0 || outH <= 0) return out;

  const n = tpl.blocks.length;
  if (!n) return out;

  let tplNorm = 0;
  for (const b of tpl.blocks) tplNorm += b.val * b.val;
  tplNorm = Math.sqrt(tplNorm);
  if (tplNorm < 1e-6) return out;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const base = y * img.w + x;
      let cross = 0, imgSq = 0;
      for (let k = 0; k < n; k++) {
        const b = tpl.blocks[k];
        const v = img.vals[base + b.by * img.w + b.bx];
        cross += v * b.val;
        imgSq += v * v;
      }
      const denom = Math.sqrt(imgSq) * tplNorm;
      out[y * outW + x] = denom > 1e-9 ? cross / denom : 0;
    }
  }
  return out;
}

/**
 * 3×3 盒式模糊
 *
 * 为什么必须先模糊再相关：
 *   同一串水印在不同页上的落点存在亚像素偏移，笔画会差 1~2 像素。
 *   直接逐像素相关，正确位置的分数也只有 0.18 —— 因为模板要求
 *   「这个像素必须是黑的」，而实际笔画挪了位置，那里就变白了。
 *   模糊之后，1 像素的错位只造成很小的灰度差异，相关分数才拉得起来。
 */
function blur3(gray, width, height) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = y > 0 ? y - 1 : 0;
    const y1 = y < height - 1 ? y + 1 : height - 1;
    for (let x = 0; x < width; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x1 = x < width - 1 ? x + 1 : width - 1;
      const s =
        gray[y0 * width + x0] + gray[y0 * width + x] + gray[y0 * width + x1] +
        gray[y * width + x0] + gray[y * width + x] + gray[y * width + x1] +
        gray[y1 * width + x0] + gray[y1 * width + x] + gray[y1 * width + x1];
      out[y * width + x] = (s / 9) | 0;
    }
  }
  return out;
}

/**
 * 原分辨率精修：在候选位置邻域里，用灰度暗度做掩膜零均值归一化相关
 *
 * 三个关键点，都是踩过坑才定下来的：
 *
 * 1. 用灰度暗度而不是二值墨迹。
 *    二值化会丢掉笔画浓淡与抗锯齿边缘，而同一水印在不同页上
 *    渲染时亚像素偏移不同，二值笔画根本不可能逐像素重合
 *    （实测交并比只有 0.3，真水印和正文误匹配完全分不开）。
 *
 * 2. 用零均值归一化相关而不是余弦。
 *    余弦没有减均值，页面整体亮度差会直接压低分数；
 *    零均值化之后只比较「笔画浓淡的空间分布」，对亮度不敏感。
 *
 * 3. 掩膜取「模板里较暗的像素」，而不是全部墨迹像素。
 *    抗锯齿边缘的浅灰像素几乎不携带形状信息，混进来只会稀释分数；
 *    同时保证模板在这组像素上有非零方差 —— 这正是早期版本
 *    用二值模板导致 NCC 分母塌成 0、分数全是垃圾值的根因。
 */
function refineScore(gray, width, height, offs, tplStats, cx, cy, radius) {
  const n = offs.length;
  if (!n) return { x: cx, y: cy, score: 0 };
  const { mean: tplMean, var: tplVar } = tplStats;
  if (tplVar < 1e-6) return { x: cx, y: cy, score: 0 };

  let best = -1, bestX = cx, bestY = cy;
  for (let oy = -radius; oy <= radius; oy++) {
    const y = cy + oy;
    if (y < 0) continue;
    for (let ox = -radius; ox <= radius; ox++) {
      const x = cx + ox;
      if (x < 0) continue;
      let cross = 0, sumI = 0, sumSq = 0, inkHits = 0;
      for (let k = 0; k < n; k++) {
        const o = offs[k];
        const px = x + o.dx, py = y + o.dy;
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        const u = 255 - gray[py * width + px];
        cross += u * o.v;
        sumI += u;
        sumSq += u * u;
        if (u > 128) inkHits++;
      }
      const m = n;
      const imgMean = sumI / m;
      const imgVar = Math.max(sumSq / m - imgMean * imgMean, 1e-6);
      const cov = cross / m - imgMean * tplMean;
      const score = cov / Math.sqrt(imgVar * tplVar);
      // 命中的笔画比例太低 → 多半是匹配到了普通正文或空白
      if (inkHits < n * 0.3) continue;
      if (score > best) { best = score; bestX = x; bestY = y; }
    }
  }
  return { x: bestX, y: bestY, score: best };
}

/**
 * 用用户框选的水印样本，在所有页面追踪同类实例
 *
 * 两阶段：块网格粗搜（快）→ 原分辨率邻域精修（准）。
 *
 * @param {Array<{ink:Uint8Array,gray:Uint8Array,width:number,height:number}>} pages
 * @param {{x:number,y:number,w:number,h:number}} sample 样本框（分析分辨率坐标）
 * @param {number} samplePageIndex 样本所在页
 * @param {number} threshold 命中阈值
 * @returns {Array<{pageIndex,x,y,w,h,score}>}
 */
export function trackTemplate(pages, sample, samplePageIndex, threshold = 0.55) {
  const sp = pages[samplePageIndex];
  if (!sp) return [];
  const K = 4;

  // 模板（原分辨率二值 + 暗度）
  const tplInk = new Uint8Array(sample.w * sample.h);
  const tplDark = new Float32Array(sample.w * sample.h);
  for (let y = 0; y < sample.h; y++) {
    for (let x = 0; x < sample.w; x++) {
      const sy = sample.y + y, sx = sample.x + x;
      if (sy < 0 || sy >= sp.height || sx < 0 || sx >= sp.width) continue;
      const idx = y * sample.w + x;
      tplInk[idx] = sp.ink[sy * sp.width + sx];
      tplDark[idx] = 255 - sp.gray[sy * sp.width + sx];
    }
  }
  let inkCount = 0;
  for (let i = 0; i < tplInk.length; i++) inkCount += tplInk[i];
  if (inkCount < 20) return [];

  // 模板的笔画像素清单（原分辨率偏移 + 暗度）
  // 掩膜取「暗度 ≥ 100」的像素：足够黑才携带形状信息，
  // 浅灰的抗锯齿边缘只会稀释分数，同时保证模板方差非零。
  // 模板取自模糊图 —— 与被检图口径必须一致。
  const spBlur = blur3(sp.gray, sp.width, sp.height);
  const offs = [];
  let tplSum = 0, tplSqSum = 0;
  for (let y = 0; y < sample.h; y++) {
    for (let x = 0; x < sample.w; x++) {
      const i = y * sample.w + x;
      if (!tplInk[i]) continue;
      const sy = sample.y + y, sx = sample.x + x;
      if (sy < 0 || sy >= sp.height || sx < 0 || sx >= sp.width) continue;
      const v = 255 - spBlur[sy * sp.width + sx];
      if (v < 100) continue;
      offs.push({ dx: x, dy: y, v });
      tplSum += v;
      tplSqSum += v * v;
    }
  }
  if (offs.length < 20) return [];
  const tplMean = tplSum / offs.length;
  const tplStats = {
    mean: tplMean,
    var: Math.max(tplSqSum / offs.length - tplMean * tplMean, 1e-6),
  };

  const tpl = buildTemplateBlocks(tplInk, sample.w, sample.h, K);

  // 模板笔画像素清单（用于容差命中率判定）
  const tplPts = [];
  for (let y = 0; y < sample.h; y++) {
    for (let x = 0; x < sample.w; x++) {
      if (tplInk[y * sample.w + x]) tplPts.push({ dx: x, dy: y });
    }
  }

  // 每页的模糊图缓存（精修阶段用）
  const blurCache = new Map();

  const results = [];
  for (let p = 0; p < pages.length; p++) {
    const { ink, gray, width, height } = pages[p];
    const grid = buildBlockGrid(ink, width, height, K);
    const res = blockCosineGrid(grid, tpl);
    const outW = grid.w - tpl.bw + 1;
    if (outW <= 0) continue;

    // 取若干个局部极大候选
    const taken = [];
    for (let k = 0; k < 12; k++) {
      let best = -1, idx = -1;
      for (let i = 0; i < res.length; i++) {
        if (res[i] > best) { best = res[i]; idx = i; }
      }
      // 粗搜阶段的余弦只用来挑候选位置，阈值与最终判定不同量纲，
      // 所以这里用一个固定的低门槛：宁可多取几个候选交给精修，
      // 也不能在粗搜阶段就把真水印剪掉。
      if (best < 0.12 || idx < 0) break;
      const gx = idx % outW, gy = (idx / outW) | 0;
      taken.push({ gx, gy, score: best });
      // 抑制已选区域
      for (let y = Math.max(0, gy - tpl.bh); y <= Math.min(grid.h - tpl.bh, gy + tpl.bh); y++) {
        for (let x = Math.max(0, gx - tpl.bw); x <= Math.min(grid.w - tpl.bw, gx + tpl.bw); x++) {
          res[y * outW + x] = -1;
        }
      }
    }

    if (!taken.length) continue;
    let pBlur = blurCache.get(p);
    if (!pBlur) {
      pBlur = blur3(gray, width, height);
      blurCache.set(p, pBlur);
    }

    for (const t of taken) {
      // 块坐标 → 像素坐标，原分辨率邻域精修。
      // 半径取 2K+2：块网格与模板框原点各可能有 K-1 像素错位，
      // 再加上粗搜本身 ±K 的误差，K+2 不够覆盖，会精修到偏位置。
      const cx = t.gx * K, cy = t.gy * K;
      const refined = refineScore(pBlur, width, height, offs, tplStats, cx, cy, K * 2 + 2);

      // 最终判定用容差命中率（阈值语义即容差命中率）
      let hit = 0, bestHit = -1, bestX = refined.x, bestY = refined.y;
      for (let oy = -3; oy <= 3; oy++) {
        for (let ox = -3; ox <= 3; ox++) {
          const h = tolerantHitRate(ink, width, height, tplPts, refined.x + ox, refined.y + oy, 1);
          if (h > bestHit) { bestHit = h; bestX = refined.x + ox; bestY = refined.y + oy; }
        }
      }
      if (bestHit < threshold) continue;
      results.push({
        pageIndex: p,
        x: bestX,
        y: bestY,
        w: sample.w,
        h: sample.h,
        score: bestHit,
      });
    }
  }
  return results;
}

/**
 * 容差命中率：模板笔画像素中，有多少能在候选位置附近找到墨迹
 *
 * 为什么用「容差」而不是逐像素比对：
 *   同一串水印在不同页上是重新渲染的，落点存在亚像素偏移，
 *   笔画会差 1~2 像素。逐像素比对时，正确位置的交并比只有 0.3，
 *   与正文误匹配完全分不开。
 *
 *   放宽到 ±1 像素后，正确位置的命中率是 0.86~0.91，
 *   而正文误匹配只有 0.54~0.69 —— 分离度足够干净。
 *
 * 判据只问「模板的笔画有没有在那里出现」，
 * 不问「那里有没有多余的笔画」，
 * 所以水印压住正文时也能匹配上。
 */
function tolerantHitRate(ink, width, height, tplPts, cx, cy, radius = 1) {
  const n = tplPts.length;
  if (!n) return 0;
  let hit = 0;
  for (let k = 0; k < n; k++) {
    const p = tplPts[k];
    const bx = cx + p.dx, by = cy + p.dy;
    let found = false;
    for (let oy = -radius; oy <= radius && !found; oy++) {
      const py = by + oy;
      if (py < 0 || py >= height) continue;
      for (let ox = -radius; ox <= radius && !found; ox++) {
        const px = bx + ox;
        if (px < 0 || px >= width) continue;
        if (ink[py * width + px]) found = true;
      }
    }
    if (found) hit++;
  }
  return hit / n;
}

/* ========== 修复：邻域扩散填充 ========== */

/**
 * 邻域扩散修复（diffusion inpainting）
 *
 * 从掩膜外沿逐层向内扩散已知像素值，每轮用四邻域平均更新掩膜内像素。
 * 迭代若干轮后，掩膜区域会与周围平滑衔接。
 * 对纯白背景的文档，效果接近 OpenCV 的 Telea，且完全不需要 OpenCV。
 *
 * 只在掩膜的包围盒内运算：整页遍历 × 24 轮在 10 页文档上要几十秒，
 * 而水印通常只占页面很小一块。
 *
 * @param {Uint8ClampedArray} rgba 目标像素（原地修改）
 * @param {number} width @param {number} height
 * @param {Uint8Array} mask 需修复区域（1 = 待修复）
 */
export function inpaint(rgba, width, height, mask, iterations = 24) {
  // 掩膜包围盒
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return;

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const localMask = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      localMask[y * bw + x] = mask[(y + minY) * width + (x + minX)];
    }
  }

  const known = new Uint8Array(bw * bh);
  const fill = new Float32Array(bw * bh * 3);
  let remaining = 0;
  for (let ly = 0; ly < bh; ly++) {
    for (let lx = 0; lx < bw; lx++) {
      const i = ly * bw + lx;
      if (localMask[i]) { remaining++; continue; }
      known[i] = 1;
      const p = (ly + minY) * width + (lx + minX);
      fill[i * 3] = rgba[p * 4];
      fill[i * 3 + 1] = rgba[p * 4 + 1];
      fill[i * 3 + 2] = rgba[p * 4 + 2];
    }
  }
  if (!remaining) return;

  for (let iter = 0; iter < iterations && remaining > 0; iter++) {
    const nextKnown = [];
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        if (known[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        if (x > 0 && known[i - 1]) { r += fill[(i - 1) * 3]; g += fill[(i - 1) * 3 + 1]; b += fill[(i - 1) * 3 + 2]; n++; }
        if (x < bw - 1 && known[i + 1]) { r += fill[(i + 1) * 3]; g += fill[(i + 1) * 3 + 1]; b += fill[(i + 1) * 3 + 2]; n++; }
        if (y > 0 && known[i - bw]) { r += fill[(i - bw) * 3]; g += fill[(i - bw) * 3 + 1]; b += fill[(i - bw) * 3 + 2]; n++; }
        if (y < bh - 1 && known[i + bw]) { r += fill[(i + bw) * 3]; g += fill[(i + bw) * 3 + 1]; b += fill[(i + bw) * 3 + 2]; n++; }
        if (!n) continue;
        fill[i * 3] = r / n; fill[i * 3 + 1] = g / n; fill[i * 3 + 2] = b / n;
        nextKnown.push(i);
        known[i] = 1;
        remaining--;
      }
    }
    if (!nextKnown.length) break;
    for (const i of nextKnown) {
      const lx = i % bw, ly = (i / bw) | 0;
      const p = (ly + minY) * width + (lx + minX);
      rgba[p * 4] = fill[i * 3];
      rgba[p * 4 + 1] = fill[i * 3 + 1];
      rgba[p * 4 + 2] = fill[i * 3 + 2];
      rgba[p * 4 + 3] = 255;
    }
  }
}

/**
 * 由矩形框生成掩膜（可带少量外扩，覆盖抗锯齿边缘）
 */
export function rectMask(width, height, box, pad = 2) {
  const mask = new Uint8Array(width * height);
  const x0 = Math.max(0, Math.floor(box.x - pad)), y0 = Math.max(0, Math.floor(box.y - pad));
  const x1 = Math.min(width, Math.ceil(box.x + box.w + pad)), y1 = Math.min(height, Math.ceil(box.y + box.h + pad));
  for (let y = y0; y < y1; y++) {
    mask.fill(1, y * width + x0, y * width + x1);
  }
  return mask;
}

/**
 * 在指定矩形内取「墨迹」掩膜（只涂有颜色的部分，不涂整块矩形）
 *
 * 为什么不用整块矩形：水印常常压在正文上，若把整个矩形涂白，
 * 水印周围的正文也会被抹掉。只涂有墨迹的像素 + 外扩，
 * 能把水印擦干净而尽量保留旁边的字。
 *
 * 阈值取「接近白」而不是 Otsu：
 *   Otsu 阈值大约在 160，只能盖住笔画核心，
 *   水印的抗锯齿灰边（灰度 170~230）会漏掉，
 *   擦完留下一道道浅灰残影（实测过，很难看）。
 *   放宽到 235 之后连灰边一起盖住，擦完是干净的空白。
 *
 * @param {Uint8Array} gray 整页灰度
 * @param {number} width @param {number} height
 * @param {{x,y,w,h}} box 矩形（灰度图坐标）
 * @param {number} pad 外扩像素
 * @param {number} [threshold] 判定为墨迹的灰度上限，不传则用 235
 */
export function inkMaskInBox(gray, width, height, box, pad = 2, threshold = 235) {
  const th = threshold;
  // 坐标必须取整：box 来自「标记 × 缩放系数」，几乎总是浮点数。
  // 直接拿浮点做数组下标会全部落空，掩膜变成空集，擦除静默失效。
  const x0 = Math.max(0, Math.floor(box.x - pad));
  const y0 = Math.max(0, Math.floor(box.y - pad));
  const x1 = Math.min(width, Math.ceil(box.x + box.w + pad));
  const y1 = Math.min(height, Math.ceil(box.y + box.h + pad));
  if (x1 <= x0 || y1 <= y0) return new Uint8Array(width * height);

  const w = x1 - x0, h = y1 - y0;
  // 先取矩形内的墨迹
  const local = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (gray[y * width + x] < th) local[(y - y0) * w + (x - x0)] = 1;
    }
  }

  // 膨胀 pad 像素（覆盖抗锯齿边缘）
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!local[y * w + x]) continue;
      for (let dy = -pad; dy <= pad; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -pad; dx <= pad; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          mask[(ny + y0) * width + (nx + x0)] = 1;
        }
      }
    }
  }
  return mask;
}
