/**
 * Toast 通知（全站共享实现）
 *
 * 收敛自 4 套并行实现：document/ui/toast.js、scandoc/lib/toast.js、
 * otp-migration 的 flashToast、ffmpeg 的 showWarn。接口统一为
 * showToast(message, type, duration)，type 取 info/success/warning/error。
 *
 * 自包含：首次调用时创建容器并注入样式（sw-toast 前缀类名，
 * 避免与工具页既有样式冲突），不依赖各工具 HTML/CSS。
 */

const TOAST_DURATION = { info: 2600, success: 2600, warning: 3600, error: 4800 };
const CONTAINER_ID = 'sw-toast-container';
const STYLE_ID = 'sw-toast-style';

const TOAST_CSS = `
.${CONTAINER_ID} {
  position: fixed;
  bottom: var(--space-lg);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  z-index: 2000;
  pointer-events: none;
}
.sw-toast {
  max-width: min(480px, calc(100vw - 2 * var(--space-lg)));
  padding: var(--space-sm) var(--space-lg);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  text-align: center;
  box-shadow: var(--shadow-lg);
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.25s ease, transform 0.25s ease;
  border: 1px solid transparent;
  word-break: break-all;
}
.sw-toast--visible { opacity: 1; transform: translateY(0); }
.sw-toast--info { background: var(--card); color: var(--text); border-color: var(--border); }
.sw-toast--success { background: #ecfdf5; color: #065f46; border-color: #6ee7b7; }
.sw-toast--warning { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
.sw-toast--error { background: #fef2f2; color: #b91c1c; border-color: #fca5a5; }
[data-theme="dark"] .sw-toast--success { background: #022c22; color: #6ee7b7; border-color: #065f46; }
[data-theme="dark"] .sw-toast--warning { background: #422006; color: #fde68a; border-color: #78350f; }
[data-theme="dark"] .sw-toast--error { background: #450a0a; color: #fca5a5; border-color: #7f1d1d; }
`;

function ensureContainer() {
  let container = document.getElementById(CONTAINER_ID);
  if (container) return container;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = TOAST_CSS;
    document.head.appendChild(style);
  }
  container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.className = CONTAINER_ID;
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
}

export function showToast(message, type = 'info', duration) {
  const container = ensureContainer();
  const toast = document.createElement('div');
  toast.className = `sw-toast sw-toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('sw-toast--visible'));
  setTimeout(() => {
    toast.classList.remove('sw-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, duration ?? TOAST_DURATION[type] ?? 2600);
}
