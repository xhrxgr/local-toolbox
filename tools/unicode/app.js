/**
 * Unicode 查看器核心逻辑
 * 3 个 Tab：字符分析 / 码点查询 / 字符块浏览
 * 全部本地运行，无任何网络请求，无第三方库
 */

/* ========== Tab 切换 ========== */
function switchTab(mode) {
  document.querySelectorAll('.mode-tab').forEach((t) => {
    t.classList.toggle('mode-tab--active', t.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-panel').forEach((p) => {
    p.classList.toggle('mode-panel--active', p.id === `panel-${mode}`);
  });
}

/* ========== 通用：复制到剪贴板（clipboard API + execCommand fallback） ========== */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      document.body.removeChild(ta);
      return false;
    }
  }
}

// 复制按钮 1.2s "已复制" 反馈
function flashCopyBtn(btn) {
  const original = btn.textContent;
  btn.textContent = '已复制';
  btn.classList.add('meta-btn--success');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('meta-btn--success');
  }, 1200);
}

// 字符网格 cell 复制反馈（改背景色）
function flashGridCell(cell) {
  cell.classList.add('grid-cell--copied');
  setTimeout(() => cell.classList.remove('grid-cell--copied'), 1200);
}

/* ========== HTML 转义 ========== */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 不可见字符的占位符显示
function visibleChar(ch) {
  if (ch === ' ') return '␣';
  if (ch === '\n') return '↵';
  if (ch === '\t') return '⇥';
  if (ch === '\r') return '⏎';
  if (/\p{C}/u.test(ch)) return '·';
  return ch;
}

/* ========== Unicode 块表 ========== */
const UNICODE_BLOCKS = [
  { name: 'Basic Latin', start: 0x0000, end: 0x007F },
  { name: 'Latin-1 Supplement', start: 0x0080, end: 0x00FF },
  { name: 'Greek and Coptic', start: 0x0370, end: 0x03FF },
  { name: 'Cyrillic', start: 0x0400, end: 0x04FF },
  { name: 'Arabic', start: 0x0600, end: 0x06FF },
  { name: 'Hebrew', start: 0x0590, end: 0x05FF },
  { name: 'Thai', start: 0x0E00, end: 0x0E7F },
  { name: 'CJK Symbols and Punctuation', start: 0x3000, end: 0x303F },
  { name: 'Hiragana', start: 0x3040, end: 0x309F },
  { name: 'Katakana', start: 0x30A0, end: 0x30FF },
  { name: 'CJK Unified Ideographs', start: 0x4E00, end: 0x9FFF },
  { name: 'Hangul Syllables', start: 0xAC00, end: 0xD7AF },
  { name: 'CJK Compatibility', start: 0x3300, end: 0x33FF },
  { name: 'Halfwidth and Fullwidth Forms', start: 0xFF00, end: 0xFFEF },
  { name: 'Box Drawing', start: 0x2500, end: 0x257F },
  { name: 'Block Elements', start: 0x2580, end: 0x259F },
  { name: 'Geometric Shapes', start: 0x25A0, end: 0x25FF },
  { name: 'Mathematical Operators', start: 0x2200, end: 0x22FF },
  { name: 'Misc Symbols', start: 0x2600, end: 0x26FF },
  { name: 'Dingbats', start: 0x2700, end: 0x27BF },
  { name: 'Misc Symbols and Pictographs', start: 0x1F300, end: 0x1F5FF },
  { name: 'Emoticons', start: 0x1F600, end: 0x1F64F },
  { name: 'Transport and Map Symbols', start: 0x1F680, end: 0x1F6FF },
  { name: 'Supplemental Symbols and Pictographs', start: 0x1F900, end: 0x1F9FF },
];

/* ========== 工具函数 ========== */
// 码点 → U+XXXX 格式（≥4 位 hex，>0xFFFF 时为 5-6 位）
function formatCodepoint(cp) {
  const hex = cp.toString(16).toUpperCase();
  return 'U+' + (hex.length <= 4 ? hex.padStart(4, '0') : hex);
}

// 字符 → UTF-8 字节数组
function getUtf8Bytes(ch) {
  return Array.from(new TextEncoder().encode(ch));
}

// 字符 → UTF-16 代码单元数组（码元）
function getUtf16Units(ch) {
  const units = [];
  for (let i = 0; i < ch.length; i++) {
    units.push(ch.charCodeAt(i));
  }
  return units;
}

// 字节数组 → 空格分隔的大写 hex 字符串
function bytesToHex(bytes) {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

// UTF-16 单元数组 → 空格分隔的大写 4 位 hex
function unitsToHex(units) {
  return units.map((u) => u.toString(16).toUpperCase().padStart(4, '0')).join(' ');
}

// 字符分类：用 Unicode 属性转义正则判断
function classifyChar(ch) {
  if (/\p{L}/u.test(ch)) return 'Letter';
  if (/\p{N}/u.test(ch)) return 'Number';
  if (/\p{P}/u.test(ch)) return 'Punctuation';
  if (/\p{S}/u.test(ch)) return 'Symbol';
  if (/\p{Z}/u.test(ch)) return 'Separator';
  return 'Other';
}

// 查找码点所属 Unicode 块
function findBlock(cp) {
  for (const b of UNICODE_BLOCKS) {
    if (cp >= b.start && cp <= b.end) return b;
  }
  return null;
}

// 解析多种格式的码点输入
function parseCodepointInput(input) {
  const s = input.trim();
  if (!s) return null;

  // U+4E2D 格式
  let m = s.match(/^U\+([0-9A-Fa-f]+)$/i);
  if (m) return parseInt(m[1], 16);

  // 0x4E2D 格式
  m = s.match(/^0x([0-9A-Fa-f]+)$/i);
  if (m) return parseInt(m[1], 16);

  // 单字符（按码点拆分，正确处理代理对）
  const chars = [...s];
  if (chars.length === 1) return chars[0].codePointAt(0);

  // 纯十进制数
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  return null;
}

// 码点 → UTF-32 字节数组（4 字节大端）
function toUtf32Bytes(cp) {
  return [
    Math.floor(cp / 0x1000000) & 0xff,
    Math.floor(cp / 0x10000) & 0xff,
    Math.floor(cp / 0x100) & 0xff,
    cp & 0xff,
  ];
}

// 码点 → HTML 实体（十进制 + 十六进制）
function toHtmlEntity(cp) {
  return `&#${cp}; 或 &#x${cp.toString(16).toUpperCase()};`;
}

// 码点 → CSS 转义（\XXXX）
function toCssEscape(cp) {
  return '\\' + cp.toString(16).toUpperCase().padStart(4, '0');
}

// 字符 → JS 转义（BMP 用 \uXXXX，补充平面用代理对 \uXXXX\uXXXX）
function toJsEscape(ch) {
  let result = '';
  for (let i = 0; i < ch.length; i++) {
    result += '\\u' + ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  }
  return result;
}

/* ========== Tab 1: 字符分析（防抖 120ms） ========== */
let analyzeTimer = null;

function scheduleAnalyze() {
  clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(analyze, 120);
}

function analyze() {
  const input = document.getElementById('analyze-input').value;
  const tbody = document.getElementById('analyze-tbody');
  const statsEl = document.getElementById('analyze-stats');
  const emptyEl = document.getElementById('analyze-empty');

  if (!input) {
    tbody.innerHTML = '';
    statsEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }

  // for...of 按码点迭代，正确拆分代理对
  const chars = [...input];
  let utf8Count = 0;
  let utf16Count = 0;
  const rows = [];

  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const utf8 = getUtf8Bytes(ch);
    const utf16 = getUtf16Units(ch);
    utf8Count += utf8.length;
    utf16Count += utf16.length;
    rows.push({ ch, cp, utf8, utf16 });
  }

  // 限制最多 2000 行避免渲染卡顿
  const maxRows = 2000;
  const displayRows = rows.slice(0, maxRows);

  tbody.innerHTML = displayRows
    .map((r) => {
      const cls = classifyChar(r.ch);
      const block = findBlock(r.cp);
      const blockName = block ? block.name : '—';
      return `
        <tr>
          <td class="char-cell">${escapeHtml(visibleChar(r.ch))}</td>
          <td><code>${formatCodepoint(r.cp)}</code></td>
          <td><code>${bytesToHex(r.utf8)}</code></td>
          <td><code>${unitsToHex(r.utf16)}</code></td>
          <td>${cls}</td>
          <td>${escapeHtml(blockName)}</td>
        </tr>
      `;
    })
    .join('');

  statsEl.hidden = false;
  document.getElementById('stat-chars').textContent = chars.length;
  document.getElementById('stat-utf8').textContent = utf8Count;
  document.getElementById('stat-utf16').textContent = utf16Count;

  emptyEl.hidden = true;
  if (rows.length > maxRows) {
    emptyEl.hidden = false;
    emptyEl.textContent = `仅显示前 ${maxRows} 个字符（共 ${rows.length} 个）`;
  }
}

/* ========== Tab 2: 码点查询 ========== */
function queryCodepoint() {
  const input = document.getElementById('cp-input').value;
  const result = document.getElementById('cp-result');
  const errorEl = document.getElementById('cp-error');

  errorEl.hidden = true;
  errorEl.textContent = '';

  const cp = parseCodepointInput(input);
  if (cp === null || !Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) {
    errorEl.textContent = '无法识别输入格式。支持 U+XXXX / 0xXXXX / 十进制 / 单字符（码点范围 0 - 10FFFF）';
    errorEl.hidden = false;
    result.hidden = true;
    return;
  }

  let ch;
  try {
    ch = String.fromCodePoint(cp);
  } catch {
    errorEl.textContent = '无效码点（超出 Unicode 范围 0 - 10FFFF）';
    errorEl.hidden = false;
    result.hidden = true;
    return;
  }

  const utf8 = getUtf8Bytes(ch);
  const utf16 = getUtf16Units(ch);
  const cls = classifyChar(ch);
  const block = findBlock(cp);
  const surrogate = ch.length === 2;

  // 大字符预览
  document.getElementById('cp-preview').textContent = visibleChar(ch);

  // 详细信息
  setInfo('cp', `${formatCodepoint(cp)}（十进制 ${cp}）`);
  setInfo('utf8', `${utf8.length} 字节 ${bytesToHex(utf8)}`);
  setInfo('utf16', `${utf16.length} 单元 ${unitsToHex(utf16)}`);
  setInfo('utf32', `4 字节 ${bytesToHex(toUtf32Bytes(cp))}`);
  setInfo('html-entity', toHtmlEntity(cp));
  setInfo('css-escape', toCssEscape(cp));
  setInfo('js-escape', toJsEscape(ch));
  setInfo('url-encode', encodeURIComponent(ch));
  setInfo('json-escape', toJsEscape(ch));
  setInfo('classify', cls);
  setInfo('surrogate', surrogate ? '是（代理对）' : '否');
  setInfo('block', block ? block.name : '未知');

  result.hidden = false;
}

function setInfo(id, value) {
  const el = document.getElementById(`info-${id}`);
  if (el) el.textContent = value;
}

/* ========== Tab 3: 字符块浏览 ========== */
let currentBlock = UNICODE_BLOCKS[0];
let currentPage = 0;
const PAGE_SIZE = 256;

function renderBlockList() {
  const list = document.getElementById('block-list');
  list.innerHTML = UNICODE_BLOCKS.map(
    (b, i) => `
    <button class="block-btn${b === currentBlock ? ' block-btn--active' : ''}" data-idx="${i}">
      ${escapeHtml(b.name)}
    </button>
  `,
  ).join('');

  list.querySelectorAll('.block-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentBlock = UNICODE_BLOCKS[parseInt(btn.dataset.idx, 10)];
      currentPage = 0;
      // 更新激活状态
      list.querySelectorAll('.block-btn').forEach((b) => b.classList.remove('block-btn--active'));
      btn.classList.add('block-btn--active');
      renderBlockGrid();
    });
  });
}

function renderBlockGrid() {
  const total = currentBlock.end - currentBlock.start + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages - 1);

  const start = currentBlock.start + currentPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE - 1, currentBlock.end);

  // 块信息：名称 + 范围 + 总数
  document.getElementById('block-info').textContent =
    `${currentBlock.name} · ` +
    `U+${currentBlock.start.toString(16).toUpperCase().padStart(4, '0')} - ` +
    `U+${currentBlock.end.toString(16).toUpperCase().padStart(4, '0')} · ` +
    `共 ${total} 字符`;

  // 字符网格（16 列）
  const grid = document.getElementById('block-grid');
  const cells = [];
  for (let cp = start; cp <= end; cp++) {
    const ch = String.fromCodePoint(cp);
    const tooltip = `${formatCodepoint(cp)} ${ch}`;
    cells.push(`
      <button class="grid-cell" data-cp="${cp}" title="${escapeHtml(tooltip)}">
        ${escapeHtml(visibleChar(ch))}
      </button>
    `);
  }
  grid.innerHTML = cells.join('');

  // 点击字符复制
  grid.querySelectorAll('.grid-cell').forEach((cell) => {
    cell.addEventListener('click', async () => {
      const cp = parseInt(cell.dataset.cp, 10);
      const ch = String.fromCodePoint(cp);
      const ok = await copyText(ch);
      if (ok) flashGridCell(cell);
    });
  });

  // 分页控件
  const pagination = document.getElementById('block-pagination');
  if (totalPages > 1) {
    pagination.hidden = false;
    document.getElementById('page-info').textContent = `${currentPage + 1} / ${totalPages}`;
    document.getElementById('btn-prev-page').disabled = currentPage === 0;
    document.getElementById('btn-next-page').disabled = currentPage === totalPages - 1;
  } else {
    pagination.hidden = true;
  }
}

/* ========== 初始化 ========== */
function initUnicode() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // Tab 1: 输入防抖
  document.getElementById('analyze-input').addEventListener('input', scheduleAnalyze);

  // Tab 2: 查询按钮 + 回车
  document.getElementById('btn-cp-query').addEventListener('click', queryCodepoint);
  document.getElementById('cp-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      queryCodepoint();
    }
  });

  // Tab 2: 复制按钮（按 data-copy 取对应信息）
  document.querySelectorAll('#panel-codepoint .meta-btn[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.copy;
      const value = document.getElementById(`info-${key}`)?.textContent || '';
      const ok = await copyText(value);
      if (ok) flashCopyBtn(btn);
    });
  });

  // Tab 3: 渲染块列表 + 网格
  renderBlockList();
  renderBlockGrid();

  // Tab 3: 分页按钮
  document.getElementById('btn-prev-page').addEventListener('click', () => {
    if (currentPage > 0) {
      currentPage--;
      renderBlockGrid();
    }
  });
  document.getElementById('btn-next-page').addEventListener('click', () => {
    currentPage++;
    renderBlockGrid();
  });
}

export { initUnicode };
