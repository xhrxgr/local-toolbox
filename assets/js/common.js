/**
 * 主题切换
 * 优先级：localStorage 用户选择 > 默认浅色
 */
/* 主题图标：内联 SVG，随主题切换（界面不用 emoji，见 AGENTS.md 界面符号规范） */
const ICON_SUN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>';
/* 资源与缓存入口图标（下载造型，指向 /tools/resources/） */
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 11 5 5 5-5"></path><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path></svg>';

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
      <a class="cache-manage-btn" href="${base}tools/resources/" aria-label="资源与缓存" title="资源与缓存管理">${ICON_DOWNLOAD}<span class="cache-manage-btn__text">下载</span></a>
      <button class="theme-toggle" aria-label="切换主题" onclick="toggleTheme()">${ICON_MOON}</button>
    </div>
  `;
  document.body.prepend(header);

  // 返回首页时打标记：首页据此还原滚动位置与分类筛选。
  // 工具页是整页跳转，而 Service Worker 会让 bfcache 失效，
  // 浏览器不会自动记住首页停在哪，返回总是落在首屏。
  header.querySelector('.back').addEventListener('click', () => {
    try {
      sessionStorage.setItem('toolbox-returning', '1');
    } catch {
      // 隐私模式下不可用，忽略
    }
  });
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
  });
} else {
  // dev 模式不注册 SW，资源与缓存入口没有内容可管——直接隐藏
  const hideStyle = document.createElement('style');
  hideStyle.textContent = '.cache-manage-btn { display: none !important; }';
  document.head.appendChild(hideStyle);
}
