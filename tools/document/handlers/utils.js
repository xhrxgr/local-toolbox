/**
 * 文档转换工具：共享工具函数
 */

export function getBaseName(filename) {
  return filename.replace(/\.[^.]+$/, '');
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
