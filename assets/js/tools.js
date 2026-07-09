/**
 * 工具注册表
 * 新增工具只需在此数组中添加一项
 */
const TOOLS = [
  {
    id: 'ffmpeg',
    name: '音视频转换',
    icon: 'film',
    desc: '本地 FFmpeg 格式转换，文件不上传云端',
    category: 'media',
    tags: ['本地处理', '隐私安全'],
    path: '/tools/ffmpeg/',
    available: true,
  },
  {
    id: 'countdown',
    name: '倒计时',
    icon: 'timer',
    desc: '专注倒计时，支持预设与自定义',
    category: 'time',
    tags: ['本地运行', '番茄钟'],
    path: '/tools/countdown/',
    available: true,
  },
  {
    id: 'stopwatch',
    name: '秒表',
    icon: 'stopwatch',
    desc: '精确计时与计次记录',
    category: 'time',
    tags: ['本地运行', '毫秒精度'],
    path: '/tools/stopwatch/',
    available: true,
  },
  {
    id: 'timestamp',
    name: '时间戳',
    icon: 'timestamp',
    desc: 'Unix 时间戳与日期互转',
    category: 'time',
    tags: ['本地运行', '秒/毫秒'],
    path: '/tools/timestamp/',
    available: true,
  },
  {
    id: 'worldclock',
    name: '世界时间',
    icon: 'worldclock',
    desc: '多时区实时查看',
    category: 'time',
    tags: ['本地运行', '多时区'],
    path: '/tools/worldclock/',
    available: true,
  },
  {
    id: 'network',
    name: '网络工具',
    icon: 'network',
    desc: '延迟测试/连接诊断/网速测试/DNS查询',
    category: 'network',
    tags: ['基于用户网络', 'HTTP测速'],
    path: '/tools/network/',
    available: true,
  },
  {
    id: 'encoding',
    name: '编码转换',
    icon: 'encoding',
    desc: 'Base64/URL/ASCII/Unicode 编解码',
    category: 'encoding',
    tags: ['本地运行', '4 种编码'],
    path: '/tools/encoding/',
    available: true,
  },
  {
    id: 'cert',
    name: '证书解析',
    icon: 'cert',
    desc: 'SSL/TLS X.509 证书本地解析',
    category: 'network',
    tags: ['本地运行', 'PEM/DER'],
    path: '/tools/cert/',
    available: true,
  },
];

/**
 * 图标 SVG 映射（内联，避免额外请求）
 */
const ICONS = {
  film: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>`,
  timer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  stopwatch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 15 15"/><line x1="12" y1="5" x2="12" y2="2"/><line x1="10" y1="2" x2="14" y2="2"/><line x1="19.07" y1="5.27" x2="20.66" y2="3.66"/></svg>`,
  timestamp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/></svg>`,
  worldclock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  network: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`,
  encoding: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  cert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6l3 3 3-3h6a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="11" r="3"/><path d="M9 17l-1.5 4L12 19l4.5 2L15 17"/></svg>`,
  toolbox: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
};

/**
 * 获取基础路径（支持 GitHub Pages 子路径部署）
 */
function getBasePath() {
  return typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/';
}

/**
 * 渲染工具卡片
 */
function renderTools(filter = 'all') {
  const grid = document.getElementById('tools-grid');
  if (!grid) return;

  const base = getBasePath();
  const filtered = filter === 'all' ? TOOLS : TOOLS.filter((t) => t.category === filter);

  grid.innerHTML = filtered
    .map(
      (tool) => `
    <a href="${tool.available ? base + tool.path.replace(/^\//, '') : 'javascript:void(0)'}"
       class="tool-card glass ${tool.available ? '' : 'tool-card--disabled'}"
       ${!tool.available ? 'aria-disabled="true" tabindex="-1"' : ''}>
      <div class="tool-card__icon">${ICONS[tool.icon] || ''}</div>
      <div class="tool-card__content">
        <h3 class="tool-card__name">${tool.name}</h3>
        <p class="tool-card__desc">${tool.desc}</p>
        <div class="tool-card__tags">
          ${tool.tags.map((tag) => `<span class="tag">${tag}</span>`).join('')}
        </div>
      </div>
    </a>
  `
    )
    .join('');
}

/**
 * 分类筛选
 */
function initFilter() {
  const filters = document.querySelectorAll('.filter__item');
  if (!filters.length) return;

  filters.forEach((btn) => {
    btn.addEventListener('click', () => {
      filters.forEach((f) => f.classList.remove('filter__item--active'));
      btn.classList.add('filter__item--active');
      renderTools(btn.dataset.filter);
    });
  });
}

// 页面加载完成后渲染
document.addEventListener('DOMContentLoaded', () => {
  renderTools();
  initFilter();
});