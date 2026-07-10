/**
 * 二维码工具核心逻辑
 * 两个模式：生成 / 识别
 * 全部本地运行，无任何网络请求
 */

import QRCode from 'qrcode';
import jsQR from 'jsqr';

/* ========== 状态 ========== */
// 最近一次生成的数据，供下载使用
let lastDataUrl = '';
let lastSvg = '';
let lastText = '';
let genTimer = null;

// 摄像头扫描状态
let cameraStream = null;
let cameraScanning = false;
let cameraRafId = null;

/* ========== Tab 切换 ========== */
function switchTab(mode) {
  // 离开识别面板时停止摄像头
  if (cameraScanning) stopCamera();
  document.querySelectorAll('.mode-tab').forEach((t) => {
    t.classList.toggle('mode-tab--active', t.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-panel').forEach((p) => {
    p.classList.toggle('mode-panel--active', p.id === `panel-${mode}`);
  });
}

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

/* ========== 生成模式 ========== */
function getEcl() {
  const checked = document.querySelector('input[name="qr-ecl"]:checked');
  return checked ? checked.value : 'M';
}

function showMeta(html) {
  document.getElementById('qr-meta').innerHTML = html;
}

function showMetaError(msg) {
  document.getElementById('qr-meta').innerHTML = `<span class="meta-error">${msg}</span>`;
}

async function generate() {
  const text = document.getElementById('qr-text').value;
  const img = document.getElementById('qr-preview-img');
  const empty = document.getElementById('qr-preview-empty');
  const btnPng = document.getElementById('btn-qr-png');
  const btnSvg = document.getElementById('btn-qr-svg');

  // 空文本：清空预览
  if (!text) {
    img.hidden = true;
    img.removeAttribute('src');
    empty.hidden = false;
    btnPng.disabled = true;
    btnSvg.disabled = true;
    lastDataUrl = '';
    lastSvg = '';
    lastText = '';
    showMeta('');
    return;
  }

  const level = getEcl();
  const size = parseInt(document.getElementById('qr-size').value, 10);
  const fg = document.getElementById('qr-fg').value;
  const bg = document.getElementById('qr-bg').value;

  try {
    const dataUrl = await QRCode.toDataURL(text, {
      errorCorrectionLevel: level,
      width: size,
      color: { dark: fg, light: bg },
      margin: 2,
    });
    // SVG 同时生成（失败不阻塞 PNG 预览）
    let svg = '';
    try {
      svg = await QRCode.toString(text, {
        type: 'svg',
        errorCorrectionLevel: level,
        width: size,
        color: { dark: fg, light: bg },
        margin: 2,
      });
    } catch {
      svg = '';
    }

    img.src = dataUrl;
    img.hidden = false;
    empty.hidden = true;
    btnPng.disabled = false;
    btnSvg.disabled = !svg;
    lastDataUrl = dataUrl;
    lastSvg = svg;
    lastText = text;

    const byteLen = new TextEncoder().encode(text).length;
    showMeta(`文本 ${text.length} 字符 / ${byteLen} 字节 · 纠错 ${level} · 尺寸 ${size}px`);
  } catch (e) {
    img.hidden = true;
    img.removeAttribute('src');
    empty.hidden = false;
    btnPng.disabled = true;
    btnSvg.disabled = true;
    lastDataUrl = '';
    lastSvg = '';
    showMetaError('生成失败：' + e.message);
  }
}

function scheduleGenerate() {
  clearTimeout(genTimer);
  genTimer = setTimeout(generate, 300);
}

function downloadPng() {
  if (!lastDataUrl) return;
  const a = document.createElement('a');
  a.href = lastDataUrl;
  a.download = 'qrcode.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadSvg() {
  if (!lastSvg) return;
  const blob = new Blob([lastSvg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'qrcode.svg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ========== 识别模式 ========== */
function isValidImageType(file) {
  return file.type.startsWith('image/');
}

// 解码单张图片，返回 { data, location } | null
async function decodeImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height);
    return result ? { data: result.data, location: result.location } : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderResultItem(file, text) {
  const list = document.getElementById('qr-result-list');
  const item = document.createElement('div');
  item.className = 'qr-result-item' + (text === null ? ' qr-result-item--fail' : ' qr-result-item--ok');
  const safeName = escapeHtml(file.name);
  const safeText = text === null ? '未能识别' : escapeHtml(text);
  const copyBtn = text === null
    ? ''
    : `<button class="qr-result__copy btn btn-secondary" data-text="${encodeURIComponent(text)}">复制</button>`;
  item.innerHTML = `
    <div class="qr-result__head">
      <span class="qr-result__name" title="${safeName}">${safeName}</span>
      <span class="qr-result__size">${formatSize(file.size)}</span>
    </div>
    <div class="qr-result__body">
      <code class="qr-result__text">${safeText}</code>
      ${copyBtn}
    </div>
  `;
  // 绑定复制按钮
  const copyEl = item.querySelector('.qr-result__copy');
  if (copyEl) {
    copyEl.addEventListener('click', async () => {
      const t = decodeURIComponent(copyEl.dataset.text || '');
      const ok = await copyText(t);
      if (ok) {
        const original = copyEl.textContent;
        copyEl.textContent = '已复制';
        copyEl.classList.add('qr-result__copy--success');
        setTimeout(() => {
          copyEl.textContent = original;
          copyEl.classList.remove('qr-result__copy--success');
        }, 1200);
      }
    });
  }
  list.appendChild(item);
  document.getElementById('qr-rec-actions').hidden = false;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

async function handleFiles(files) {
  const imgs = Array.from(files).filter(isValidImageType);
  if (!imgs.length) return;
  // 逐张识别（避免并发占用过多内存）
  for (const file of imgs) {
    try {
      const result = await decodeImage(file);
      renderResultItem(file, result ? result.data : null);
    } catch {
      renderResultItem(file, null);
    }
  }
}

function clearRecognizeResults() {
  if (cameraScanning) stopCamera();
  document.getElementById('qr-result-list').innerHTML = '';
  document.getElementById('qr-rec-actions').hidden = true;
}

/* ========== 摄像头扫描 ========== */
async function startCamera() {
  const video = document.getElementById('qr-camera-video');
  const cameraView = document.getElementById('qr-camera');
  const dropzone = document.getElementById('qr-dropzone');
  const statusEl = document.getElementById('qr-camera-status');
  const cameraBtnRow = document.querySelector('.qr-camera-btn-row');

  // 检测 API 支持
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = '您的浏览器不支持摄像头 API，请使用 HTTPS 环境下的现代浏览器';
    cameraView.hidden = false;
    return;
  }

  statusEl.textContent = '正在扫描二维码...';
  cameraView.hidden = false;
  dropzone.hidden = true;
  if (cameraBtnRow) cameraBtnRow.hidden = true;

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    video.srcObject = cameraStream;
    await video.play();
    cameraScanning = true;
    scanLoop();
  } catch (e) {
    let msg = '无法访问摄像头';
    if (e.name === 'NotAllowedError') msg = '摄像头权限被拒绝，请在浏览器设置中允许访问';
    else if (e.name === 'NotFoundError') msg = '未检测到摄像头设备';
    else if (e.name === 'NotReadableError') msg = '摄像头被其他程序占用';
    else if (e.message) msg += '：' + e.message;
    statusEl.textContent = msg;
  }
}

function stopCamera() {
  cameraScanning = false;
  if (cameraRafId) {
    cancelAnimationFrame(cameraRafId);
    cameraRafId = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  const video = document.getElementById('qr-camera-video');
  if (video) video.srcObject = null;
  const cameraView = document.getElementById('qr-camera');
  const dropzone = document.getElementById('qr-dropzone');
  const cameraBtnRow = document.querySelector('.qr-camera-btn-row');
  if (cameraView) cameraView.hidden = true;
  if (dropzone) dropzone.hidden = false;
  if (cameraBtnRow) cameraBtnRow.hidden = false;
}

function scanLoop() {
  if (!cameraScanning) return;
  const video = document.getElementById('qr-camera-video');

  if (video.readyState >= 2 && video.videoWidth > 0) {
    // 缩小到 640px 宽度提升性能
    const scale = Math.min(1, 640 / video.videoWidth);
    const w = Math.floor(video.videoWidth * scale);
    const h = Math.floor(video.videoHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const result = jsQR(imageData.data, imageData.width, imageData.height);

    if (result && result.data) {
      // 识别成功
      const text = result.data;
      stopCamera();
      // 模拟文件对象渲染结果
      const fakeFile = { name: '摄像头扫描', size: 0 };
      renderResultItem(fakeFile, text);
      return;
    }
  }

  cameraRafId = requestAnimationFrame(scanLoop);
}

function setupDropzone() {
  const dz = document.getElementById('qr-dropzone');
  const fileInput = document.getElementById('qr-file');

  // 点击选择
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  // 文件选择
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length) {
      handleFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  // 拖放
  ['dragenter', 'dragover'].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.add('qr-dropzone--active');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.remove('qr-dropzone--active');
    });
  });
  dz.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  });

  // 粘贴识别（Ctrl+V）
  document.addEventListener('paste', (e) => {
    // 仅在识别 Tab 激活时响应
    const recognizeActive = document.getElementById('panel-recognize').classList.contains('mode-panel--active');
    if (!recognizeActive) return;
    if (!e.clipboardData || !e.clipboardData.items) return;
    const files = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      handleFiles(files);
    }
  });
}

/* ========== 初始化 ========== */
function initQrcode() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // 生成：实时（防抖）
  document.getElementById('qr-text').addEventListener('input', scheduleGenerate);
  document.querySelectorAll('input[name="qr-ecl"]').forEach((r) => {
    r.addEventListener('change', scheduleGenerate);
  });
  document.getElementById('qr-fg').addEventListener('input', scheduleGenerate);
  document.getElementById('qr-bg').addEventListener('input', scheduleGenerate);

  // 尺寸滑块：实时更新数值 + 重新生成
  const sizeEl = document.getElementById('qr-size');
  const sizeValue = document.getElementById('qr-size-value');
  sizeEl.addEventListener('input', () => {
    sizeValue.textContent = sizeEl.value + 'px';
    scheduleGenerate();
  });

  // 生成按钮（手动触发，立即生成）
  document.getElementById('btn-qr-generate').addEventListener('click', () => {
    clearTimeout(genTimer);
    generate();
  });

  // 下载
  document.getElementById('btn-qr-png').addEventListener('click', downloadPng);
  document.getElementById('btn-qr-svg').addEventListener('click', downloadSvg);

  // 识别
  setupDropzone();
  document.getElementById('btn-qr-clear-rec').addEventListener('click', clearRecognizeResults);

  // 摄像头扫描
  document.getElementById('btn-qr-camera').addEventListener('click', startCamera);
  document.getElementById('btn-qr-camera-stop').addEventListener('click', stopCamera);
}

export { initQrcode };
