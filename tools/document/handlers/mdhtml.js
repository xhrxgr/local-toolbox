/**
 * Markdown / HTML 操作处理（marked + turndown + jspdf + html2canvas）
 * 上下文 ctx: { text, setProgress }
 */
import { marked } from 'marked';
import TurndownService from 'turndown';
import { htmlToPdfBlob } from './utils.js';

marked.setOptions({ gfm: true, breaks: false });

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

/* ========== Markdown → HTML ========== */
export async function mdToHtml(ctx) {
  const { text, setProgress } = ctx;
  setProgress('渲染 Markdown...', '', 30);
  const html = marked.parse(text);
  setProgress('完成', '', 100);
  return { text: html, filename: 'export.html' };
}

/* ========== HTML → Markdown ========== */
export async function htmlToMd(ctx) {
  const { text, setProgress } = ctx;
  setProgress('转换 HTML...', '', 30);
  const md = turndown.turndown(text);
  setProgress('完成', '', 100);
  return { text: md, filename: 'export.md' };
}

/* ========== Markdown → PDF ========== */
export async function mdToPdf(ctx) {
  const { text, setProgress } = ctx;
  setProgress('渲染 Markdown...', '', 20);
  const html = marked.parse(text);
  setProgress('生成 PDF...', '', 50);
  const blob = await htmlToPdfBlob(html, 'markdown_export');
  setProgress('完成', '', 100);
  return [{ blob, filename: 'markdown_export.pdf' }];
}

/* ========== HTML → PDF ========== */
export async function htmlToPdf(ctx) {
  const { text, setProgress } = ctx;
  setProgress('生成 PDF...', '', 30);
  const blob = await htmlToPdfBlob(text, 'html_export');
  setProgress('完成', '', 100);
  return [{ blob, filename: 'html_export.pdf' }];
}

/* ========== TXT → PDF ========== */
// 纯文本转 PDF：按空行分段 → 包成 <pre> 风格 HTML → htmlToPdfBlob
export async function txtToPdf(ctx) {
  const { text, setProgress } = ctx;
  setProgress('构建 HTML...', '', 20);
  const escaped = escapeHtml(text);
  // 保留换行与空格：用 <pre> 包裹
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
body { font-family: -apple-system, "Segoe UI", Roboto, "Microsoft YaHei", monospace; line-height: 1.5; margin: 0; padding: 16px; }
pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; margin: 0; }
</style>
</head>
<body>
<pre>${escaped}</pre>
</body>
</html>`;
  setProgress('生成 PDF...', '', 50);
  const blob = await htmlToPdfBlob(html, 'text_export');
  setProgress('完成', '', 100);
  return [{ blob, filename: 'text_export.pdf' }];
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const HANDLERS = {
  'md-to-html':  mdToHtml,
  'html-to-md':  htmlToMd,
  'md-to-pdf':   mdToPdf,
  'html-to-pdf': htmlToPdf,
  'txt-to-pdf':  txtToPdf,
};
