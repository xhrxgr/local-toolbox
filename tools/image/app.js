/**
 * 图片处理工具核心逻辑
 * 3 个模式：压缩 / 裁剪 / 信息
 * 全部本地运行，无任何网络请求
 */

/* ========== 全局状态 ========== */
const state = {
  file: null,        // 当前文件
  img: null,         // 已加载的 Image 对象
  originalURL: null, // 原图 ObjectURL
  compressBlob: null,// 压缩结果 blob
  compressURL: null, // 压缩结果 ObjectURL
  cropBlob: null,    // 裁剪结果 blob
  cropURL: null,     // 裁剪结果 ObjectURL
};

/* ========== 支持的图片类型 ========== */
const ACCEPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
// canvas 可编码的输出类型（gif/bmp 无法由 canvas 编码，会回退为 png）
const ENCODABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const EXT_MAP = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};

/* ========== Tab 切换 ========== */
function switchTab(mode) {
  document.querySelectorAll('.mode-tab').forEach((t) => {
    t.classList.toggle('mode-tab--active', t.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-panel').forEach((p) => {
    p.classList.toggle('mode-panel--active', p.id === `panel-${mode}`);
  });
}

/* ========== 通用工具 ========== */
function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = URL.createObjectURL(file);
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('编码失败'))),
      mime,
      quality
    );
  });
}

// 根据下拉选择和源文件决定输出 MIME
function getOutputMime(formatSelect, file) {
  if (formatSelect === 'keep') {
    if (ENCODABLE_TYPES.includes(file.type)) return file.type;
    return 'image/png'; // gif/bmp 无法 canvas 编码，回退 png
  }
  return formatSelect;
}

function getBaseName(filename) {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

function revoke(obj) {
  if (obj) URL.revokeObjectURL(obj);
  return null;
}

/* ========== 文件选择与加载 ========== */
async function handleFile(file) {
  if (!file) return;
  if (!ACCEPT_TYPES.includes(file.type)) {
    alert('不支持的图片格式，请选择 JPEG / PNG / WebP / GIF / BMP');
    return;
  }

  // 清理旧 URL
  state.originalURL = revoke(state.originalURL);
  state.compressURL = revoke(state.compressURL);
  state.cropURL = revoke(state.cropURL);
  state.compressBlob = null;
  state.cropBlob = null;

  state.file = file;
  try {
    state.img = await loadImage(file);
  } catch (e) {
    alert('图片加载失败：' + e.message);
    return;
  }
  state.originalURL = URL.createObjectURL(file);

  // 更新拖放区文件信息
  const infoEl = document.getElementById('dropzone-info');
  const innerEl = document.getElementById('dropzone-inner');
  document.getElementById('file-info-name').textContent = file.name;
  document.getElementById('file-info-meta').textContent =
    `${state.img.naturalWidth} × ${state.img.naturalHeight} · ${formatBytes(file.size)} · ${EXT_MAP[file.type] || file.type}`;
  infoEl.hidden = false;
  innerEl.style.display = 'none';

  // 重置压缩结果区
  document.getElementById('compress-result').hidden = true;
  // 重置裁剪
  resetCrop();
  document.getElementById('crop-result').hidden = true;
  // 自动切换到压缩 Tab
  switchTab('compress');

  // 绘制裁剪 canvas
  drawCropCanvas();
  // 更新质量滑块可见性
  updateQualityVisibility();
  // 渲染信息 Tab
  renderInfo();
}

function clearFile() {
  state.file = null;
  state.img = null;
  state.originalURL = revoke(state.originalURL);
  state.compressURL = revoke(state.compressURL);
  state.cropURL = revoke(state.cropURL);
  state.compressBlob = null;
  state.cropBlob = null;

  document.getElementById('dropzone-info').hidden = true;
  document.getElementById('dropzone-inner').style.display = '';
  document.getElementById('compress-result').hidden = true;
  document.getElementById('crop-result').hidden = true;
  resetCrop();
  const cropCanvas = document.getElementById('crop-canvas');
  const ctx = cropCanvas.getContext('2d');
  ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
  cropCanvas.width = 0;
  cropCanvas.height = 0;
  renderInfo();
}

/* ========== 压缩模式 ========== */
function updateQualityVisibility() {
  const formatSelect = document.getElementById('compress-format').value;
  const mime = state.file ? getOutputMime(formatSelect, state.file) : formatSelect;
  const showQuality = mime === 'image/jpeg' || mime === 'image/webp';
  document.getElementById('quality-row').style.display = showQuality ? '' : 'none';
}

async function compress() {
  if (!state.img) {
    alert('请先选择图片');
    return;
  }
  const btn = document.getElementById('btn-compress');
  btn.disabled = true;
  btn.textContent = '压缩中…';

  try {
    const formatSelect = document.getElementById('compress-format').value;
    const mime = getOutputMime(formatSelect, state.file);
    const target = parseInt(document.getElementById('compress-target').value, 10);

    // 准备 canvas，绘制原图
    const canvas = document.createElement('canvas');
    canvas.width = state.img.naturalWidth;
    canvas.height = state.img.naturalHeight;
    const ctx = canvas.getContext('2d');
    // JPEG 无 alpha，填充白底避免透明区域变黑
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(state.img, 0, 0);

    let blob;
    const useTarget = target > 0 && (mime === 'image/jpeg' || mime === 'image/webp');

    if (useTarget) {
      blob = await compressToTarget(canvas, target, mime);
    } else if (mime === 'image/jpeg' || mime === 'image/webp') {
      const quality = parseInt(document.getElementById('compress-quality').value, 10) / 100;
      blob = await canvasToBlob(canvas, mime, quality);
    } else {
      // PNG 无损
      blob = await canvasToBlob(canvas, mime);
    }

    state.compressURL = revoke(state.compressURL);
    state.compressBlob = blob;
    state.compressURL = URL.createObjectURL(blob);

    // 渲染结果
    document.getElementById('preview-original').src = state.originalURL;
    document.getElementById('preview-compressed').src = state.compressURL;

    const originalSize = state.file.size;
    const compressedSize = blob.size;
    const reduction = originalSize > 0
      ? Math.max(0, ((originalSize - compressedSize) / originalSize) * 100).toFixed(1)
      : '0';
    const changeText = compressedSize <= originalSize
      ? `减少 ${reduction}%`
      : `增加 ${Math.abs(reduction)}%`;
    document.getElementById('compress-summary').innerHTML =
      `<span class="size-before">${formatBytes(originalSize)}</span>` +
      `<span class="size-arrow">→</span>` +
      `<span class="size-after">${formatBytes(compressedSize)}</span>` +
      `<span class="size-change ${compressedSize <= originalSize ? 'size-change--down' : 'size-change--up'}">${changeText}</span>`;

    document.getElementById('compress-result').hidden = false;
  } catch (e) {
    alert('压缩失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '开始压缩';
  }
}

// 二分法调整 quality 直到 ≤ 目标大小
async function compressToTarget(canvas, targetKB, mime) {
  let lo = 0.01;
  let hi = 1.0;
  let best = null;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const blob = await canvasToBlob(canvas, mime, mid);
    if (blob.size > targetKB * 1024) {
      hi = mid;
    } else {
      lo = mid;
      best = blob;
    }
  }
  // 用 lo（满足条件的最大质量）再次生成确保结果
  if (!best) best = await canvasToBlob(canvas, mime, lo);
  return best;
}

function downloadCompress() {
  if (!state.compressBlob || !state.file) return;
  const mime = state.compressBlob.type;
  const ext = EXT_MAP[mime] || 'png';
  downloadBlob(state.compressBlob, `${getBaseName(state.file.name)}-compressed.${ext}`);
}

/* ========== 裁剪模式 ========== */
const cropState = {
  active: false,
  startX: 0,
  startY: 0,
  curX: 0,
  curY: 0,
  hasSelection: false,
  // 显示坐标系下的选区
  rect: { left: 0, top: 0, width: 0, height: 0 },
};

function drawCropCanvas() {
  if (!state.img) return;
  const canvas = document.getElementById('crop-canvas');
  canvas.width = state.img.naturalWidth;
  canvas.height = state.img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(state.img, 0, 0);
  resetCrop();
}

function resetCrop() {
  cropState.active = false;
  cropState.hasSelection = false;
  cropState.rect = { left: 0, top: 0, width: 0, height: 0 };
  const sel = document.getElementById('crop-selection');
  sel.hidden = true;
  sel.style.left = '0px';
  sel.style.top = '0px';
  sel.style.width = '0px';
  sel.style.height = '0px';
  document.getElementById('btn-crop').disabled = true;
}

function getCanvasDisplayRect() {
  const canvas = document.getElementById('crop-canvas');
  return canvas.getBoundingClientRect();
}

function getDisplayPoint(e) {
  const rect = getCanvasDisplayRect();
  return {
    x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
    y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
  };
}

function updateSelectionFromDrag() {
  const rect = getCanvasDisplayRect();
  const ratio = parseFloat(document.getElementById('crop-ratio').value);
  const dx = cropState.curX - cropState.startX;
  const dy = cropState.curY - cropState.startY;
  let width, height, left, top;

  if (ratio > 0) {
    width = Math.abs(dx);
    height = width / ratio;
    left = dx >= 0 ? cropState.startX : cropState.startX - width;
    top = dy >= 0 ? cropState.startY : cropState.startY - height;
  } else {
    left = Math.min(cropState.startX, cropState.curX);
    top = Math.min(cropState.startY, cropState.curY);
    width = Math.abs(dx);
    height = Math.abs(dy);
  }

  // 夹紧到 canvas 显示边界
  if (left < 0) {
    width += left;
    left = 0;
    if (ratio > 0) height = width / ratio;
  }
  if (top < 0) {
    height += top;
    top = 0;
  }
  if (left + width > rect.width) {
    width = rect.width - left;
    if (ratio > 0) height = width / ratio;
  }
  if (top + height > rect.height) {
    height = rect.height - top;
  }

  cropState.rect = { left, top, width, height };
  renderSelection();
}

function renderSelection() {
  const sel = document.getElementById('crop-selection');
  const { left, top, width, height } = cropState.rect;
  if (width < 4 || height < 4) {
    sel.hidden = true;
    cropState.hasSelection = false;
    document.getElementById('btn-crop').disabled = true;
    return;
  }
  sel.hidden = false;
  sel.style.left = left + 'px';
  sel.style.top = top + 'px';
  sel.style.width = width + 'px';
  sel.style.height = height + 'px';
  cropState.hasSelection = true;
  document.getElementById('btn-crop').disabled = false;
}

function initCropEvents() {
  const wrap = document.getElementById('crop-canvas-wrap');

  wrap.addEventListener('mousedown', (e) => {
    if (!state.img) return;
    if (e.button !== 0) return;
    const p = getDisplayPoint(e);
    cropState.active = true;
    cropState.startX = p.x;
    cropState.startY = p.y;
    cropState.curX = p.x;
    cropState.curY = p.y;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!cropState.active) return;
    const p = getDisplayPoint(e);
    cropState.curX = p.x;
    cropState.curY = p.y;
    updateSelectionFromDrag();
  });

  window.addEventListener('mouseup', () => {
    if (!cropState.active) return;
    cropState.active = false;
    renderSelection();
  });

  // 触摸支持
  wrap.addEventListener('touchstart', (e) => {
    if (!state.img || !e.touches[0]) return;
    const t = e.touches[0];
    const fake = { clientX: t.clientX, clientY: t.clientY, button: 0, preventDefault: () => e.preventDefault() };
    const p = getDisplayPoint(fake);
    cropState.active = true;
    cropState.startX = p.x;
    cropState.startY = p.y;
    cropState.curX = p.x;
    cropState.curY = p.y;
    e.preventDefault();
  }, { passive: false });

  wrap.addEventListener('touchmove', (e) => {
    if (!cropState.active || !e.touches[0]) return;
    const t = e.touches[0];
    const rect = getCanvasDisplayRect();
    cropState.curX = Math.max(0, Math.min(t.clientX - rect.left, rect.width));
    cropState.curY = Math.max(0, Math.min(t.clientY - rect.top, rect.height));
    updateSelectionFromDrag();
    e.preventDefault();
  }, { passive: false });

  wrap.addEventListener('touchend', () => {
    if (!cropState.active) return;
    cropState.active = false;
    renderSelection();
  });

  // 宽高比变化时重新调整已有选区
  document.getElementById('crop-ratio').addEventListener('change', () => {
    if (cropState.hasSelection) {
      cropState.curX = cropState.startX + cropState.rect.width;
      cropState.curY = cropState.startY + cropState.rect.height;
      updateSelectionFromDrag();
    }
  });
}

function cropSelection() {
  if (!state.img || !cropState.hasSelection) return;
  const canvas = document.getElementById('crop-canvas');
  const rect = getCanvasDisplayRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const srcX = Math.round(cropState.rect.left * scaleX);
  const srcY = Math.round(cropState.rect.top * scaleY);
  const srcW = Math.round(cropState.rect.width * scaleX);
  const srcH = Math.round(cropState.rect.height * scaleY);

  if (srcW < 1 || srcH < 1) return;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = srcW;
  cropCanvas.height = srcH;
  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

  cropCanvas.toBlob((blob) => {
    if (!blob) {
      alert('裁剪失败：编码错误');
      return;
    }
    state.cropURL = revoke(state.cropURL);
    state.cropBlob = blob;
    state.cropURL = URL.createObjectURL(blob);
    document.getElementById('preview-crop').src = state.cropURL;
    document.getElementById('crop-result').hidden = false;
  }, 'image/png');
}

function downloadCrop() {
  if (!state.cropBlob || !state.file) return;
  downloadBlob(state.cropBlob, `${getBaseName(state.file.name)}-cropped.png`);
}

/* ========== 信息模式 ========== */
function renderInfo() {
  const basic = document.getElementById('info-basic');
  if (!state.file || !state.img) {
    basic.innerHTML = '<div class="info-empty">请先选择图片</div>';
    document.getElementById('info-exif').hidden = true;
    document.getElementById('info-exif-empty').style.display = '';
    document.getElementById('info-exif-empty').textContent = '请先选择图片';
    return;
  }
  const f = state.file;
  basic.innerHTML = `
    <div class="info-cell"><span class="info-key">文件名</span><span class="info-val">${escapeHtml(f.name)}</span></div>
    <div class="info-cell"><span class="info-key">格式</span><span class="info-val">${EXT_MAP[f.type] || f.type}（${f.type}）</span></div>
    <div class="info-cell"><span class="info-key">宽 × 高</span><span class="info-val">${state.img.naturalWidth} × ${state.img.naturalHeight} px</span></div>
    <div class="info-cell"><span class="info-key">文件大小</span><span class="info-val">${formatBytes(f.size)}</span></div>
  `;
  // 解析 EXIF
  loadExif();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function loadExif() {
  const table = document.getElementById('info-exif');
  const empty = document.getElementById('info-exif-empty');
  table.hidden = true;
  empty.style.display = '';
  empty.textContent = '解析中…';

  if (!state.file || state.file.type !== 'image/jpeg') {
    empty.textContent = '无 EXIF 信息（仅 JPEG 含 EXIF）';
    return;
  }

  try {
    const exif = await parseExif(state.file);
    if (!exif) {
      empty.textContent = '无 EXIF 信息';
      return;
    }
    const rows = [];
    const addRow = (label, val) => {
      if (val !== null && val !== undefined && val !== '') rows.push({ label, val });
    };
    addRow('相机制造商', exif.Make);
    addRow('型号', exif.Model);
    addRow('拍摄时间', exif.DateTime);
    addRow('曝光时间', exif.ExposureTime);
    addRow('光圈', exif.FNumber);
    addRow('ISO 感光度', exif.ISO);
    addRow('焦距', exif.FocalLength);
    addRow('GPS', exif.GPS);

    if (rows.length === 0) {
      empty.textContent = '无 EXIF 信息';
      return;
    }
    table.querySelector('tbody').innerHTML = rows
      .map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.val)}</td></tr>`)
      .join('');
    table.hidden = false;
    empty.style.display = 'none';
  } catch (e) {
    empty.textContent = 'EXIF 解析失败：' + e.message;
  }
}

/* ========== EXIF 解析器 ========== */
function parseExif(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new DataView(e.target.result);
        // 检查 JPEG SOI marker (0xFFD8)
        if (data.byteLength < 4 || data.getUint16(0) !== 0xFFD8) { resolve(null); return; }
        let offset = 2;
        while (offset < data.byteLength) {
          const marker = data.getUint16(offset);
          offset += 2;
          // APP1 (EXIF)
          if (marker === 0xFFE1) {
            const segLen = data.getUint16(offset);
            // 检查 "Exif\0\0"
            if (
              data.getUint32(offset + 2) === 0x45786966 &&
              data.getUint16(offset + 6) === 0x0000
            ) {
              const tiffOffset = offset + 8;
              const result = parseTiff(data, tiffOffset);
              resolve(result);
              return;
            }
            offset += segLen;
          } else if (marker === 0xFFDA) {
            // SOS - 扫描开始，后面无 APP
            break;
          } else if ((marker & 0xFF00) !== 0xFF00) {
            break;
          } else {
            const segLen = data.getUint16(offset);
            offset += segLen;
          }
        }
        resolve(null);
      } catch (err) {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file);
  });
}

// 解析 TIFF 头 + IFD
function parseTiff(data, tiffOffset) {
  const byteOrder = data.getUint16(tiffOffset);
  const le = byteOrder === 0x4949; // "II" 小端；"MM"(0x4D4D) 大端
  // magic 0x002A
  const ifd0Offset = tiffOffset + data.getUint32(tiffOffset + 4, le);
  const result = {};
  const tags0 = parseIfd(data, tiffOffset, ifd0Offset, le);
  // IFD0 标签
  if (tags0[0x010F]) result.Make = tags0[0x010F];
  if (tags0[0x0110]) result.Model = tags0[0x0110];
  if (tags0[0x0132]) result.DateTime = tags0[0x0132];
  // Exif IFD
  if (tags0[0x8769]) {
    const exifOffset = tiffOffset + tags0[0x8769];
    const exifTags = parseIfd(data, tiffOffset, exifOffset, le);
    if (exifTags[0x829A]) result.ExposureTime = formatExposure(exifTags[0x829A]);
    if (exifTags[0x829D]) result.FNumber = formatFNumber(exifTags[0x829D]);
    if (exifTags[0x8827]) result.ISO = exifTags[0x8827];
    if (exifTags[0x920A]) result.FocalLength = formatFocal(exifTags[0x920A]);
  }
  // GPS IFD
  if (tags0[0x8825]) {
    const gpsOffset = tiffOffset + tags0[0x8825];
    const gpsTags = parseIfd(data, tiffOffset, gpsOffset, le);
    result.GPS = formatGps(gpsTags);
  }
  return result;
}

// 解析单个 IFD，返回 { tag: value } 映射
function parseIfd(data, tiffOffset, ifdOffset, le) {
  const tags = {};
  const numEntries = data.getUint16(ifdOffset, le);
  let offset = ifdOffset + 2;
  for (let i = 0; i < numEntries; i++) {
    const tag = data.getUint16(offset, le);
    const type = data.getUint16(offset + 2, le);
    const count = data.getUint32(offset + 4, le);
    const valueOffset = offset + 8;
    try {
      tags[tag] = readExifValue(data, tiffOffset, type, count, valueOffset, le);
    } catch (_) {
      // 忽略无法读取的条目
    }
    offset += 12;
  }
  return tags;
}

// 读取 EXIF 值
function readExifValue(data, tiffOffset, type, count, valueOffset, le) {
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const size = sizes[type] || 1;
  const totalBytes = size * count;
  let dataOffset;
  if (totalBytes <= 4) {
    dataOffset = valueOffset;
  } else {
    dataOffset = tiffOffset + data.getUint32(valueOffset, le);
  }

  if (type === 2) {
    // ASCII
    let str = '';
    for (let i = 0; i < count; i++) {
      const b = data.getUint8(dataOffset + i);
      if (b === 0) break;
      str += String.fromCharCode(b);
    }
    return str.trim();
  } else if (type === 3) {
    // SHORT
    const arr = [];
    for (let i = 0; i < count; i++) arr.push(data.getUint16(dataOffset + i * 2, le));
    return count === 1 ? arr[0] : arr;
  } else if (type === 4) {
    // LONG
    const arr = [];
    for (let i = 0; i < count; i++) arr.push(data.getUint32(dataOffset + i * 4, le));
    return count === 1 ? arr[0] : arr;
  } else if (type === 5) {
    // RATIONAL
    const arr = [];
    for (let i = 0; i < count; i++) {
      const num = data.getUint32(dataOffset + i * 8, le);
      const den = data.getUint32(dataOffset + i * 8 + 4, le);
      arr.push({ num, den });
    }
    return count === 1 ? arr[0] : arr;
  } else if (type === 7) {
    // UNDEFINED
    let str = '';
    for (let i = 0; i < count; i++) str += String.fromCharCode(data.getUint8(dataOffset + i));
    return str;
  }
  return null;
}

function formatExposure(r) {
  const num = r.num;
  const den = r.den;
  if (den === 0) return null;
  if (den === 1) return num + ' s';
  // 通常曝光 < 1s，存储为分数
  if (num === 1) return '1/' + den + ' s';
  // 通用：约简为 1/X
  const sec = num / den;
  if (sec < 1) return '1/' + Math.round(1 / sec) + ' s';
  return sec.toFixed(1) + ' s';
}

function formatFNumber(r) {
  if (r.den === 0) return null;
  return 'f/' + (r.num / r.den).toFixed(1);
}

function formatFocal(r) {
  if (r.den === 0) return null;
  return (r.num / r.den).toFixed(0) + ' mm';
}

function formatGps(gpsTags) {
  const latRef = gpsTags[0x0001];
  const lat = gpsTags[0x0002];
  const lonRef = gpsTags[0x0003];
  const lon = gpsTags[0x0004];
  if (!lat || !lon) return null;
  const latDec = dmsToDecimal(lat, latRef);
  const lonDec = dmsToDecimal(lon, lonRef);
  if (latDec === null || lonDec === null) return null;
  return `${latDec.toFixed(6)}, ${lonDec.toFixed(6)}`;
}

function dmsToDecimal(ratios, ref) {
  if (!Array.isArray(ratios) || ratios.length < 3) return null;
  const d = ratios[0].den !== 0 ? ratios[0].num / ratios[0].den : 0;
  const m = ratios[1].den !== 0 ? ratios[1].num / ratios[1].den : 0;
  const s = ratios[2].den !== 0 ? ratios[2].num / ratios[2].den : 0;
  let dec = d + m / 60 + s / 3600;
  if (ref === 'S' || ref === 'W') dec = -dec;
  return dec;
}

/* ========== 初始化 ========== */
function initImage() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // 文件拖放区
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const inner = document.getElementById('dropzone-inner');

  inner.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
    fileInput.value = '';
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dropzone--drag');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dropzone--drag');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dropzone--drag');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  // 移除文件
  document.getElementById('file-info-remove').addEventListener('click', clearFile);

  // 压缩
  document.getElementById('compress-format').addEventListener('change', updateQualityVisibility);
  document.getElementById('compress-quality').addEventListener('input', (e) => {
    document.getElementById('quality-value').textContent = e.target.value;
  });
  document.getElementById('btn-compress').addEventListener('click', compress);
  document.getElementById('btn-download-compress').addEventListener('click', downloadCompress);

  // 裁剪
  initCropEvents();
  document.getElementById('btn-crop').addEventListener('click', cropSelection);
  document.getElementById('btn-download-crop').addEventListener('click', downloadCrop);

  // 初始渲染信息占位
  renderInfo();
}

export { initImage };
