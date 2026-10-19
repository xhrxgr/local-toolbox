/**
 * 笔迹消除：协调层
 * 负责状态流转、画布渲染、交互绑定与推理调度
 */
import { showToast } from '../ui/toast.js';
import { MaskEditor } from './mask-editor.js';
import { detectColoredInk, maskRatio } from './detect-ink.js';
import { MODEL_INFO, ensureModel, isModelCached, requestPersistence, runtimeWasmPaths } from './model-manager.js';

const MAX_EDGE = 2000; // 超大图先缩放，控制内存峰值

const el = {};
let original = null;      // { canvas, width, height, rgba }
let maskEditor = new MaskEditor();
let resultCanvas = null;
let worker = null;
let modelBuffer = null;
let workerIdleTimer = null;

let brushMode = 'paint'; // 'paint' | 'erase'
let brushRadius = 18;
let showMask = true;
let stroke = null;       // 当前拖拽笔画
let rafPending = false;

let inited = false;

/** 首次进入「图片」Tab 时才挂载，确保首屏不加载模型与推理代码 */
export function initInkErase() {
  if (inited) return;
  inited = true;
  const ids = [
    'ink-drop', 'ink-file', 'ink-meta', 'ink-meta-name', 'ink-meta-size', 'ink-meta-dim',
    'ink-canvas-wrap', 'ink-mode-paint', 'ink-mode-erase', 'ink-undo', 'ink-redo',
    'ink-brush', 'ink-brush-val', 'ink-show-mask', 'ink-stage', 'ink-canvas', 'ink-overlay',
    'ink-detect-type', 'ink-sensitivity', 'ink-sensitivity-val', 'ink-detect', 'ink-detect-hint',
    'ink-expand', 'ink-expand-val', 'ink-ratio', 'ink-clear-mask', 'ink-model-state', 'ink-model-size',
    'ink-run', 'ink-run-hint', 'ink-progress', 'ink-progress-fill', 'ink-progress-text',
    'ink-result-card', 'ink-compare', 'ink-result-canvas', 'ink-divider', 'ink-result-meta',
    'ink-download', 'ink-again', 'toast-container',
  ];
  ids.forEach(id => { el[id] = document.getElementById(id); });

  bindImport();
  bindTools();
  bindDetect();
  bindRun();
  bindResult();
  refreshCacheState();
}

function refreshCacheState() {
  isModelCached().then((cached) => {
    el['ink-model-state'].textContent = cached ? '已缓存，可离线使用' : '未加载';
  });
}

/* ========== 图片导入 ========== */
function bindImport() {
  el['ink-drop'].addEventListener('click', () => el['ink-file'].click());
  el['ink-drop'].addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el['ink-file'].click(); }
  });
  el['ink-file'].addEventListener('change', (e) => {
    if (e.target.files?.[0]) loadFile(e.target.files[0]);
    e.target.value = '';
  });

  const wrap = document.querySelector('.ink-tool');
  ['dragover', 'dragleave', 'drop'].forEach(type => {
    wrap.addEventListener(type, (e) => {
      e.preventDefault();
      if (type === 'dragover') el['ink-drop'].classList.add('ink-drop--active');
      else el['ink-drop'].classList.remove('ink-drop--active');
      if (type === 'drop' && e.dataTransfer.files?.length) loadFile(e.dataTransfer.files[0]);
    });
  });

  document.addEventListener('paste', (e) => {
    for (const item of e.clipboardData?.items || []) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) { loadFile(f); e.preventDefault(); }
        return;
      }
    }
  });
}

async function loadFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('请选择 JPG / PNG / WebP 图片', 'warning');
    return;
  }
  setBusy('读取图片...');
  try {
    // 立即释放文件引用，避免大图长期占用内存
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const imageData = ctx.getImageData(0, 0, w, h);
    original = { canvas, width: w, height: h, rgba: imageData.data, name: file.name };

    el['ink-meta'].hidden = false;
    el['ink-meta-name'].textContent = file.name;
    el['ink-meta-size'].textContent = formatBytes(file.size);
    el['ink-meta-dim'].textContent = `${w} × ${h}${scale < 1 ? '（已缩放）' : ''}`;
    el['ink-canvas-wrap'].hidden = false;
    el['ink-result-card'].hidden = true;
    resultCanvas = null;

    maskEditor.reset(w, h);
    setupCanvasSize();
    drawAll();
    updateStatus();
    showToast('图片已载入，可自动识别或手动涂抹', 'success');
  } catch (err) {
    showToast('图片读取失败：' + (err.message || err), 'error');
  } finally {
    setBusy(null);
  }
}

function setupCanvasSize() {
  const stage = el['ink-stage'];
  const availW = Math.min(stage.clientWidth || 640, 720);
  const scale = Math.min(1, availW / original.width);
  const dispW = Math.round(original.width * scale);
  const dispH = Math.round(original.height * scale);
  [el['ink-canvas'], el['ink-overlay']].forEach((c) => {
    c.style.width = `${dispW}px`;
    c.style.height = `${dispH}px`;
    c.width = original.width;
    c.height = original.height;
  });
}

/* ========== 渲染 ========== */
function drawAll() {
  if (!original) return;
  drawBase();
  drawOverlay();
}

function drawBase() {
  const ctx = el['ink-canvas'].getContext('2d');
  ctx.putImageData(new ImageData(original.rgba.slice(), original.width, original.height), 0, 0);
}

function drawOverlay() {
  const ctx = el['ink-overlay'].getContext('2d');
  const { width: w, height: h } = original;
  ctx.clearRect(0, 0, w, h);
  if (!showMask) return;
  // 把掩码叠成半透明红色遮罩
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0, p = 0; i < maskEditor.mask.length; i++, p += 4) {
    if (maskEditor.mask[i]) {
      d[p] = 239; d[p + 1] = 68; d[p + 2] = 68; d[p + 3] = 128;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function scheduleDraw() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; drawOverlay(); });
}

/* ========== 掩码编辑交互 ========== */
function bindTools() {
  el['ink-mode-paint'].addEventListener('click', () => setBrushMode('paint'));
  el['ink-mode-erase'].addEventListener('click', () => setBrushMode('erase'));

  el['ink-brush'].addEventListener('input', (e) => {
    brushRadius = parseInt(e.target.value, 10);
    el['ink-brush-val'].textContent = brushRadius;
  });
  el['ink-show-mask'].addEventListener('change', (e) => { showMask = e.target.checked; scheduleDraw(); });

  el['ink-undo'].addEventListener('click', () => { if (maskEditor.undo()) { scheduleDraw(); updateStatus(); } });
  el['ink-redo'].addEventListener('click', () => { if (maskEditor.redo()) { scheduleDraw(); updateStatus(); } });
  el['ink-clear-mask'].addEventListener('click', () => { maskEditor.clear(); scheduleDraw(); updateStatus(); });

  el['ink-expand'].addEventListener('input', (e) => { el['ink-expand-val'].textContent = e.target.value; });
  el['ink-expand'].addEventListener('change', (e) => {
    const r = parseInt(e.target.value, 10);
    if (r > 0) { maskEditor.expand(r); scheduleDraw(); updateStatus(); }
  });

  const overlay = el['ink-overlay'];
  overlay.addEventListener('pointerdown', (e) => {
    if (!original) return;
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId);
    const pt = toImageCoords(e);
    stroke = { last: pt, value: brushMode === 'paint' ? 255 : 0 };
    maskEditor.beginStroke();
    applyStroke(pt, pt);
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    e.preventDefault();
    const pt = toImageCoords(e);
    applyStroke(stroke.last, pt);
    stroke.last = pt;
  });
  const finish = () => {
    if (!stroke) return;
    stroke = null;
    maskEditor.endStroke();
    scheduleDraw();
    updateStatus();
  };
  overlay.addEventListener('pointerup', finish);
  overlay.addEventListener('pointercancel', finish);
  overlay.addEventListener('pointerleave', finish);

  window.addEventListener('resize', () => { if (original) { setupCanvasSize(); drawAll(); } });
}

function setBrushMode(mode) {
  brushMode = mode;
  el['ink-mode-paint'].classList.toggle('ink-tool-btn--active', mode === 'paint');
  el['ink-mode-erase'].classList.toggle('ink-tool-btn--active', mode === 'erase');
}

/** 屏幕坐标 → 图像坐标 */
function toImageCoords(e) {
  const rect = el['ink-overlay'].getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * original.width,
    y: ((e.clientY - rect.top) / rect.height) * original.height,
  };
}

function applyStroke(from, to) {
  maskEditor.paint(from.x, from.y, to.x, to.y, brushRadius, stroke.value);
  scheduleDraw();
}

/* ========== 自动识别 ========== */
function bindDetect() {
  el['ink-sensitivity'].addEventListener('input', (e) => {
    el['ink-sensitivity-val'].textContent = e.target.value;
  });
  el['ink-detect'].addEventListener('click', () => {
    if (!original) return;
    const type = el['ink-detect-type'].value;
    const sens = parseInt(el['ink-sensitivity'].value, 10);
    const hits = detectColoredInk(original.rgba, maskEditor.mask, type, sens);
    // 自动应用当前膨胀值：检测出的掩码边缘通常比笔迹可见边缘小 1~2px，
    // 不膨胀的话修复后笔画会残留一圈原色（实测残留率约 54%）
    const expandPx = parseInt(el['ink-expand'].value, 10) || 0;
    if (hits > 0 && expandPx > 0) maskEditor.expand(expandPx);
    if (hits === 0) {
      showToast('未检测到该颜色笔迹。可降低灵敏度，或用画笔手动涂抹标记。', 'warning', 4200);
    } else {
      maskEditor.snapshot();
      const pct = (maskRatio(maskEditor.mask) * 100).toFixed(1);
      showToast(`已标记 ${pct}% 区域，确认无误后再执行擦除`, 'success');
    }
    scheduleDraw();
    updateStatus();
  });
}

/* ========== 推理 ========== */
function bindRun() {
  el['ink-run'].addEventListener('click', run);
}

async function run() {
  if (!original) return;
  const ratio = maskRatio(maskEditor.mask);
  if (ratio <= 0) {
    showToast('请先标记要擦除的区域', 'warning');
    return;
  }
  if (ratio > 0.6) {
    showToast('掩码覆盖超过 60%，可能误选了大片区域，确认后再继续', 'warning', 4000);
    return;
  }

  el['ink-run'].disabled = true;
  el['ink-run-hint'].textContent = '正在准备模型...';
  showProgress(true, '准备中...', 0);

  try {
    // 1. 模型（缓存优先，带完整性校验）
    setModelState('加载中...');
    requestPersistence();
    modelBuffer = await ensureModel((loaded, total) => {
      const pct = total ? loaded / total : 0;
      showProgress(true, `下载模型 ${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`, pct * 0.6);
    });
    setModelState(modelBuffer ? '已就绪' : '未加载');
    refreshCacheState();

    // 2. 推理会话
    showProgress(true, '初始化推理环境...', 0.65);
    await ensureWorker(modelBuffer);

    // 3. 执行修复
    showProgress(true, 'AI 修复中...', 0.8);
    const out = await runInference();

    resultCanvas = renderResult(out.data, out.width, out.height);
    showResult(out.ms);
    showProgress(false);
    el['ink-run-hint'].textContent = '已完成，可下载或返回继续调整掩码。';
  } catch (err) {
    const msg = (err && err.message) || String(err);
    showProgress(false);
    el['ink-run-hint'].textContent = '处理失败：' + msg;
    showToast('处理失败：' + msg, 'error', 5000);
    console.error('[笔迹消除] 推理失败', err);
    el['ink-run'].disabled = false;
  }
}

/** 创建或复用 Worker */
function ensureWorker(modelBuf) {
  if (worker && modelBuffer) return Promise.resolve();
  disposeWorker();
  return new Promise((resolve, reject) => {
    worker = new Worker(new URL('./inpaint-worker.js', import.meta.url), { type: 'module' });
    const onMessage = (e) => {
      const d = e.data;
      if (d.type === 'stage' && d.stage === 'session-ready') {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        resolve();
      } else if (d.type === 'error') {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        reject(new Error(d.message));
      }
    };
    const onError = (err) => reject(new Error(err.message || '推理环境启动失败'));
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'init', modelBuffer: modelBuf, wasmPaths: runtimeWasmPaths() });
  });
}

function runInference() {
  return new Promise((resolve, reject) => {
    const onMessage = (e) => {
      const d = e.data;
      if (d.type === 'result') {
        cleanup();
        resolve(d);
      } else if (d.type === 'error') {
        cleanup();
        reject(new Error(d.message));
      }
    };
    const onError = (err) => { cleanup(); reject(new Error(err.message || '推理中断')); };
    const cleanup = () => {
      worker?.removeEventListener('message', onMessage);
      worker?.removeEventListener('error', onError);
      scheduleWorkerDispose();
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({
      type: 'run',
      image: original.rgba.slice().buffer,
      mask: maskEditor.mask.slice().buffer,
      width: original.width,
      height: original.height,
    });
  });
}

/** 把模型输出画到结果画布
 *  模型输出是 uint8 [1,3,H,W] 的 CHW 三平面布局（已在模型上实测确认），
 *  需要按平面取通道再组装成 RGBA，直接按下标连续读会串色成整片黑。 */
function renderResult(data, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(width, height);
  const d = out.data;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    d[p] = data[i];              // R 平面
    d[p + 1] = data[n + i];      // G 平面
    d[p + 2] = data[n * 2 + i];  // B 平面
    d[p + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/* ========== Worker 生命周期 ========== */
// 空闲后销毁：ORT 的 WASM 堆不会自动归还给系统，长期持有会在手机上累积内存
function scheduleWorkerDispose() {
  clearTimeout(workerIdleTimer);
  workerIdleTimer = setTimeout(() => {
    if (worker) {
      worker.postMessage({ type: 'dispose' });
      setTimeout(() => { worker?.terminate(); worker = null; }, 200);
    }
  }, 30000);
}

function disposeWorker() {
  clearTimeout(workerIdleTimer);
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

/* ========== 结果展示 ========== */
function bindResult() {
  const divider = el['ink-divider'];
  let dragging = false;

  const setPos = (clientX) => {
    const rect = el['ink-compare'].getBoundingClientRect();
    const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    divider.style.left = `${pct}%`;
  };
  divider.addEventListener('pointerdown', (e) => {
    dragging = true;
    divider.setPointerCapture(e.pointerId);
    setPos(e.clientX);
  });
  divider.addEventListener('pointermove', (e) => { if (dragging) setPos(e.clientX); });
  divider.addEventListener('pointerup', () => { dragging = false; });

  el['ink-download'].addEventListener('click', () => {
    if (!resultCanvas) return;
    resultCanvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (original?.name || 'image').replace(/\.[^.]+$/, '') + '_擦除.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  });

  el['ink-again'].addEventListener('click', () => {
    el['ink-result-card'].hidden = true;
    drawAll();
  });
}

function showResult(ms) {
  const card = el['ink-result-card'];
  card.hidden = false;
  const src = resultCanvas;
  const maxW = 520;
  const scale = Math.min(1, maxW / src.width);
  const c = el['ink-result-canvas'];
  c.width = src.width;
  c.height = src.height;
  c.style.width = `${Math.round(src.width * scale)}px`;
  c.style.height = `${Math.round(src.height * scale)}px`;
  c.getContext('2d').drawImage(src, 0, 0);

  // 对比视图底层铺原图，上层裁切显示结果
  el['ink-compare'].style.setProperty('--orig-bg', `url(${original.canvas.toDataURL('image/png')})`);
  el['ink-compare'].style.aspectRatio = `${src.width} / ${src.height}`;

  el['ink-result-meta'].textContent = `推理耗时 ${(ms / 1000).toFixed(1)} 秒 · 输出 ${src.width}×${src.height}`;
  el['ink-divider'].style.left = '50%';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ========== 状态与提示 ========== */
function updateStatus() {
  const has = !!original;
  el['ink-detect'].disabled = !has;
  el['ink-undo'].disabled = !has || !maskEditor.canUndo;
  el['ink-redo'].disabled = !has || !maskEditor.canRedo;
  const ratio = maskRatio(maskEditor.mask);
  el['ink-ratio'].textContent = (ratio * 100).toFixed(1) + '%';
  el['ink-run'].disabled = !has || ratio <= 0;
  el['ink-run-hint'].textContent = has
    ? (ratio > 0 ? '将按标记区域修复背景。' : '需先标记要擦除的区域。')
    : '需先选择图片。';
  if (has && ratio > 0) el['ink-detect-hint'].textContent = `当前待擦除 ${(ratio * 100).toFixed(1)}%，可用画笔修正。`;
}

function setModelState(text) { el['ink-model-state'].textContent = text; }

function showProgress(show, text = '', pct = 0) {
  el['ink-progress'].hidden = !show;
  if (!show) return;
  el['ink-progress-text'].textContent = text;
  el['ink-progress-fill'].style.width = `${Math.round(pct * 100)}%`;
}

function setBusy(text) {
  // 简化：读取阶段用按钮禁用表达
  el['ink-file'].disabled = !!text;
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}