/**
 * OCR 图片识字核心逻辑
 * 基于 tesseract.js，使用 dynamic import 减小首屏体积
 * 识别过程完全本地，图片不上传
 */

/* ========== 通用：复制到剪贴板 ========== */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      document.body.removeChild(ta);
      return false;
    }
  }
}

function flashCopyBtn(btn) {
  const original = btn.textContent;
  btn.textContent = '已复制';
  btn.classList.add('meta-btn--success');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('meta-btn--success');
  }, 1200);
}

/* ========== 工具函数 ========== */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// 支持的图片类型
const ACCEPT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'];

// tesseract.js logger 状态码中文映射
const STATUS_MAP = {
  'loading tesseract core': '加载 Tesseract 核心',
  'initializing tesseract': '初始化 Tesseract',
  'loading language traineddata': '加载语言数据',
  'initializing api': '初始化 API',
  'recognizing text': '识别中',
};

/* ========== 状态 ========== */
let currentFile = null;
let currentObjectUrl = null;
let currentWorker = null;
let isRecognizing = false;

/* ========== 进度更新 ========== */
function updateProgress(m) {
  if (!m || !m.status) return;
  const titleEl = document.getElementById('ocr-progress-title');
  const pctEl = document.getElementById('ocr-progress-pct');
  const fillEl = document.getElementById('ocr-progress-fill');
  const statusEl = document.getElementById('ocr-progress-status');

  const translated = STATUS_MAP[m.status] || m.status;
  titleEl.textContent = translated;
  const pct = Math.round((m.progress || 0) * 100);
  pctEl.textContent = pct + '%';
  fillEl.style.width = pct + '%';
  statusEl.textContent = `${translated} · ${pct}%`;
}

function showProgress() {
  document.getElementById('ocr-progress').hidden = false;
}

function hideProgress() {
  document.getElementById('ocr-progress').hidden = true;
}

function showError(msg) {
  // 复用进度区状态行显示错误
  showProgress();
  document.getElementById('ocr-progress-status').innerHTML =
    `<span class="meta-error">${msg}</span>`;
}

/* ========== 文件加载与预览 ========== */
function loadFile(file) {
  if (!file) return;
  if (!ACCEPT_TYPES.includes(file.type)) {
    showError('不支持的图片类型，仅支持 PNG / JPG / WebP / BMP / GIF');
    return;
  }
  // 释放旧 URL
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  currentFile = file;
  currentObjectUrl = URL.createObjectURL(file);

  const img = document.getElementById('ocr-preview-img');
  img.src = currentObjectUrl;
  document.getElementById('ocr-file-info').textContent =
    `${file.name} · ${formatSize(file.size)}`;
  document.getElementById('ocr-preview').hidden = false;
  document.getElementById('btn-ocr-start').disabled = false;
  // 隐藏旧结果
  document.getElementById('ocr-result').hidden = true;
  // 进度区也复位
  hideProgress();
}

function clearFile() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  currentFile = null;
  document.getElementById('ocr-preview-img').src = '';
  document.getElementById('ocr-preview').hidden = true;
  document.getElementById('ocr-file').value = '';
  document.getElementById('btn-ocr-start').disabled = true;
}

/* ========== 拖放 + 选择 + 粘贴 ========== */
function setupDropzone() {
  const dz = document.getElementById('ocr-dropzone');
  const fileInput = document.getElementById('ocr-file');

  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.add('hash-dropzone--active');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.remove('hash-dropzone--active');
    });
  });
  dz.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) loadFile(file);
  });

  // 全局粘贴图片（Ctrl+V）
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          loadFile(file);
          break;
        }
      }
    }
  });
}

/* ========== 识别流程 ========== */
function setRecognizing(state) {
  isRecognizing = state;
  document.getElementById('btn-ocr-start').disabled = state || !currentFile;
  document.getElementById('btn-ocr-cancel').hidden = !state;
  document.getElementById('ocr-lang').disabled = state;
  document.getElementById('ocr-oem').disabled = state;
}

async function startOcr() {
  if (isRecognizing || !currentFile) return;
  // 捕获到闭包中，避免识别过程中 currentFile 被替换
  const file = currentFile;
  setRecognizing(true);
  showProgress();
  updateProgress({ status: 'loading tesseract core', progress: 0 });

  try {
    // dynamic import 减小首屏体积
    const { createWorker } = await import('tesseract.js');
    const langs = document.getElementById('ocr-lang').value;
    const oem = parseInt(document.getElementById('ocr-oem').value, 10);
    currentWorker = await createWorker(langs, oem, {
      logger: (m) => updateProgress(m),
    });
    const { data } = await currentWorker.recognize(file);
    document.getElementById('ocr-text').value = data.text || '';
    document.getElementById('ocr-confidence').textContent =
      (typeof data.confidence === 'number' ? data.confidence : 0).toFixed(1) + '%';
    document.getElementById('ocr-result').hidden = false;
    updateProgress({ status: '完成', progress: 1 });
  } catch (e) {
    // terminate 引发的错误视为取消
    const msg = (e && e.message) || String(e);
    if (msg.includes('terminate') || msg.includes('aborted')) {
      updateProgress({ status: '已取消', progress: 0 });
    } else {
      showError('识别失败：' + msg);
    }
  } finally {
    if (currentWorker) {
      try { await currentWorker.terminate(); } catch {}
      currentWorker = null;
    }
    setRecognizing(false);
  }
}

async function cancelOcr() {
  if (currentWorker) {
    try { await currentWorker.terminate(); } catch {}
    currentWorker = null;
  }
  setRecognizing(false);
  updateProgress({ status: '已取消', progress: 0 });
}

/* ========== 结果操作 ========== */
async function copyResult(e) {
  const text = document.getElementById('ocr-text').value;
  if (!text) return;
  const ok = await copyText(text);
  if (ok) flashCopyBtn(e.currentTarget);
}

function downloadTxt() {
  const text = document.getElementById('ocr-text').value;
  if (!text) return;
  // UTF-8 BOM 防乱码
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ocr-result.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clearResult() {
  document.getElementById('ocr-text').value = '';
  document.getElementById('ocr-confidence').textContent = '--';
  document.getElementById('ocr-result').hidden = true;
  hideProgress();
}

/* ========== 初始化 ========== */
function initOcr() {
  setupDropzone();
  document.getElementById('btn-ocr-start').addEventListener('click', startOcr);
  document.getElementById('btn-ocr-cancel').addEventListener('click', cancelOcr);
  document.getElementById('btn-ocr-remove').addEventListener('click', clearFile);
  document.getElementById('btn-ocr-copy').addEventListener('click', copyResult);
  document.getElementById('btn-ocr-download').addEventListener('click', downloadTxt);
  document.getElementById('btn-ocr-clear').addEventListener('click', clearResult);
}

export { initOcr };
