/**
 * 粘贴支持：文件类操作粘贴图片/文件，文本类操作粘贴纯文本
 * deps: { getOp, addFiles } 由 app 注入，避免循环依赖
 */
import { showToast } from '/assets/js/toast.js';

export function handlePaste(e, deps) {
  const { getOp, addFiles } = deps;
  const op = getOp();
  if (!op) return;

  const dt = e.clipboardData;
  if (!dt) return;

  // 焦点在输入控件内时走默认行为
  const target = e.target;
  const inEditable = target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  if (inEditable) return;

  if (op.inputType === 'file') {
    const pasted = [];
    for (const item of dt.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pasted.push(f);
      }
    }
    if (pasted.length > 0) {
      e.preventDefault();
      addFiles(pasted, op);
      showToast(`已粘贴 ${pasted.length} 个文件`, 'success');
    }
  } else if (op.inputType === 'text') {
    const text = dt.getData('text/plain');
    if (text) {
      e.preventDefault();
      document.getElementById('text-input').value = text;
      showToast('已粘贴文本', 'success');
    }
  }
}
