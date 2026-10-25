/**
 * 本地缓存管理（Service Worker 缓存的可视化与手动清理）
 *
 * 入口：页面上的 .cache-manage-btn 按钮（首页静态写入，工具页由 common.js
 * 的 injectToolHeader 注入）。点击弹出毛玻璃管理面板：
 * 查看存储占用与缓存条目、按条目/按缓存删除、全部清除、申请持久化存储。
 *
 * 由 common.js 仅在 production 动态加载（dev 模式不注册 SW，无缓存可管）。
 * 缓存策略本身见 public/sw.js。
 */

const ICON_DB = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14a9 3 0 0 0 18 0V5"></path><path d="M3 12a9 3 0 0 0 18 0"></path></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';

/* 单个缓存默认最多渲染多少条，超出折叠，避免一次渲染上百条卡面板 */
const RENDER_LIMIT = 60;

let panelEl = null;
let listEl = null;
let summaryEl = null;
let expanded = new Set(); // 已展开的缓存名
let lastFocus = null;
let armedRestore = null; // 确认态恢复函数（关面板时调用，防残留）

/* ========== 入口与面板骨架 ========== */

function injectButtonStyles() {
  // 入口按钮样式放全局会污染首页/工具页头部，这里按需注入一次
  if (document.getElementById('cache-manage-style')) return;
  const style = document.createElement('style');
  style.id = 'cache-manage-style';
  style.textContent = `
    .cache-manage-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      min-height: 36px;
      padding: var(--space-xs) var(--space-sm);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-secondary);
      color: var(--text-secondary);
      font-size: var(--text-sm);
      font-weight: 500;
      cursor: pointer;
      transition: color var(--transition-fast), background var(--transition-fast);
    }
    .cache-manage-btn:hover { color: var(--accent); background: var(--card); }
    .cache-manage-btn svg { flex: none; }
    @media (max-width: 640px) {
      .cache-manage-btn { min-height: 40px; }
      .cache-manage-btn__text { display: none; }
    }
  `;
  document.head.appendChild(style);
}

function buildPanel() {
  if (panelEl) return panelEl;
  const wrap = document.createElement('div');
  wrap.className = 'cache-panel';
  wrap.id = 'cache-panel';
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="cache-panel__mask" data-cache-close></div>
    <div class="cache-panel__box" role="dialog" aria-modal="true" aria-label="本地缓存管理" tabindex="-1">
      <div class="cache-panel__head">
        <h2>本地缓存管理</h2>
        <button class="cache-panel__close" type="button" data-cache-close aria-label="关闭">${ICON_CLOSE}</button>
      </div>
      <div class="cache-panel__summary" id="cache-summary">读取中…</div>
      <div class="cache-panel__actions">
        <button class="btn btn-sm btn-secondary" type="button" id="cache-refresh">刷新</button>
        <button class="btn btn-sm btn-secondary" type="button" id="cache-persist">保持持久化</button>
        <button class="btn btn-sm btn--danger" type="button" id="cache-clear-all">清除全部缓存</button>
      </div>
      <div class="cache-panel__list" id="cache-list"></div>
      <div class="cache-panel__note">
        缓存用于加速二次访问：页面文件走网络优先（保证内容最新），静态资源与 CDN
        内核命中缓存后不再联网。删除后下次访问相应内容会自动重新下载；
        「清除全部缓存」不会删除任何个人数据。存储占用为本站整体用量
        （含缓存与其他站点数据）。
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  panelEl = wrap;
  listEl = wrap.querySelector('#cache-list');
  summaryEl = wrap.querySelector('#cache-summary');

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-cache-close]')) closePanel();
  });
  wrap.querySelector('#cache-refresh').addEventListener('click', () => loadData());
  wrap.querySelector('#cache-persist').addEventListener('click', requestPersistence);
  wrap.querySelector('#cache-clear-all').addEventListener('click', clearAllCaches);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panelEl.hidden) closePanel();
  });
  return panelEl;
}

/* ========== 打开 / 关闭 ========== */

function openPanel() {
  buildPanel();
  lastFocus = document.activeElement;
  panelEl.hidden = false;
  loadData();
  panelEl.querySelector('.cache-panel__box').focus();
}

function closePanel() {
  if (!panelEl) return;
  // 关面板时恢复残留的确认态，避免重开看到变红的「确认清除全部？」
  if (armedRestore) armedRestore();
  panelEl.hidden = true;
  if (lastFocus && lastFocus.isConnected) lastFocus.focus();
}

/* ========== 数据读取与渲染 ========== */

function formatSize(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

async function getEntrySize(cache, request) {
  try {
    // 只读响应头，不读 body——28MB 的 onnx 也不能为算大小整个拉进来
    const res = await cache.match(request);
    if (!res) return null;
    const len = res.headers.get('content-length');
    if (len !== null) return parseInt(len, 10);
    // 无 content-length（分块传输/压缩响应）：读缓存里的 body 算实际大小。
    // 数据来自 Cache API（本地存储），不经过网络；超大模型文件也就多花几百毫秒
    const buf = await res.clone().arrayBuffer();
    return buf.byteLength;
  } catch {
    return null;
  }
}

async function loadData() {
  if (!listEl) return;
  listEl.innerHTML = '<div class="cache-empty">读取中…</div>';

  let cacheNames = [];
  try {
    cacheNames = await caches.keys();
  } catch {
    cacheNames = [];
  }

  // 存储概览（usage 为整个 origin 占用，含缓存之外的数据）
  let estimateText = '存储用量不可用';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      estimateText = `已用 ${formatSize(est.usage)} / 配额 ${formatSize(est.quota)}`;
    }
  } catch { /* 保持兜底文案 */ }

  let persisted = null;
  try {
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
  } catch { /* ignore */ }

  let totalEntries = 0;
  let totalBytes = 0;
  const groups = [];

  for (const name of cacheNames) {
    let cache;
    try {
      cache = await caches.open(name);
    } catch {
      continue;
    }
    const requests = await cache.keys();
    let groupBytes = 0;
    const items = [];
    for (const req of requests) {
      const size = await getEntrySize(cache, req);
      if (size !== null) groupBytes += size;
      items.push({ req, size });
    }
    totalEntries += items.length;
    totalBytes += groupBytes;
    groups.push({ name, cache, items, bytes: groupBytes });
  }

  renderSummary({ estimateText, persisted, totalEntries, cacheCount: groups.length, totalBytes });
  try {
    renderList(groups);
  } catch (err) {
    // 渲染失败不能留白：给出可见的错误反馈
    listEl.innerHTML = '';
    const errEl = document.createElement('div');
    errEl.className = 'cache-empty';
    errEl.textContent = '列表渲染失败：' + (err && err.message ? err.message : String(err));
    listEl.appendChild(errEl);
  }
}

function renderSummary({ estimateText, persisted, totalEntries, cacheCount, totalBytes }) {
  const persistBtn = summaryEl.parentElement.querySelector('#cache-persist');
  // 持久化状态常驻显示在摘要区，不用点开按钮才知道开没开
  const persistText = persisted === true ? '已开启' : persisted === false ? '未开启' : '不可用';
  summaryEl.innerHTML = `
    <span>${escapeHtml(estimateText)}</span>
    <span>存储持久化：${persistText}</span>
    <span>缓存 ${cacheCount} 个 · 条目 ${totalEntries} 条 · 合计 ${formatSize(totalBytes)}</span>
  `;
  // 按钮永不禁用：已授权时重复调用 persist() 会直接 resolve，无害；
  // 禁用反而让用户点了没反应（.btn 没有 disabled 视觉样式，看不出已禁用）
  if (persistBtn && !persistBtn.dataset.flashing) {
    persistBtn.disabled = false;
    persistBtn.textContent = persisted === true ? '持久化已开启' : '保持持久化';
    persistBtn.title = persisted === true
      ? '已开启：浏览器不会自动清理本站缓存，点击可查看状态'
      : '防止浏览器在磁盘空间不足时自动清理本站缓存';
  }
}

function renderList(groups) {
  if (groups.length === 0) {
    listEl.innerHTML = '<div class="cache-empty">暂无缓存。访问过的页面与用过的功能会自动缓存，下次访问即可离线可用。</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const group of groups) {
    listEl.appendChild(renderGroup(group));
  }
}

function renderGroup(group) {
  const box = document.createElement('div');
  box.className = 'cache-group';

  const head = document.createElement('div');
  head.className = 'cache-group__head';
  head.innerHTML = `
    <span class="cache-group__name">${escapeHtml(group.name)}</span>
    <span class="cache-group__meta">${group.items.length} 条 · ${formatSize(group.bytes)}</span>
    <button class="btn btn-sm btn--danger cache-group__clear" type="button">清空此缓存</button>
  `;
  head.querySelector('.cache-group__clear').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    armConfirm(btn, '确认清空？', async () => {
      btn.disabled = true;
      btn.textContent = '清理中…';
      try {
        await caches.delete(group.name);
        flashBtn(btn, '已清空', 'btn--success');
      } catch {
        flashBtn(btn, '清空失败', 'btn--danger');
      }
      loadData();
    });
  });
  box.appendChild(head);

  const limit = expanded.has(group.name) ? group.items.length : RENDER_LIMIT;
  const shown = group.items.slice(0, limit);
  const list = document.createElement('div');
  list.className = 'cache-group__list';
  for (const item of shown) {
    list.appendChild(renderItem(group, item));
  }
  box.appendChild(list);

  if (group.items.length > RENDER_LIMIT && !expanded.has(group.name)) {
    const more = document.createElement('button');
    more.className = 'cache-group__more';
    more.type = 'button';
    more.textContent = `展开其余 ${group.items.length - RENDER_LIMIT} 条`;
    more.addEventListener('click', () => {
      expanded.add(group.name);
      loadData();
    });
    box.appendChild(more);
  }
  return box;
}

function renderItem(group, item) {
  const row = document.createElement('div');
  row.className = 'cache-item';

  // 同源条目只显示路径（完整 URL 放 title）；跨域条目带主机名区分来源
  let url;
  try {
    const u = new URL(item.req.url);
    url = u.origin === location.origin ? u.pathname + u.search : u.host + u.pathname;
  } catch {
    url = item.req.url;
  }

  const urlEl = document.createElement('span');
  urlEl.className = 'cache-item__url';
  urlEl.textContent = url;
  urlEl.title = item.req.url;

  const size = document.createElement('span');
  size.className = 'cache-item__size';
  size.textContent = formatSize(item.size);

  const del = document.createElement('button');
  del.className = 'btn btn-sm btn--danger cache-item__del';
  del.type = 'button';
  del.textContent = '删除';
  del.addEventListener('click', async () => {
    del.disabled = true;
    del.textContent = '删除中…';
    try {
      await group.cache.delete(item.req);
      flashBtn(del, '已删除', 'btn--success');
    } catch {
      flashBtn(del, '失败', 'btn--danger');
    }
    loadData();
  });

  row.appendChild(urlEl);
  row.appendChild(size);
  row.appendChild(del);
  return row;
}

/* ========== 操作 ========== */

/**
 * 破坏性操作的二次确认：点击后按钮进入确认态（文字变红 + 出现「取消」），
 * 需再次点击才执行，5 秒无操作自动恢复。
 * 清除缓存的误触代价大（去手写模型 28MB、ffmpeg 内核都靠重新下载），
 * 但用原生 confirm 会割裂毛玻璃 UI，所以在按钮内做轻量二次确认。
 * 删除单条代价小（重新访问即回），保持直接删不加确认。
 */
function armConfirm(btn, confirmText, onConfirm) {
  if (btn.dataset.armed) return;
  // 先恢复上一个确认态：否则 armedRestore 被覆盖，关面板时只恢复最后一个，
  // 前面那个按钮的红色文字和取消按钮会残留在界面上
  if (armedRestore) armedRestore();
  btn.dataset.armed = '1';
  const original = btn.textContent;
  btn.textContent = confirmText;
  btn.classList.add('btn--danger');
  btn.title = '再次点击确认执行';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-sm btn-secondary';
  cancel.textContent = '取消';
  btn.parentElement.insertBefore(cancel, btn.nextSibling);

  const timer = setTimeout(restore, 5000);

  function restore() {
    clearTimeout(timer);
    delete btn.dataset.armed;
    btn.textContent = original;
    btn.classList.remove('btn--danger');
    btn.title = '';
    cancel.remove();
    btn.removeEventListener('click', onConfirmClick, true);
    if (armedRestore === restore) armedRestore = null;
  }

  function onConfirmClick(e) {
    // capture 阶段拦截，抢在原 click handler 之前
    e.stopImmediatePropagation();
    restore();
    onConfirm();
  }

  cancel.addEventListener('click', restore);
  btn.addEventListener('click', onConfirmClick, true);
  armedRestore = restore;
}

function doClearAllCaches() {
  const btn = summaryEl.parentElement.querySelector('#cache-clear-all');
  btn.disabled = true;
  btn.textContent = '清理中…';
  caches.keys()
    .then((names) => Promise.all(names.map((n) => caches.delete(n))))
    .then(() => {
      expanded = new Set();
      // 删除完成后再刷新列表：大缓存（28MB 模型）删除耗时可达数百毫秒，
      // 提前 loadData 会读到还没删掉的条目
      loadData();
      flashBtn(btn, '已清除全部', 'btn--success');
    })
    .catch(() => {
      flashBtn(btn, '清除失败', 'btn--danger');
    });
}

function clearAllCaches() {
  const btn = summaryEl.parentElement.querySelector('#cache-clear-all');
  armConfirm(btn, '确认清除全部？', doClearAllCaches);
}

async function requestPersistence() {
  const btn = summaryEl.parentElement.querySelector('#cache-persist');
  try {
    const granted = await navigator.storage.persist();
    // 已授权时重复调用直接 resolve true，明确告知无需重复申请；
    // 闪烁结束再 loadData 同步按钮文字与摘要状态，避免中间态不一致
    flashBtn(btn, granted ? '已开启，无需重复申请' : '未获授权', granted ? 'btn--success' : 'btn--danger', loadData);
  } catch {
    flashBtn(btn, '不可用', 'btn--danger', loadData);
  }
}

/* ========== 工具函数 ========== */

function flashBtn(btn, text, cls, onRestore) {
  // 闪烁期间忽略重复触发：连点会让 original 捕获到闪烁中的文字，
  // 恢复时留下错误状态（持久化按钮在 loadData 后仍存在于 DOM，会踩到）
  if (btn.dataset.flashing) return;
  const original = btn.textContent;
  btn.textContent = text;
  btn.classList.add(cls);
  // 闪烁锁：loadData() 的 renderSummary 不能在此期间重置按钮文字，
  // 否则刚设置的「已开启/未获授权」会被立刻覆盖，用户看不到反馈
  btn.dataset.flashing = '1';
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove(cls);
    delete btn.dataset.flashing;
    btn.disabled = false;
    // 恢复后按最新状态重刷（持久化授权结果要等闪烁结束才同步，
    // 避免「按钮说已开启、摘要说未开启」的中间态）
    if (onRestore) onRestore();
  }, 1500);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ========== 启动 ========== */

injectButtonStyles();
buildPanel();

// 事件委托：入口按钮可能在面板构建前注入（工具页头部是 JS 动态加的）
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.cache-manage-btn');
  if (btn) openPanel();
});

export { ICON_DB };
