/**
 * 倒计时核心逻辑
 * - performance.now() + requestAnimationFrame 高精度计时
 * - SVG 圆环进度
 * - 到期多通道提醒：Web Audio 蜂鸣 + Notification + 标题闪烁
 * - 到期后超时计数（继续显示 +MM:SS）
 * - localStorage 持久化（刷新恢复）
 */

const STORAGE_KEY = 'countdown-state-v1';
const MS_TOGGLE_KEY = 'countdown-show-ms-v1';
const DEFAULT_MS = 25 * 60 * 1000; // 默认 25 分钟番茄钟
const RING_RADIUS = 148;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const PAGE_TITLE = '倒计时 - 网页工具箱';

// 状态机
const state = {
  totalMs: DEFAULT_MS,
  remainingMs: DEFAULT_MS,
  savedRemainingMs: DEFAULT_MS, // 启动时刻的快照
  running: false,
  startTimestamp: 0,
  expired: false, // 是否已到期（进入超时计数）
};

let rafId = 0;
let titleFlashTimer = 0;
let audioCtx = null;

// DOM 引用（initCountdown 中赋值）
let ringFill, digitsEl, statusEl, btnStart, btnStartText, btnReset;
let inputHours, inputMinutes, inputSeconds;
let showMsToggle;

/* ========== 时间格式化 ========== */
function pad(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }

function formatTime(ms, highPrecision) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (highPrecision) {
    const msPart = Math.floor(ms % 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad3(msPart)}`;
  }
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatOvertime(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `+${pad(h)}:${pad(m)}:${pad(s)}`;
}

/* ========== 持久化 ========== */
function saveState() {
  try {
    const persisted = {
      totalMs: state.totalMs,
      remainingMs: state.running ? state.savedRemainingMs - (performance.now() - state.startTimestamp) : state.remainingMs,
      running: state.running,
      startTimestamp: state.startTimestamp,
      savedRemainingMs: state.savedRemainingMs,
      expired: state.expired,
      // 用 Date.now() 做相对锚点，performance.now() 重载后会归零
      wallStart: state.running ? Date.now() : 0,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw);
    if (typeof p.totalMs !== 'number' || p.totalMs <= 0) return false;
    state.totalMs = p.totalMs;
    // 字段类型校验
    if (typeof p.expired !== 'boolean') p.expired = false;
    const canRestoreRunning = p.running
      && typeof p.savedRemainingMs === 'number' && p.savedRemainingMs >= 0
      && typeof p.wallStart === 'number' && p.wallStart > 0;
    if (canRestoreRunning) {
      // 计算刷新期间流失的时间
      const wallElapsed = Date.now() - p.wallStart;
      const remaining = p.savedRemainingMs - wallElapsed;
      if (remaining > 0) {
        state.running = true;
        state.startTimestamp = performance.now();
        state.savedRemainingMs = remaining;
        state.remainingMs = remaining;
        state.expired = false;
      } else {
        // 刷新期间已到期 → 进入超时计数
        state.running = true;
        state.expired = true;
        state.startTimestamp = performance.now();
        state.savedRemainingMs = 0;
        state.remainingMs = 0;
        // 超时起点 = 应到期时刻
        const overtimeMs = -remaining;
        state.startTimestamp = performance.now() - overtimeMs;
      }
    } else {
      state.remainingMs = p.remainingMs > 0 ? p.remainingMs : p.totalMs;
      state.running = false;
      state.expired = false;
    }
    // 恢复后检查 NaN，异常则重置为默认状态
    if (isNaN(state.remainingMs) || isNaN(state.startTimestamp)) {
      state.running = false;
      state.expired = false;
      state.remainingMs = state.totalMs;
      state.savedRemainingMs = state.totalMs;
      state.startTimestamp = 0;
    }
    return true;
  } catch { return false; }
}

/* ========== 主循环 ========== */
function tick() {
  if (!state.running) return;
  const now = performance.now();
  const elapsed = now - state.startTimestamp;

  if (state.expired) {
    // 超时计数模式
    state.remainingMs = elapsed; // 用 remainingMs 字段存超时毫秒
  } else {
    state.remainingMs = state.savedRemainingMs - elapsed;
    if (state.remainingMs <= 0) {
      state.remainingMs = 0;
      state.expired = true;
      onExpire();
      // 切换到超时计数
      state.startTimestamp = now;
      state.savedRemainingMs = 0;
      updateButtons(); // 到期瞬间更新按钮状态
    }
  }

  render();
  saveState();
  rafId = requestAnimationFrame(tick);
}

/* ========== 控制 ========== */
function start() {
  if (state.running) return;
  if (state.remainingMs <= 0 && !state.expired) return;
  if (state.expired) {
    // 已超时，不允许继续"开始"，需先重置
    return;
  }
  // 申请通知权限（首次）
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  state.running = true;
  state.startTimestamp = performance.now();
  state.savedRemainingMs = state.remainingMs;
  rafId = requestAnimationFrame(tick);
  updateButtons();
  saveState();
}

function pause() {
  if (!state.running) return;
  state.running = false;
  cancelAnimationFrame(rafId);
  // remainingMs 已在 tick 中更新，但需重新渲染以更新状态文字
  render();
  updateButtons();
  saveState();
}

function toggleStartPause() {
  if (state.expired) {
    // 超时模式：允许暂停/继续超时计数
    if (state.running) {
      pause();
    } else {
      // 继续超时计数：startTimestamp 往前推 remainingMs，保持已超时毫秒
      state.running = true;
      state.startTimestamp = performance.now() - state.remainingMs;
      rafId = requestAnimationFrame(tick);
      updateButtons();
      saveState();
    }
    return;
  }
  if (state.running) pause();
  else start();
}

function reset() {
  state.running = false;
  state.expired = false;
  state.remainingMs = state.totalMs;
  state.savedRemainingMs = state.totalMs;
  cancelAnimationFrame(rafId);
  stopTitleFlash();
  document.title = PAGE_TITLE;
  render();
  updateButtons();
  saveState();
}

function setDuration(ms) {
  if (state.running) return; // 运行中不允许修改
  if (ms <= 0) return;
  state.totalMs = ms;
  state.remainingMs = ms;
  state.savedRemainingMs = ms;
  state.expired = false;
  render();
  saveState();
}

/* ========== 到期提醒 ========== */
function onExpire() {
  playBeep();
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('⏰ 倒计时结束', { body: '时间到了！', silent: false });
    } catch {}
  } else if ('Notification' in window && Notification.permission !== 'granted') {
    console.warn('倒计时结束，但通知权限未授予（' + Notification.permission + '），无法弹出桌面通知');
  }
  startTitleFlash();
}

function playBeep() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // 3 短声 880Hz
    for (let i = 0; i < 3; i++) {
      const t0 = audioCtx.currentTime + i * 0.4;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.3, t0 + 0.05);
      gain.gain.linearRampToValueAtTime(0, t0 + 0.3);
      osc.start(t0);
      osc.stop(t0 + 0.35);
    }
  } catch {}
}

function startTitleFlash() {
  let toggle = false;
  stopTitleFlash();
  titleFlashTimer = setInterval(() => {
    toggle = !toggle;
    document.title = toggle ? '⏰ 时间到！' : PAGE_TITLE;
  }, 800);
}

function stopTitleFlash() {
  if (titleFlashTimer) {
    clearInterval(titleFlashTimer);
    titleFlashTimer = 0;
  }
  document.title = PAGE_TITLE;
}

/* ========== 渲染 ========== */
function render() {
  const ratio = state.expired
    ? 1
    : Math.max(0, Math.min(1, state.remainingMs / state.totalMs));
  ringFill.style.strokeDasharray = RING_CIRCUMFERENCE;
  ringFill.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - ratio);

  // 是否显示毫秒：用户开关 OR 超时模式（超时统一不显示毫秒）
  const showMs = showMsToggle && showMsToggle.checked;
  if (state.expired) {
    digitsEl.textContent = formatOvertime(state.remainingMs);
    digitsEl.classList.add('timer-digits--expired');
    digitsEl.classList.remove('timer-digits--with-ms');
    ringFill.classList.add('timer-ring__fill--expired');
    statusEl.textContent = '已超时';
    statusEl.classList.add('timer-status--expired');
  } else {
    digitsEl.textContent = formatTime(state.remainingMs, showMs);
    if (showMs) digitsEl.classList.add('timer-digits--with-ms');
    else digitsEl.classList.remove('timer-digits--with-ms');
    digitsEl.classList.remove('timer-digits--expired');
    ringFill.classList.remove('timer-ring__fill--expired');
    if (state.running) {
      statusEl.textContent = '运行中';
      statusEl.classList.remove('timer-status--expired');
    } else if (state.remainingMs === state.totalMs) {
      statusEl.textContent = '就绪';
      statusEl.classList.remove('timer-status--expired');
    } else {
      statusEl.textContent = '已暂停';
      statusEl.classList.remove('timer-status--expired');
    }
  }
}

function updateButtons() {
  if (state.expired) {
    // 超时模式：允许暂停/继续超时计数
    btnStart.disabled = false;
    if (state.running) {
      btnStartText.textContent = '暂停';
      btnStart.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    } else {
      btnStartText.textContent = '继续';
      btnStart.querySelector('svg').innerHTML = '<polygon points="6 4 20 12 6 20 6 4"/>';
    }
  } else if (state.running) {
    btnStart.disabled = false;
    btnStartText.textContent = '暂停';
    btnStart.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  } else {
    btnStart.disabled = state.remainingMs <= 0;
    btnStartText.textContent = '开始';
    btnStart.querySelector('svg').innerHTML = '<polygon points="6 4 20 12 6 20 6 4"/>';
  }
  // 重置按钮：仅"初始未运行"状态 disabled，运行/暂停/超时 都可重置
  btnReset.disabled = (!state.running && !state.expired && state.remainingMs === state.totalMs);
}

/* ========== 自定义时长输入同步 ========== */
function syncInputsFromState() {
  const totalSec = Math.floor(state.totalMs / 1000);
  inputHours.value = Math.floor(totalSec / 3600);
  inputMinutes.value = Math.floor((totalSec % 3600) / 60);
  inputSeconds.value = totalSec % 60;
}

function readInputsToMs() {
  const h = Math.max(0, parseInt(inputHours.value) || 0);
  const m = Math.max(0, parseInt(inputMinutes.value) || 0);
  const s = Math.max(0, parseInt(inputSeconds.value) || 0);
  return (h * 3600 + m * 60 + s) * 1000;
}

/* ========== 预设按钮 ========== */
function clearPresetActive() {
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('preset-btn--active'));
}

function findPresetByMs(ms) {
  return document.querySelector(`.preset-btn[data-min="${Math.floor(ms / 60000)}"]`);
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
  } else if (e.key === 'r' || e.key === 'R') {
    reset();
  }
}

/* ========== 初始化 ========== */
function initCountdown() {
  ringFill = document.getElementById('ring-fill');
  digitsEl = document.getElementById('timer-digits');
  statusEl = document.getElementById('timer-status');
  btnStart = document.getElementById('btn-start');
  btnStartText = document.getElementById('btn-start-text');
  btnReset = document.getElementById('btn-reset');
  inputHours = document.getElementById('input-hours');
  inputMinutes = document.getElementById('input-minutes');
  inputSeconds = document.getElementById('input-seconds');
  showMsToggle = document.getElementById('show-ms');

  // 恢复毫秒开关偏好
  try {
    const saved = localStorage.getItem(MS_TOGGLE_KEY);
    if (saved === '1') showMsToggle.checked = true;
  } catch {}

  // 加载持久化状态
  const loaded = loadState();
  if (!loaded) {
    syncInputsFromState();
  } else {
    syncInputsFromState();
    // 同步预设按钮高亮
    const presetBtn = findPresetByMs(state.totalMs);
    if (presetBtn) {
      clearPresetActive();
      presetBtn.classList.add('preset-btn--active');
    }
  }

  // 初始渲染
  render();
  updateButtons();

  // 如果刷新前在运行，继续运行
  if (state.running) {
    rafId = requestAnimationFrame(tick);
  }

  // 事件绑定
  btnStart.addEventListener('click', toggleStartPause);
  btnReset.addEventListener('click', reset);

  showMsToggle.addEventListener('change', () => {
    try { localStorage.setItem(MS_TOGGLE_KEY, showMsToggle.checked ? '1' : '0'); } catch {}
    render();
  });

  document.getElementById('btn-apply').addEventListener('click', () => {
    const ms = readInputsToMs();
    if (ms <= 0) {
      alert('请设置大于 0 的时长');
      return;
    }
    setDuration(ms);
    clearPresetActive();
    const presetBtn = findPresetByMs(ms);
    if (presetBtn) presetBtn.classList.add('preset-btn--active');
  });

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.running) return;
      const min = parseInt(btn.dataset.min);
      if (isNaN(min) || min <= 0) return;
      const ms = min * 60 * 1000;
      setDuration(ms);
      clearPresetActive();
      btn.classList.add('preset-btn--active');
      syncInputsFromState();
    });
  });

  // 输入框变化时实时清除预设高亮（直到点应用）
  [inputHours, inputMinutes, inputSeconds].forEach(inp => {
    inp.addEventListener('input', () => {
      const ms = readInputsToMs();
      const presetBtn = findPresetByMs(ms);
      if (presetBtn) {
        clearPresetActive();
        presetBtn.classList.add('preset-btn--active');
      } else {
        clearPresetActive();
      }
    });
  });

  // 键盘快捷键
  window.addEventListener('keydown', onKeydown);

  // 页面隐藏时保存状态（保险）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveState();
  });
}

export { initCountdown };
