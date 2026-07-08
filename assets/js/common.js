/**
 * 主题切换
 * 优先级：localStorage 用户选择 > 默认浅色
 */
function initTheme() {
  const stored = localStorage.getItem('theme');

  if (stored === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  } else {
    document.documentElement.dataset.theme = 'light';
  }

  updateThemeIcon();
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  updateThemeIcon();
}

function updateThemeIcon() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
  });
}

/**
 * 公共头部注入（工具页使用）
 * @param {string} toolName - 工具名称
 */
function injectToolHeader(toolName) {
  const header = document.createElement('header');
  header.className = 'tool-header';
  header.innerHTML = `
    <a href="/" class="back">
      <svg class="back-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="10 3 5 8 10 13"></polyline>
      </svg>
      工具箱
    </a>
    <h1>${toolName}</h1>
    <button class="theme-toggle" aria-label="切换主题" onclick="toggleTheme()">🌙</button>
  `;
  document.body.prepend(header);
}

// 导出给其他模块使用
export { injectToolHeader, toggleTheme };

// 同时挂载到 window 供 HTML onclick 使用
window.toggleTheme = toggleTheme;
window.injectToolHeader = injectToolHeader;

// 初始化
initTheme();

// 监听系统主题变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('theme')) {
    document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
    updateThemeIcon();
  }
});