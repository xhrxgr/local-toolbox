/**
 * 秒表核心逻辑
 * - performance.now() + requestAnimationFrame 高精度计时（毫秒级）
 * - 计次记录：总时间 + 分段时间
 * - 最佳（最短分段）/最差（最长分段）高亮（≥3 次才高亮）
 * - CSV 导出
 * - localStorage 持久化（刷新恢复）
 */

const STORAGE_KEY = 'stopwatch-state-v1';
const MAX_LAPS = 999;
const PAGE_TITLE = '秒表 - 网页工具箱';

// 状态机
const state = {
  elapsedMs: 0,         // 累计已运行毫秒（暂停时已结算）
  running: false,
  startTimestamp: 0,    // performance.now() 启动时刻
  wallStart: 0,         // Date.now() 启动时刻（用于刷新恢复）
  laps: [],             // [{ totalMs, splitMs, timestamp }]
};

let rafId = 0;

// DOM 引用
let digitsEl, statusEl, btnStart, btnStartText, btnLap, btnReset, btnExport, btnClearLaps, lapList;

/* ========== 时间格式化 ========== */
function pad(n) { return String(n).padStart(2, '0'); }

function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mss = Math.floor(ms) % 1000; // 毫秒（3 位固定，与倒计时统一）
  return `${pad(h)}:${pad(m)}:${pad(s)}.${String(mss).padStart(3, '0')}`;
}

/* ========== 持久化 ========== */
function saveState() {
  try {
    const persisted = {
      elapsedMs: state.running ? state.elapsedMs + (performance.now() - state.startTimestamp) : state.elapsedMs,
      running: state.running,
      startTimestamp: state.startTimestamp,
      wallStart: state.wallStart,
      laps: state.laps,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw);
    state.elapsedMs = (typeof p.elapsedMs === 'number' && p.elapsedMs >= 0 && isFinite(p.elapsedMs)) ? p.elapsedMs : 0;
    state.laps = Array.isArray(p.laps) ? p.laps.filter(l => l && typeof l.totalMs === 'number' && typeof l.splitMs === 'number' && isFinite(l.totalMs) && isFinite(l.splitMs)) : [];
    if (p.running && typeof p.wallStart === 'number' && p.wallStart > 0) {
      // 刷新恢复：用 wall clock 计算刷新期间流失的时间
      const wallElapsed = Date.now() - p.wallStart;
      state.running = true;
      state.startTimestamp = performance.now();
      state.wallStart = p.wallStart;
      // 已累计的（不含刷新期间）+ 刷新期间也计入运行时间
      state.elapsedMs = p.elapsedMs + wallElapsed;
      // 注意：startTimestamp 设为现在，elapsedMs 已经包含刷新期间
      // 这样后续 tick 计算 currentElapsed = elapsedMs + (now - startTimestamp) 会从刷新点继续
    } else {
      state.running = false;
    }
    return true;
  } catch { return false; }
}

/* ========== 主循环 ========== */
function tick() {
  if (!state.running) return;
  const now = performance.now();
  const currentElapsed = state.elapsedMs + (now - state.startTimestamp);
  if (!isFinite(currentElapsed)) return;
  render(currentElapsed);
  rafId = requestAnimationFrame(tick);
}

function getCurrentElapsed() {
  if (state.running) {
    return state.elapsedMs + (performance.now() - state.startTimestamp);
  }
  return state.elapsedMs;
}

/* ========== 控制 ========== */
function start() {
  if (state.running) return;
  state.running = true;
  state.startTimestamp = performance.now();
  state.wallStart = Date.now();
  rafId = requestAnimationFrame(tick);
  updateButtons();
  saveState();
}

function pause() {
  if (!state.running) return;
  state.running = false;
  cancelAnimationFrame(rafId);
  state.elapsedMs += performance.now() - state.startTimestamp;
  state.startTimestamp = 0;
  state.wallStart = 0;
  render(state.elapsedMs);
  updateButtons();
  saveState();
}

function toggleStartPause() {
  if (state.running) pause();
  else start();
}

function lap() {
  if (!state.running) return;
  if (state.laps.length >= MAX_LAPS) {
    alert('已达计次上限（' + MAX_LAPS + ' 次）');
    return;
  }
  const totalMs = getCurrentElapsed();
  const prevTotal = state.laps.length > 0 ? state.laps[state.laps.length - 1].totalMs : 0;
  state.laps.push({
    totalMs,
    splitMs: totalMs - prevTotal,
    timestamp: Date.now(),
  });
  renderLaps();
  saveState();
}

function deleteLap(index) {
  if (index < 0 || index >= state.laps.length) return;
  // 删除中间计次会重算后续分段时间
  const deleted = state.laps.splice(index, 1)[0];
  // 重新计算后续 split
  if (index < state.laps.length) {
    const prevTotal = index > 0 ? state.laps[index - 1].totalMs : 0;
    state.laps[index].splitMs = state.laps[index].totalMs - prevTotal;
    for (let i = index + 1; i < state.laps.length; i++) {
      state.laps[i].splitMs = state.laps[i].totalMs - state.laps[i - 1].totalMs;
    }
  }
  renderLaps();
  saveState();
}

function clearLaps() {
  state.laps = [];
  renderLaps();
  saveState();
}

function reset() {
  state.running = false;
  cancelAnimationFrame(rafId);
  state.elapsedMs = 0;
  state.startTimestamp = 0;
  state.wallStart = 0;
  state.laps = [];
  render(0);
  renderLaps();
  updateButtons();
  saveState();
}

/* ========== 渲染 ========== */
function render(ms) {
  digitsEl.textContent = formatTime(ms);
  if (state.running) {
    statusEl.textContent = '运行中';
    statusEl.classList.remove('timer-status--paused');
  } else if (ms > 0) {
    statusEl.textContent = '已暂停';
    statusEl.classList.add('timer-status--paused');
  } else {
    statusEl.textContent = '就绪';
    statusEl.classList.remove('timer-status--paused');
  }
}

function renderLaps() {
  if (state.laps.length === 0) {
    lapList.innerHTML = '<div class="lap-empty">暂无计次记录，运行秒表后点击"计次"按钮记录</div>';
    btnExport.disabled = true;
    btnClearLaps.disabled = true;
    return;
  }

  btnExport.disabled = false;
  btnClearLaps.disabled = false;

  // 计算最佳/最差（≥3 次才高亮）
  let bestIdx = -1, worstIdx = -1;
  if (state.laps.length >= 3) {
    let minSplit = Infinity, maxSplit = -Infinity;
    state.laps.forEach((l, i) => {
      if (l.splitMs < minSplit) { minSplit = l.splitMs; bestIdx = i; }
      if (l.splitMs > maxSplit) { maxSplit = l.splitMs; worstIdx = i; }
    });
    // 所有 split 相等则不高亮任何条目
    if (minSplit === maxSplit) {
      bestIdx = -1;
      worstIdx = -1;
    }
  }

  // 倒序显示（最新在最上方）
  const html = state.laps.slice().reverse().map((l, revIdx) => {
    const idx = state.laps.length - 1 - revIdx;
    const classes = ['lap-item'];
    if (idx === bestIdx) classes.push('lap-item--best');
    if (idx === worstIdx) classes.push('lap-item--worst');
    const tag = idx === bestIdx ? '<span class="lap-tag lap-tag--best">最快</span>'
              : idx === worstIdx ? '<span class="lap-tag lap-tag--worst">最慢</span>'
              : '';
    return `
      <div class="${classes.join(' ')}" data-index="${idx}">
        <span class="lap-index">#${idx + 1}</span>
        <span class="lap-split">${formatTime(l.splitMs)}</span>
        <span class="lap-total">${formatTime(l.totalMs)}</span>
        ${tag}
        <button class="lap-delete" data-action="delete" data-index="${idx}" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  }).join('');

  lapList.innerHTML = html;

  // 绑定删除按钮
  lapList.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteLap(parseInt(btn.dataset.index));
    });
  });
}

function updateButtons() {
  if (state.running) {
    btnStartText.textContent = '暂停';
    btnStart.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    btnLap.disabled = false;
  } else {
    btnStartText.textContent = '开始';
    btnStart.querySelector('svg').innerHTML = '<polygon points="6 4 20 12 6 20 6 4"/>';
    btnLap.disabled = true;
  }
  btnReset.disabled = state.elapsedMs === 0 && state.laps.length === 0 && !state.running;
}

/* ========== CSV 导出 ========== */
function exportCsv() {
  if (state.laps.length === 0) return;
  const rows = [['序号', '总时间', '分段时间', '绝对时间戳']];
  state.laps.forEach((l, i) => {
    rows.push([
      i + 1,
      formatTime(l.totalMs),
      formatTime(l.splitMs),
      new Date(l.timestamp).toISOString(),
    ]);
  });
  const csv = '\ufeff' + rows.map(r => r.join(',')).join('\n'); // BOM 防 Excel 乱码
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `stopwatch-laps-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ========== 键盘快捷键 ========== */
function isTypingInInput() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

function onKeydown(e) {
  if (isTypingInInput()) return;
  if (e.code === 'Space') {
    e.preventDefault();
    toggleStartPause();
  } else if (e.key === 'l' || e.key === 'L') {
    e.preventDefault();
    lap();
  } else if (e.key === 'r' || e.key === 'R') {
    reset();
  }
}

/* ========== 初始化 ========== */
function initStopwatch() {
  digitsEl = document.getElementById('timer-digits');
  statusEl = document.getElementById('timer-status');
  btnStart = document.getElementById('btn-start');
  btnStartText = document.getElementById('btn-start-text');
  btnLap = document.getElementById('btn-lap');
  btnReset = document.getElementById('btn-reset');
  btnExport = document.getElementById('btn-export');
  btnClearLaps = document.getElementById('btn-clear-laps');
  lapList = document.getElementById('lap-list');

  loadState();

  render(getCurrentElapsed());
  renderLaps();
  updateButtons();

  // 如果刷新前在运行，继续
  if (state.running) {
    rafId = requestAnimationFrame(tick);
  }

  // 事件绑定
  btnStart.addEventListener('click', toggleStartPause);
  btnLap.addEventListener('click', lap);
  btnReset.addEventListener('click', reset);
  btnExport.addEventListener('click', exportCsv);
  btnClearLaps.addEventListener('click', clearLaps);

  window.addEventListener('keydown', onKeydown);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveState();
  });
}

export { initStopwatch };
