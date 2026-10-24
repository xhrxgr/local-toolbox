/**
 * 文件下载（共享实现）
 *
 * 为什么抽成共享模块：此前 11 处下载各写一份，撤销 ObjectURL 的时机有四种：
 *   立即 / 200ms / 1000ms / 10000ms。
 * 其中立即撤销（diff、markdown、stopwatch）会在部分浏览器上中断下载——
 * 浏览器还没开始读 blob，URL 就失效了，下载得到 0 字节或直接失败。
 * 而 document 那处早已改成延后 10 秒，正是为了避开这个问题。
 *
 * 统一规则：点击后延后 10 秒再 revokeObjectURL。
 * 页面关闭时浏览器会自动释放，不必额外处理。
 */

/** 撤销延迟：足够浏览器完成下载，又不至于长时间占用内存 */
const REVOKE_DELAY_MS = 10000;

/**
 * 下载 Blob
 * @param {Blob} blob 内容
 * @param {string} filename 目标文件名
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 撤销太早会让浏览器在大文件下载时中断，延后回收
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * 下载 DataURL（canvas 导出的图片等）
 * @param {string} dataUrl data URL
 * @param {string} filename 目标文件名
 */
export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
