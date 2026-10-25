/**
 * 主题切换
 * 优先级：localStorage 用户选择 > 默认浅色
 */
/* 主题图标：内联 SVG，随主题切换（界面不用 emoji，见 AGENTS.md 界面符号规范） */
const ICON_SUN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>';
/* 缓存管理入口图标（数据库造型，与 cache-manager.js 面板内的图标同款） */
const ICON_CACHE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14a9 3 0 0 0 18 0V5"></path><path d="M3 12a9 3 0 0 0 18 0"></path></svg>';

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
    btn.innerHTML = isDark ? ICON_SUN : ICON_MOON;
    btn.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
  });
}

/**
 * 公共头部注入（工具页使用）
 * @param {string} toolName - 工具名称
 */
function injectToolHeader(toolName) {
  const base = (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/') || '/';
  const header = document.createElement('header');
  header.className = 'tool-header';
  header.innerHTML = `
    <a href="${base}" class="back">
      <svg class="back-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="10 3 5 8 10 13"></polyline>
      </svg>
      工具箱
    </a>
    <h1>${toolName}</h1>
    <div class="tool-header__actions">
      <button class="cache-manage-btn" type="button" aria-label="缓存管理" title="缓存管理">${ICON_CACHE}<span class="cache-manage-btn__text">缓存</span></button>
      <button class="theme-toggle" aria-label="切换主题" onclick="toggleTheme()">${ICON_MOON}</button>
    </div>
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

/**
 * Service Worker 注册（静态资源本地缓存）
 * 仅生产环境注册：dev 模式下模块 URL 带时间戳参数，缓存无意义反而干扰开发。
 * 策略详见 public/sw.js——页面导航走网络优先保证内容最新，
 * hash 静态资源与跨域 CDN 资源走缓存优先，二次访问直接读本地。
 */
if (import.meta.env && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = (typeof import.meta.env.BASE_URL === 'string' && import.meta.env.BASE_URL) || '/';
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // 注册失败（协议不支持等）时静默降级，不影响站点功能
    });
    // 缓存管理面板（查看/删除本地缓存），与 SW 同生命周期
    import('./cache-manager.js').catch(() => {
      // 加载失败不影响主功能
    });
  });
}
