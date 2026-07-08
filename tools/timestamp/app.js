/**
 * 时间戳工具核心逻辑
 * - 当前时间戳（秒/毫秒）+ 本地时间实时显示（每秒更新）
 * - 时间戳 → 日期（自动/秒/毫秒）
 * - 日期 → 时间戳（秒/毫秒）
 * - 一键复制
 */

const PAGE_TITLE = '时间戳 - 网页工具箱';

let nowSecEl, nowMsEl, nowLocalEl;
let tsInput, tsUnit, tsResult, btnTsConvert;
let dateInput, dateResult, btnDateConvert;
let rafId = 0;

function pad(n) { return String(n).padStart(2, '0'); }

function formatLocalTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatLocalTimeMs(d) {
  return formatLocalTime(d) + `.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatResultDate(d) {
  // YYYY-MM-DD HH:mm:ss.mmm (北京时间)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.` +
         String(d.getMilliseconds()).padStart(3, '0');
}

function formatUTCDate(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
         String(d.getMilliseconds()).padStart(3, '0') + ' UTC';
}

function tick() {
  const now = new Date();
  const ms = now.getTime();
  const sec = Math.floor(ms / 1000);
  nowSecEl.textContent = String(sec);
  nowMsEl.textContent = String(ms);
  nowLocalEl.textContent = formatLocalTime(now);
  rafId = setTimeout(tick, 1000 - (Date.now() % 1000)); // 对齐到秒边界
}

/* ========== 转换逻辑 ========== */
function convertTsToDate() {
  const raw = tsInput.value.trim();
  if (!raw) {
    tsResult.textContent = '请输入时间戳';
    tsResult.classList.add('convert-result--error');
    return;
  }
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    tsResult.textContent = '时间戳格式无效，应为整数或浮点数';
    tsResult.classList.add('convert-result--error');
    return;
  }
  let num = parseFloat(raw);
  if (isNaN(num)) {
    tsResult.textContent = '时间戳无效';
    tsResult.classList.add('convert-result--error');
    return;
  }
  // 自动判断单位：< 1e12 视为秒
  const unit = tsUnit.value;
  let actualMs;
  if (unit === 's') actualMs = num * 1000;
  else if (unit === 'ms') actualMs = num;
  else actualMs = num < 1e12 ? num * 1000 : num;

  const d = new Date(actualMs);
  if (isNaN(d.getTime())) {
    tsResult.textContent = '时间戳超出有效范围';
    tsResult.classList.add('convert-result--error');
    return;
  }
  const local = formatResultDate(d);
  const utc = formatUTCDate(d);
  tsResult.classList.remove('convert-result--error');
  tsResult.innerHTML = `
    <div class="result-line"><strong>本地时间：</strong>${local}</div>
    <div class="result-line"><strong>UTC 时间：</strong>${utc}</div>
    <div class="result-line result-line--sub">${d.toString()}</div>
  `;
}

function convertDateToTs() {
  const raw = dateInput.value;
  if (!raw) {
    dateResult.textContent = '请选择日期时间';
    dateResult.classList.add('convert-result--error');
    return;
  }
  // datetime-local 不带时区，按本地时间解析
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    dateResult.textContent = '日期时间无效';
    dateResult.classList.add('convert-result--error');
    return;
  }
  const ms = d.getTime();
  const sec = Math.floor(ms / 1000);
  dateResult.classList.remove('convert-result--error');
  dateResult.innerHTML = `
    <div class="result-line"><strong>秒：</strong><code>${sec}</code></div>
    <div class="result-line"><strong>毫秒：</strong><code>${ms}</code></div>
  `;
}

/* ========== 复制 ========== */
function copyToClipboard(text, btn) {
  if (!navigator.clipboard) {
    // 回退
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  } else {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  showCopyFeedback(btn);
}

function showCopyFeedback(btn) {
  const original = btn.innerHTML;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>';
  btn.classList.add('btn-copy--success');
  setTimeout(() => {
    btn.innerHTML = original;
    btn.classList.remove('btn-copy--success');
  }, 1200);
}

/* ========== 初始化 ========== */
function initTimestamp() {
  nowSecEl = document.getElementById('now-sec');
  nowMsEl = document.getElementById('now-ms');
  nowLocalEl = document.getElementById('now-local');
  tsInput = document.getElementById('ts-input');
  tsUnit = document.getElementById('ts-unit');
  tsResult = document.getElementById('ts-result');
  btnTsConvert = document.getElementById('btn-ts-convert');
  dateInput = document.getElementById('date-input');
  dateResult = document.getElementById('date-result');
  btnDateConvert = document.getElementById('btn-date-convert');

  // 初始默认时间：当前本地时间
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  const localISO = new Date(now.getTime() - tz).toISOString().slice(0, 19);
  dateInput.value = localISO;

  // 启动实时刷新
  tick();

  // 事件
  btnTsConvert.addEventListener('click', convertTsToDate);
  tsInput.addEventListener('keydown', e => { if (e.key === 'Enter') convertTsToDate(); });
  btnDateConvert.addEventListener('click', convertDateToTs);
  dateInput.addEventListener('change', convertDateToTs);

  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.copyTarget);
      if (target) copyToClipboard(target.textContent, btn);
    });
  });
}

export { initTimestamp };
