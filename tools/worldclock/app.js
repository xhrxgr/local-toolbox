/**
 * 世界时间工具核心逻辑
 * - 多时区实时显示（每秒更新）
 * - 用户自定义时区列表（增/删）
 * - 全局「显示毫秒」开关
 * - localStorage 持久化：时区列表 + 毫秒偏好 + 浏览器时区
 */

const STORAGE_KEY = 'worldclock-state-v1';
const MS_KEY = 'worldclock-show-ms-v1';

// 常用时区预设（含中文显示名）
const COMMON_TIMEZONES = [
  { id: 'Asia/Shanghai',         name: '北京 / 上海',   offset: '+08:00' },
  { id: 'Asia/Hong_Kong',        name: '香港',         offset: '+08:00' },
  { id: 'Asia/Taipei',           name: '台北',         offset: '+08:00' },
  { id: 'Asia/Tokyo',            name: '东京',         offset: '+09:00' },
  { id: 'Asia/Seoul',            name: '首尔',         offset: '+09:00' },
  { id: 'Asia/Singapore',        name: '新加坡',       offset: '+08:00' },
  { id: 'Asia/Bangkok',          name: '曼谷',         offset: '+07:00' },
  { id: 'Asia/Dubai',            name: '迪拜',         offset: '+04:00' },
  { id: 'Asia/Kolkata',          name: '孟买',         offset: '+05:30' },
  { id: 'Europe/Moscow',         name: '莫斯科',       offset: '+03:00' },
  { id: 'Europe/London',         name: '伦敦',         offset: '+00:00' },
  { id: 'Europe/Paris',          name: '巴黎',         offset: '+01:00' },
  { id: 'Europe/Berlin',         name: '柏林',         offset: '+01:00' },
  { id: 'Europe/Istanbul',       name: '伊斯坦布尔',   offset: '+03:00' },
  { id: 'Africa/Cairo',          name: '开罗',         offset: '+02:00' },
  { id: 'America/New_York',      name: '纽约',         offset: '-05:00' },
  { id: 'America/Chicago',       name: '芝加哥',       offset: '-06:00' },
  { id: 'America/Denver',        name: '丹佛',         offset: '-07:00' },
  { id: 'America/Los_Angeles',   name: '洛杉矶',       offset: '-08:00' },
  { id: 'America/Sao_Paulo',     name: '圣保罗',       offset: '-03:00' },
  { id: 'America/Mexico_City',   name: '墨西哥城',     offset: '-06:00' },
  { id: 'Australia/Sydney',      name: '悉尼',         offset: '+11:00' },
  { id: 'Australia/Perth',       name: '珀斯',         offset: '+08:00' },
  { id: 'Pacific/Auckland',      name: '奥克兰',       offset: '+13:00' },
  { id: 'Pacific/Honolulu',      name: '檀香山',       offset: '-10:00' },
];

// 状态
const state = {
  zones: [], // ['Asia/Shanghai', 'Europe/London', ...]
  showMs: false,
  browserTz: '', // 自动检测的浏览器时区
};

let timerId = 0;
let listEl, showMsToggle, tzSelect, btnAddTz;
let fsEl, fsCloseBtn, fsNameEl, fsTzidEl, fsTimeEl, fsOffsetEl, fsPeriodEl;
let fsTimerId = 0;
let fsCurrentTz = ''; // 当前全屏显示的时区

function pad(n) { return String(n).padStart(2, '0'); }

/* ========== 持久化 ========== */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ zones: state.zones }));
  } catch {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p.zones)) {
        state.zones = p.zones.filter(z => typeof z === 'string' && z.length > 0);
      }
    }
  } catch {}
  try {
    state.showMs = localStorage.getItem(MS_KEY) === '1';
  } catch {}
  // 检测浏览器时区
  try {
    state.browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch { state.browserTz = ''; }
}

/* ========== 渲染 ========== */
function getZoneInfo(tzId) {
  // 先查常用预设
  const common = COMMON_TIMEZONES.find(z => z.id === tzId);
  if (common) return common;
  // 否则生成友好名
  let cityName = tzId.split('/').pop().replace(/_/g, ' ');
  // 浏览器时区标记
  if (tzId === state.browserTz) cityName += ' (本机)';
  // 计算当前 offset
  const offset = getCurrentOffset(tzId);
  return { id: tzId, name: cityName, offset };
}

function getCurrentOffset(tzId) {
  try {
    const d = new Date();
    const utc = d.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
    const local = d.toLocaleString('en-US', { timeZone: tzId, hour12: false });
    const utcDate = new Date(utc);
    const localDate = new Date(local);
    const diffMin = Math.round((localDate - utcDate) / 60000);
    const sign = diffMin >= 0 ? '+' : '-';
    const abs = Math.abs(diffMin);
    return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  } catch { return ''; }
}

function formatTimeInZone(tzId, withMs) {
  try {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tzId,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = t => parts.find(p => p.type === t)?.value || '00';
    let s = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
    if (withMs) s += `.${pad(d.getMilliseconds())}`;
    return s;
  } catch { return '—'; }
}

function getDayPeriod(tzId) {
  // 今日 vs 昨日/明日（相对于本地时区）
  try {
    const d = new Date();
    const localDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const localInTarget = new Date(d.toLocaleString('en-US', { timeZone: tzId, hour12: false }));
    const targetDay = new Date(localInTarget.getFullYear(), localInTarget.getMonth(), localInTarget.getDate()).getTime();
    const diffDays = Math.round((targetDay - localDay) / 86400000);
    if (diffDays === 0) return { label: '今天', color: 'today' };
    if (diffDays === 1) return { label: '明天', color: 'tomorrow' };
    if (diffDays === -1) return { label: '昨天', color: 'yesterday' };
    if (diffDays > 1) return { label: `+${diffDays}天`, color: 'future' };
    return { label: `${diffDays}天`, color: 'past' };
  } catch { return { label: '', color: '' }; }
}

function renderList() {
  if (state.zones.length === 0) {
    listEl.innerHTML = '<div class="empty-state">点击右上角"添加时区"开始</div>';
    return;
  }
  listEl.innerHTML = state.zones.map(tzId => {
    const info = getZoneInfo(tzId);
    const period = getDayPeriod(tzId);
    return `
      <div class="clock-card glass" data-tz="${tzId}">
        <div class="clock-card__head">
          <div class="clock-card__title">
            <h3 class="clock-card__name">${info.name}</h3>
            <span class="clock-card__tzid">${tzId}</span>
          </div>
          <button class="clock-card__remove" data-action="remove" data-tz="${tzId}" title="移除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="clock-card__time" data-time>—</div>
        <div class="clock-card__meta">
          <span class="clock-card__offset">UTC ${info.offset}</span>
          <span class="clock-card__period clock-card__period--${period.color}">${period.label}</span>
        </div>
      </div>
    `;
  }).join('');

  // 绑定删除
  listEl.querySelectorAll('[data-action="remove"]').forEach(btn => {
    btn.addEventListener('click', () => removeZone(btn.dataset.tz));
  });

  // 绑定点击时间元素 → 全屏显示
  listEl.querySelectorAll('.clock-card__time').forEach(timeEl => {
    timeEl.addEventListener('click', () => {
      const card = timeEl.closest('.clock-card');
      if (card) openFullscreen(card.dataset.tz);
    });
  });
}

function updateTimes() {
  state.zones.forEach(tzId => {
    const card = listEl.querySelector(`.clock-card[data-tz="${CSS.escape(tzId)}"]`);
    if (!card) return;
    const timeEl = card.querySelector('[data-time]');
    timeEl.textContent = formatTimeInZone(tzId, state.showMs);
  });
}

function cancelTimer() {
  if (timerId) {
    // 兼容 setTimeout（number）和 requestAnimationFrame（number）
    clearTimeout(timerId);
    cancelAnimationFrame(timerId);
    timerId = 0;
  }
}

function tick() {
  updateTimes();
  // 开启毫秒时用 RAF 60fps 刷新；否则对齐秒边界每秒刷新
  if (state.showMs) {
    timerId = requestAnimationFrame(tick);
  } else {
    timerId = setTimeout(tick, 1000 - (Date.now() % 1000));
  }
}

/* ========== 全屏显示 ========== */
function updateFsTime() {
  if (!fsCurrentTz) return;
  const info = getZoneInfo(fsCurrentTz);
  const period = getDayPeriod(fsCurrentTz);
  fsNameEl.textContent = info.name;
  fsTzidEl.textContent = fsCurrentTz;
  // 拆成两行：日期 / 时间（含毫秒），保证大字号下不溢出屏幕
  const _t = formatTimeInZone(fsCurrentTz, state.showMs);
  const _i = _t.indexOf(' ');
  if (_i > 0) {
    fsTimeEl.innerHTML = `<div class="fs-time__date">${_t.slice(0, _i)}</div><div class="fs-time__clock">${_t.slice(_i + 1)}</div>`;
  } else {
    fsTimeEl.textContent = _t;
  }
  fsOffsetEl.textContent = `UTC ${info.offset}`;
  fsPeriodEl.textContent = period.label;
  // 重设颜色 class
  fsPeriodEl.className = 'fullscreen-clock__period fullscreen-clock__period--' + period.color;
}

function fsTick() {
  updateFsTime();
  // 全屏内同样根据毫秒开关选择刷新频率
  if (state.showMs) {
    fsTimerId = requestAnimationFrame(fsTick);
  } else {
    fsTimerId = setTimeout(fsTick, 1000 - (Date.now() % 1000));
  }
}

function cancelFsTimer() {
  if (fsTimerId) {
    clearTimeout(fsTimerId);
    cancelAnimationFrame(fsTimerId);
    fsTimerId = 0;
  }
}

function openFullscreen(tzId) {
  if (!tzId) return;
  fsCurrentTz = tzId;
  updateFsTime();
  fsEl.hidden = false;
  cancelFsTimer();
  fsTick();
}

function closeFullscreen() {
  fsEl.hidden = true;
  fsCurrentTz = '';
  cancelFsTimer();
}

/* ========== 操作 ========== */
function addZone(tzId) {
  if (!tzId || state.zones.includes(tzId)) return;
  state.zones.push(tzId);
  saveState();
  renderList();
  updateTimes();
}

function removeZone(tzId) {
  state.zones = state.zones.filter(z => z !== tzId);
  saveState();
  renderList();
  updateTimes();
}

function populateTzSelect() {
  // 收集所有可用时区：常用预设 + 浏览器时区（如果不在常用中）
  const all = new Map();
  COMMON_TIMEZONES.forEach(z => all.set(z.id, z));
  if (state.browserTz && !all.has(state.browserTz)) {
    const cityName = state.browserTz.split('/').pop().replace(/_/g, ' ') + ' (本机)';
    all.set(state.browserTz, { id: state.browserTz, name: cityName, offset: getCurrentOffset(state.browserTz) });
  }
  // 按 offset + 名称排序
  const list = [...all.values()].sort((a, b) => {
    if (a.offset !== b.offset) return a.offset.localeCompare(b.offset);
    return a.name.localeCompare(b.name);
  });
  tzSelect.innerHTML = '<option value="">— 选择时区 —</option>' +
    list.map(z => `<option value="${z.id}">${z.name} (UTC ${z.offset})</option>`).join('');
}

/* ========== 初始化 ========== */
function initWorldclock() {
  listEl = document.getElementById('clocks-list');
  showMsToggle = document.getElementById('show-ms');
  tzSelect = document.getElementById('tz-select');
  btnAddTz = document.getElementById('btn-add-tz');

  // 全屏元素
  fsEl = document.getElementById('fullscreen-clock');
  fsCloseBtn = document.getElementById('fs-close');
  fsNameEl = document.getElementById('fs-name');
  fsTzidEl = document.getElementById('fs-tzid');
  fsTimeEl = document.getElementById('fs-time');
  fsOffsetEl = document.getElementById('fs-offset');
  fsPeriodEl = document.getElementById('fs-period');

  loadState();

  // 默认时区：浏览器时区 + 北京
  if (state.zones.length === 0) {
    state.zones = ['Asia/Shanghai'];
    if (state.browserTz && state.browserTz !== 'Asia/Shanghai') {
      state.zones.push(state.browserTz);
    }
    saveState();
  }

  // 恢复毫秒开关
  showMsToggle.checked = state.showMs;

  populateTzSelect();
  renderList();
  tick();

  // 事件
  showMsToggle.addEventListener('change', () => {
    state.showMs = showMsToggle.checked;
    try { localStorage.setItem(MS_KEY, state.showMs ? '1' : '0'); } catch {}
    // 重启两个定时器：列表 + 全屏（若开启）
    cancelTimer();
    tick();
    if (!fsEl.hidden) {
      cancelFsTimer();
      fsTick();
    }
  });

  btnAddTz.addEventListener('click', () => {
    const tzId = tzSelect.value;
    if (!tzId) return;
    addZone(tzId);
    tzSelect.value = '';
  });

  // 全屏事件
  fsCloseBtn.addEventListener('click', closeFullscreen);
  // 点击空白处关闭（点击内容区不关闭）
  fsEl.addEventListener('click', e => {
    if (e.target === fsEl) closeFullscreen();
  });
  // ESC 关闭
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !fsEl.hidden) closeFullscreen();
  });
}

export { initWorldclock };
