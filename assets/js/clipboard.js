/**
 * 复制到剪贴板（共享实现）
 *
 * 为什么抽成共享模块：此前 15 个工具各写一份 copyText，行为分三档——
 *   · 11 个检查 execCommand 返回值（正确）
 *   · 3 个不检查（otp-migration / document / timestamp）→ 复制失败却提示"已复制"
 *   · 4 个干脆没有降级路径（chmod / sqlcron / radix / text）→ 非安全上下文下完全无法复制
 * 复制一份实现是根治办法：行为一致，且以后只改一处。
 *
 * 降级顺序：
 *   1) Clipboard API（navigator.clipboard.writeText）—— 需安全上下文
 *   2) execCommand('copy') —— 老办法，靠临时 textarea
 *   3) 都不行 → 返回 false，调用方负责提示用户手动复制
 *
 * 关键点：execCommand 失败时**返回 false 而不抛错**，必须检查返回值，
 * 否则用户会看到"已复制"但剪贴板里还是旧内容。
 */

/**
 * 复制文本到剪贴板
 * @param {string} text 要复制的文本
 * @returns {Promise<boolean>} 是否复制成功
 */
export async function copyText(text) {
  // 1) Clipboard API
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒 / 非安全上下文 → 走降级
  }

  // 2) execCommand 降级
  return fallbackCopy(text);
}

/**
 * execCommand 降级实现
 * @param {string} text
 * @returns {boolean} 是否成功
 */
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  // 移到视口外但仍在文档流内：display:none 的元素无法被 select，
  // 用 left 移出屏幕比 opacity:0 更稳（部分浏览器对透明元素仍有兼容问题）
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  ta.setAttribute('readonly', '');
  document.body.appendChild(ta);

  let ok = false;
  try {
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    // 必须检查返回值：execCommand 失败时返回 false 而不抛错
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(ta);
  }
  return ok;
}

/**
 * 复制并给出按钮反馈
 * @param {string} text 要复制的文本
 * @param {HTMLElement} btn 反馈的按钮
 * @param {string} [okText] 成功文案
 * @param {string} [failText] 失败文案
 * @returns {Promise<boolean>} 是否复制成功
 */
export async function copyWithFeedback(text, btn, okText = '已复制', failText = '复制失败') {
  const ok = await copyText(text);
  if (!btn) return ok;

  const original = btn.textContent;
  btn.textContent = ok ? okText : failText;
  btn.classList.add(ok ? 'meta-btn--success' : 'meta-btn--danger');

  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('meta-btn--success', 'meta-btn--danger');
  }, 1200);

  return ok;
}
