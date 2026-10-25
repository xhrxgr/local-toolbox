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
    <div class="cache-panel__box" role="dialog" aria-modal="true" aria-label="本地缓存管理">
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
  if (persistBtn) {
    if (persisted === true) {
      persistBtn.textContent = '持久化已开启';
      persistBtn.disabled = true;
    } else if (persisted === false) {
      persistBtn.textContent = '保持持久化';
      persistBtn.disabled = false;
      persistBtn.title = '防止浏览器在磁盘空间不足时自动清理本站缓存';
    } else {
      persistBtn.textContent = '保持持久化';
      persistBtn.disabled = false;
    }
  }
  summaryEl.innerHTML = `
    <span>${escapeHtml(estimateText)}</span>
    <span>缓存 ${cacheCount} 个 · 条目 ${totalEntries} 条 · 合计 ${formatSize(totalBytes)}</span>
  `;
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
  head.querySelector('.cache-group__clear').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
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

async function clearAllCaches() {
  const btn = summaryEl.parentElement.querySelector('#cache-clear-all');
  btn.disabled = true;
  btn.textContent = '清理中…';
  try {
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    expanded = new Set();
    flashBtn(btn, '已清除全部', 'btn--success');
  } catch {
    flashBtn(btn, '清除失败', 'btn--danger');
  }
  loadData();
}

async function requestPersistence() {
  const btn = summaryEl.parentElement.querySelector('#cache-persist');
  try {
    const granted = await navigator.storage.persist();
    flashBtn(btn, granted ? '已开启' : '未获授权', granted ? 'btn--success' : 'btn--danger');
  } catch {
    flashBtn(btn, '不可用', 'btn--danger');
  }
  loadData();
}

/* ========== 工具函数 ========== */

function flashBtn(btn, text, cls) {
  const original = btn.textContent;
  btn.textContent = text;
  btn.classList.add(cls);
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove(cls);
    btn.disabled = false;
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
