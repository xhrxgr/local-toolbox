/**
 * 资源中心
 *
 * 把工具依赖的大文件（ffmpeg 内核、OCR 运行时与语言包、去手写模型与
 * 推理运行时）一次性预取到本地。资源条目来自共享清单
 * assets/js/resource-registry.js，与各工具页的「离线资源」面板同源。
 */
import { RESOURCE_GROUPS, allResources, totalSize } from '/assets/js/resource-registry.js';
import { showToast } from '/assets/js/toast.js';
import { armConfirm } from '/assets/js/confirm.js';

const state = {
  selected: new Set(), // 已勾选的资源 id
  statuses: new Map(), // id -> { cached, state, loaded, total, error }
  running: false,
};

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/* ========== 渲染 ========== */

function statusOf(res) {
  if (!state.statuses.has(res.id)) {
    state.statuses.set(res.id, { cached: false, state: 'unknown', loaded: 0, total: res.size, error: '' });
  }
  return state.statuses.get(res.id);
}

function renderGroups() {
  const host = document.getElementById('res-groups');
  host.innerHTML = '';

  for (const group of RESOURCE_GROUPS) {
    const box = document.createElement('section');
    box.className = 'res-group';

    const head = document.createElement('div');
    head.className = 'res-group__head';
    const title = document.createElement('h3');
    title.className = 'res-group__title';
    title.textContent = group.title;
    const meta = document.createElement('span');
    meta.className = 'res-group__meta';
    meta.textContent = `${group.resources.length} 项 · ${formatBytes(totalSize(group.resources))}`;
    head.appendChild(title);
    head.appendChild(meta);
    box.appendChild(head);

    for (const res of group.resources) {
      box.appendChild(renderRow(res));
    }
    host.appendChild(box);
  }
}

function renderRow(res) {
  const st = statusOf(res);
  const row = document.createElement('div');
  row.className = 'res-row';
  row.dataset.id = res.id;

  // 勾选框
  const check = document.createElement('label');
  check.className = 'res-row__check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = state.selected.has(res.id);
  input.addEventListener('change', () => {
    if (input.checked) state.selected.add(res.id);
    else state.selected.delete(res.id);
    updateSelection();
  });
  check.appendChild(input);
  row.appendChild(check);

  // 名称与说明
  const main = document.createElement('div');
  main.className = 'res-row__main';
  const name = document.createElement('div');
  name.className = 'res-row__name';
  name.textContent = res.name;
  const desc = document.createElement('div');
  desc.className = 'res-row__desc';
  desc.textContent = res.desc;
  main.appendChild(name);
  main.appendChild(desc);
  row.appendChild(main);

  // 状态
  const status = document.createElement('span');
  status.className = 'res-row__status';
  status.dataset.role = 'status';
  row.appendChild(status);

  // 大小
  const size = document.createElement('span');
  size.className = 'res-row__size';
  size.textContent = formatBytes(res.size);
  row.appendChild(size);

  // 操作
  const actions = document.createElement('div');
  actions.className = 'res-row__actions';
  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'btn btn-sm btn-primary';
  dlBtn.textContent = '下载';
  dlBtn.addEventListener('click', () => downloadOne(res));
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-sm btn--danger';
  delBtn.textContent = '删除';
  delBtn.addEventListener('click', () => {
    // 二次确认：资源删除后要用时得重新下载（最大的有几十 MB）
    armConfirm(delBtn, '确认删除？', () => removeOne(res));
  });
  actions.appendChild(dlBtn);
  actions.appendChild(delBtn);
  row.appendChild(actions);

  // 行内进度条
  const bar = document.createElement('div');
  bar.className = 'res-row__bar';
  bar.hidden = true;
  const fill = document.createElement('span');
  fill.className = 'res-row__bar-fill';
  bar.appendChild(fill);
  row.appendChild(bar);

  updateRow(res);
  return row;
}

function updateRow(res) {
  const row = document.querySelector(`.res-row[data-id="${res.id}"]`);
  if (!row) return;
  const st = statusOf(res);
  const status = row.querySelector('[data-role="status"]');
  const dlBtn = row.querySelector('.btn-primary');
  const delBtn = row.querySelector('.btn--danger');
  const bar = row.querySelector('.res-row__bar');
  const fill = row.querySelector('.res-row__bar-fill');

  status.className = 'res-row__status';
  if (st.state === 'downloading') {
    const pct = st.total ? Math.round((st.loaded / st.total) * 100) : 0;
    status.textContent = `下载中 ${pct}%`;
    status.classList.add('res-row__status--busy');
    bar.hidden = false;
    fill.style.width = pct + '%';
    dlBtn.disabled = true;
    dlBtn.textContent = '下载中…';
    delBtn.disabled = true;
  } else if (st.state === 'error') {
    status.textContent = '下载失败';
    status.classList.add('res-row__status--error');
    status.title = st.error || '';
    bar.hidden = true;
    dlBtn.disabled = false;
    dlBtn.textContent = '重试';
    delBtn.disabled = !st.cached;
  } else if (st.cached) {
    status.textContent = '已在本地';
    status.classList.add('res-row__status--ready');
    bar.hidden = true;
    dlBtn.disabled = true;
    dlBtn.textContent = '已下载';
    delBtn.disabled = false;
  } else {
    status.textContent = '未下载';
    bar.hidden = true;
    dlBtn.disabled = state.running;
    dlBtn.textContent = '下载';
    delBtn.disabled = true;
  }
}

/* ========== 选择与总进度 ========== */

function updateSelection() {
  const resources = allResources();
  const picked = resources.filter((r) => state.selected.has(r.id));
  const bytes = totalSize(picked);
  const info = document.getElementById('res-selection');
  info.textContent = picked.length ? `已选 ${picked.length} 项 · 约 ${formatBytes(bytes)}` : '未选择';
  const btn = document.getElementById('res-download-all');
  btn.disabled = picked.length === 0 || state.running;
  btn.textContent = state.running ? '下载中…' : '下载所选';
}

/* 全局进度：串行下载，累计字节与瞬时速度 */
const progress = {
  totalBytes: 0,
  doneBytes: 0,
  currentTotal: 0,
  currentLoaded: 0,
  startedAt: 0,
  lastSample: 0,
  lastBytes: 0,
  speed: 0,
};

function resetProgress(totalBytes) {
  progress.totalBytes = totalBytes;
  progress.doneBytes = 0;
  progress.currentTotal = 0;
  progress.currentLoaded = 0;
  progress.startedAt = performance.now();
  progress.lastSample = progress.startedAt;
  progress.lastBytes = 0;
  progress.speed = 0;
  const box = document.getElementById('res-progress');
  box.hidden = false;
  updateProgress();
}

function updateProgress() {
  const loaded = progress.doneBytes + progress.currentLoaded;
  const total = progress.totalBytes || 1;
  const pct = Math.min(100, Math.round((loaded / total) * 100));
  document.getElementById('res-progress-fill').style.width = pct + '%';

  // 速度：两次采样之间的平均速率
  const now = performance.now();
  if (now - progress.lastSample > 400) {
    const deltaBytes = loaded - progress.lastBytes;
    const deltaTime = (now - progress.lastSample) / 1000;
    if (deltaTime > 0) {
      const inst = deltaBytes / deltaTime;
      progress.speed = progress.speed ? progress.speed * 0.6 + inst * 0.4 : inst;
    }
    progress.lastSample = now;
    progress.lastBytes = loaded;
  }

  const speedText = progress.speed > 0 ? ` · ${formatBytes(progress.speed)}/s` : '';
  document.getElementById('res-progress-text').textContent =
    `${formatBytes(loaded)} / ${formatBytes(progress.totalBytes)}${speedText}`;
}

function finishProgress() {
  const box = document.getElementById('res-progress');
  box.hidden = true;
}

/* ========== 下载与删除 ========== */

async function downloadOne(res) {
  if (state.running) return;
  const st = statusOf(res);
  st.state = 'downloading';
  st.loaded = 0;
  st.total = res.size;
  st.error = '';
  updateRow(res);

  try {
    await res.download((loaded, total) => {
      st.loaded = loaded;
      if (total) st.total = total;
      updateRow(res);
    });
    st.cached = true;
    st.state = 'done';
    st.loaded = st.total;
    showToast(`${res.name} 下载完成`, 'success');
  } catch (err) {
    st.state = 'error';
    st.error = err && err.message ? err.message : String(err);
    showToast(`${res.name} 下载失败`, 'error');
  }
  updateRow(res);
  updateUsage();
}

async function removeOne(res) {
  const st = statusOf(res);
  try {
    await res.remove();
    st.cached = false;
    st.state = 'done';
    showToast(`${res.name} 已删除`, 'info');
  } catch {
    showToast(`${res.name} 删除失败`, 'error');
  }
  updateRow(res);
  updateUsage();
}

/** 批量下载所选资源（串行，逐项汇报） */
async function downloadSelected() {
  if (state.running) return;
  const picked = allResources().filter((r) => state.selected.has(r.id) && !statusOf(r).cached);
  if (picked.length === 0) {
    showToast('所选资源已在本地', 'info');
    return;
  }

  state.running = true;
  updateSelection();
  resetProgress(totalSize(picked));

  for (const res of picked) {
    const st = statusOf(res);
    st.state = 'downloading';
    st.loaded = 0;
    st.total = res.size;
    st.error = '';
    updateRow(res);

    progress.currentLoaded = 0;
    progress.currentTotal = res.size;

    try {
      await res.download((loaded, total) => {
        st.loaded = loaded;
        if (total) st.total = total;
        progress.currentLoaded = loaded;
        progress.currentTotal = total || res.size;
        updateRow(res);
        updateProgress();
      });
      st.cached = true;
      st.state = 'done';
      st.loaded = st.total;
      progress.doneBytes += st.total;
    } catch (err) {
      st.state = 'error';
      st.error = err && err.message ? err.message : String(err);
      progress.doneBytes += st.loaded;
      showToast(`${res.name} 下载失败：${st.error}`, 'error');
    }
    progress.currentLoaded = 0;
    updateRow(res);
    updateProgress();
  }

  state.running = false;
  finishProgress();
  updateSelection();
  updateUsage();
  const failed = picked.filter((r) => statusOf(r).state === 'error').length;
  if (failed === 0) showToast('所选资源已全部下载完成', 'success');
  else showToast(`${failed} 项下载失败，可单独重试`, 'warning');
}

/* ========== 占用与初始化 ========== */

async function updateUsage() {
  const el = document.getElementById('res-usage');
  if (!el) return;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      el.textContent = `本站当前占用 ${formatBytes(est.usage)}（配额 ${formatBytes(est.quota)}），其中包含这些离线资源。`;
      return;
    }
  } catch {
    /* 忽略 */
  }
  el.textContent = '本地占用信息不可用。';
}

async function refreshStatuses() {
  for (const res of allResources()) {
    const st = statusOf(res);
    try {
      st.cached = await res.isCached();
    } catch {
      st.cached = false;
    }
    if (st.state !== 'downloading') st.state = st.cached ? 'done' : 'idle';
    updateRow(res);
  }
}

function initResources() {
  renderGroups();
  updateSelection();
  refreshStatuses();
  updateUsage();

  document.getElementById('res-select-all').addEventListener('change', (e) => {
    const all = allResources();
    if (e.target.checked) {
      for (const r of all) state.selected.add(r.id);
    } else {
      state.selected.clear();
    }
    for (const input of document.querySelectorAll('.res-row__check input')) {
      input.checked = e.target.checked;
    }
    updateSelection();
  });

  document.getElementById('res-download-all').addEventListener('click', downloadSelected);
}

export { initResources };
