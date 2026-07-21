/**
 * Word 操作处理（mammoth + docx + marked）
 * 上下文 ctx: { files, text, setProgress, getBaseName }
 */
import mammoth from 'mammoth/mammoth.browser.js';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { marked } from 'marked';
import { htmlToPdfBlob, getBaseName } from './utils.js';

marked.setOptions({ gfm: true, breaks: false });

/* ========== Word → HTML ========== */
export async function wordToHtml(ctx) {
  const { files, setProgress } = ctx;
  const file = files[0];
  setProgress('解析 Word 文档...', '', 30);
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  setProgress('完成', '', 100);
  return { text: result.value, filename: `${getBaseName(file.name)}.html` };
}

/* ========== Word → 文本 ========== */
export async function wordToText(ctx) {
  const { files, setProgress } = ctx;
  const file = files[0];
  setProgress('解析 Word 文档...', '', 30);
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  setProgress('完成', '', 100);
  return { text: result.value, filename: `${getBaseName(file.name)}.txt` };
}

/* ========== Word → PDF（先转 HTML 再用 jsPDF 渲染） ========== */
export async function wordToPdf(ctx) {
  const { files, setProgress } = ctx;
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

/* ========== Markdown → Word ========== */
export async function mdToWord(ctx) {
  const { text, setProgress } = ctx;
  setProgress('解析 Markdown...', '', 10);
  const html = marked.parse(text);

  setProgress('生成 Word 文档...', '', 40);
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;
  const paragraphs = [];

  // 遍历 body 子节点，列表元素需展开为多个段落
  for (const node of body.childNodes) {
    const tag = node.nodeType === Node.ELEMENT_NODE ? node.tagName.toLowerCase() : '';
    if (tag === 'ul' || tag === 'ol') {
      const items = node.querySelectorAll(':scope > li');
      items.forEach(li => {
        paragraphs.push(new Paragraph({
          children: [new TextRun((tag === 'ol' ? '• ' : '- ') + li.textContent)],
        }));
      });
    } else {
      const para = domNodeToDocxParagraph(node);
      if (para) paragraphs.push(para);
    }
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

/* ========== DOM → docx Paragraph 转换器 ========== */
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
    case 'li': return new Paragraph({ children: [new TextRun('• ' + text)] });
    case 'blockquote': return new Paragraph({ children: [new TextRun(text)], indent: { left: 720 } });
    case 'pre': {
      const code = el.textContent;
      return new Paragraph({
        children: [new TextRun({ text: code, font: 'Consolas' })],
      });
    }
    case 'hr': return new Paragraph({ children: [new TextRun('---')] });
    default: {
      const t = text.trim();
      return t ? new Paragraph({ children: [new TextRun(t)] }) : null;
    }
  }
}

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

export const HANDLERS = {
  'word-to-html': wordToHtml,
  'word-to-text': wordToText,
  'word-to-pdf':  wordToPdf,
  'md-to-word':   mdToWord,
};
