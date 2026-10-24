/**
 * 剪贴板复制：优先 Clipboard API，降级 execCommand
 * 返回 Promise<boolean> 表示是否成功
 *
 * 统一走共享实现（assets/js/clipboard.js）：原先这里的降级分支不检查
 * execCommand 的返回值，复制失败也返回 true。
 */
export { copyText } from '/assets/js/clipboard.js';
