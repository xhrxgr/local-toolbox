import DOMPurify from 'dompurify';
/**
 * 文档转换工具：共享工具函数
 */

export function getBaseName(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 字节数 → 人类可读大小 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/** 按扩展名返回文件类型标签（用于列表图标替代 emoji） */
export function getFileKind(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'PDF';
  if (ext === 'docx' || ext === 'doc') return 'DOC';
  if (ext === 'xlsx' || ext === 'xls') return 'XLS';
  if (ext === 'csv' || ext === 'tsv') return 'CSV';
  if (ext === 'md' || ext === 'markdown') return 'MD';
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'HTM';
  if (ext === 'txt') return 'TXT';
  if (ext === 'rtf') return 'RTF';
  if (ext === 'epub') return 'EPB';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'avif'].includes(ext)) return 'IMG';
  return 'FILE';
}

/**
 * HTML 字符串 → PDF Blob
 * 用临时 div + html2canvas 截图 + jsPDF 分页嵌入
 */
export async function htmlToPdfBlob(html, filename) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);

  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; left: -9999px; top: 0; width: 794px; padding: 32px;
    background: #ffffff; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1.6; font-size: 14px;
  `;
  // 用户 HTML 必须先消毒再挂到 document.body：
  // 事件处理器属性（<img onerror>、<svg onload>）在 innerHTML 注入后是会执行的，
  // 粘贴一段带 onerror 的 HTML 就能以本页上下文跑脚本、读 localStorage。
  // <script> 标签本身不会被 innerHTML 执行，但保留它没有意义。
  const safeHtml = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
  });

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
    ${safeHtml}
  `;
  document.body.appendChild(container);

  try {
    // canvas 单边上限（Chrome 约 16384px）。整篇文档渲染成一张图时，
    // 超限会静默返回空白/损坏的图，导出的 PDF 全黑且不报错——提前拦下并说明。
    const contentH = container.scrollHeight;
    if (contentH * 2 > 16000) {
      throw new Error(`文档渲染高度约 ${Math.round(contentH * 2)}px，超过浏览器画布上限，请拆分成多份后分别转换`);
    }

    const canvas = await html2canvas(container, {
      scale: 2,
      // 文档里的远程图片需要跨域读取才能入图；注意这会向图片所在服务器发起请求
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
