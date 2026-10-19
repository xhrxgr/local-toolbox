/**
 * 扫描文档：协调层
 * 串联状态、渲染管线、四角覆盖层、导入导出与全部交互
 */
import {
  subscribe, getPages, getSelected, selectPage,
  addImageFiles, removePage, movePage, updatePage, clearPages, isImageFile,
} from './state.js';
import { renderPage, defaultCorners } from './render.js';
import { detectCorners } from './detect.js';
import { CornerOverlay } from './corners-ui.js';
import { exportPageImage, exportMergedPdf } from './exporter.js';
import { showToast } from './lib/toast.js';

const THUMB_SIZE = 120;
const EDITOR_MAX_SIZE = 1400;

let canvas;
let overlay;
let warpTimer = null;
let isWorking = false;

/* ========== 忙碌遮罩 ========== */
function setBusy(text) {
  isWorking = !!text;
  const busy = document.getElementById('scan-busy');
  const busyText = document.getElementById('scan-busy-text');
  if (!busy) return;
  busy.hidden = !text;
  if (text) busyText.textContent = text;
  // 忙碌状态影响导出/工具按钮可用性
  updateFooter();
  syncToolbar(getSelected());
}

/* ========== 页面列表 ========== */
function renderPageList() {
  const pages = getPages();
  const list = document.getElementById('page-list');
  const count = document.getElementById('page-count');
  const drop = document.getElementById('scan-drop');
  count.textContent = `${pages.length} 页`;
  drop.hidden = pages.length > 0;

  list.innerHTML = pages.map((p, i) => `
    <div class="page-item${p.id === getSelected()?.id ? ' page-item--active' : ''}" data-id="${p.id}" data-index="${i}" draggable="true">
      <span class="page-item__index">${i + 1}</span>
      <img class="page-item__thumb" src="${p.thumb || ''}" alt="" />
      <div class="page-item__meta">
        <span class="page-item__name" title="${escapeAttr(p.name)}">${escapeHtml(p.name)}</span>
        <div class="page-item__tags">
          <span class="page-item__tag">${filterLabel(p.filter)}</span>
          ${p.rotation ? `<span class="page-item__tag">${p.rotation}°</span>` : ''}
          ${p.cornersDetected ? '<span class="page-item__tag">已识别</span>' : ''}
        </div>
      </div>
      <button class="page-item__remove" data-remove="${p.id}" title="删除此页" aria-label="删除第 ${i + 1} 页">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `).join('');

  // 点击选中 / 删除
  list.querySelectorAll('.page-item').forEach(el => {
    el.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('[data-remove]');
      if (removeBtn) {
        e.stopPropagation();
        removePage(removeBtn.dataset.remove);
        return;
      }
      selectPage(el.dataset.id);
    });
    // 拖拽排序
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.index);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('page-item--dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('page-item--dragging'));
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('page-item--dragover');
    });
    el.addEventListener('dragleave', () => el.classList.remove('page-item--dragover'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('page-item--dragover');
      const from = parseInt(e.dataTransfer.getData('text/plain'));
      const to = parseInt(el.dataset.index);
      if (!Number.isNaN(from) && !Number.isNaN(to)) movePage(from, to);
    });
  });

  updateFooter();
}

function updateFooter() {
  const pages = getPages();
  const selected = getSelected();
  document.getElementById('export-info').textContent =
    pages.length > 0 ? `共 ${pages.length} 页${selected ? ` · 当前第 ${pages.indexOf(selected) + 1} 页` : ''}` : '共 0 页';
  document.getElementById('btn-export-one').disabled = !selected || isWorking;
  document.getElementById('btn-export-pdf').disabled = pages.length === 0 || isWorking;
}

function filterLabel(f) {
  return f === 'bw' ? '黑白' : f === 'enhance' ? '增强' : '原图';
}

/* ========== 缩略图 ========== */
async function refreshThumb(page) {
  try {
    const c = renderPage(page, { maxSize: THUMB_SIZE, applyWarp: false });
    const url = c.toDataURL('image/png');
    updatePage(page.id, { thumb: url });
  } catch {
    // 缩略图失败不影响主流程
  }
}

/* ========== 编辑器 ========== */
function renderEditor() {
  const page = getSelected();
  const empty = document.getElementById('editor-empty');
  if (!page) {
    canvas.hidden = true;
    empty.hidden = false;
    overlay.hide();
    document.getElementById('warp-preview').hidden = true;
    syncToolbar(null);
    return;
  }
  empty.hidden = true;
  canvas.hidden = false;

  // 画布恒为「旋转 + 滤镜」原图视图，四角覆盖层常驻可拖拽
  const source = renderPage(page, { maxSize: EDITOR_MAX_SIZE, applyWarp: false });
  paintCanvas(source);

  if (page.corners) {
    overlay.setPage(page);
    if (document.getElementById('chk-live-preview').checked) {
      scheduleWarpPreview(page);
    } else {
      document.getElementById('warp-preview').hidden = true;
    }
  } else {
    overlay.hide();
    document.getElementById('warp-preview').hidden = true;
  }
  syncToolbar(page);
}

function paintCanvas(source) {
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
}

/** 矫正效果小预览（debounce，避免拖拽时频繁重算） */
function scheduleWarpPreview(page) {
  clearTimeout(warpTimer);
  warpTimer = setTimeout(() => {
    if (getSelected() !== page || !page.corners) return;
    try {
      const warped = renderPage(page, { maxSize: 360, applyWarp: true });
      const img = document.getElementById('warp-preview-img');
      img.src = warped.toDataURL('image/png');
      document.getElementById('warp-preview').hidden = false;
    } catch {
      // 矫正失败（四角退化等）时隐藏预览
      document.getElementById('warp-preview').hidden = true;
    }
  }, 200);
}

function syncToolbar(page) {
  const hasPage = !!page;
  document.querySelectorAll('#filter-segmented .segmented__btn').forEach(btn => {
    btn.classList.toggle('segmented__btn--active', hasPage && btn.dataset.filter === page.filter);
  });
  document.getElementById('btn-rotate-left').disabled = !hasPage || isWorking;
  document.getElementById('btn-move-up').disabled = !hasPage || isWorking;
  document.getElementById('btn-move-down').disabled = !hasPage || isWorking;
  document.getElementById('btn-rotate-right').disabled = !hasPage || isWorking;
  document.getElementById('btn-detect').disabled = !hasPage || isWorking;
  document.getElementById('btn-reset-corners').disabled = !hasPage || isWorking;
}

/* ========== 导入 ========== */
// 导入串行队列：避免两次快速导入的 busy 状态与页序互相踩
let importQueue = Promise.resolve();

function enqueueImport(fileList) {
  // 必须同步拷贝：事件的 FileList / DataTransfer.files 在事件结束后即失效，
  // 而 importFiles 在队列微任务里才执行，直接传引用会拿到空列表
  const files = Array.from(fileList);
  importQueue = importQueue
    .then(() => importFiles(files))
    .catch((err) => {
      console.error('[导入失败]', err);
      showToast('导入失败：' + (err.message || String(err)), 'error');
    });
  return importQueue;
}

async function importFiles(files) {
  const images = files.filter(isImageFile);
  if (images.length === 0) {
    showToast('请选择图片文件', 'warning');
    return;
  }
  setBusy('导入图片...');
  try {
    const { added, failed } = await addImageFiles(images);
    // 失败反馈：HEIC 等不支持格式 / 文件损坏，不能静默跳过
    if (failed.length > 0) {
      const names = failed.map(f => f.name).join('、');
      const detail = `无法导入 ${failed.length} 个文件（${names}）：${failed[0].reason}`;
      if (added.length === 0) {
        showToast(detail, 'error', 6000);
        return;
      }
      showToast(`已导入 ${added.length} 张，${detail}`, 'warning', 6000);
    } else {
      showToast(`已导入 ${added.length} 张图片`, 'success');
    }
    // 缩略图 + 自动识别四角（按导入顺序处理）
    for (const page of added) {
      await refreshThumb(page);
      await autoDetect(page);
    }
  } finally {
    setBusy(null);
  }
}

/** 自动识别四角；失败则用默认整图四角 */
async function autoDetect(page) {
  setBusy(`识别四角：${page.name}`);
  try {
    const corners = await detectCorners(page.img);
    if (corners) {
      updatePage(page.id, { corners, cornersDetected: true });
    } else {
      updatePage(page.id, { corners: defaultCorners(page), cornersDetected: false });
    }
  } catch {
    updatePage(page.id, { corners: defaultCorners(page), cornersDetected: false });
  } finally {
    setBusy(null);
    if (getSelected() === page) renderEditor();
  }
}

/* ========== 导出 ========== */
async function onExportOne() {
  const page = getSelected();
  if (!page) return;
  setBusy('导出图片...');
  try {
    await exportPageImage(page);
  } catch (err) {
    showToast('导出失败：' + err.message, 'error');
  } finally {
    setBusy(null);
  }
}

async function onExportPdf() {
  const pages = getPages();
  if (pages.length === 0) return;
  // 快照：导出期间用户若继续导入，不把新页塞进本次 PDF
  const snapshot = [...pages];
  setBusy('生成 PDF...');
  try {
    await exportMergedPdf(snapshot, (i, total) => {
      setBusy(`生成 PDF ${i + 1}/${total}...`);
    });
  } catch (err) {
    showToast('导出失败：' + err.message, 'error');
  } finally {
    setBusy(null);
  }
}

/* ========== 工具函数 ========== */
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/* ========== 初始化 ========== */
export function initScanDoc() {
  canvas = document.getElementById('scan-canvas');
  overlay = new CornerOverlay(document.getElementById('corner-layer'), canvas, () => {
    // 拖拽结束：更新缩略图角点状态 + 实时预览
    const page = getSelected();
    if (page) {
      updatePage(page.id, { corners: page.corners });
      if (document.getElementById('chk-live-preview').checked) scheduleWarpPreview(page);
    }
  });

  // 导入
  const fileInput = document.getElementById('file-input');
  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    enqueueImport(e.target.files);
    e.target.value = '';
  });

  // 拖放导入（桌面）
  const drop = document.getElementById('scan-drop');
  const wrap = document.getElementById('scan-pages');
  ['dragover', 'dragleave', 'drop'].forEach(type => {
    wrap.addEventListener(type, (e) => {
      e.preventDefault();
      if (type === 'dragover') drop.classList.add('scan-drop--active');
      else drop.classList.remove('scan-drop--active');
      if (type === 'drop' && e.dataTransfer.files.length) enqueueImport(e.dataTransfer.files);
    });
  });
  // 拖放区本身可点击：移动端没有拖拽，点它要能打开文件选择器
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  // 粘贴导入
  document.addEventListener('paste', (e) => {
    const files = [];
    for (const item of e.clipboardData?.items || []) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f && isImageFile(f)) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      enqueueImport(files);
    }
  });

  // 清空（二次确认：清空会丢失全部滤镜/旋转/四角编辑结果，不可撤销）
  const clearBtn = document.getElementById('btn-clear');
  let clearArmed = false;
  let clearTimer = null;
  clearBtn.addEventListener('click', () => {
    if (getPages().length === 0) return;
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.textContent = '确认清空？';
      clearBtn.classList.add('btn-clear-all--armed');
      clearTimer = setTimeout(() => {
        clearArmed = false;
        clearBtn.textContent = '清空';
        clearBtn.classList.remove('btn-clear-all--armed');
      }, 4000);
      return;
    }
    clearTimeout(clearTimer);
    clearArmed = false;
    clearBtn.textContent = '清空';
    clearBtn.classList.remove('btn-clear-all--armed');
    clearPages();
    showToast('已清空', 'info');
  });

  // 页面顺序（上移 / 下移：移动端 HTML5 拖拽不可用，同时提供键盘可达路径）
  const moveSelected = (dir) => {
    const page = getSelected();
    if (!page) return;
    const idx = getPages().indexOf(page);
    const to = idx + dir;
    if (to < 0 || to >= getPages().length) return;
    movePage(idx, to);
  };
  document.getElementById('btn-move-up').addEventListener('click', () => moveSelected(-1));
  document.getElementById('btn-move-down').addEventListener('click', () => moveSelected(1));

  // 滤镜切换（同步刷新缩略图，保持列表与画布一致）
  document.querySelectorAll('#filter-segmented .segmented__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = getSelected();
      if (!page) return;
      updatePage(page.id, { filter: btn.dataset.filter });
      refreshThumb(page);
    });
  });

  // 旋转（同步刷新缩略图）
  document.getElementById('btn-rotate-left').addEventListener('click', () => {
    const page = getSelected();
    if (page) {
      updatePage(page.id, { rotation: (page.rotation + 270) % 360 });
      refreshThumb(page);
    }
  });
  document.getElementById('btn-rotate-right').addEventListener('click', () => {
    const page = getSelected();
    if (page) {
      updatePage(page.id, { rotation: (page.rotation + 90) % 360 });
      refreshThumb(page);
    }
  });

  // 自动识别 / 重置四角
  document.getElementById('btn-detect').addEventListener('click', () => {
    const page = getSelected();
    if (page) autoDetect(page);
  });
  document.getElementById('btn-reset-corners').addEventListener('click', () => {
    const page = getSelected();
    if (!page) return;
    updatePage(page.id, { corners: defaultCorners(page), cornersDetected: false });
  });

  // 实时预览开关
  document.getElementById('chk-live-preview').addEventListener('change', (e) => {
    const page = getSelected();
    if (e.target.checked && page) {
      scheduleWarpPreview(page);
    } else {
      clearTimeout(warpTimer);
      document.getElementById('warp-preview').hidden = true;
    }
  });

  // 导出
  document.getElementById('btn-export-one').addEventListener('click', onExportOne);
  document.getElementById('btn-export-pdf').addEventListener('click', onExportPdf);

  // 阻止页面默认拖放
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // 状态订阅
  subscribe(() => {
    renderPageList();
    renderEditor();
  });

  // 窗口尺寸变化 → 覆盖层重定位
  window.addEventListener('resize', () => {
    const page = getSelected();
    if (page?.corners) overlay.redraw();
  });

  renderPageList();
  renderEditor();
}
