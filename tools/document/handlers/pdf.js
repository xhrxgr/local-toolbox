/**
 * PDF 操作处理（pdfjs-dist + pdf-lib）
 * 上下文 ctx: { files, options, setProgress, getBaseName }
 */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, degrees } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/* ========== 工具函数 ========== */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法加载图片: ' + file.name)); };
    img.src = url;
  });
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
      ranges.push([start - 1, end - 1]);
    } else if (/^\d+$/.test(part)) {
      const p = parseInt(part);
      ranges.push([p - 1, p - 1]);
    } else {
      throw new Error(`页码格式无法识别：${part}`);
    }
  }
  return ranges;
}

// 解析页码列表，如 "1, 3, 5-8" → [0, 2, 4, 5, 6, 7]（0-based 去重）
function parsePageList(input) {
  const ranges = parsePageRanges(input);
  const pages = new Set();
  for (const [start, end] of ranges) {
    for (let i = start; i <= end; i++) pages.add(i);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

/* ========== PDF → 图片 ========== */
export async function pdfToImage(ctx) {
  const { files, options, setProgress, getBaseName } = ctx;
  const file = files[0];
  const imgFormat = options['pdf-image-format'] || 'png';
  setProgress('加载 PDF...', '', 5);
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const results = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    setProgress(`渲染第 ${i}/${pdf.numPages} 页`, '', 5 + (i / pdf.numPages) * 90);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx2d = canvas.getContext('2d');
    await page.render({ canvasContext: ctx2d, viewport }).promise;

    const mime = imgFormat === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.92));
    const filename = `${getBaseName(file.name)}_page_${String(i).padStart(3, '0')}.${imgFormat}`;
    results.push({ blob, filename });
  }

  setProgress('完成', '', 100);
  return results;
}

/* ========== 图片 → PDF ========== */
export async function imageToPdf(ctx) {
  const { files, setProgress } = ctx;
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

/* ========== PDF → 文本 ========== */
export async function pdfToText(ctx) {
  const { files, setProgress, getBaseName } = ctx;
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

/* ========== PDF 合并 ========== */
export async function pdfMerge(ctx) {
  const { files, setProgress } = ctx;
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

/* ========== PDF 拆分 ========== */
export async function pdfSplit(ctx) {
  const { files, options, setProgress, getBaseName } = ctx;
  const file = files[0];
  const rangesInput = options['pdf-split-ranges'];
  if (!rangesInput || !rangesInput.trim()) throw new Error('请填写拆分区间');

  const ranges = parsePageRanges(rangesInput);
  setProgress('加载源 PDF...', '', 5);
  const srcBytes = await file.arrayBuffer();
  const src = await PDFDocument.load(srcBytes);
  const totalPages = src.getPageCount();

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

/* ========== PDF 旋转 ========== */
export async function pdfRotate(ctx) {
  const { files, options, setProgress, getBaseName } = ctx;
  const file = files[0];
  const angle = parseInt(options['pdf-rotate-angle'] || '90');
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

/* ========== PDF 提取指定页 ========== */
export async function pdfExtract(ctx) {
  const { files, options, setProgress, getBaseName } = ctx;
  const file = files[0];
  const pagesInput = options['pdf-extract-pages'];
  if (!pagesInput || !pagesInput.trim()) throw new Error('请填写提取页码');

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

export const HANDLERS = {
  'pdf-to-image': pdfToImage,
  'image-to-pdf': imageToPdf,
  'pdf-to-text':  pdfToText,
  'pdf-merge':    pdfMerge,
  'pdf-split':    pdfSplit,
  'pdf-rotate':   pdfRotate,
  'pdf-extract':  pdfExtract,
};
