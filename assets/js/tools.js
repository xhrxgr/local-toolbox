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
  {
    id: 'image',
    name: '图片处理',
    icon: 'image',
    desc: '压缩/裁剪/格式转换/EXIF 读取',
    category: 'media',
    tags: ['本地运行', '批量处理'],
    path: '/tools/image/',
    available: true,
  },
  {
    id: 'json',
    name: 'JSON 工具',
    icon: 'json',
    desc: 'JSON 格式化/压缩/校验/树形展示/查询',
    category: 'dev',
    tags: ['本地运行', '树形折叠'],
    path: '/tools/json/',
    available: true,
  },
  {
    id: 'regex',
    name: '正则测试',
    icon: 'regex',
    desc: '正则匹配/高亮/捕获组/替换预览',
    category: 'dev',
    tags: ['本地运行', '常用预设'],
    path: '/tools/regex/',
    available: true,
  },
  {
    id: 'jwt',
    name: 'JWT 解析',
    icon: 'jwt',
    desc: 'JWT 三段解码/过期检查/声明解释',
    category: 'dev',
    tags: ['本地运行', '实时解析'],
    path: '/tools/jwt/',
    available: true,
  },
  {
    id: 'hash',
    name: 'UUID/哈希',
    icon: 'hash',
    desc: 'UUID v1/v4/v7 生成 + MD5/SHA 哈希 + HMAC',
    category: 'dev',
    tags: ['本地运行', '文件哈希'],
    path: '/tools/hash/',
    available: true,
  },
  {
    id: 'diff',
    name: '文本对比',
    icon: 'diff',
    desc: '逐行/逐字 diff + 并排/内联视图',
    category: 'dev',
    tags: ['本地运行', '导出 patch'],
    path: '/tools/diff/',
    available: true,
  },
  {
    id: 'markdown',
    name: 'Markdown 预览',
    icon: 'markdown',
    desc: '实时渲染 + 代码高亮 + 导出 HTML',
    category: 'dev',
    tags: ['GFM', '目录生成'],
    path: '/tools/markdown/',
    available: true,
  },
  {
    id: 'qrcode',
    name: '二维码',
    icon: 'qrcode',
    desc: '二维码生成（自定义颜色/纠错）+ 图片识别',
    category: 'util',
    tags: ['本地运行', 'PNG/SVG'],
    path: '/tools/qrcode/',
    available: true,
  },
  {
    id: 'color',
    name: '颜色工具',
    icon: 'color',
    desc: 'HEX/RGB/HSL 互转 + WCAG 对比度 + 调色板提取',
    category: 'util',
    tags: ['取色器', '渐变生成'],
    path: '/tools/color/',
    available: true,
  },
  {
    id: 'password',
    name: '密码生成',
    icon: 'password',
    desc: '随机密码/记忆口令 + 强度评估',
    category: 'util',
    tags: ['安全随机', 'diceware'],
    path: '/tools/password/',
    available: true,
  },
  {
    id: 'unit',
    name: '单位转换',
    icon: 'unit',
    desc: '长度/质量/温度/数据/时间/角度/速度',
    category: 'util',
    tags: ['7 类单位', '实时转换'],
    path: '/tools/unit/',
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
  json: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/></svg>`,
  regex: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h2l2-4 4 8 2-4h4"/><circle cx="20" cy="12" r="1.5"/></svg>`,
  qrcode: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3z M18 14h3 M14 18v3 M18 18h3v3"/></svg>`,
  jwt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15 19 4 M18 5l2 2 M15 8l2 2"/></svg>`,
  color: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125 0-.926.746-1.688 1.688-1.688h1.999c3.108 0 5.541-2.452 5.541-5.562C22 6.5 17.5 2 12 2z"/></svg>`,
  hash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  diff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18 M3 6h6 M9 6v6 M9 12l-3 3-3-3 M21 12h-6 M15 12v6 M15 18l3 3 3-3"/></svg>`,
  password: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  unit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="6" x2="6" y2="18"/><line x1="10" y1="6" x2="10" y2="18"/><line x1="14" y1="6" x2="14" y2="18"/><line x1="18" y1="6" x2="18" y2="18"/></svg>`,
  markdown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15V9l3 3 3-3v6 M17 9v6 M17 15l-2-2 M17 15l2-2"/></svg>`,
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