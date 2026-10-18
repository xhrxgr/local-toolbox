/**
 * Markdown / HTML 操作处理（marked + turndown + jspdf + html2canvas）
 * 上下文 ctx: { text, setProgress }
 */
import { marked } from 'marked';
import TurndownService from 'turndown';
import { htmlToPdfBlob, escapeHtml } from './utils.js';

marked.setOptions({ gfm: true, breaks: false });

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

/* ========== Markdown → HTML ========== */
export async function mdToHtml(ctx) {
  const { text, options, setProgress } = ctx;
  setProgress('渲染 Markdown...', '', 30);
  const html = marked.parse(text);
  setProgress('完成', '', 100);
  if (options['md-full-doc']) {
    return { text: buildFullDoc(html, 'Markdown Export'), filename: 'export.html' };
  }
  return { text: html, filename: 'export.html' };
}

/** HTML 片段 → 带基础样式的完整文档 */
function buildFullDoc(fragmentHtml, title) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif; line-height: 1.6; max-width: 800px; margin: 2em auto; padding: 0 1em; color: #1f2937; }
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
img { max-width: 100%; }
a { color: #6366f1; }
</style>
</head>
<body>
${fragmentHtml}
</body>
</html>`;
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

export const HANDLERS = {
  'md-to-html':  mdToHtml,
  'html-to-md':  htmlToMd,
  'md-to-pdf':   mdToPdf,
  'html-to-pdf': htmlToPdf,
  'txt-to-pdf':  txtToPdf,
};
