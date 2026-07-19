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
    aliases: ['ffmpeg', '视频转换', '音频转换', '格式转换', '转码', 'video', 'audio', 'convert', 'mp4', 'mp3', 'mkv', 'webm', '裁剪', '提取音频', '去隔行', 'amv'],
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
    aliases: ['倒计时', '番茄钟', 'pomodoro', 'timer', '专注', '定时', '提醒', 'countdown'],
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
    aliases: ['秒表', '计时', 'stopwatch', 'lap', '计次', '计时器', 'split'],
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
    aliases: ['时间戳', 'unix', 'timestamp', '日期转换', 'epoch', '毫秒', '时间转换'],
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
    aliases: ['世界时间', '世界时钟', '时区', 'worldclock', 'world time', 'timezone', '多时区', '国际时间'],
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
    aliases: ['网络', 'ping', '延迟', '测速', '网速', 'dns', '诊断', 'tcp', '网络信息', 'ip', 'network'],
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
    aliases: ['编码', 'base64', 'url编码', 'ascii', 'unicode', '编码转换', '解码', 'encode', 'decode', '转义'],
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
    aliases: ['证书', 'ssl', 'tls', 'x509', 'pem', 'der', 'crt', 'cer', '证书解析', 'certificate'],
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
    aliases: ['图片', '图像', '压缩', '裁剪', 'exif', '格式转换', 'webp', 'jpeg', 'png', 'image', 'picture'],
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
    aliases: ['json', '格式化', '压缩', '校验', 'jsonpath', '树形', 'minify', 'beautify', 'pretty'],
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
    aliases: ['正则', 'regex', 'regexp', 'regular expression', '正则表达式', '匹配', '捕获组'],
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
    aliases: ['jwt', 'json web token', 'token', 'jwt解析', ' bearer', '授权', '认证'],
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
    aliases: ['uuid', '哈希', 'hash', 'md5', 'sha', 'sha256', 'sha512', 'hmac', 'uuid生成', '指纹', '摘要'],
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
    aliases: ['diff', '对比', '比较', '文本对比', '差异', 'patch', '并排', '逐行', '逐字'],
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
    aliases: ['markdown', 'md', '渲染', '预览', '代码高亮', 'gfm', '文档', '编辑器'],
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
    aliases: ['二维码', 'qr', 'qrcode', 'qr code', '条码', '扫码', '识别', '生成二维码'],
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
    aliases: ['颜色', 'color', '色彩', 'hex', 'rgb', 'hsl', 'hsv', '对比度', 'wcag', '取色器', '调色板', '渐变', 'palette'],
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
    aliases: ['密码', 'password', '生成密码', '随机密码', '口令', 'diceware', '强度', '密码生成器'],
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
    aliases: ['单位', '单位转换', '换算', 'unit', '长度', '质量', '温度', '角度', '速度', '数据量', 'conversion'],
    path: '/tools/unit/',
    available: true,
  },
  {
    id: 'otp-migration',
    name: 'TOTP 迁移',
    icon: 'totp',
    desc: '解析 Google Authenticator 导出码，生成标准 otpauth:// 链接',
    category: 'util',
    tags: ['完全离线', '实时验证码'],
    aliases: ['totp', 'otp', '验证器', '二步验证', '两步验证', 'google authenticator', '身份验证器', '动态密码', 'otpauth', '迁移', '2fa', 'mfa'],
    path: '/tools/otp-migration/',
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
  totp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/><path d="M12 11v3"/></svg>`,
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

/* ============================================================
 * 工具搜索：加权评分算法
 * 评分维度（0-100）：
 *   name 完全匹配 = 100 / name 前缀 = 60 / name 词边界包含 = 40
 *   alias 精确 = 50 / alias 部分包含 = 30
 *   tags 命中 = 25 / desc 包含 = 20
 * 多词查询累加并封顶 100，得分 > 0 才进入结果
 * ============================================================ */

// 拼音首字母表（仅常用字，避免引入完整拼音库）
const PINYIN_INITIALS = {
  '音': 'y', '视': 's', '频': 'p', '转': 'z', '换': 'h',
  '倒': 'd', '计': 'j', '时': 's', '世': 's', '界': 'j',
  '网': 'w', '络': 'l', '编': 'b', '码': 'm', '证': 'z', '书': 's',
  '图': 't', '片': 'p', '正': 'z', '则': 'z', '文': 'w', '本': 'b',
  '对': 'd', '比': 'b', '二': 'e', '维': 'w', '码': 'm', '颜': 'y',
  '色': 's', '密': 'm', '单': 'd', '位': 'w', '验': 'y', '迁': 'q',
  '秒': 'm', '表': 'b', '日': 'r', '期': 'q', '格': 'g', '式': 's',
  '压': 'y', '缩': 's', '裁': 'c', '剪': 'j', '哈': 'h', '希': 'x',
  '摘': 'z', '要': 'y', '加': 'j', '密': 'm', '长': 'c', '度': 'd',
  '质': 'z', '量': 'l', '温': 'w', '度': 'd', '角': 'j', '速': 's',
  '数': 's', '据': 'j', '时': 's', '间': 'j', '停': 't', '延': 'y',
  '测': 'c', '速': 's', '诊': 'z', '断': 'd', '查': 'c', '询': 'x',
  '批': 'p', '量': 'l', '处': 'c', '理': 'l', '安': 'a', '全': 'q',
  '隐': 'y', '私': 's', '本': 'b', '地': 'd', '运': 'y', '行': 'x',
  '毫': 'h', '秒': 'm', '精': 'j', '度': 'd', '多': 'd', '区': 'q',
  '国': 'g', '际': 'j', '标': 'b', '准': 'z', '链': 'l', '接': 'j',
  '生': 's', '成': 'c', '识': 's', '别': 'b', '扫': 's',
  '取': 'q', '器': 'q', '板': 'b', '渐': 'j', '变': 'b',
  '随': 's', '机': 'j', '口': 'k', '令': 'l', '强': 'q', '弱': 'r',
  '摘': 'z', '要': 'y', '指': 'z', '纹': 'w',
  '实': 's', '时': 's', '渲': 'x', '染': 'r', '预': 'y', '览': 'l',
  '代': 'd', '高': 'g', '亮': 'l', '目': 'm', '录': 'l',
  '校': 'j', '验': 'y', '树': 's', '形': 'x', '折': 'z', '叠': 'd',
  '匹': 'p', '配': 'p', '捕': 'b', '获': 'h', '组': 'z',
  '过': 'g', '期': 'q', '声': 's', '明': 'm', '解': 'j', '析': 'x',
  '过': 'g', '滤': 'l', '导': 'd', '出': 'c', '导': 'd', '入': 'r',
  '迁': 'q', '移': 'y', '动': 'd', '态': 't', '态': 't',
  '身': 's', '份': 'f', '验': 'y', '证': 'z',
  '文': 'w', '档': 'd', '编': 'b', '辑': 'j',
};

function toPinyinInitials(str) {
  let result = '';
  for (const ch of str) {
    if (PINYIN_INITIALS[ch]) result += PINYIN_INITIALS[ch];
    else if (/[a-zA-Z0-9]/.test(ch)) result += ch.toLowerCase();
  }
  return result;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 高亮文本中所有匹配子串
 */
function highlightMatches(text, queries) {
  if (!queries.length) return escapeHtml(text);
  const escaped = queries.map(escapeRegExp).filter((q) => q.length > 0);
  if (!escaped.length) return escapeHtml(text);
  const re = new RegExp('(' + escaped.join('|') + ')', 'gi');
  return escapeHtml(text).replace(re, '<mark>$1</mark>');
}

/**
 * 单字段评分：返回 0 或正分数
 * type: 'name' | 'alias' | 'tag' | 'desc'
 */
function scoreField(text, query, type) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;

  // 完全匹配
  if (lower === q) {
    return type === 'name' ? 100 : type === 'alias' ? 50 : 25;
  }
  // 前缀匹配
  if (lower.startsWith(q)) {
    const ratio = q.length / lower.length;
    if (type === 'name') return Math.round(60 * ratio + 20);
    if (type === 'alias') return Math.round(35 * ratio + 10);
    return 15;
  }
  // 词边界包含（中文字符间或英文字母间）
  const idx = lower.indexOf(q);
  if (idx >= 0) {
    const ratio = q.length / lower.length;
    if (type === 'name') return Math.round(40 * ratio + 5);
    if (type === 'alias') return Math.round(30 * ratio + 5);
    if (type === 'tag') return 25;
    if (type === 'desc') return Math.round(20 * ratio);
  }
  return 0;
}

/**
 * 评分单个工具
 * query: 已拆分的查询词数组（去重去空）
 */
function scoreTool(tool, queries) {
  let bestScore = 0;
  let matchedFields = { name: false, alias: false, tag: false, desc: false };

  for (const q of queries) {
    let wordBest = 0;
    // 1. name
    const nameScore = scoreField(tool.name, q, 'name');
    if (nameScore > wordBest) { wordBest = nameScore; matchedFields.name = true; }
    // 2. name 拼音首字母
    const pinyin = toPinyinInitials(tool.name);
    const pinyinScore = scoreField(pinyin, q, 'alias') * 0.6; // 拼音降权
    if (pinyinScore > wordBest) { wordBest = pinyinScore; matchedFields.alias = true; }
    // 3. aliases
    for (const alias of (tool.aliases || [])) {
      const s = scoreField(alias, q, 'alias');
      if (s > wordBest) { wordBest = s; matchedFields.alias = true; }
    }
    // 4. tags
    for (const tag of (tool.tags || [])) {
      const s = scoreField(tag, q, 'tag');
      if (s > wordBest) { wordBest = s; matchedFields.tag = true; }
    }
    // 5. desc
    const descScore = scoreField(tool.desc, q, 'desc');
    if (descScore > wordBest) { wordBest = descScore; matchedFields.desc = true; }

    bestScore += wordBest;
  }

  // 多词查询时给"所有词都命中"的工具小幅加成
  if (queries.length > 1) {
    let allHit = false;
    for (const q of queries) {
      let hit = false;
      if (scoreField(tool.name, q, 'name') > 0) hit = true;
      else if (scoreField(toPinyinInitials(tool.name), q, 'alias') > 0) hit = true;
      else if ((tool.aliases || []).some((a) => scoreField(a, q, 'alias') > 0)) hit = true;
      else if ((tool.tags || []).some((t) => scoreField(t, q, 'tag') > 0)) hit = true;
      else if (scoreField(tool.desc, q, 'desc') > 0) hit = true;
      if (!hit) { allHit = false; break; }
      allHit = true;
    }
    if (allHit) bestScore += 15;
  }

  bestScore = Math.min(100, bestScore);

  return {
    tool,
    score: bestScore,
    matchedFields,
    // 显示百分比：映射到 50-100 区间，让用户感知差异
    displayScore: bestScore > 0 ? Math.round(50 + bestScore * 0.5) : 0,
  };
}

/**
 * 搜索工具主入口
 */
function searchTools(query) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  // 拆分查询词：按空白字符分割，去重去空
  const queries = [...new Set(trimmed.split(/\s+/).filter((s) => s.length > 0))];
  if (!queries.length) return [];

  const results = TOOLS
    .filter((t) => t.available)
    .map((t) => scoreTool(t, queries))
    .filter((r) => r.score > 0);

  // 排序：分数降序，相同分按 name 字母序
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.tool.name.localeCompare(b.tool.name, 'zh');
  });

  return results;
}

/* ============================================================
 * 搜索栏 UI 控制器
 * ============================================================ */
function initSearch() {
  const input = document.getElementById('search-input');
  const suggestions = document.getElementById('search-suggestions');
  if (!input || !suggestions) return;

  let debounceTimer = null;
  let currentResults = [];
  let activeIndex = -1; // -1 = 未选中, 0..n-1 = 选中项索引

  function renderEmpty(query) {
    suggestions.innerHTML = `
      <div class="search-suggestion search-suggestion--empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <span>未找到匹配「${escapeHtml(query)}」的工具</span>
      </div>`;
    suggestions.hidden = false;
  }

  function renderResults(results, queries) {
    if (!results.length) {
      renderEmpty(queries.join(' '));
      currentResults = [];
      return;
    }
    currentResults = results;
    activeIndex = -1;

    const base = getBasePath();
    suggestions.innerHTML = results.slice(0, 8).map((r, i) => {
      const tool = r.tool;
      const href = base + tool.path.replace(/^\//, '');
      const nameHtml = highlightMatches(tool.name, queries);
      const descHtml = highlightMatches(tool.desc, queries);
      const tagsHtml = (tool.tags || []).map((t) =>
        `<span class="search-suggestion__tag">${highlightMatches(t, queries)}</span>`
      ).join('');
      return `
        <a href="${href}" class="search-suggestion" data-index="${i}" role="option">
          <div class="search-suggestion__icon">${ICONS[tool.icon] || ''}</div>
          <div class="search-suggestion__body">
            <div class="search-suggestion__header">
              <span class="search-suggestion__name">${nameHtml}</span>
              <span class="search-suggestion__category">${CATEGORY_LABELS[tool.category] || tool.category}</span>
              <span class="search-suggestion__score">${r.displayScore}%</span>
            </div>
            <div class="search-suggestion__desc">${descHtml}</div>
            ${tagsHtml ? `<div class="search-suggestion__tags">${tagsHtml}</div>` : ''}
          </div>
        </a>`;
    }).join('');

    suggestions.hidden = false;
  }

  function clearActive() {
    suggestions.querySelectorAll('.search-suggestion').forEach((el) => {
      el.classList.remove('search-suggestion--active');
    });
  }

  function setActive(idx) {
    clearActive();
    if (idx < 0 || idx >= currentResults.length) return;
    const el = suggestions.querySelector(`.search-suggestion[data-index="${idx}"]`);
    if (el) {
      el.classList.add('search-suggestion--active');
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  function closeSuggestions() {
    suggestions.hidden = true;
    currentResults = [];
    activeIndex = -1;
  }

  function performSearch() {
    const query = input.value;
    if (!query.trim()) {
      closeSuggestions();
      return;
    }
    const results = searchTools(query);
    const queries = [...new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean))];
    renderResults(results, queries);
  }

  // 输入防抖
  input.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(performSearch, 120);
  });

  // 聚焦时如果有内容立即显示
  input.addEventListener('focus', () => {
    if (input.value.trim()) performSearch();
  });

  // 失焦延迟关闭（让点击事件先触发）
  input.addEventListener('blur', () => {
    setTimeout(() => {
      // 如果焦点转移到建议项，不关闭
      if (suggestions.contains(document.activeElement)) return;
      closeSuggestions();
    }, 180);
  });

  // 键盘导航
  input.addEventListener('keydown', (e) => {
    if (suggestions.hidden || !currentResults.length) {
      if (e.key === 'ArrowDown' && input.value.trim()) {
        performSearch();
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % Math.min(currentResults.length, 8);
      setActive(activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = activeIndex <= 0 ? Math.min(currentResults.length, 8) - 1 : activeIndex - 1;
      setActive(activeIndex);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < currentResults.length) {
        e.preventDefault();
        const tool = currentResults[activeIndex].tool;
        window.location.href = getBasePath() + tool.path.replace(/^\//, '');
      }
      // 否则让浏览器默认行为（如表单提交）触发，或无操作
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = '';
      input.focus();
      closeSuggestions();
    }
  });

  // 鼠标 hover 高亮
  suggestions.addEventListener('mousemove', (e) => {
    const item = e.target.closest('.search-suggestion');
    if (!item) return;
    const idx = parseInt(item.dataset.index);
    if (!isNaN(idx) && idx !== activeIndex) {
      activeIndex = idx;
      clearActive();
      item.classList.add('search-suggestion--active');
    }
  });

  // 全局快捷键 / 聚焦搜索框
  document.addEventListener('keydown', (e) => {
    // 忽略 input/textarea 中的 /
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

const CATEGORY_LABELS = {
  all: '全部',
  media: '媒体',
  time: '时间',
  network: '网络',
  encoding: '编码',
  dev: '开发',
  util: '实用',
};

// 页面加载完成后渲染
document.addEventListener('DOMContentLoaded', () => {
  renderTools();
  initFilter();
  initSearch();
});