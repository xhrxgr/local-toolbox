/**
 * 导出：单页图片 / 多页合并 PDF
 * PDF 用 pdf-lib 逐页嵌入渲染结果，页面尺寸跟随图片
 */
import { PDFDocument } from 'pdf-lib';
import { renderPage } from './render.js';
import { downloadBlob, canvasToBlob } from './lib/download.js';
import { showToast } from './lib/toast.js';

const EXPORT_MAX_SIZE = 2200; // 导出最长边限制，控制 PDF 体积

/** 导出当前页为图片（PNG） */
export async function exportPageImage(page) {
  const canvas = await renderPage(page, { maxSize: EXPORT_MAX_SIZE, applyWarp: true });
  const blob = await canvasToBlob(canvas, 'image/png');
  downloadBlob(blob, `${baseName(page.name)}_扫描.png`);
  showToast('已导出当前页图片', 'success');
}

/** 多页按顺序合并导出 PDF */
export async function exportMergedPdf(pages, onProgress) {
  const pdfDoc = await PDFDocument.create();
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length, pages[i]);
    const canvas = await renderPage(pages[i], { maxSize: EXPORT_MAX_SIZE, applyWarp: true });
    const pngBytes = await canvasToBlob(canvas, 'image/png').then(b => b.arrayBuffer());
    const img = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const bytes = await pdfDoc.save();
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), '扫描文档合并.pdf');
  showToast(`已合并导出 ${pages.length} 页 PDF`, 'success');
}

function baseName(name) {
  return String(name || 'image').replace(/\.[^.]+$/, '');
}
