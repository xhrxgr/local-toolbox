/**
 * 二次确认（两段式）
 *
 * 点击一次：按钮变为确认文案，旁边出现「取消」，5 秒内无操作自动还原。
 * 再点一次才真正执行。
 *
 * 不用 confirm()/alert()：它们是阻塞式弹窗，样式与站点不一致，
 * 也会打断当前页面的操作节奏。
 *
 * 同一时间只允许一个按钮处于确认态——新的确认会先还原上一个，
 * 避免界面上残留多处红色确认按钮。
 */

let armedRestore = null;

/**
 * 给按钮加二次确认
 * @param {HTMLButtonElement} btn 触发按钮
 * @param {string} confirmText 确认态的按钮文案，如「确认删除？」
 * @param {() => void} onConfirm 二次点击后执行的动作
 */
export function armConfirm(btn, confirmText, onConfirm) {
  if (btn.dataset.armed) return;
  // 先还原上一个确认态：否则 armedRestore 被覆盖，
  // 前面那个按钮的确认文案和取消按钮会残留在界面上
  if (armedRestore) armedRestore();

  btn.dataset.armed = '1';
  const original = btn.textContent;
  btn.textContent = confirmText;
  btn.classList.add('btn--danger');
  btn.title = '再次点击确认执行';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-sm btn-secondary';
  cancel.textContent = '取消';
  btn.parentElement.insertBefore(cancel, btn.nextSibling);

  const timer = setTimeout(restore, 5000);

  function restore() {
    clearTimeout(timer);
    delete btn.dataset.armed;
    btn.textContent = original;
    btn.classList.remove('btn--danger');
    btn.title = '';
    cancel.remove();
    btn.removeEventListener('click', onConfirmClick, true);
    if (armedRestore === restore) armedRestore = null;
  }

  function onConfirmClick(e) {
    // capture 阶段拦截，抢在原 click handler 之前
    e.stopImmediatePropagation();
    restore();
    onConfirm();
  }

  cancel.addEventListener('click', restore);
  btn.addEventListener('click', onConfirmClick, true);
  armedRestore = restore;
}

/** 还原当前处于确认态的按钮（页面切换等场景用） */
export function resetArmedConfirm() {
  if (armedRestore) armedRestore();
}
