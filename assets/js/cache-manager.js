/**
 * 本地缓存管理（Service Worker 缓存的可视化与手动清理）
 *
 * 入口：页面上的 .cache-manage-btn 按钮（首页静态写入，工具页由 common.js
 * 的 injectToolHeader 注入）。点击弹出毛玻璃管理面板：
 * 查看存储占用与缓存条目、按条目/按缓存删除、全部清除、申请持久化存储。
 *
 * 显示取向：用户不关心 hash 文件名与长路径，所以条目一律翻译成可读名称
 * （「多媒体转换 · 页面」「OCR 语言包」），并用占比条直观看出谁最占空间。
 *
 * 由 common.js 仅在 production 动态加载（dev 模式不注册 SW，无缓存可管）。
 * 缓存策略本身见 public/sw.js。
 */

import { TOOLS } from '/assets/js/tool-registry.js';

const ICON_DB = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14a9 3 0 0 0 18 0V5"></path><path d="M3 12a9 3 0 0 0 18 0"></path></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';

/* 单个缓存默认最多渲染多少条，超出折叠，避免一次渲染上百条卡面板 */
const RENDER_LIMIT = 60;

/* 条目排序模式：size-desc（默认，最大占比优先）/ size-asc / name。
   无大小信息的条目（跨域 opaque 响应等）任何模式下一律排尾部 */
let sortMode = 'size-desc';

const SORT_OPTIONS = [
  { mode: 'size-desc', label: '大小↓' },
  { mode: 'size-asc', label: '大小↑' },
  { mode: 'name', label: '名称' },
];

let panelEl = null;
let listEl = null;
let summaryEl = null;
let expanded = new Set(); // 已展开的缓存名
let lastFocus = null;
let armedRestore = null; // 确认态恢复函数（关面板时调用，防残留）

/* ========== 入口与面板骨架 ========== */

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
        <div class="cache-panel__title">
          <h2>本地缓存管理</h2>
          <p>本站离线资源与页面缓存</p>
        </div>
        <button class="cache-panel__close" type="button" data-cache-close aria-label="关闭">${ICON_CLOSE}</button>
      </div>
      <div class="cache-panel__summary" id="cache-summary">读取中…</div>
      <div class="cache-panel__actions">
        <button class="btn btn-sm btn-secondary" type="button" id="cache-refresh">刷新</button>
        <button class="btn btn-sm btn-secondary" type="button" id="cache-persist">保持持久化</button>
        <button class="btn btn-sm btn--danger" type="button" id="cache-clear-all">清除全部缓存</button>
      </div>
      <div class="cache-list__bar">
        <span class="cache-list__count" id="cache-count">读取中…</span>
        <div class="cache-sort" id="cache-sort" role="group" aria-label="条目排序">
          ${SORT_OPTIONS.map((o) => `<button class="cache-sort__btn${o.mode === sortMode ? ' cache-sort__btn--active' : ''}" type="button" data-sort="${o.mode}">${o.label}</button>`).join('')}
        </div>
      </div>
      <div class="cache-panel__list" id="cache-list"></div>
      <div class="cache-panel__note">
        缓存用于加速二次访问：页面走网络优先（内容永远最新），静态资源命中缓存后不再联网。
        删除后下次访问相应内容会自动重新下载，不会丢失任何个人数据。
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
  wrap.querySelector('#cache-sort').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    sortMode = btn.dataset.sort;
    wrap.querySelectorAll('#cache-sort .cache-sort__btn').forEach((b) => {
      b.classList.toggle('cache-sort__btn--active', b.dataset.sort === sortMode);
    });
    loadData();
  });
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
  lockBackgroundScroll();
  loadData();
  panelEl.querySelector('.cache-panel__box').focus();
}

function closePanel() {
  if (!panelEl) return;
  // 关面板时恢复残留的确认态，避免重开看到变红的「确认清除全部？」
  if (armedRestore) armedRestore();
  panelEl.hidden = true;
  unlockBackgroundScroll();
  if (lastFocus && lastFocus.isConnected) lastFocus.focus();
}

/* 背景锁定：面板是模态，背景不该跟着滚。
   用 position:fixed 锁 body 而不是 html{overflow:hidden}——
   后者会让根元素失去滚动容器、滚动位置被重置为 0（背景突然跳回顶部，
   比穿透本身更糟）。锁定后把滚动位置记下来，关闭时还原。 */
let lockedScrollY = 0;

function lockBackgroundScroll() {
  lockedScrollY = window.scrollY;
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  // 锁定后滚动条消失，body 会变宽，用 padding 补回这段宽度
  if (scrollbar > 0) document.body.style.paddingRight = scrollbar + 'px';
}

function unlockBackgroundScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.paddingRight = '';
  window.scrollTo(0, lockedScrollY);
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
  let usage = null;
  let quota = null;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage;
      quota = est.quota;
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

  renderSummary({ usage, quota, persisted, totalEntries, cacheCount: groups.length, totalBytes });
  // 列表工具条上的条目数（与摘要里的数字一致，方便滚动时对照）
  const countEl = panelEl && panelEl.querySelector('#cache-count');
  if (countEl) {
    countEl.textContent = totalEntries > 0 ? `${totalEntries} 个条目` : '暂无缓存';
  }
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

function renderSummary({ usage, quota, persisted, totalEntries, cacheCount, totalBytes }) {
  const persistBtn = summaryEl.parentElement.querySelector('#cache-persist');
  // 持久化状态常驻显示在摘要区，不用点开按钮才知道开没开
  const persistText = persisted === true ? '已开启' : persisted === false ? '未开启' : '不可用';
  summaryEl.innerHTML = `
    <div class="cache-summary__main">
      <span class="cache-summary__value">${formatSize(totalBytes)}</span>
      <span class="cache-summary__label">可清理缓存 · ${totalEntries} 条 · ${cacheCount} 组</span>
    </div>
    <div class="cache-summary__meta">
      <span>${usage !== null && usage !== undefined ? `站点已用 ${formatSize(usage)} / 配额 ${formatSize(quota)}` : '存储用量不可用'}</span>
      <span>存储持久化：${persistText}</span>
    </div>
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
    <span class="cache-group__name">${escapeHtml(describeGroup(group.name))}</span>
    <span class="cache-group__meta">${group.items.length} 条 · ${formatSize(group.bytes)}</span>
    <button class="btn btn-sm cache-group__clear" type="button">清空此缓存</button>
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
  const sorted = sortItems(group.items);
  const shown = sorted.slice(0, limit);
  // 占比条以本组最大条目为 100%，一眼看出谁最占空间
  const maxSize = sorted.reduce((max, it) => (it.size !== null && it.size > max ? it.size : max), 0);
  const list = document.createElement('div');
  list.className = 'cache-group__list';
  for (const item of shown) {
    list.appendChild(renderItem(group, item, maxSize));
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

/* 按当前排序模式重排条目：大小模式把无大小信息的条目固定在尾部，
   名称模式按可读名称排序 */
function sortItems(items) {
  if (sortMode === 'name') {
    return [...items].sort((a, b) => {
      const an = describeEntry(a.req.url).name;
      const bn = describeEntry(b.req.url).name;
      return an.localeCompare(bn, 'zh-Hans-CN');
    });
  }
  const sorted = [...items].sort((a, b) => {
    if (a.size === null && b.size === null) return 0;
    if (a.size === null) return 1;
    if (b.size === null) return -1;
    return sortMode === 'size-asc' ? a.size - b.size : b.size - a.size;
  });
  return sorted;
}

/* 常见第三方库文件（构建产物里不带 hash 的那批），标成「库文件」更贴切 */
const LIBRARY_FILES = new Set([
  'es.js', 'jsQR.js', 'purify.es.js', 'marked.esm.js', 'jspdf.es.min.js',
  'html2canvas.js', 'jszip.min.js', 'qrcode.js', 'ort-wasm-simd-threaded.mjs',
  'pdf.worker.min.mjs', 'pdf.min.js', 'word.js', 'epub.js', 'rtf.js',
  'xlsx.js', 'ort-wasm-simd-threaded.wasm',
]);

/* 缓存组名 → 可读名称（toolbox-v1 是站点自身缓存，其余是工具专用缓存） */
function describeGroup(name) {
  if (name.startsWith('toolbox')) return '站点页面与静态资源';
  if (name.startsWith('ffmpeg-core')) return 'FFmpeg 转换内核';
  if (name.startsWith('inkerase-models')) return '扫描文档去手写模型';
  return name;
}

/**
 * 缓存条目 URL → 可读名称与类型标签。
 * 用户不关心 hash 文件名和长路径，「多媒体转换 · 页面」远比
 * 「/local-toolbox/assets/ffmpeg-CEFw3M00.js」直观。
 */
function describeEntry(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { name: rawUrl, kind: '' };
  }
  const file = u.pathname.split('/').filter(Boolean).pop() || u.pathname;

  // 同源：工具页面
  if (u.origin === location.origin) {
    const tool = TOOLS.find((t) => u.pathname.endsWith(t.path));
    if (tool) return { name: tool.name, kind: '页面' };

    // 同源资源：去掉构建 hash
    const clean = file.replace(/-[A-Za-z0-9_-]{8,}(\.[^.]+)$/, '$1');
    if (clean === 'main.js') return { name: '主程序', kind: '脚本' };
    if (clean === 'common.js') return { name: '公共脚本', kind: '脚本' };
    if (clean === 'common.css') return { name: '公共样式', kind: '样式' };
    const chunk = clean.match(/^([a-z0-9-]+)\.js$/i);
    if (chunk) {
      const t = TOOLS.find((x) => x.id === chunk[1]);
      if (t) return { name: t.name, kind: '脚本' };
    }
    if (clean.endsWith('.wasm')) return { name: clean, kind: '运行时' };
    if (clean.endsWith('.onnx')) return { name: '去手写模型', kind: '模型' };
    if (LIBRARY_FILES.has(clean)) return { name: clean, kind: '库文件' };
    return { name: clean, kind: '文件' };
  }

  // 跨域
  if (file.endsWith('.traineddata.gz')) {
    return { name: file.replace('.traineddata.gz', ''), kind: '语言包' };
  }
  if (file.startsWith('ffmpeg-core')) return { name: 'FFmpeg 内核', kind: file.endsWith('.wasm') ? '运行时' : '脚本' };
  if (file.endsWith('.wasm')) return { name: file, kind: '运行时' };
  return { name: file, kind: u.host };
}

function renderItem(group, item, maxSize) {
  const row = document.createElement('div');
  row.className = 'cache-item';

  const desc = describeEntry(item.req.url);

  const main = document.createElement('div');
  main.className = 'cache-item__main';
  const nameEl = document.createElement('span');
  nameEl.className = 'cache-item__name';
  nameEl.textContent = desc.name;
  main.appendChild(nameEl);
  if (desc.kind) {
    const kindEl = document.createElement('span');
    kindEl.className = 'cache-item__kind';
    kindEl.textContent = desc.kind;
    main.appendChild(kindEl);
  }
  const pathEl = document.createElement('span');
  pathEl.className = 'cache-item__path';
  pathEl.textContent = item.req.url;
  pathEl.title = item.req.url;
  main.appendChild(pathEl);

  // 占比条：相对本组最大条目
  const bar = document.createElement('span');
  bar.className = 'cache-item__bar';
  const pct = maxSize > 0 && item.size ? Math.max(4, Math.round((item.size / maxSize) * 100)) : 0;
  const fill = document.createElement('span');
  fill.className = 'cache-item__bar-fill';
  fill.style.width = pct + '%';
  bar.appendChild(fill);
  bar.title = pct > 0 ? `占本组最大条目的 ${pct}%` : '';

  const size = document.createElement('span');
  size.className = 'cache-item__size';
  size.textContent = formatSize(item.size);

  const del = document.createElement('button');
  del.className = 'btn btn-sm cache-item__del';
  del.type = 'button';
  del.textContent = '删除';
  del.title = '删除这个缓存条目';
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

  row.appendChild(main);
  row.appendChild(bar);
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

buildPanel();

// 事件委托：入口按钮可能在面板构建前注入（工具页头部是 JS 动态加的）
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.cache-manage-btn');
  if (btn) openPanel();
});

export { ICON_DB };
