/**
 * Toast 通知（自包含小模块，与 document 工具的同名模块保持一致）
 */
const TOAST_DURATION = { info: 2600, success: 2600, warning: 3600, error: 4800 };

export function showToast(message, type = 'info', duration) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, duration ?? TOAST_DURATION[type] ?? 2600);
}
