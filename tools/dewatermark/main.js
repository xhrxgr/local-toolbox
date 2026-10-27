/**
 * 去水印工具（交互层）
 *
 * 三段式流程：载入 → 找水印 → 清除并导出。
 *
 * 关于这类水印：像「微信公众号:某某资料厂」这种水印，
 * 通常不是 PDF 的文字对象，而是已经烧进页面位图里的黑色文字。
 * 也就是说 pdf-lib 删不掉它，只能在像素层面处理。
 *
 * 因此本工具的做法是：
 *   1. 逐页渲染成位图，取二值墨迹图；
 *   2. 固定位水印（页眉/页脚）用「跨页同位置墨迹共识」自动找出；
 *      变位水印（插在正文行里）由用户框选一处，再按字形追踪到其他页；
 *   3. 用「邻域扩散填充」把墨迹抹掉，按选定 DPI 重新编码为图片页导出。
 *
 * 已知限制（如实告知，不隐藏）：
 *   - 变位水印压住正文的地方，原文已经被水印顶掉，擦除后该处只会留白；
 *   - 变位水印无法全自动识别，必须框选；
 *   - 输出是图片页，文字层不保留。
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { injectToolHeader } from '/assets/js/common.js';
import { showToast } from '/assets/js/toast.js';
import { downloadBlob } from '/assets/js/download.js';
import { armConfirm } from '/assets/js/confirm.js';
import {
  toGray,
  binarize,
  detectFixedWatermark,
  crossPageConsistency,
  trackTemplate,
  inpaint,
  inkMaskInBox,
} from './core.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/* ========== 常量 ========== */

/** 分析分辨率的目标宽度（像素）。够看清水印笔画，又不至于内存爆掉。 */
const ANALYSIS_WIDTH = 1400;

/**
 * 追踪命中阈值
 *
 * 分数是「容差命中率」：模板笔画中有多大比例能在目标位置附近找到墨迹。
 * 实测（样本 10 页）：真水印 0.86~0.91，正文误匹配 0.54~0.69。
 * 所以 0.78 以下直接丢弃，0.85 以上算确认。
 */
const SCORE_CONFIRM = 0.85;
const SCORE_FLOOR = 0.78;

/* ========== 状态 ========== */

const state = {
  pdf: null,          // pdf.js 文档
  fileName: '',
  pages: [],          // { w, h, gray, ink, ptW, ptH }  分析分辨率
  analysisScale: 1,
  globalMarks: [],    // 固定位水印（对所有页生效）
  pageMarks: new Map(),// 变位水印：pageIndex -> [{x,y,w,h,score,low}]
  current: 0,
  picking: false,
  pickStart: null,
  showLow: false,
  marksVisible: true,
  cleanedPages: new Set(), // 已经预览过清除效果的页
  exportDpi: 150,
};

/* ========== DOM ========== */

const $ = (id) => document.getElementById(id);
const el = {
  btnImport: $('btn-import'),
  btnExport: $('btn-export'),
  fileInput: $('file-input'),
  drop: $('dw-drop'),
  dropText: $('dw-drop-text'),
  dropHint: $('dw-drop-hint'),
  fileInfo: $('dw-file-info'),
  btnAuto: $('btn-auto'),
  btnPick: $('btn-pick'),
  chkShowAll: $('chk-show-all'),
  btnRemove: $('btn-remove'),
  removeHint: $('dw-remove-hint'),
  selQuality: $('sel-quality'),
  pageInfo: $('dw-page-info'),
  btnPrev: $('btn-prev'),
  btnNext: $('btn-next'),
  btnToggle: $('btn-toggle'),
  canvasWrap: $('canvas-wrap'),
  stage: $('dw-stage'),
  canvas: $('dw-canvas'),
  marks: $('dw-marks'),
  empty: $('dw-empty'),
  busy: $('dw-busy'),
  busyText: $('dw-busy-text'),
  busyFill: $('dw-busy-fill'),
  marksPanel: $('marks-panel'),
  marksCount: $('marks-count'),
  marksList: $('marks-list'),
  btnClearMarks: $('btn-clear-marks'),
};

/* ========== 忙碌提示 ========== */

/**
 * 显示/隐藏处理中遮罩
 *
 * 不用计数器：载入流程里会多次嵌套 busy(true)，
 * 而 finally 只会配对一次，计数必然失衡，遮罩会永久留在页面上。
 * 这里改成单一状态，重复调用互相覆盖。
 */
let busyState = false;
function busy(on, text = '处理中', percent = null) {
  busyState = !!on;
  el.busy.hidden = !busyState;
  if (busyState && text) el.busyText.textContent = text;
  if (busyState && percent !== null) el.busyFill.style.width = `${percent}%`;
  if (!busyState) el.busyFill.style.width = '0%';
}

/* ========== 载入 ========== */

async function loadFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showToast('请选择 PDF 文件', 'warning');
    return;
  }

  resetState();
  el.dropText.textContent = '正在解析…';
  busy(true, '解析 PDF', 5);

  try {
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    state.pdf = pdf;
    state.fileName = file.name;

    const first = await pdf.getPage(1);
    const pt = first.getViewport({ scale: 1 });
    state.analysisScale = ANALYSIS_WIDTH / pt.width;

    for (let i = 1; i <= pdf.numPages; i++) {
      busy(true, `分析第 ${i}/${pdf.numPages} 页`, 5 + (i / pdf.numPages) * 70);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: state.analysisScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      await page.render({ canvasContext: ctx, viewport }).promise;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const gray = toGray(imageData);
      const { ink } = binarize(gray, canvas.width, canvas.height);
      const ptViewport = page.getViewport({ scale: 1 });
      state.pages.push({
        w: canvas.width,
        h: canvas.height,
        gray,
        ink,
        ptW: ptViewport.width,
        ptH: ptViewport.height,
      });
      // 画布尺寸置 0 归还显存
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }

    el.fileInfo.hidden = false;
    el.fileInfo.textContent = `${file.name} · ${pdf.numPages} 页`;
    el.dropText.textContent = '点击选择 PDF';
    el.dropHint.textContent = '也可拖拽文件到此处';

    el.btnAuto.disabled = false;
    el.btnPick.disabled = false;
    el.btnRemove.disabled = false;
    el.btnExport.disabled = false;
    el.btnPrev.disabled = false;
    el.btnNext.disabled = false;
    el.btnToggle.disabled = false;
    el.empty.hidden = true;

    state.current = 0;
    await showPage(0);
    updateMarkUI();
    showToast(`已载入 ${pdf.numPages} 页`, 'success');
  } catch (err) {
    console.error(err);
    showToast('解析失败：' + (err && err.message ? err.message : '未知错误'), 'error');
    el.dropText.textContent = '点击选择 PDF';
  } finally {
    busy(false);
  }
}

function resetState() {
  state.pdf = null;
  state.fileName = '';
  state.pages = [];
  state.globalMarks = [];
  state.pageMarks = new Map();
  state.current = 0;
  state.picking = false;
  state.cleanedPages = new Set();
  el.fileInfo.hidden = true;
  el.empty.hidden = false;
  el.stage.hidden = true;
  el.marksPanel.hidden = true;
}

/* ========== 预览 ========== */

async function showPage(index) {
  if (!state.pdf || !state.pages.length) return;
  const n = state.pages.length;
  state.current = Math.max(0, Math.min(n - 1, index));

  const page = state.pages[state.current];
  const canvas = el.canvas;
  canvas.width = page.w;
  canvas.height = page.h;

  const pdfPage = await state.pdf.getPage(state.current + 1);
  const viewport = pdfPage.getViewport({ scale: state.analysisScale });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;

  // 已清除过的页：用清除后的结果覆盖显示
  if (state.cleanedPages.has(state.current)) {
    const cleaned = await renderCleanedPage(state.current, state.analysisScale);
    if (cleaned) ctx.putImageData(cleaned, 0, 0);
  }

  el.stage.hidden = false;
  el.marks.hidden = false;
  el.marks.setAttribute('viewBox', `0 0 ${page.w} ${page.h}`);
  el.pageInfo.textContent = `第 ${state.current + 1} / ${n} 页`;
  el.btnPrev.disabled = state.current === 0;
  el.btnNext.disabled = state.current === n - 1;
  drawMarks();
}

/** 当前页所有生效的标记 */
function currentMarks() {
  const list = state.globalMarks.map((m) => ({ ...m, global: true }));
  const per = state.pageMarks.get(state.current) || [];
  for (const m of per) list.push({ ...m, global: false });
  return list;
}

function drawMarks() {
  const page = state.pages[state.current];
  if (!page || !state.marksVisible) {
    el.marks.innerHTML = '';
    return;
  }
  const parts = [];
  for (const m of currentMarks()) {
    if (m.low && !state.showLow) continue;
    const cls = m.global ? 'dw-marks__box dw-marks__box--auto' : 'dw-marks__box';
    const dash = m.low ? ' stroke-dasharray="6 4"' : '';
    parts.push(
      `<rect class="${cls}" x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}"${dash} />`
    );
  }
  el.marks.innerHTML = parts.join('');
}

/* ========== 自动识别固定位水印 ========== */

async function autoDetect() {
  if (!state.pages.length) return;
  busy(true, '逐页比对墨迹位置', 10);
  try {
    // 只取尺寸一致的页参与共识（尺寸不同的页坐标不可比）
    const groups = new Map();
    state.pages.forEach((p, i) => {
      const key = `${p.w}x${p.h}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    });
    let best = [];
    for (const idxs of groups.values()) {
      if (idxs.length < 2) continue;
      const inks = idxs.map(i => state.pages[i].ink);
      const w = state.pages[idxs[0]].w, h = state.pages[idxs[0]].h;
      const strips = detectFixedWatermark(inks, w, h);
      // 只保留「每页图案一致」的条带。
      // 页码「第 1 页 共 10 页」每页都在同一位置，会被共识检测当成水印，
      // 但它每个字都不同，图案一致性只有 0.1 左右；真水印是同一张位图，
      // 一致性在 0.9 以上。
      const kept = [];
      for (const s of strips) {
        const box = { x: s.x0, y: s.y0, w: s.x1 - s.x0, h: s.y1 - s.y0 };
        const c = crossPageConsistency(inks, w, h, box);
        if (c < 0.55) continue;
        kept.push({ ...box, consistency: c });
      }
      if (kept.length > best.length) best = kept;
    }

    if (!best.length) {
      showToast('未发现固定位水印，可改用「框选水印并追踪」', 'warning');
      return;
    }
    state.globalMarks = best;
    state.cleanedPages.clear();
    updateMarkUI();
    drawMarks();
    showToast(`识别到 ${best.length} 处固定位水印`, 'success');
  } finally {
    busy(false);
  }
}

/* ========== 框选水印并追踪 ========== */

function startPick() {
  if (!state.pages.length) return;
  state.picking = !state.picking;
  state.pickStart = null;
  el.canvas.dataset.picking = state.picking ? '1' : '0';
  el.btnPick.textContent = state.picking ? '取消框选' : '框选水印并追踪到其他页';
  if (state.picking) {
    showToast('在预览图上拖动框选一处水印', 'info');
  }
}

/** 画布 CSS 尺寸 → 分析分辨率坐标 */
function canvasToAnalysis(e) {
  const rect = el.canvas.getBoundingClientRect();
  const page = state.pages[state.current];
  const sx = page.w / rect.width;
  const sy = page.h / rect.height;
  return {
    x: (e.clientX - rect.left) * sx,
    y: (e.clientY - rect.top) * sy,
  };
}

function onPickDown(e) {
  if (!state.picking) return;
  e.preventDefault();
  state.pickStart = canvasToAnalysis(e);
  el.canvas.dataset.picking = 'dragging';
}

function onPickMove(e) {
  if (!state.picking || !state.pickStart) return;
  const p = canvasToAnalysis(e);
  const x = Math.min(p.x, state.pickStart.x);
  const y = Math.min(p.y, state.pickStart.y);
  const w = Math.abs(p.x - state.pickStart.x);
  const h = Math.abs(p.y - state.pickStart.y);
  const page = state.pages[state.current];
  el.marks.innerHTML =
    `<rect class="dw-marks__box dw-marks__box--picking" x="${x}" y="${y}" width="${w}" height="${h}" />`;
  void page;
}

/**
 * 把框选区域收紧到墨迹的外接矩形
 *
 * 用户手拖很难正好贴着水印，往往会多框进两侧的正文。
 * 多框进来的正文会跟着进模板，于是「模板长什么样」就掺了正文的样子，
 * 追踪时更容易匹到普通正文。收紧到墨迹外接框能显著提高命中率。
 */
function tightenToInk(box, page) {
  const { ink, w, h } = page;
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(w, Math.ceil(box.x + box.w));
  const y1 = Math.min(h, Math.ceil(box.y + box.h));
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!ink[y * w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return box;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function onPickUp(e) {
  if (!state.picking || !state.pickStart) return;
  const p = canvasToAnalysis(e);
  const x = Math.min(p.x, state.pickStart.x);
  const y = Math.min(p.y, state.pickStart.y);
  const w = Math.round(Math.abs(p.x - state.pickStart.x));
  const h = Math.round(Math.abs(p.y - state.pickStart.y));
  state.pickStart = null;
  el.canvas.dataset.picking = state.picking ? '1' : '0';

  if (w < 8 || h < 8) {
    showToast('框选区域太小', 'warning');
    drawMarks();
    return;
  }

  busy(true, '在其他页面查找同类水印', 20);
  try {
    // 收紧到墨迹外接框，避免把水印旁边的正文也当成模板
    const box = tightenToInk({ x, y, w, h }, state.pages[state.current]);
    // 模板追踪需要灰度图（精修阶段按暗度匹配）与二值图（粗搜阶段按墨量匹配）
    const pages = state.pages.map(p => ({
      ink: p.ink, gray: p.gray, width: p.w, height: p.h,
    }));
    const hits = trackTemplate(pages, box, state.current, SCORE_FLOOR);
    if (!hits.length) {
      showToast('没有在其他页面找到同类水印', 'warning');
      drawMarks();
      return;
    }
    let added = 0;
    for (const hit of hits) {
      const list = state.pageMarks.get(hit.pageIndex) || [];
      // 同页同位置不重复添加
      if (list.some(m => Math.abs(m.x - hit.x) < 12 && Math.abs(m.y - hit.y) < 12)) continue;
      list.push({
        x: hit.x, y: hit.y, w: hit.w, h: hit.h,
        score: hit.score,
        low: hit.score < SCORE_CONFIRM,
      });
      state.pageMarks.set(hit.pageIndex, list);
      added++;
    }
    state.cleanedPages.clear();
    updateMarkUI();
    drawMarks();
    const lowCount = [...state.pageMarks.values()].flat().filter(m => m.low).length;
    showToast(
      lowCount
        ? `找到 ${added} 处，其中 ${lowCount} 处置信度较低，已归入「待确认」`
        : `找到 ${added} 处水印`,
      lowCount ? 'warning' : 'success'
    );
  } finally {
    busy(false);
  }
}

/* ========== 清除 ========== */

/**
 * 渲染某页并按标记做像素级修复
 * @param {number} pageIndex
 * @param {number} targetWidth 目标像素宽度（null = 用分析分辨率）
 */
async function renderCleanedPage(pageIndex, targetWidth = null) {
  const page = state.pages[pageIndex];
  if (!page) return null;
  const width = Math.max(1, Math.round(targetWidth ?? page.w));
  const scale = width / page.ptW;

  const pdfPage = await state.pdf.getPage(pageIndex + 1);
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = toGray(imageData);

  // 该页生效的标记，坐标换算到本次渲染分辨率
  const factor = width / page.w;
  const boxes = [];
  for (const m of state.globalMarks) {
    boxes.push({ x: m.x * factor, y: m.y * factor, w: m.w * factor, h: m.h * factor });
  }
  for (const m of (state.pageMarks.get(pageIndex) || [])) {
    if (m.low && !state.showLow) continue;
    boxes.push({ x: m.x * factor, y: m.y * factor, w: m.w * factor, h: m.h * factor });
  }
  if (!boxes.length) {
    canvas.width = 0; canvas.height = 0;
    pdfPage.cleanup();
    return imageData;
  }

  // 只涂有墨迹的像素，不涂整块矩形 —— 保住水印旁边的正文。
  // 阈值用 235（含抗锯齿灰边），否则擦完会留一道道浅灰残影。
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (const box of boxes) {
    const sub = inkMaskInBox(gray, canvas.width, canvas.height, box, 2);
    for (let i = 0; i < mask.length; i++) if (sub[i]) mask[i] = 1;
  }
  inpaint(imageData.data, canvas.width, canvas.height, mask);

  canvas.width = 0; canvas.height = 0;
  pdfPage.cleanup();
  return imageData;
}

async function removeWatermark() {
  if (!state.pages.length) return;
  const total = currentMarks().length + state.globalMarks.length;
  if (!total) {
    showToast('尚未标记任何水印区域', 'warning');
    return;
  }
  busy(true, '擦除水印像素', 30);
  try {
    const cleaned = await renderCleanedPage(state.current, null);
    if (!cleaned) return;
    const ctx = el.canvas.getContext('2d', { willReadFrequently: true });
    ctx.putImageData(cleaned, 0, 0);
    state.cleanedPages.add(state.current);
    showToast('本页水印已擦除，可翻页检查后再导出', 'success');
  } finally {
    busy(false);
  }
}

/* ========== 导出 ========== */

async function exportPdf() {
  if (!state.pdf) return;
  const quality = el.selQuality.value;
  const dpi = parseInt(el.selQuality.dataset.dpi, 10) || 150;
  state.exportDpi = dpi;

  busy(true, '准备导出', 5);
  try {
    const out = await PDFDocument.create();
    for (let i = 0; i < state.pages.length; i++) {
      busy(true, `处理第 ${i + 1}/${state.pages.length} 页`, 5 + (i / state.pages.length) * 85);
      const pt = state.pages[i];
      // 高画质：按分析分辨率输出（无损 PNG），其余按指定 DPI
      const targetWidth = quality === 'high'
        ? pt.w
        : Math.round(pt.ptW * (dpi / 72));
      const cleaned = await renderCleanedPage(i, targetWidth);
      if (!cleaned) continue;

      const canvas = document.createElement('canvas');
      canvas.width = cleaned.width;
      canvas.height = cleaned.height;
      canvas.getContext('2d').putImageData(cleaned, 0, 0);

      let img;
      if (quality === 'high') {
        // 无损 PNG：扫描件以白色为主，PNG 体积反而比 JPEG 小，
        // 且不会因二次压缩让小字发虚
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        img = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
      } else {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      }
      canvas.width = 0; canvas.height = 0;

      const page = out.addPage([pt.ptW, pt.ptH]);
      page.drawImage(img, { x: 0, y: 0, width: pt.ptW, height: pt.ptH });
    }

    busy(true, '生成 PDF', 95);
    const bytes = await out.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const base = state.fileName.replace(/\.pdf$/i, '');
    downloadBlob(blob, `${base}_去水印.pdf`);
    showToast('已导出 PDF', 'success');
  } catch (err) {
    console.error(err);
    showToast('导出失败：' + (err && err.message ? err.message : '未知错误'), 'error');
  } finally {
    busy(false);
  }
}

/* ========== 标记列表 ========== */

function updateMarkUI() {
  const per = [...state.pageMarks.values()].flat();
  const globalCount = state.globalMarks.length;
  const total = globalCount + per.length;
  el.marksPanel.hidden = total === 0;
  el.marksCount.textContent = total === 0 ? '0 处标记'
    : `${total} 处标记（固定位 ${globalCount} · 变位 ${per.length}）`;

  el.removeHint.textContent = total
    ? (per.some(m => m.low) && !state.showLow
        ? `已标记 ${total} 处，其中部分置信度较低，未勾选「显示全部候选」时不会擦除`
        : `已标记 ${total} 处，点击擦除当前页的标记区域`)
    : '尚未标记任何水印区域。';

  el.marksList.innerHTML = '';
  state.globalMarks.forEach((m, i) => {
    el.marksList.appendChild(makeMarkChip({
      label: '全部页',
      detail: '固定位',
      score: m.consistency,
      onRemove: () => {
        state.globalMarks.splice(i, 1);
        state.cleanedPages.clear();
        updateMarkUI();
        drawMarks();
      },
    }));
  });
  for (const [pageIndex, list] of state.pageMarks) {
    list.forEach((m, i) => {
      el.marksList.appendChild(makeMarkChip({
        label: `第 ${pageIndex + 1} 页`,
        detail: m.low ? '待确认' : '变位',
        score: m.score,
        onRemove: () => {
          const arr = state.pageMarks.get(pageIndex);
          arr.splice(i, 1);
          if (!arr.length) state.pageMarks.delete(pageIndex);
          state.cleanedPages.clear();
          updateMarkUI();
          drawMarks();
        },
      }));
    });
  }
}

function makeMarkChip({ label, detail, score, onRemove }) {
  const chip = document.createElement('span');
  chip.className = 'dw-mark';
  const page = document.createElement('span');
  page.className = 'dw-mark__page';
  page.textContent = label;
  chip.appendChild(page);

  const kind = document.createElement('span');
  kind.textContent = detail;
  chip.appendChild(kind);

  if (score !== null && score !== undefined) {
    const s = document.createElement('span');
    s.className = 'dw-mark__score';
    s.textContent = score.toFixed(2);
    chip.appendChild(s);
  }

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'dw-mark__del';
  del.textContent = '移除';
  del.setAttribute('aria-label', '移除此标记');
  chip.appendChild(del);

  // armConfirm 需要按钮已有父节点才能插入「取消」按钮，
  // 所以必须先挂到 chip 上，再挂二次确认
  armConfirm(del, '确认移除？', onRemove);

  return chip;
}

/* ========== 事件绑定 ========== */

el.btnImport.addEventListener('click', () => el.fileInput.click());
el.drop.addEventListener('click', () => el.fileInput.click());
el.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
});
el.fileInput.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) loadFile(f);
  e.target.value = '';
});

['dragenter', 'dragover'].forEach(type => {
  el.drop.addEventListener(type, (e) => {
    e.preventDefault();
    el.drop.style.borderColor = 'var(--accent)';
  });
});
['dragleave', 'drop'].forEach(type => {
  el.drop.addEventListener(type, (e) => {
    e.preventDefault();
    el.drop.style.borderColor = '';
  });
});
el.drop.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});
el.canvasWrap.addEventListener('dragover', (e) => e.preventDefault());
el.canvasWrap.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

el.btnAuto.addEventListener('click', autoDetect);
el.btnPick.addEventListener('click', startPick);
el.btnRemove.addEventListener('click', removeWatermark);
el.btnExport.addEventListener('click', exportPdf);
el.btnPrev.addEventListener('click', () => showPage(state.current - 1));
el.btnNext.addEventListener('click', () => showPage(state.current + 1));
el.btnToggle.addEventListener('click', () => {
  state.marksVisible = !state.marksVisible;
  el.btnToggle.textContent = state.marksVisible ? '隐藏标记' : '显示标记';
  drawMarks();
});
el.chkShowAll.addEventListener('change', (e) => {
  state.showLow = e.target.checked;
  drawMarks();
  updateMarkUI();
});
el.btnClearMarks.addEventListener('click', () => {
  armConfirm(el.btnClearMarks, '确认清空？', () => {
    state.globalMarks = [];
    state.pageMarks = new Map();
    state.cleanedPages.clear();
    updateMarkUI();
    drawMarks();
  });
});

el.canvas.addEventListener('mousedown', onPickDown);
el.canvas.addEventListener('mousemove', onPickMove);
window.addEventListener('mouseup', onPickUp);

el.selQuality.addEventListener('change', (e) => {
  state.exportDpi = parseInt(e.target.value, 10) || 150;
});

/* ========== 初始化 ========== */

// 跳转文档转换工具（格式转换类需求）
const linkDocument = document.getElementById('link-document');
if (linkDocument) {
  linkDocument.addEventListener('click', (e) => {
    e.preventDefault();
    const base = (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/') || '/';
    location.href = base.replace(/\/$/, '') + '/tools/document/';
  });
}

injectToolHeader('去水印');
updateMarkUI();

if (import.meta.env && import.meta.env.DEV) {
  window.__dw = { state, renderCleanedPage, toGray, binarize, inkMaskInBox, inpaint };
}
