/**
 * 扫描文档：协调层
 * 串联状态、渲染管线、四角覆盖层、导入导出与全部交互
 */
import {
  subscribe, getPages, getSelected, selectPage,
  addImageFiles, removePage, movePage, updatePage, clearPages, isImageFile,
} from './state.js';
import { renderPage, defaultCorners } from './render.js';
import { detectCorners, validateQuad, snapToBorder, checkEdgeStrength } from './detect.js';
import { CornerOverlay } from './corners-ui.js';
import { exportPageImage, exportMergedPdf } from './exporter.js';
import { showToast } from '/assets/js/toast.js';

const THUMB_SIZE = 120;
const EDITOR_MAX_SIZE = 1400;

let canvas;
let overlay;
let compareMode = false;      // 按住「看原图」中
let adjustMode = false;       // 四角调整模式（停留式，可松手拖角点）
let editorProgress = null;  // 编辑器渲染的进度回调（滤镜分块时上报）
let isWorking = false;

/* ========== 忙碌遮罩 ========== */
/** 只控制忙碌遮罩显隐，不联动工具栏状态（滤镜切换时工具栏要保持可用）。
 *  ratio 为 0~1；给出时显示进度条与百分比，避免用户只能干等。 */
function showBusyOverlay(show, text, ratio) {
  const busy = document.getElementById('scan-busy');
  const busyText = document.getElementById('scan-busy-text');
  if (busy) busy.hidden = !show;
  if (show && busyText && text) busyText.textContent = text;
  if (show && typeof ratio === 'number') {
    setBusyProgress(ratio);
  } else {
    setBusyProgress(null);
  }
}

/** 更新进度条；传 null 表示这次操作没有可量化的进度 */
function setBusyProgress(ratio) {
  const bar = document.getElementById('scan-busy-bar');
  const fill = document.getElementById('scan-busy-fill');
  const pct = document.getElementById('scan-busy-pct');
  if (!bar || !fill || !pct) return;
  if (ratio == null || Number.isNaN(ratio)) {
    bar.hidden = true;
    pct.hidden = true;
    return;
  }
  const r = Math.max(0, Math.min(1, ratio));
  bar.hidden = false;
  pct.hidden = false;
  fill.style.width = (r * 100).toFixed(1) + '%';
  pct.textContent = Math.round(r * 100) + '%';
}

function setBusy(text, ratio) {
  isWorking = !!text;
  const busy = document.getElementById('scan-busy');
  const busyText = document.getElementById('scan-busy-text');
  if (!busy) return;
  busy.hidden = !text;
  if (text) busyText.textContent = text;
  setBusyProgress(typeof ratio === 'number' ? ratio : null);
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
    // 缩略图也要走矫正：否则列表里是斜的、编辑器里是直的，
    // 与「所见即所得」相悖（编辑器/导出都带矫正）
    const c = await renderPage(page, { maxSize: THUMB_SIZE, applyWarp: true });
    const url = c.toDataURL('image/png');
    updatePage(page.id, { thumb: url });
  } catch {
    // 缩略图失败不影响主流程
  }
}

/* ========== 编辑器 ========== */
let editorRenderToken = 0;
/** 最近一次编辑器渲染的 promise。updatePage 触发的渲染是「即发即忘」，
 *  需要等待完整渲染结束的地方（如滤镜切换的进度提示）可以 await 它。 */
let editorRenderPromise = Promise.resolve();

async function renderEditor() {
  editorRenderPromise = doRenderEditor();
  return editorRenderPromise;
}

async function doRenderEditor() {
  const token = ++editorRenderToken;
  const page = getSelected();
  const empty = document.getElementById('editor-empty');
  if (!page) {
    canvas.hidden = true;
    empty.hidden = false;
    overlay.hide();
    syncToolbar(null);
    return;
  }
  empty.hidden = true;
  canvas.hidden = false;

  // 按住「看原图」或处于「四角调整」模式时，画布显示**导入时的原图**：
  // 不旋转、不加滤镜、不矫正。前者用于快速对比，后者用于拖角点调整。
  const showRaw = compareMode || adjustMode;
  document.getElementById('adjust-bar').hidden = !adjustMode;
  if (showRaw) {
    const raw = renderRaw(page, EDITOR_MAX_SIZE);
    if (token !== editorRenderToken || getSelected() !== page) return;
    paintCanvas(raw);
    // 原图视图：角点即原图相对坐标，省掉旋转换算，且能直接拖拽
    if (page.corners) overlay.setPage(page, true);
    else overlay.hide();
    syncToolbar(page);
    return;
  }

  // 默认视图：旋转 → 曲面矫正 → 滤镜 的结果
  const source = await renderPage(page, {
    maxSize: EDITOR_MAX_SIZE,
    applyWarp: true,
    onProgress: editorProgress,
  });
  // 滤镜是分块异步的，等待期间用户可能又切了页/改了滤镜，过期结果直接丢弃
  if (token !== editorRenderToken || getSelected() !== page) return;
  paintCanvas(source);
  // 矫正结果里角点已被拉直，手柄无处对齐，默认视图不显示
  overlay.hide();
  syncToolbar(page);
}

/** 渲染导入时的原图：不旋转、不加滤镜、不矫正 */
function renderRaw(page, maxSize) {
  const iw = page.img.naturalWidth;
  const ih = page.img.naturalHeight;
  const s = Math.min(1, maxSize / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(iw * s));
  c.height = Math.max(1, Math.round(ih * s));
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(page.img, 0, 0, c.width, c.height);
  return c;
}

/** 图像是否相对导入时有过修改（决定角落图标是否显示） */
function hasEdits(page) {
  return !!page && (
    page.filter !== 'original' ||
    page.rotation !== 0 ||
    !!page.corners ||
    !!page.erased
  );
}

function paintCanvas(source) {
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
}

function syncToolbar(page) {
  const hasPage = !!page;
  document.querySelectorAll('#filter-segmented .segmented__btn').forEach(btn => {
    btn.classList.toggle('segmented__btn--active', hasPage && btn.dataset.filter === page.filter);
  });
  document.getElementById('btn-rotate-left').disabled = !hasPage || isWorking;
  document.getElementById('btn-move-up').disabled = !hasPage || isWorking;
  document.getElementById('btn-erase-ink').disabled = !hasPage || isWorking;
  document.getElementById('btn-move-down').disabled = !hasPage || isWorking;
  document.getElementById('btn-rotate-right').disabled = !hasPage || isWorking;
  document.getElementById('btn-detect').disabled = !hasPage || isWorking;
  document.getElementById('btn-reset-corners').disabled = !hasPage || isWorking;
  // 调整模式下已经看着原图，角落的对比图标该退让
  const cmp = document.getElementById('btn-compare');
  const canCompare = hasEdits(page) && !isWorking && !adjustMode;
  cmp.hidden = !canCompare;
  cmp.disabled = !canCompare;
  const adj = document.getElementById('btn-adjust');
  adj.disabled = !hasPage || isWorking;
  adj.classList.toggle('btn-primary', adjustMode);
  adj.classList.toggle('btn-secondary', !adjustMode);
  // 若图标在隐藏时仍处于按住态（例如处理中去手写），要退出按住
  if (!canCompare && compareMode) {
    compareMode = false;
    cmp.classList.remove('is-holding');
  }
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
  const w = page.img.naturalWidth;
  const h = page.img.naturalHeight;
  let corners = null;
  try {
    corners = await detectCorners(page.img);
  } catch {
    corners = null;
  }

  // 轮廓不明显或纸张超出画面时，检测结果可能是畸形四边形，
  // 直接采用会把正文裁没，因此先做合理性校验，不通过则回退到整图范围
  let rejectReason = null;
  if (!corners) {
    // 彻底没找到纸张边缘：也要告诉用户，否则会误以为「识别成功就是整图」
    showToast('未识别到纸张边缘，已按整图范围处理，可手动拖动角点修正', 'warning', 4600);
  }
  if (corners) {
    // detectCorners 返回 0-1 归一化坐标，几何校验需要像素坐标
    const snapped = snapToBorder(corners);
    const toPx = snapped.map(pt => ({ x: pt.x * w, y: pt.y * h }));
    rejectReason = validateQuad(toPx, w, h);
    if (!rejectReason) {
      // 几何合法不代表语义正确：四边可能落在正文内部，再校验边强度
      const probe = document.createElement('canvas');
      // 探针分辨率不能太低：缩放后细笔画会被模糊，导致漏判
      const pw = Math.min(640, w);
      const ph = Math.max(8, Math.round((h / w) * pw));
      probe.width = pw;
      probe.height = ph;
      const pctx = probe.getContext('2d', { willReadFrequently: true });
      pctx.drawImage(page.img, 0, 0, pw, ph);
      const scaled = snapped.map(pt => ({ x: pt.x * pw, y: pt.y * ph }));
      rejectReason = checkEdgeStrength(scaled, pctx.getImageData(0, 0, pw, ph));
      probe.width = probe.height = 0;
    }
    if (!rejectReason) corners = snapped;
  }

  if (corners && !rejectReason) {
    updatePage(page.id, { corners, cornersDetected: true });
  } else {
    updatePage(page.id, { corners: defaultCorners(page), cornersDetected: false });
  }

  if (rejectReason) {
    showToast(`未识别到清晰的纸张轮廓（${rejectReason}），已按整图范围处理，可手动拖动角点修正`, 'warning', 5200);
  }

  setBusy(null);
  if (getSelected() === page) renderEditor();
}

/* ========== 去手写 ========== */
async function eraseCurrentPage() {
  const page = getSelected();
  if (!page) return;
  const type = document.getElementById('ink-type').value;
  const scope = document.getElementById('ink-scope').value;
  const allPages = scope === 'all' ? getPages() : [page];
  const typeLabel = type === 'red' ? '红笔' : '蓝笔';

  if (allPages.length > 1) {
    const ok = window.confirm(
      `将对全部 ${allPages.length} 页执行${typeLabel}笔迹擦除，每页约需 2~4 秒，确定继续？`
    );
    if (!ok) return;
  }

  setBusy('准备去手写...');
  showCancel(true);
  let done = 0;
  let totalMs = 0;
  let lastCoverage = 0;
  try {
    const mod = await import('./handwriting/app.js');
    for (const p of allPages) {
      if (cancelRequested) break;
      const res = await mod.eraseHandwriting(p, type, (stage, ratio) => {
        const prefix = allPages.length > 1 ? `第 ${done + 1}/${allPages.length} 页 · ` : '';
        setBusy(`${prefix}${stage}...`, ratio);
      });
      // 用修复后的图替换原图；保留当前滤镜设置（滤镜是视图层偏好，不该被静默丢弃），
      // 旋转与四角保持不变（输出与输入同尺寸，几何关系未变）
      // 标记为已擦除：原图已被替换，属于「有异于原图的修改」，
      // 即使没旋转/滤镜/四角，也要让角落的对比图标显示出来
      updatePage(p.id, { img: res.img, thumb: null, erased: true });
      await refreshThumb(p);
      totalMs += res.ms;
      lastCoverage = res.coverage;
      done++;
    }
    renderPageList();
    if (cancelRequested) {
      showToast(`已取消，完成 ${done}/${allPages.length} 页`, 'warning');
    } else if (done > 0) {
      showToast(
        `已擦除 ${done} 页的${typeLabel}笔迹（末页 ${(lastCoverage * 100).toFixed(1)}% 区域，共 ${(totalMs / 1000).toFixed(1)} 秒）。原图已被替换`,
        'success',
        4200
      );
    }
  } catch (err) {
    const msg = (err && err.message) || String(err);
    const cancelled = cancelRequested || /cancel|取消|terminat/i.test(msg);
    if (cancelled) {
      showToast(`已取消，完成 ${done}/${allPages.length} 页`, 'warning');
    } else {
      showToast(msg, err && err.code === 'NO_INK' ? 'warning' : 'error', 4200);
      console.error('[去手写] 失败', err);
    }
  } finally {
    showCancel(false);
    setBusy(null);
  }
}

/* ========== 取消 ========== */
let cancelRequested = false;

/** 忙碌时显示/隐藏取消按钮 */
function showCancel(show) {
  const btn = document.getElementById('btn-cancel');
  if (!btn) return;
  btn.hidden = !show;
  cancelRequested = false;
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
      setBusy(`生成 PDF ${i + 1}/${total}...`, (i + 1) / total);
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
    // 拖拽结束：更新角点并重渲染（矫正结果随之变化）
    const page = getSelected();
    if (page) {
      updatePage(page.id, { corners: page.corners });
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

  // 去手写：擦除彩色笔迹
  document.getElementById('btn-erase-ink').addEventListener('click', () => { eraseCurrentPage(); });

  // 取消：ORT 的 WASM 推理无法在运行中打断，只能终止 Worker
  document.getElementById('btn-cancel').addEventListener('click', async () => {
    cancelRequested = true;
    const btn = document.getElementById('btn-cancel');
    if (btn) btn.hidden = true;
    try {
      const mod = await import('./handwriting/app.js');
      mod.abortInference();
    } catch { /* 模块未加载时无需处理 */ }
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
    btn.addEventListener('click', async () => {
      const page = getSelected();
      if (!page) return;
      const next = btn.dataset.filter;
      if (page.filter === next) return;
      // 滤镜是同步计算（会占住主线程），必须先让浏览器把「处理中」画出来，
      // 否则在大图上点按钮会像没反应。同时禁掉按钮避免连点排队。
      const label = filterLabel(next);
      showBusyOverlay(true, `正在应用「${label}」...`, 0);
      btn.disabled = true;
      // 编辑器渲染是「即发即忘」的，这里挂一个进度回调把分块进度透出来
      editorProgress = (ratio) => setBusyProgress(ratio);
      const t0 = performance.now();
      try {
        // 让出一帧，等遮罩真正渲染出来再开始计算
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        updatePage(page.id, { filter: next });
        // 立刻同步按钮选中态：state 是同步更新的，不必等画布渲染完，
        // 用户点下去马上就能看到反馈，不会以为没点上
        syncToolbar(getSelected() || page);
        // 必须等编辑器渲染真正结束：updatePage 触发的 renderEditor 是即发即忘的，
        // 只等缩略图会让遮罩提前消失，而滤镜还在后台跑——用户依然觉得「没反应」
        await editorRenderPromise;
        await refreshThumb(page);
      } finally {
        // 最短显示时长：处理很快时遮罩只闪 1 帧反而像界面抽了一下，
        // 补足到 220ms 让用户确实看到「正在处理」。慢操作不受影响。
        const elapsed = performance.now() - t0;
        if (elapsed < 220) {
          await new Promise((r) => setTimeout(r, 220 - elapsed));
        }
        btn.disabled = false;
        editorProgress = null;
        showBusyOverlay(false);
      }
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
  // 四角调整：进入后画布切原图 + 显示手柄，可松手逐个拖角点；
  // 再点一次或点「完成」退出，回到矫正结果视图
  const toggleAdjust = () => {
    if (!getSelected()) return;
    adjustMode = !adjustMode;
    if (adjustMode) compareMode = false;
    renderEditor();
  };
  document.getElementById('btn-adjust').addEventListener('click', toggleAdjust);
  document.getElementById('btn-adjust-done').addEventListener('click', () => {
    if (!adjustMode) return;
    adjustMode = false;
    renderEditor();
  });

  document.getElementById('btn-detect').addEventListener('click', () => {
    const page = getSelected();
    if (page) autoDetect(page);
  });
  document.getElementById('btn-reset-corners').addEventListener('click', () => {
    const page = getSelected();
    if (!page) return;
    updatePage(page.id, { corners: defaultCorners(page), cornersDetected: false });
  });

  // 按住看原图：按下时切到未矫正原图（四角手柄可用），松开回到矫正结果
  const cmpBtn = document.getElementById('btn-compare');
  const holdOn = (e) => {
    if (e && e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
    if (compareMode) return;
    compareMode = true;
    cmpBtn.classList.add('is-holding');
    renderEditor();
  };
  const holdOff = () => {
    if (!compareMode) return;
    compareMode = false;
    cmpBtn.classList.remove('is-holding');
    renderEditor();
  };
  cmpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); holdOn(e); });
  cmpBtn.addEventListener('pointerup', holdOff);
  cmpBtn.addEventListener('pointerleave', holdOff);
  cmpBtn.addEventListener('pointercancel', holdOff);
  // 键盘可达：空格/回车等同按住
  cmpBtn.addEventListener('keydown', holdOn);
  cmpBtn.addEventListener('keyup', holdOff);
  cmpBtn.addEventListener('blur', holdOff);

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
