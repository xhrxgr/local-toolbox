/**
 * 文件下载 + canvas 转 Blob
 *
 * downloadBlob 统一走共享模块（assets/js/download.js）：
 * 原先这里延后 200ms 就撤销 ObjectURL，导出大尺寸扫描图或合并 PDF 时
 * 浏览器还没读完 blob 就被回收，下载得到空文件或直接失败。
 */
export { downloadBlob } from '/assets/js/download.js';

export function canvasToBlob(canvas, mime = 'image/png', quality) {
  return new Promise(resolve => canvas.toBlob(resolve, mime, quality));
}
