/**
 * 文件下载（自包含小模块）
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

export function canvasToBlob(canvas, mime = 'image/png', quality) {
  return new Promise(resolve => canvas.toBlob(resolve, mime, quality));
}
