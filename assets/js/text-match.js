/**
 * 文本转义与匹配高亮（全站共享）
 *
 * 收敛自三处并行实现：assets/js/tools.js（首页工具搜索）、
 * assets/js/cache-manager.js（缓存管理页）、tools/scripts/app.js（脚本页搜索）。
 *
 * 为什么不各写一份：
 * - cache-manager 用 String(s)，tools.js 用 String(s ?? '') ——
 *   null 的处理就不一致，null 会变成字符串 "null" 显示出来；
 * - 高亮一旦分叉，同一个页面里两处高亮样式会不一样；
 * - 正则转义漏写会让含括号/点号的关键词抛异常或匹配错。
 *
 * 高亮为什么不用「先 escapeHtml 再正则替换」：
 * 那样的做法对含 & < > 的关键词会失效 —— 转义后文本里已经没有原字符了，
 * 替换位置会错。这里改成「先在原文上切出匹配段，再逐段转义」。
 */

/** HTML 实体转义。null / undefined 转成空串，不变成字符串 "null"。 */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 正则元字符转义，用于把用户输入安全地拼进 RegExp。 */
function escapeRegExp(s) {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 高亮文本中所有匹配子串。
 *
 * @param {string} text 原文
 * @param {string[]} queries 关键词列表（按「或」匹配）
 * @returns {string} 含 <mark> 的 HTML 片段
 */
function highlightMatches(text, queries) {
  const src = String(text ?? '');
  const list = Array.isArray(queries) ? queries : [queries];
  if (!list.length) return escapeHtml(src);

  const escaped = list.map(escapeRegExp).filter((q) => q.length > 0);
  if (!escaped.length) return escapeHtml(src);

  const re = new RegExp('(' + escaped.join('|') + ')', 'gi');
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    out += escapeHtml(src.slice(last, m.index));
    out += '<mark>' + escapeHtml(m[0]) + '</mark>';
    last = m.index + m[0].length;
    // 零宽匹配会让 exec 死循环
    if (m[0].length === 0) re.lastIndex++;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

export { escapeHtml, escapeRegExp, highlightMatches };
