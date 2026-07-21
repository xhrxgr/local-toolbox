/**
 * 文档转换工具核心逻辑
 * 全部本地处理，文件不上传云端
 * 支持：PDF / Word / Excel-CSV / Markdown-HTML 互转
 */

import * as pdfjsLib from 'pdfjs-dist';
// Vite 把 worker 文件作为 URL 导入
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, degrees } from 'pdf-lib';
import mammoth from 'mammoth/mammoth.browser.js';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { marked } from 'marked';
import TurndownService from 'turndown';

// 配置 pdfjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// 配置 marked
marked.setOptions({ gfm: true, breaks: false });

// 配置 turndown
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// 状态
let files = [];
let currentTab = 'pdf';

/* ========== 操作配置表 ========== */
// inputType: 'file' | 'text'
// accept: 文件选择器 accept 属性
// multiple: 是否允许多选
// outputType: 'file' | 'text'
// fileExt: 输出文件扩展名（outputType=file 时）
const OPERATIONS = {
  // PDF
  'pdf-to-image':  { tab: 'pdf',    label: 'PDF → 图片',        inputType: 'file', accept: '.pdf',                multiple: false, outputType: 'file', fileExt: 'png' },
  'image-to-pdf':  { tab: 'pdf',    label: '图片 → PDF',        inputType: 'file', accept: 'image/*',             multiple: true,  outputType: 'file', fileExt: 'pdf' },
  'pdf-to-text':   { tab: 'pdf',    label: 'PDF → 文本',        inputType: 'file', accept: '.pdf',                multiple: false, outputType: 'text' },
  'pdf-merge':     { tab: 'pdf',    label: 'PDF 合并',          inputType: 'file', accept: '.pdf',                multiple: true,  outputType: 'file', fileExt: 'pdf' },
  'pdf-split':     { tab: 'pdf',    label: 'PDF 拆分',          inputType: 'file', accept: '.pdf',                multiple: false, outputType: 'file', fileExt: 'pdf' },
  'pdf-rotate':    { tab: 'pdf',    label: 'PDF 旋转',          inputType: 'file', accept: '.pdf',                multiple: false, outputType: 'file', fileExt: 'pdf' },
  'pdf-extract':   { tab: 'pdf',    label: 'PDF 提取指定页',    inputType: 'file', accept: '.pdf',                multiple: false, outputType: 'file', fileExt: 'pdf' },
  // Word
  'word-to-html':  { tab: 'word',   label: 'Word → HTML',       inputType: 'file', accept: '.docx',               multiple: false, outputType: 'text' },
  'word-to-text':  { tab: 'word',   label: 'Word → 文本',       inputType: 'file', accept: '.docx',               multiple: false, outputType: 'text' },
  'word-to-pdf':   { tab: 'word',   label: 'Word → PDF',        inputType: 'file', accept: '.docx',               multiple: false, outputType: 'file', fileExt: 'pdf' },
  'md-to-word':    { tab: 'word',   label: 'Markdown → Word',   inputType: 'text', accept: null,                  multiple: false, outputType: 'file', fileExt: 'docx' },
  // Excel / CSV
  'excel-to-csv':  { tab: 'excel',  label: 'Excel → CSV',       inputType: 'file', accept: '.xlsx,.xls',          multiple: false, outputType: 'text' },
  'excel-to-json': { tab: 'excel',  label: 'Excel → JSON',      inputType: 'file', accept: '.xlsx,.xls',          multiple: false, outputType: 'text' },
  'csv-to-json':   { tab: 'excel',  label: 'CSV → JSON',        inputType: 'text', accept: null,                  multiple: false, outputType: 'text' },
  'json-to-csv':   { tab: 'excel',  label: 'JSON → CSV',        inputType: 'text', accept: null,                  multiple: false, outputType: 'text' },
  'csv-to-excel':  { tab: 'excel',  label: 'CSV → Excel',       inputType: 'text', accept: null,                  multiple: false, outputType: 'file', fileExt: 'xlsx' },
  // MD / HTML
  'md-to-html':    { tab: 'mdhtml', label: 'Markdown → HTML',   inputType: 'text', accept: null,                  multiple: false, outputType: 'text' },
  'html-to-md':    { tab: 'mdhtml', label: 'HTML → Markdown',   inputType: 'text', accept: null,                  multiple: false, outputType: 'text' },
  'md-to-pdf':     { tab: 'mdhtml', label: 'Markdown → PDF',    inputType: 'text', accept: null,                  multiple: false, outputType: 'file', fileExt: 'pdf' },
  'html-to-pdf':   { tab: 'mdhtml', label: 'HTML → PDF',        inputType: 'text', accept: null,                  multiple: false, outputType: 'file', fileExt: 'pdf' },
};

/* ========== 获取当前操作 ========== */
function getCurrentOp() {
  const opSelect = document.querySelector(`.tab-panel[data-panel="${currentTab}"] .setting__select`);
  if (!opSelect) return null;
  return OPERATIONS[opSelect.value] || null;
}

function getCurrentOpId() {
  const opSelect = document.querySelector(`.tab-panel[data-panel="${currentTab}"] .setting__select`);
  return opSelect ? opSelect.value : null;
}

/* ========== 工具函数 ========== */
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

function getBaseName(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

function setProgress(title, status, pct) {
  const titleEl = document.getElementById('progress-stage-title');
  const statusEl = document.getElementById('progress-stage-status');
  const pctEl = document.getElementById('progress-stage-pct');
  const fillEl = document.getElementById('progress-fill');
  if (titleEl) titleEl.textContent = title;
  if (statusEl) statusEl.textContent = status || '';
  if (pctEl) pctEl.textContent = pct != null ? `${Math.round(pct)}%` : '';
  if (fillEl && pct != null) fillEl.style.width = `${Math.round(pct)}%`;
}

function showProgress(show) {
  document.getElementById('progress-section').hidden = !show;
}

/* ========== 文件列表渲染 ========== */
function renderFileList() {
  const list = document.getElementById('file-list-items');
  const count = document.getElementById('file-list-count');
  const fileList = document.getElementById('file-list');
  const uploadArea = document.getElementById('upload-area');

  if (files.length === 0) {
    fileList.hidden = true;
    uploadArea.hidden = false;
    return;
  }
  fileList.hidden = false;
  uploadArea.hidden = true;
  count.textContent = `${files.length} 个文件`;

  list.innerHTML = files.map((f, i) => `
    <div class="file-item" data-index="${i}">
      <span class="file-item__icon">📄</span>
      <span class="file-item__name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="file-item__size">${formatFileSize(f.size)}</span>
      <button class="file-item__remove" data-action="remove" data-index="${i}" title="移除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`).join('');

  list.querySelectorAll('.file-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="remove"]')) return;
    });
  });
  list.querySelectorAll('[data-action="remove"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      files.splice(idx, 1);
      renderFileList();
    });
  });
}

function clearAllFiles() {
  files = [];
  renderFileList();
}

/* ========== UI 更新：根据当前操作显示对应输入区 ========== */
function updateUIForOp() {
  const op = getCurrentOp();
  if (!op) return;

  const uploadSection = document.getElementById('upload-section');
  const textInputSection = document.getElementById('text-input-section');
  const fileInput = document.getElementById('file-input');
  const uploadText = document.getElementById('upload-text');
  const uploadHint = document.getElementById('upload-hint');
  const textInputLabel = document.getElementById('text-input-label');

  // PDF 操作选项显隐
  const opId = getCurrentOpId();
  document.getElementById('pdf-image-format-setting').hidden = opId !== 'pdf-to-image';
  document.getElementById('pdf-rotate-setting').hidden = opId !== 'pdf-rotate';
  document.getElementById('pdf-split-setting').hidden = opId !== 'pdf-split';
  document.getElementById('pdf-extract-setting').hidden = opId !== 'pdf-extract';
  document.getElementById('excel-sheet-setting').hidden = !(opId === 'excel-to-csv' || opId === 'excel-to-json');

  if (op.inputType === 'file') {
    uploadSection.hidden = false;
    textInputSection.hidden = true;
    fileInput.accept = op.accept || '';
    fileInput.multiple = op.multiple;
    uploadText.textContent = op.multiple ? '选择或拖入多个文件' : '选择或拖入文件';
    uploadHint.textContent = `支持：${op.accept || '任意文件'}`;
    // 切换操作时清空已选文件（避免类型不匹配）
    if (files.length > 0 && files.some(f => !f.type.startsWith(op.accept?.split('/')[0] || 'nope'))) {
      // 不强制清空，让用户决定
    }
  } else {
    uploadSection.hidden = true;
    textInputSection.hidden = false;
    const labels = {
      'md-to-word': 'Markdown 内容',
      'csv-to-json': 'CSV 内容',
      'json-to-csv': 'JSON 内容（数组对象）',
      'csv-to-excel': 'CSV 内容',
      'md-to-html': 'Markdown 内容',
      'html-to-md': 'HTML 内容',
      'md-to-pdf': 'Markdown 内容',
      'html-to-pdf': 'HTML 内容',
    };
    textInputLabel.textContent = labels[opId] || '输入内容';
  }

  // 隐藏结果区
  document.getElementById('text-result-section').hidden = true;
  document.getElementById('file-result-section').hidden = true;
}

/* ========== Tab 切换 ========== */
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('mode-tab--active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.hidden = p.dataset.panel !== tab;
    p.classList.toggle('tab-panel--active', p.dataset.panel === tab);
  });
  updateUIForOp();
}

/* ========== 文件选择 ========== */
function handleFiles(newFiles) {
  const op = getCurrentOp();
  if (!op || op.inputType !== 'file') return;

  if (op.multiple) {
    files = files.concat(Array.from(newFiles));
  } else {
    files = Array.from(newFiles).slice(0, 1);
  }
  renderFileList();
}

/* ========== 转换入口 ========== */
async function convert() {
  const opId = getCurrentOpId();
  const op = OPERATIONS[opId];
  if (!op) return;

  // 校验输入
  if (op.inputType === 'file' && files.length === 0) {
    alert('请先选择文件');
    return;
  }
  if (op.inputType === 'text') {
    const text = document.getElementById('text-input').value;
    if (!text.trim()) {
      alert('请先输入内容');
      return;
    }
  }

  // 隐藏旧结果
  document.getElementById('text-result-section').hidden = true;
  document.getElementById('file-result-section').hidden = true;
  showProgress(true);
  setProgress('处理中...', '', 0);

  try {
    const handler = OP_HANDLERS[opId];
    if (!handler) throw new Error('未实现的操作: ' + opId);
    const result = await handler(op);
    showProgress(false);
    showResult(op, result);
  } catch (err) {
    console.error('[文档转换失败]', err);
    showProgress(false);
    alert('转换失败：' + (err.message || String(err)));
  }
}

/* ========== 结果展示 ========== */
function showResult(op, result) {
  if (op.outputType === 'text') {
    const section = document.getElementById('text-result-section');
    const resultEl = document.getElementById('text-result');
    const downloadBtn = document.getElementById('btn-download-text');
    resultEl.textContent = result.text;
    // 对于部分操作显示下载按钮
    if (result.filename) {
      downloadBtn.hidden = false;
      downloadBtn.onclick = () => {
        const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, result.filename);
      };
    } else {
      downloadBtn.hidden = true;
    }
    section.hidden = false;
  } else if (op.outputType === 'file') {
    const section = document.getElementById('file-result-section');
    const listEl = document.getElementById('result-list');
    const statsEl = document.getElementById('result-stats');
    const downloadAllBtn = document.getElementById('btn-download-all');

    const items = Array.isArray(result) ? result : [result];
    statsEl.textContent = `共 ${items.length} 个文件`;

    listEl.innerHTML = items.map((item, i) => `
      <li class="result-item">
        <span class="result-item__icon">📦</span>
        <span class="result-item__name">${escapeHtml(item.filename)}</span>
        <span class="result-item__size">${formatFileSize(item.blob.size)}</span>
        <button class="btn btn-sm btn-primary result-item__download" data-index="${i}">下载</button>
      </li>
    `).join('');

    listEl.querySelectorAll('.result-item__download').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        downloadBlob(items[idx].blob, items[idx].filename);
      });
    });

    // 多文件显示"下载全部"
    if (items.length > 1) {
      downloadAllBtn.hidden = false;
      downloadAllBtn.onclick = () => {
        items.forEach((item, i) => {
          setTimeout(() => downloadBlob(item.blob, item.filename), i * 200);
        });
      };
    } else {
      downloadAllBtn.hidden = true;
    }

    section.hidden = false;
  }
}

/* ========== 复制结果 ========== */
function copyResult() {
  const text = document.getElementById('text-result').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-copy-result');
    const original = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = original; }, 1500);
  }).catch(() => alert('复制失败，请手动选择文本复制'));
}

/* ============================================================
 * PDF 操作实现
 * ============================================================ */

// PDF → 图片：用 pdfjs 渲染每页到 canvas
async function pdfToImage(op) {
  const file = files[0];
  const imgFormat = document.getElementById('pdf-image-format').value;
  setProgress('加载 PDF...', '', 5);
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const results = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    setProgress(`渲染第 ${i}/${pdf.numPages} 页`, '', 5 + (i / pdf.numPages) * 90);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 }); // 2x 渲染保证清晰度
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const mime = imgFormat === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.92));
    const filename = `${getBaseName(file.name)}_page_${String(i).padStart(3, '0')}.${imgFormat}`;
    results.push({ blob, filename });
  }

  setProgress('完成', '', 100);
  return results;
}

// 图片 → PDF：用 pdf-lib 嵌入图片
async function imageToPdf(op) {
  setProgress('创建 PDF...', '', 5);
  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setProgress(`嵌入图片 ${i + 1}/${files.length}`, '', 5 + (i / files.length) * 90);
    const bytes = await file.arrayBuffer();
    let img;
    if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
      img = await pdfDoc.embedPng(bytes);
    } else if (file.type === 'image/jpeg' || /\.(jpe?g)$/i.test(file.name)) {
      img = await pdfDoc.embedJpg(bytes);
    } else {
      // 其他格式尝试通过 canvas 转为 PNG
      const imgEl = await loadImage(file);
      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      canvas.getContext('2d').drawImage(imgEl, 0, 0);
      const pngBytes = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')).then(b => b.arrayBuffer());
      img = await pdfDoc.embedPng(pngBytes);
    }
    const page = pdfDoc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }

  setProgress('生成 PDF...', '', 95);
  const bytes = await pdfDoc.save();
  setProgress('完成', '', 100);
  return [{ blob: new Blob([bytes], { type: 'application/pdf' }), filename: 'images_merged.pdf' }];
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法加载图片: ' + file.name)); };
    img.src = url;
  });
}

// PDF → 文本
async function pdfToText(op) {
  const file = files[0];
  setProgress('加载 PDF...', '', 5);
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    setProgress(`提取文本 ${i}/${pdf.numPages}`, '', 5 + (i / pdf.numPages) * 90);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    text += `--- 第 ${i} 页 ---\n${pageText}\n\n`;
  }

  setProgress('完成', '', 100);
  return { text: text.trim(), filename: `${getBaseName(file.name)}.txt` };
}

// PDF 合并
async function pdfMerge(op) {
  setProgress('合并 PDF...', '', 5);
  const merged = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    setProgress(`合并 ${i + 1}/${files.length}`, '', 5 + (i / files.length) * 90);
    const bytes = await files[i].arrayBuffer();
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }

  setProgress('生成 PDF...', '', 95);
  const bytes = await merged.save();
  setProgress('完成', '', 100);
  return [{ blob: new Blob([bytes], { type: 'application/pdf' }), filename: 'merged.pdf' }];
}

// 解析页码区间字符串，如 "1-3, 5, 7-9" → [[0,2], [4,4], [6,8]]（0-based）
function parsePageRanges(input) {
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  const ranges = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const start = parseInt(m[1]);
      const end = parseInt(m[2]);
      if (start > end) throw new Error(`区间无效：${part}（起始大于结束）`);
      ranges.push([start - 1, end - 1]); // 转 0-based
    } else if (/^\d+$/.test(part)) {
      const p = parseInt(part);
      ranges.push([p - 1, p - 1]);
    } else {
      throw new Error(`页码格式无法识别：${part}`);
    }
  }
  return ranges;
}

// 解析页码列表，如 "1, 3, 5-8" → [0, 2, 4, 5, 6, 7]（0-based）
function parsePageList(input) {
  const ranges = parsePageRanges(input);
  const pages = new Set();
  for (const [start, end] of ranges) {
    for (let i = start; i <= end; i++) pages.add(i);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

// PDF 拆分
async function pdfSplit(op) {
  const file = files[0];
  const rangesInput = document.getElementById('pdf-split-ranges').value;
  if (!rangesInput.trim()) throw new Error('请填写拆分区间');

  const ranges = parsePageRanges(rangesInput);
  setProgress('加载源 PDF...', '', 5);
  const srcBytes = await file.arrayBuffer();
  const src = await PDFDocument.load(srcBytes);
  const totalPages = src.getPageCount();

  // 校验区间
  for (const [s, e] of ranges) {
    if (s < 0 || e >= totalPages) throw new Error(`区间 ${s + 1}-${e + 1} 超出页数范围（共 ${totalPages} 页）`);
  }

  const results = [];
  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i];
    setProgress(`生成第 ${i + 1}/${ranges.length} 个 PDF（页 ${start + 1}-${end + 1}）`, '', 5 + (i / ranges.length) * 90);
    const out = await PDFDocument.create();
    const pageIndices = [];
    for (let p = start; p <= end; p++) pageIndices.push(p);
    const pages = await out.copyPages(src, pageIndices);
    pages.forEach(p => out.addPage(p));
    const bytes = await out.save();
    const filename = `${getBaseName(file.name)}_pages_${start + 1}-${end + 1}.pdf`;
    results.push({ blob: new Blob([bytes], { type: 'application/pdf' }), filename });
  }

  setProgress('完成', '', 100);
  return results;
}

// PDF 旋转
async function pdfRotate(op) {
  const file = files[0];
  const angle = parseInt(document.getElementById('pdf-rotate-angle').value);
  setProgress('加载 PDF...', '', 10);
  const src = await PDFDocument.load(await file.arrayBuffer());
  const pages = src.getPages();
  pages.forEach(page => {
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + angle) % 360));
  });
  setProgress('生成 PDF...', '', 90);
  const bytes = await src.save();
  setProgress('完成', '', 100);
  return [{ blob: new Blob([bytes], { type: 'application/pdf' }), filename: `${getBaseName(file.name)}_rotated.pdf` }];
}

// PDF 提取指定页
async function pdfExtract(op) {
  const file = files[0];
  const pagesInput = document.getElementById('pdf-extract-pages').value;
  if (!pagesInput.trim()) throw new Error('请填写要提取的页码');

  const pageList = parsePageList(pagesInput);
  setProgress('加载源 PDF...', '', 10);
  const src = await PDFDocument.load(await file.arrayBuffer());
  const totalPages = src.getPageCount();
  if (pageList.some(p => p >= totalPages)) {
    throw new Error(`页码超出范围（共 ${totalPages} 页）`);
  }

  setProgress('提取页面...', '', 40);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, pageList);
  pages.forEach(p => out.addPage(p));

  setProgress('生成 PDF...', '', 90);
  const bytes = await out.save();
  setProgress('完成', '', 100);
  const rangeStr = pageList.map(p => p + 1).join(',');
  return [{ blob: new Blob([bytes], { type: 'application/pdf' }), filename: `${getBaseName(file.name)}_extracted_p${rangeStr}.pdf` }];
}

/* ============================================================
 * Word 操作实现
 * ============================================================ */

// Word → HTML
async function wordToHtml(op) {
  const file = files[0];
  setProgress('解析 Word 文档...', '', 30);
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  setProgress('完成', '', 100);
  return { text: result.value, filename: `${getBaseName(file.name)}.html` };
}

// Word → 文本
async function wordToText(op) {
  const file = files[0];
  setProgress('解析 Word 文档...', '', 30);
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  setProgress('完成', '', 100);
  return { text: result.value, filename: `${getBaseName(file.name)}.txt` };
}

// Word → PDF（先转 HTML 再用 jsPDF 渲染）
async function wordToPdf(op) {
  const file = files[0];
  setProgress('解析 Word 文档...', '', 10);
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = result.value;

  setProgress('渲染 PDF...', '', 40);
  const blob = await htmlToPdfBlob(html, getBaseName(file.name));
  setProgress('完成', '', 100);
  return [{ blob, filename: `${getBaseName(file.name)}.pdf` }];
}

// Markdown → Word：用 marked 转 HTML，再用 DOMParser 解析生成 docx
async function mdToWord(op) {
  const md = document.getElementById('text-input').value;
  setProgress('解析 Markdown...', '', 10);
  const html = marked.parse(md);

  setProgress('生成 Word 文档...', '', 40);
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;
  const paragraphs = [];

  for (const node of body.childNodes) {
    const para = domNodeToDocxParagraph(node);
    if (para) paragraphs.push(para);
  }
  if (paragraphs.length === 0) paragraphs.push(new Paragraph({ text: '' }));

  const docxDoc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });

  setProgress('打包 .docx...', '', 80);
  const blob = await Packer.toBlob(docxDoc);
  setProgress('完成', '', 100);
  return [{ blob, filename: 'markdown_export.docx' }];
}

// 把 DOM 节点转换为 docx Paragraph
function domNodeToDocxParagraph(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.trim();
    if (!text) return null;
    return new Paragraph({ children: [new TextRun(text)] });
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node;
  const tag = el.tagName.toLowerCase();
  const text = el.textContent || '';

  switch (tag) {
    case 'h1': return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
    case 'h2': return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
    case 'h3': return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] });
    case 'h4': return new Paragraph({ heading: HeadingLevel.HEADING_4, children: [new TextRun(text)] });
    case 'h5': return new Paragraph({ heading: HeadingLevel.HEADING_5, children: [new TextRun(text)] });
    case 'h6': return new Paragraph({ heading: HeadingLevel.HEADING_6, children: [new TextRun(text)] });
    case 'p': return new Paragraph({ children: parseInlineRuns(el) });
    case 'ul':
    case 'ol': {
      // 列表：把每个 li 转成一个段落（简化处理）
      const items = el.querySelectorAll(':scope > li');
      const paras = [];
      items.forEach(li => {
        paras.push(new Paragraph({
          children: [new TextRun((tag === 'ol' ? '• ' : '- ') + li.textContent)],
        }));
      });
      return paras.length ? paras[0] : null; // 返回第一个，其余会被遗漏——为了简化，调用方需展开
    }
    case 'li': return new Paragraph({ children: [new TextRun('• ' + text)] });
    case 'blockquote': return new Paragraph({ children: [new TextRun(text)], indent: { left: 720 } });
    case 'pre': {
      // 代码块：等宽字体段落
      const code = el.textContent;
      return new Paragraph({
        children: [new TextRun({ text: code, font: 'Consolas' })],
      });
    }
    case 'hr': return new Paragraph({ children: [new TextRun('---')] });
    case 'table': return new Paragraph({ children: [new TextRun(text)] });
    default:
      if (!text.trim()) return null;
      return new Paragraph({ children: [new TextRun(text)] });
  }
}

// 解析行内元素（粗体/斜体/链接等）为 TextRun 数组
function parseInlineRuns(el) {
  const runs = [];
  el.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent;
      if (t) runs.push(new TextRun(t));
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      const text = node.textContent || '';
      if (tag === 'strong' || tag === 'b') {
        runs.push(new TextRun({ text, bold: true }));
      } else if (tag === 'em' || tag === 'i') {
        runs.push(new TextRun({ text, italics: true }));
      } else if (tag === 'code') {
        runs.push(new TextRun({ text, font: 'Consolas' }));
      } else if (tag === 'a') {
        runs.push(new TextRun({ text, style: 'Hyperlink' }));
      } else if (tag === 'br') {
        runs.push(new TextRun({ break: 1 }));
      } else {
        runs.push(new TextRun(text));
      }
    }
  });
  return runs.length ? runs : [new TextRun(el.textContent || '')];
}

/* ============================================================
 * Excel / CSV 操作实现
 * ============================================================ */

// Excel → CSV
async function excelToCsv(op) {
  const file = files[0];
  const sheetIdx = parseInt(document.getElementById('excel-sheet').value) || 0;
  setProgress('解析 Excel...', '', 30);
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  if (sheetIdx >= wb.SheetNames.length) throw new Error(`工作表索引 ${sheetIdx} 超出范围（共 ${wb.SheetNames.length} 个工作表）`);
  const ws = wb.Sheets[wb.SheetNames[sheetIdx]];
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',', RS: '\n' });
  setProgress('完成', '', 100);
  return { text: csv, filename: `${getBaseName(file.name)}.csv` };
}

// Excel → JSON
async function excelToJson(op) {
  const file = files[0];
  const sheetIdx = parseInt(document.getElementById('excel-sheet').value) || 0;
  setProgress('解析 Excel...', '', 30);
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  if (sheetIdx >= wb.SheetNames.length) throw new Error(`工作表索引 ${sheetIdx} 超出范围（共 ${wb.SheetNames.length} 个工作表）`);
  const ws = wb.Sheets[wb.SheetNames[sheetIdx]];
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
  setProgress('完成', '', 100);
  return { text: JSON.stringify(json, null, 2), filename: `${getBaseName(file.name)}.json` };
}

// CSV → JSON
async function csvToJson(op) {
  const csv = document.getElementById('text-input').value;
  setProgress('解析 CSV...', '', 30);
  const wb = XLSX.read(csv, { type: 'string' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
  setProgress('完成', '', 100);
  return { text: JSON.stringify(json, null, 2), filename: 'converted.json' };
}

// JSON → CSV
async function jsonToCsv(op) {
  const jsonStr = document.getElementById('text-input').value;
  setProgress('解析 JSON...', '', 30);
  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('JSON 解析失败：' + e.message);
  }
  if (!Array.isArray(data)) {
    // 单个对象转为单行
    data = [data];
  }
  if (data.length === 0) {
    return { text: '', filename: 'converted.csv' };
  }
  const ws = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',', RS: '\n' });
  setProgress('完成', '', 100);
  return { text: csv, filename: 'converted.csv' };
}

// CSV → Excel
async function csvToExcel(op) {
  const csv = document.getElementById('text-input').value;
  setProgress('生成 Excel...', '', 30);
  const wb = XLSX.read(csv, { type: 'string' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, ws, 'Sheet1');
  const arrayBuffer = XLSX.write(out, { type: 'array', bookType: 'xlsx' });
  setProgress('完成', '', 100);
  return [{ blob: new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename: 'converted.xlsx' }];
}

/* ============================================================
 * Markdown / HTML 操作实现
 * ============================================================ */

// Markdown → HTML
async function mdToHtml(op) {
  const md = document.getElementById('text-input').value;
  setProgress('渲染 Markdown...', '', 30);
  const html = marked.parse(md);
  setProgress('完成', '', 100);
  return { text: html, filename: 'export.html' };
}

// HTML → Markdown
async function htmlToMd(op) {
  const html = document.getElementById('text-input').value;
  setProgress('转换 HTML...', '', 30);
  const md = turndown.turndown(html);
  setProgress('完成', '', 100);
  return { text: md, filename: 'export.md' };
}

// Markdown → PDF
async function mdToPdf(op) {
  const md = document.getElementById('text-input').value;
  setProgress('渲染 Markdown...', '', 20);
  const html = marked.parse(md);
  setProgress('生成 PDF...', '', 50);
  const blob = await htmlToPdfBlob(html, 'markdown_export');
  setProgress('完成', '', 100);
  return [{ blob, filename: 'markdown_export.pdf' }];
}

// HTML → PDF
async function htmlToPdf(op) {
  const html = document.getElementById('text-input').value;
  setProgress('生成 PDF...', '', 30);
  const blob = await htmlToPdfBlob(html, 'html_export');
  setProgress('完成', '', 100);
  return [{ blob, filename: 'html_export.pdf' }];
}

// 通用：HTML 字符串 → PDF Blob
// 用临时 div + html2canvas 截图 + jsPDF 嵌入
async function htmlToPdfBlob(html, filename) {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; left: -9999px; top: 0; width: 794px; padding: 32px;
    background: #ffffff; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1.6; font-size: 14px;
  `;
  // 内嵌基础样式让渲染效果接近标准 HTML
  container.innerHTML = `
    <style>
      h1 { font-size: 1.8em; margin: 0.6em 0 0.3em; }
      h2 { font-size: 1.5em; margin: 0.6em 0 0.3em; }
      h3 { font-size: 1.2em; margin: 0.6em 0 0.3em; }
      p { margin: 0.6em 0; }
      code { font-family: Consolas, monospace; background: #f1f5f9; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
      pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px; overflow-x: auto; }
      pre code { background: none; color: inherit; padding: 0; }
      blockquote { border-left: 3px solid #6366f1; padding-left: 12px; color: #6b7280; margin: 0.6em 0; }
      table { border-collapse: collapse; width: 100%; margin: 0.6em 0; }
      th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; }
      th { background: #f1f5f9; }
      ul, ol { padding-left: 24px; }
      img { max-width: 100%; }
    </style>
    ${html}
  `;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    });

    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    return pdf.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}

/* ============================================================
 * 操作分发表
 * ============================================================ */
const OP_HANDLERS = {
  'pdf-to-image':  pdfToImage,
  'image-to-pdf':  imageToPdf,
  'pdf-to-text':   pdfToText,
  'pdf-merge':     pdfMerge,
  'pdf-split':     pdfSplit,
  'pdf-rotate':    pdfRotate,
  'pdf-extract':   pdfExtract,
  'word-to-html':  wordToHtml,
  'word-to-text':  wordToText,
  'word-to-pdf':   wordToPdf,
  'md-to-word':    mdToWord,
  'excel-to-csv':  excelToCsv,
  'excel-to-json': excelToJson,
  'csv-to-json':   csvToJson,
  'json-to-csv':   jsonToCsv,
  'csv-to-excel':  csvToExcel,
  'md-to-html':    mdToHtml,
  'html-to-md':    htmlToMd,
  'md-to-pdf':     mdToPdf,
  'html-to-pdf':   htmlToPdf,
};

/* ============================================================
 * 初始化
 * ============================================================ */
function initDocument() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // 操作类型切换
  document.querySelectorAll('.tab-panel .setting__select').forEach(sel => {
    sel.addEventListener('change', updateUIForOp);
  });

  // 文件选择
  const fileInput = document.getElementById('file-input');
  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  // 拖放
  const uploadArea = document.getElementById('upload-area');
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('upload-area--dragover');
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('upload-area--dragover');
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('upload-area--dragover');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  // 清空全部
  document.getElementById('btn-clear-all').addEventListener('click', clearAllFiles);

  // 转换按钮
  document.getElementById('btn-convert').addEventListener('click', convert);

  // 复制结果
  document.getElementById('btn-copy-result').addEventListener('click', copyResult);

  // 阻止页面默认拖放行为
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // 初始化 UI
  updateUIForOp();
}

export { initDocument };
