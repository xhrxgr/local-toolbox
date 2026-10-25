/**
 * 文件列表：管理待处理文件集合（增删、拖拽排序）与列表渲染
 * 文件集合状态由本模块持有，app 通过 API 访问
 */
import { escapeHtml, getFileKind, formatFileSize } from '../handlers/utils.js';
import { BIG_FILE_BYTES } from '../operations.js';
import { showToast } from '/assets/js/toast.js';

let files = [];
let lastOp = null;              // 最近一次渲染时使用的操作配置
let filesChangedHandler = null; // 文件变化回调（供 app 刷新元数据）

export function setFilesChangedHandler(fn) {
  filesChangedHandler = fn;
}

export function getFiles() {
  return files;
}

function notifyChanged() {
  if (filesChangedHandler) filesChangedHandler();
}

/** 新增文件：multiple 操作追加，单选操作替换；大文件给出警告 */
export function addFiles(newFiles, op) {
  const incoming = Array.from(newFiles);
  if (incoming.length === 0) return;

  const big = incoming.filter(f => f.size > BIG_FILE_BYTES);
  if (big.length > 0) {
    showToast(`文件较大（${big.map(f => formatFileSize(f.size)).join('、')}），处理耗时与内存占用较高`, 'warning');
  }

  if (op.multiple) {
    files = files.concat(incoming);
  } else {
    files = incoming.slice(0, 1);
  }
  renderFileList(op);
}

/** 移除指定索引的文件 */
export function removeFileAt(index, op) {
  files.splice(index, 1);
  renderFileList(op);
}

/** 清空全部文件 */
export function clearFiles(op) {
  files = [];
  renderFileList(op);
}

/** 渲染文件列表（op 决定是否可拖拽排序） */
export function renderFileList(op) {
  lastOp = op;
  const list = document.getElementById('file-list-items');
  const count = document.getElementById('file-list-count');
  const fileList = document.getElementById('file-list');
  const uploadArea = document.getElementById('upload-area');
  if (!list) return;

  if (files.length === 0) {
    fileList.hidden = true;
    uploadArea.hidden = false;
    notifyChanged();
    return;
  }
  fileList.hidden = false;
  uploadArea.hidden = true;
  const sortable = !!(op && op.multiple && files.length > 1);
  count.textContent = `${files.length} 个文件${sortable ? ' · 拖拽调整顺序' : ''}`;

  list.innerHTML = files.map((f, i) => `
    <div class="file-item${sortable ? ' file-item--sortable' : ''}" data-index="${i}"${sortable ? ' draggable="true"' : ''}>
      <span class="file-item__kind">${getFileKind(f.name)}</span>
      <span class="file-item__name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="file-item__size">${formatFileSize(f.size)}</span>
      <button class="file-item__remove" data-action="remove" data-index="${i}" title="移除" aria-label="移除 ${escapeHtml(f.name)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`).join('');

  list.querySelectorAll('[data-action="remove"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFileAt(parseInt(btn.dataset.index), lastOp);
    });
  });

  if (sortable) setupFileDrag();
  notifyChanged();
}

/* ========== 拖拽排序（仅多选操作） ========== */
let dragFromIndex = null;

function setupFileDrag() {
  const list = document.getElementById('file-list-items');
  list.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      dragFromIndex = parseInt(item.dataset.index);
      item.classList.add('file-item--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragFromIndex));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('file-item--dragover');
    });
    item.addEventListener('dragleave', () => item.classList.remove('file-item--dragover'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('file-item--dragover');
      const to = parseInt(item.dataset.index);
      if (dragFromIndex == null || Number.isNaN(dragFromIndex) || Number.isNaN(to) || dragFromIndex === to) return;
      const [moved] = files.splice(dragFromIndex, 1);
      files.splice(to, 0, moved);
      dragFromIndex = null;
      renderFileList(lastOp);
    });
    item.addEventListener('dragend', () => {
      dragFromIndex = null;
      item.classList.remove('file-item--dragging');
      list.querySelectorAll('.file-item--dragover').forEach(el => el.classList.remove('file-item--dragover'));
    });
  });
}
