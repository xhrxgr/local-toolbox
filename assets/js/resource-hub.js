/**
 * 大资源预下载管理
 *
 * ffmpeg 转换内核（~31MB）、OCR 语言包（~20MB）、扫描文档去手写模型（28MB）
 * 都是「用到才下载」的大文件，第一次用要干等很久，弱网下更是几分钟。
 * 本模块给这些资源提供统一的「提前下载 / 删除」入口：
 *   下载：把资源取回本地（写进 Cache Storage），之后使用同一 URL 直接命中
 *   删除：移除本地副本，释放空间
 *
 * 资源条目由各工具提供（URL 与缓存规则分散在各自代码里，
 * 这里只负责渲染状态、串联下载与删除）：
 *   {
 *     id: string,
 *     name: string,        // 展示名
 *     desc: string,        // 一句话说明
 *     sizeLabel: string,   // 体积标签，如 '~31 MB'
 *     isCached: async () => boolean,        // 是否已在本地
 *     download: async (onProgress) => void,  // 下载并落地到缓存
 *     remove: async () => void,              // 删除本地副本
 *   }
 */

import { showToast } from './toast.js';

const PANEL_CLASS = 'resource-panel';
let styleInjected = false;

function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .${PANEL_CLASS} {
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-secondary);
    }
    .${PANEL_CLASS} > summary {
      cursor: pointer;
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--text);
      list-style: none;
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-height: 32px;
    }
    .${PANEL_CLASS} > summary::-webkit-details-marker { display: none; }
    .${PANEL_CLASS} > summary::before {
      content: '›';
      display: inline-block;
      transition: transform var(--transition-fast);
      color: var(--text-secondary);
    }
    .${PANEL_CLASS}[open] > summary::before { transform: rotate(90deg); }
    .resource-panel__badge {
      font-size: var(--text-xs);
      font-weight: 400;
      color: var(--text-secondary);
    }
    .resource-panel__badge--ready { color: #22c55e; }
    .resource-panel__hint {
      font-size: var(--text-xs);
      color: var(--text-secondary);
      line-height: 1.5;
    }
    .resource-item {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs) var(--space-sm);
      padding: var(--space-xs) 0;
      border-top: 1px dashed var(--border);
    }
    .resource-item:first-of-type { border-top: none; }
    .resource-item__main { flex: 1; min-width: 180px; }
    .resource-item__name { font-size: var(--text-sm); color: var(--text); }
    .resource-item__desc { font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.5; }
    .resource-item__status {
      font-size: var(--text-xs);
      color: var(--text-secondary);
      white-space: nowrap;
    }
    .resource-item__status--ready { color: #22c55e; }
    .resource-item__actions { display: flex; gap: var(--space-xs); flex: none; }
    .resource-item__progress {
      width: 100%;
      font-size: var(--text-xs);
      color: var(--text-secondary);
    }
  `;
  document.head.appendChild(style);
}

/**
 * 挂载资源面板
 * @param {HTMLElement|string} container 容器元素或选择器
 * @param {Array} resources 资源条目数组
 * @param {{collapsed?: boolean}} options collapsed=true 时默认折叠
 */
export function mountResourcePanel(container, resources, options = {}) {
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  if (!el) return;
  injectStyles();

  // 用原生 details/summary 折叠：默认收起不占空间，展开才看到条目
  const details = document.createElement('details');
  details.className = PANEL_CLASS;
  if (!options.collapsed) details.open = true;
  details.innerHTML = `
    <summary>
      <span>离线资源</span>
      <span class="resource-panel__badge" data-role="badge">检查中…</span>
    </summary>
    <div class="resource-panel__hint">大文件提前下载到本地，用的时候就不用等；删掉可释放空间。</div>
  `;
  el.innerHTML = '';
  el.appendChild(details);

  const list = document.createElement('div');
  list.className = 'resource-panel__list';
  details.appendChild(list);

  for (const res of resources) {
    list.appendChild(renderItem(res, () => refreshAll(details, resources)));
  }
  refreshAll(details, resources);
}

function renderItem(res, onChanged) {
  const row = document.createElement('div');
  row.className = 'resource-item';

  const main = document.createElement('div');
  main.className = 'resource-item__main';
  main.innerHTML = `
    <div class="resource-item__name">${res.name}${res.sizeLabel ? ' · ' + res.sizeLabel : ''}</div>
    <div class="resource-item__desc">${res.desc}</div>
  `;

  const status = document.createElement('span');
  status.className = 'resource-item__status';
  status.textContent = '检查中…';

  const actions = document.createElement('div');
  actions.className = 'resource-item__actions';
  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'btn btn-sm btn-primary';
  dlBtn.textContent = '下载';
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-sm btn--danger';
  delBtn.textContent = '删除';

  const progress = document.createElement('div');
  progress.className = 'resource-item__progress';
  progress.hidden = true;

  actions.appendChild(dlBtn);
  actions.appendChild(delBtn);
  row.appendChild(main);
  row.appendChild(status);
  row.appendChild(actions);
  row.appendChild(progress);

  dlBtn.addEventListener('click', async () => {
    dlBtn.disabled = true;
    delBtn.disabled = true;
    dlBtn.textContent = '下载中…';
    progress.hidden = false;
    progress.textContent = '正在下载…';
    try {
      await res.download((loaded, total) => {
        if (!total) {
          progress.textContent = `已下载 ${formatBytes(loaded)}`;
          return;
        }
        const pct = Math.round((loaded / total) * 100);
        progress.textContent = `下载中 ${pct}%（${formatBytes(loaded)} / ${formatBytes(total)}）`;
      });
      progress.textContent = '下载完成，已存到本地';
      showToast(`${res.name} 下载完成`, 'success');
      await refreshItem(res, status, dlBtn, delBtn);
      onChanged?.();
    } catch (err) {
      progress.textContent = '下载失败：' + (err && err.message ? err.message : String(err));
      showToast(`${res.name} 下载失败`, 'error');
      dlBtn.disabled = false;
    } finally {
      dlBtn.textContent = '下载';
    }
  });

  delBtn.addEventListener('click', async () => {
    delBtn.disabled = true;
    dlBtn.disabled = true;
    delBtn.textContent = '删除中…';
    try {
      await res.remove();
      progress.hidden = true;
      showToast(`${res.name} 已删除`, 'info');
      await refreshItem(res, status, dlBtn, delBtn);
      onChanged?.();
    } catch (err) {
      showToast(`${res.name} 删除失败`, 'error');
    } finally {
      delBtn.textContent = '删除';
    }
  });

  return row;
}

async function refreshItem(res, status, dlBtn, delBtn) {
  let cached = false;
  try {
    cached = await res.isCached();
  } catch {
    cached = false;
  }
  status.textContent = cached ? '已在本地' : '未下载';
  status.classList.toggle('resource-item__status--ready', cached);
  dlBtn.disabled = cached;
  delBtn.disabled = !cached;
  dlBtn.textContent = cached ? '已下载' : '下载';
  return cached;
}

async function refreshAll(details, resources) {
  const rows = details.querySelectorAll('.resource-item');
  let ready = 0;
  for (let i = 0; i < resources.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const ok = await refreshItem(
      resources[i],
      row.querySelector('.resource-item__status'),
      row.querySelector('.resource-item__actions .btn-primary'),
      row.querySelector('.resource-item__actions .btn--danger')
    );
    if (ok) ready++;
  }
  const badge = details.querySelector('[data-role="badge"]');
  if (badge) {
    badge.textContent = ready === resources.length
      ? '全部已就绪'
      : ready > 0
        ? `${ready}/${resources.length} 已就绪`
        : '未下载';
    badge.classList.toggle('resource-panel__badge--ready', ready === resources.length && resources.length > 0);
  }
}

/** 某个 URL 是否已缓存在任意缓存里（不依赖具体缓存名） */
export async function urlCachedAnywhere(url) {
  if (!('caches' in window)) return false;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    try {
      if (await cache.match(url)) return true;
    } catch { /* 忽略单个缓存的错误 */ }
  }
  return false;
}

/** 从所有缓存里移除某个 URL */
export async function removeUrlEverywhere(url) {
  if (!('caches' in window)) return;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    try {
      await cache.delete(url);
    } catch { /* 忽略 */ }
  }
}

function formatBytes(bytes) {
  if (!bytes || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
