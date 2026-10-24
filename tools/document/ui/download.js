/**
 * 文件下载：单文件下载 + 多文件 ZIP 打包
 */
import { showToast } from './toast.js';
import { downloadBlob as sharedDownloadBlob } from '/assets/js/download.js';

// 下载实现统一走共享模块（assets/js/download.js），撤销时机与全站一致
export function downloadBlob(blob, filename) {
  sharedDownloadBlob(blob, filename);
}

/** 多文件打包为单个 ZIP 下载，避免浏览器拦截连续下载 */
export async function downloadAllAsZip(items) {
  try {
    showToast('正在打包 ZIP...', 'info', 1500);
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const item of items) zip.file(item.filename, item.blob);
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, '文档转换结果.zip');
    showToast('ZIP 已开始下载', 'success');
  } catch (err) {
    console.error('[ZIP 打包失败]', err);
    showToast('ZIP 打包失败：' + (err.message || String(err)), 'error');
  }
}
