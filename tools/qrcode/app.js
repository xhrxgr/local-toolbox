/**
 * 二维码工具核心逻辑
 * 两个模式：生成 / 识别
 * 全部本地运行，无任何网络请求
 */

import QRCode from 'qrcode';
import { copyText } from '/assets/js/clipboard.js';
import { downloadBlob, downloadDataUrl } from '/assets/js/download.js';
import {
  decodeCanvasAsync,
  decodeFiles,
  createVideoScanner,
  STRATEGY_LABELS,
} from '/assets/js/qr-decoder.js';
import { prewarmZxing } from '/assets/js/qr-zxing.js';

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
// 摄像头扫描器（多分辨率轮询 + 帧间投票 + 区域跟踪）
let cameraScanner = null;
// 扫描帧的串行链：扫描是异步的，用 promise 链保证同一时刻只有一帧在处理
let cameraChain = Promise.resolve();

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
// 复制实现见共享模块 assets/js/clipboard.js

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
  downloadDataUrl(lastDataUrl, 'qrcode.png');
}

function downloadSvg() {
  if (!lastSvg) return;
  const blob = new Blob([lastSvg], { type: 'image/svg+xml' });
  downloadBlob(blob, 'qrcode.svg');
}

/* ========== 识别模式 ========== */
function isValidImageType(file) {
  return file.type.startsWith('image/');
}

// 解码单张图片，返回 { data, location, strategy } | null
// 走共享解码管线：多策略级联（光度、尺度、透视矫正、弯曲矫正、分块）
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
    return decodeCanvasAsync(canvas);
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

function renderResultItem(file, text, strategy) {
  const list = document.getElementById('qr-result-list');
  const item = document.createElement('div');
  item.className = 'qr-result-item' + (text === null ? ' qr-result-item--fail' : ' qr-result-item--ok');
  const safeName = escapeHtml(file.name);
  const safeText = text === null ? '未能识别' : escapeHtml(text);
  const copyBtn = text === null
    ? ''
    : `<button class="qr-result__copy btn btn-secondary" data-text="${encodeURIComponent(text)}">复制</button>`;
  // 识别策略标签：告诉用户是靠哪种处理才读出来的，便于判断成败原因
  //
  // 多帧融合的策略名带前缀（如 fuse-zxing-normalized），
  // 表里没有对应项时退回前缀本身，仍然给用户一个可读的说明。
  const strategyLabel = (() => {
    if (!strategy) return '';
    const text = STRATEGY_LABELS[strategy]
      || (String(strategy).split('-')[0] === 'fuse' ? '多帧融合' : '');
    return text ? `<span class="qr-result__strategy">${escapeHtml(text)}</span>` : '';
  })();
  item.innerHTML = `
    <div class="qr-result__head">
      <span class="qr-result__name" title="${safeName}">${safeName}</span>
      <span class="qr-result__meta">
        ${strategyLabel}
        <span class="qr-result__size">${formatSize(file.size)}</span>
      </span>
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

  const list = document.getElementById('qr-result-list');
  const progressEl = document.getElementById('qr-progress');
  list.innerHTML = '';
  document.getElementById('qr-rec-actions').hidden = false;
  if (progressEl) {
    progressEl.hidden = false;
    progressEl.textContent = `正在识别 0/${imgs.length}`;
  }

  // 受控并发解码：解码是 CPU 密集计算，并发太多反而变慢且吃内存
  const items = await decodeFiles(imgs, {
    concurrency: 3,
    onProgress: (done, total) => {
      if (progressEl) progressEl.textContent = `正在识别 ${done}/${total}`;
    },
  });

  // 按原文件顺序展示
  for (const it of items) {
    const r = it.result;
    renderResultItem(it.file, r ? r.data : null, r ? r.strategy : null);
  }
  if (progressEl) {
    progressEl.hidden = true;
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
    cameraScanner = createVideoScanner();
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
    // 扫描器封装了多分辨率轮询、帧间投票、区域跟踪与 zxing 兜底。
    // 它是异步的（zxing 解码要 await），所以用串行链而非 rAF 回调，
    // 避免上一帧还没结束就叠加下一帧。
    cameraChain = cameraChain
      .then(async () => {
        if (!cameraScanning) return;
        let hit = null;
        try {
          hit = await cameraScanner.scanFrame(video);
        } catch {
          hit = null;
        }

        if (hit && hit.data) {
          const text = hit.data;
          stopCamera();
          // 模拟文件对象渲染结果
          const fakeFile = { name: '摄像头扫描', size: 0 };
          renderResultItem(fakeFile, text, hit.strategy);
        }
      })
      .then(() => {
        if (cameraScanning) cameraRafId = requestAnimationFrame(scanLoop);
      });
    return;
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
  // 空闲时预热 zxing 后端：拉取并编译 wasm（约 400KB），
  // 摊掉首次识别时的加载延迟。不阻塞首屏渲染。
  prewarmZxing();

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
