/**
 * 工具注册表
 * 新增工具只需在此数组中添加一项
 */
import { TOOLS } from '/assets/js/tool-registry.js';

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
  document: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>`,
  scandoc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 12l2.5 2.5L16 9"/></svg>`,
  text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
  radix: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h6v6H4z M14 14h6v6h-6z M10 7h4 M14 17h-4"/></svg>`,
  chmod: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/><path d="M12 11v3"/></svg>`,
  sqlcron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/></svg>`,
  unicode: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h2v8 M9 12h2 M9 16h2"/><circle cx="16" cy="9" r="1.5" fill="currentColor"/><circle cx="16" cy="15" r="1.5" fill="currentColor"/></svg>`,
  crypto: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3z"/><path d="M9 12l2 2 4-4"/></svg>`,
  svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/><line x1="12" y1="22" x2="12" y2="15.5"/><polyline points="22 8.5 12 15.5 2 8.5"/><polyline points="2 15.5 12 8.5 22 15.5"/><line x1="12" y1="2" x2="12" y2="8.5"/></svg>`,
  ocr: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><line x1="9" y1="6" x2="15" y2="6"/><line x1="9" y1="18" x2="15" y2="18"/><line x1="6" y1="9" x2="6" y2="15"/><line x1="18" y1="9" x2="18" y2="15"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`,
};

/**
 * 获取基础路径（支持 GitHub Pages 子路径部署）
 */
function getBasePath() {
  return typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/';
}

/**
 * 渲染工具卡片
 *
 * 只渲染业务工具：siteFeature 标记的站点级入口（资源中心、实用脚本）
 * 不属于业务功能，单独放在网格上方的站点功能区。
 */
function renderTools(filter = 'all') {
  const grid = document.getElementById('tools-grid');
  if (!grid) return;

  const base = getBasePath();
  const business = TOOLS.filter((t) => !t.siteFeature);
  const filtered = filter === 'all' ? business : business.filter((t) => t.category === filter);

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
 * 渲染站点功能入口
 *
 * 资源中心、实用脚本这类入口不是业务工具，放在工具网格上方独立一行，
 * 视觉上与业务工具卡片区分（横排小卡 vs 竖排大卡）。
 * 仍可被搜索命中，注册表里保留即可。
 */
function renderSiteFeatures() {
  const section = document.getElementById('site-features');
  const list = document.getElementById('site-features-list');
  if (!section || !list) return;

  const features = TOOLS.filter((t) => t.siteFeature && t.available);
  if (features.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const base = getBasePath();
  list.innerHTML = features
    .map(
      (f) => `
    <a href="${base}${f.path.replace(/^\//, '')}" class="site-feature">
      <span class="site-feature__icon">${ICONS[f.icon] || ''}</span>
      <span class="site-feature__text">
        <span class="site-feature__name">${f.name}</span>
        <span class="site-feature__desc">${f.shortDesc || f.desc}</span>
      </span>
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
  '多': 'd', '媒': 'm', '体': 't',
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
  color: '颜色',
  unit: '换算',
  dev: '开发',
  document: '文档',
  security: '安全',
};

/* ============================================================
 * 返回首页时的状态衔接
 *
 * 工具页是整页跳转，而 Service Worker 会让 bfcache 失效，
 * 浏览器不会自动记住首页停在哪个位置，返回时总是落在首屏。
 * 这里自己在离开首页时记下滚动位置与分类筛选，返回时还原。
 *
 * 只在「确实是回到首页」时才还原：
 *   - 点了工具页的返回链接（common.js 会打 toolbox-returning 标记）
 *   - 用浏览器后退/前进回到首页（导航类型为 back_forward）
 * 直接输入地址打开首页时不还原，避免被拉回上一次的位置。
 * ============================================================ */
const HOME_STATE_KEY = 'toolbox-home-state';
const HOME_RETURN_FLAG = 'toolbox-returning';

/**
 * 保存首页状态
 * @param {boolean} skipIfZero 为 true 时，滚动位置为 0 就不写
 *   （导航/切后台时浏览器可能已把 scrollY 报成 0，别用它覆盖正确位置；
 *   点击时位置是准确的，0 也是合法值，不能跳过）
 */
function saveHomeState(skipIfZero) {
  const y = Math.round(window.scrollY);
  if (skipIfZero && y === 0) return;
  try {
    const active = document.querySelector('.filter__item--active');
    sessionStorage.setItem(
      HOME_STATE_KEY,
      JSON.stringify({
        scrollY: y,
        filter: active ? active.dataset.filter : 'all',
      })
    );
  } catch {
    // 隐私模式下 sessionStorage 不可用，忽略
  }
}

/**
 * 在点击工具卡片的瞬间保存状态。
 * 不能只靠 pagehide：那时浏览器已进入卸载流程，scrollY 会被报成 0。
 */
function initStateSave() {
  document.addEventListener(
    'click',
    (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!href.includes('/tools/')) return;
      saveHomeState(false);
    },
    true
  );
  // 兜底：刷新、关闭标签页、浏览器后退等
  window.addEventListener('pagehide', () => saveHomeState(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveHomeState(true);
  });
}

function isReturningToHome() {
  // 浏览器后退/前进
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav && nav.type === 'back_forward') return true;
  // 点工具页的返回链接
  try {
    return sessionStorage.getItem(HOME_RETURN_FLAG) === '1';
  } catch {
    return false;
  }
}

function restoreHomeState() {
  let state = null;
  try {
    const raw = sessionStorage.getItem(HOME_STATE_KEY);
    if (!raw) return;
    state = JSON.parse(raw);
    sessionStorage.removeItem(HOME_RETURN_FLAG);
  } catch {
    return;
  }
  if (!state) return;

  // 还原分类筛选
  if (state.filter && state.filter !== 'all') {
    const btn = document.querySelector(`.filter__item[data-filter="${state.filter}"]`);
    if (btn) {
      document.querySelectorAll('.filter__item').forEach((f) => f.classList.remove('filter__item--active'));
      btn.classList.add('filter__item--active');
      renderTools(state.filter);
    }
  }

  // 还原滚动位置：要等卡片渲染完，否则页面高度不够会滚不到位
  if (state.scrollY > 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo(0, state.scrollY));
    });
  }
}

// 页面加载完成后渲染
document.addEventListener('DOMContentLoaded', () => {
  renderTools();
  renderSiteFeatures();
  initFilter();
  initSearch();
  initStateSave();
  // 只有从工具页返回（或浏览器后退）才还原，直接打开首页保持原样
  if (isReturningToHome()) restoreHomeState();
});