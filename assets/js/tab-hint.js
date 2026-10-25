/**
 * 可横向滚动 Tab 行的滑动提示
 *
 * color / unit 的 tab 较多，窄屏下 tab 行 overflow-x:auto 可横向滑动，
 * 但默认没有任何提示，用户不知道还有隐藏的 tab。
 * 本模块在滚动容器上维护三个状态类，由 global.css 的 .mode-tabs
 * 渐变遮罩规则消费：
 *   mode-tabs--scrollable   内容宽于容器（可滑动）
 *   mode-tabs--at-start     滚到最左（隐藏左遮罩）
 *   mode-tabs--at-end       滚到最右（隐藏右遮罩）
 *
 * 用法：initTabScrollHint()，默认监听 .mode-tabs；
 * 容器类名不同时传入选择器。
 */
export function initTabScrollHint(selector = '.mode-tabs') {
  const el = document.querySelector(selector);
  if (!el) return;

  const update = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('mode-tabs--scrollable', max > 0);
    el.classList.toggle('mode-tabs--at-start', el.scrollLeft <= 0);
    el.classList.toggle('mode-tabs--at-end', el.scrollLeft >= max - 1);
  };

  el.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  // 初始渲染时 scrollWidth 可能未定（字体加载/布局抖动），补一帧后校正
  requestAnimationFrame(update);
  update();
}
