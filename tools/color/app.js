/**
 * 颜色工具核心逻辑
 * 5 个模式：色彩转换 / 对比度 / 取色器 / 渐变 / 调色板
 * 全部本地运行，无任何网络请求
 */

/* ========== Tab 切换 ========== */
function switchTab(mode) {
  document.querySelectorAll('.mode-tab').forEach((t) => {
    t.classList.toggle('mode-tab--active', t.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-panel').forEach((p) => {
    p.classList.toggle('mode-panel--active', p.id === `panel-${mode}`);
  });
}

/* ========== 颜色转换工具函数（纯函数） ========== */
// HEX → RGB，支持 #6366f1 / 6366f1 / #6f6 / 6f6，无效返回 null
function parseHex(input) {
  if (!input) return null;
  let s = String(input).trim().replace(/^#/, '');
  if (s.length === 3) {
    s = s.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// RGB → HEX，输出 #rrggbb
function rgbToHex(r, g, b) {
  const h = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

// RGB → "rgb(r,g,b)"
function rgbToCss([r, g, b]) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

// RGB → HSL，返回 [0-360, 0-100, 0-100]
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = 0; s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

// HSL → RGB，输入 [0-360, 0-100, 0-100]，返回 [0-255]
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// RGB → HSV，返回 [0-360, 0-100, 0-100]
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d === 0) {
    h = 0;
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, v * 100];
}

// HSV → RGB，输入 [0-360, 0-100, 0-100]，返回 [0-255]
function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  v = Math.max(0, Math.min(100, v)) / 100;
  let r, g, b;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/* ========== WCAG 对比度 ========== */
function relativeLuminance(r, g, b) {
  const toLinear = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1[0], rgb1[1], rgb1[2]);
  const l2 = relativeLuminance(rgb2[0], rgb2[1], rgb2[2]);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
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

// 复制并给出按钮反馈
async function copyAndFeedback(text, btn) {
  const ok = await copyText(text);
  if (ok && btn) {
    const original = btn.textContent;
    btn.textContent = '已复制';
    btn.classList.add('copy-success');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copy-success');
    }, 1200);
  }
  return ok;
}

// 数值夹紧
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/* ========== 色彩转换模式 ========== */
let convertState = { r: 99, g: 102, b: 241 }; // #6366f1

function setConvertColor(rgb, source) {
  convertState = { r: rgb[0], g: rgb[1], b: rgb[2] };
  const { r, g, b } = convertState;
  // 预览
  document.getElementById('convert-preview').style.background = rgbToCss([r, g, b]);
  // HEX
  if (source !== 'hex') {
    document.getElementById('convert-hex').value = rgbToHex(r, g, b);
  }
  document.getElementById('convert-error').textContent = '';
  // RGB
  if (source !== 'rgb') {
    document.getElementById('convert-r').value = r;
    document.getElementById('convert-g').value = g;
    document.getElementById('convert-b').value = b;
  }
  // HSL
  if (source !== 'hsl') {
    const [h, s, l] = rgbToHsl(r, g, b);
    document.getElementById('convert-h').value = Math.round(h);
    document.getElementById('convert-s').value = Math.round(s);
    document.getElementById('convert-l').value = Math.round(l);
  }
  // HSV（只读，始终更新）
  const [hv, sv, vv] = rgbToHsv(r, g, b);
  document.getElementById('convert-hv-h').value = Math.round(hv);
  document.getElementById('convert-hv-s').value = Math.round(sv);
  document.getElementById('convert-hv-v').value = Math.round(vv);
}

function onHexInput() {
  const rgb = parseHex(document.getElementById('convert-hex').value);
  const errEl = document.getElementById('convert-error');
  if (!rgb) {
    const v = document.getElementById('convert-hex').value.trim();
    errEl.textContent = v ? '无效的 HEX（应为 #6366f1 或 6366f1）' : '';
    return;
  }
  setConvertColor(rgb, 'hex');
}

function onRgbInput() {
  const r = clamp(parseInt(document.getElementById('convert-r').value, 10) || 0, 0, 255);
  const g = clamp(parseInt(document.getElementById('convert-g').value, 10) || 0, 0, 255);
  const b = clamp(parseInt(document.getElementById('convert-b').value, 10) || 0, 0, 255);
  setConvertColor([r, g, b], 'rgb');
}

function onHslInput() {
  const h = clamp(parseFloat(document.getElementById('convert-h').value) || 0, 0, 360);
  const s = clamp(parseFloat(document.getElementById('convert-s').value) || 0, 0, 100);
  const l = clamp(parseFloat(document.getElementById('convert-l').value) || 0, 0, 100);
  setConvertColor(hslToRgb(h, s, l), 'hsl');
}

async function onConvertPicker() {
  if (typeof EyeDropper === 'undefined') return;
  try {
    const result = await new EyeDropper().open();
    const rgb = parseHex(result.sRGBHex);
    if (rgb) setConvertColor(rgb, 'picker');
  } catch {
    // 用户取消，忽略
  }
}

/* ========== 对比度模式 ========== */
function setContrastChip(id, rgb) {
  document.getElementById(id).style.background = rgbToCss(rgb);
}

function updateContrast() {
  const fg = parseHex(document.getElementById('contrast-fg').value);
  const bg = parseHex(document.getElementById('contrast-bg').value);
  const ratioEl = document.getElementById('contrast-ratio');
  const large = document.getElementById('contrast-preview-large');
  const small = document.getElementById('contrast-preview-small');
  const badges = ['wcag-aa', 'wcag-aa-large', 'wcag-aaa', 'wcag-aaa-large'];

  if (!fg || !bg) {
    ratioEl.textContent = '—';
    badges.forEach((id) => setWcagBadge(id, null));
    return;
  }

  setContrastChip('contrast-fg-preview', fg);
  setContrastChip('contrast-bg-preview', bg);

  const ratio = contrastRatio(fg, bg);
  ratioEl.textContent = ratio.toFixed(2) + ' : 1';

  // 预览文字
  const fgCss = rgbToCss(fg);
  const bgCss = rgbToCss(bg);
  large.style.color = fgCss;
  large.style.background = bgCss;
  small.style.color = fgCss;
  small.style.background = bgCss;

  setWcagBadge('wcag-aa', ratio >= 4.5);
  setWcagBadge('wcag-aa-large', ratio >= 3);
  setWcagBadge('wcag-aaa', ratio >= 7);
  setWcagBadge('wcag-aaa-large', ratio >= 4.5);
}

function setWcagBadge(id, pass) {
  const el = document.getElementById(id);
  const mark = el.querySelector('.wcag-badge__mark');
  el.classList.remove('wcag-badge--pass', 'wcag-badge--fail');
  if (pass === null) {
    mark.textContent = '—';
    return;
  }
  if (pass) {
    mark.textContent = '✓';
    el.classList.add('wcag-badge--pass');
  } else {
    mark.textContent = '✗';
    el.classList.add('wcag-badge--fail');
  }
}

/* ========== 取色器模式 ========== */
function setupPickerSupport() {
  const supported = typeof EyeDropper !== 'undefined';
  const btn = document.getElementById('picker-start');
  const msg = document.getElementById('picker-unsupported');
  if (!supported) {
    btn.disabled = true;
    msg.hidden = false;
  } else {
    btn.disabled = false;
    msg.hidden = true;
  }
}

async function onPickerStart() {
  if (typeof EyeDropper === 'undefined') return;
  const btn = document.getElementById('picker-start');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '取色中…';
  try {
    const result = await new EyeDropper().open();
    const hex = result.sRGBHex;
    const rgb = parseHex(hex);
    if (!rgb) return;
    const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    document.getElementById('picker-result').hidden = false;
    document.getElementById('picker-preview').style.background = rgbToCss(rgb);
    document.getElementById('picker-hex').textContent = hex.toLowerCase();
    document.getElementById('picker-rgb').textContent = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    document.getElementById('picker-hsl').textContent = `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
  } catch {
    // 用户取消，忽略
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ========== 渐变模式 ========== */
function setGradientChip(id, rgb) {
  document.getElementById(id).style.background = rgbToCss(rgb);
}

function updateGradient() {
  const start = parseHex(document.getElementById('gradient-start').value);
  const end = parseHex(document.getElementById('gradient-end').value);
  const angle = parseInt(document.getElementById('gradient-angle').value, 10) || 0;
  document.getElementById('gradient-angle-value').textContent = angle + '°';
  const codeEl = document.getElementById('gradient-code');
  const preview = document.getElementById('gradient-preview');

  if (!start || !end) {
    codeEl.textContent = '请输入有效的起止颜色';
    preview.style.background = '';
    return;
  }
  setGradientChip('gradient-start-preview', start);
  setGradientChip('gradient-end-preview', end);
  const startHex = rgbToHex(start[0], start[1], start[2]);
  const endHex = rgbToHex(end[0], end[1], end[2]);
  const css = `linear-gradient(${angle}deg, ${startHex}, ${endHex})`;
  codeEl.textContent = css;
  preview.style.background = css;
}

/* ========== 调色板模式（中位切分法） ========== */
// 把所有像素递归切分，直到 bucket 数 = 目标数
function medianCut(pixels, count) {
  if (pixels.length === 0) return [];
  let buckets = [pixels];
  while (buckets.length < count) {
    let bestIdx = -1, bestRange = -1, bestChannel = 0;
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      if (bucket.length < 2) continue;
      let maxRange = -1, ch = 0;
      for (let c = 0; c < 3; c++) {
        let mn = 255, mx = 0;
        for (let j = 0; j < bucket.length; j++) {
          const v = bucket[j][c];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        const range = mx - mn;
        if (range > maxRange) {
          maxRange = range;
          ch = c;
        }
      }
      if (maxRange > bestRange) {
        bestRange = maxRange;
        bestIdx = i;
        bestChannel = ch;
      }
    }
    if (bestIdx === -1) break; // 无法继续切分
    const bucket = buckets[bestIdx];
    bucket.sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = Math.floor(bucket.length / 2);
    const left = bucket.slice(0, mid);
    const right = bucket.slice(mid);
    buckets.splice(bestIdx, 1, left, right);
  }
  // 每个 bucket 取平均色
  const total = pixels.length;
  return buckets
    .map((b) => {
      let r = 0, g = 0, bl = 0;
      for (let i = 0; i < b.length; i++) {
        r += b[i][0]; g += b[i][1]; bl += b[i][2];
      }
      const n = b.length;
      return {
        rgb: [Math.round(r / n), Math.round(g / n), Math.round(bl / n)],
        count: n,
        percent: (n / total) * 100,
      };
    })
    .sort((a, b) => b.count - a.count);
}

let paletteImage = null; // 缓存当前图片，色块数量变化时重新提取

function extractPalette(img, count) {
  const canvas = document.createElement('canvas');
  const size = 100;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 125) continue; // 跳过透明像素
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (pixels.length === 0) {
    return { error: '图片没有有效像素（可能完全透明）' };
  }
  const palette = medianCut(pixels, count);
  return { palette };
}

function renderPalette(palette) {
  const grid = document.getElementById('palette-grid');
  grid.innerHTML = '';
  palette.forEach((item) => {
    const hex = rgbToHex(item.rgb[0], item.rgb[1], item.rgb[2]);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'palette-cell';
    cell.title = '点击复制 ' + hex;
    cell.innerHTML = `
      <span class="palette-cell__color" style="background:${rgbToCss(item.rgb)}"></span>
      <span class="palette-cell__hex">${hex.toUpperCase()}</span>
      <span class="palette-cell__pct">${item.percent.toFixed(1)}%</span>
    `;
    cell.addEventListener('click', () => copyAndFeedback(hex, cell));
    grid.appendChild(cell);
  });
}

function processPalette() {
  const status = document.getElementById('palette-status');
  const grid = document.getElementById('palette-grid');
  if (!paletteImage) {
    status.textContent = '';
    grid.innerHTML = '';
    return;
  }
  const count = parseInt(document.getElementById('palette-count').value, 10) || 8;
  status.textContent = '正在提取颜色…';
  grid.innerHTML = '';
  // 异步让 UI 更新
  setTimeout(() => {
    const result = extractPalette(paletteImage, count);
    if (result.error) {
      status.textContent = result.error;
      return;
    }
    status.textContent = `已提取 ${result.palette.length} 种主色调（点击色块复制 HEX）`;
    renderPalette(result.palette);
  }, 0);
}

function loadImageFile(file) {
  const status = document.getElementById('palette-status');
  if (!file || !file.type.startsWith('image/')) {
    status.textContent = '请选择有效的图片文件';
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      paletteImage = img;
      processPalette();
    };
    img.onerror = () => {
      status.textContent = '图片加载失败';
    };
    img.src = e.target.result;
  };
  reader.onerror = () => {
    status.textContent = '文件读取失败';
  };
  reader.readAsDataURL(file);
}

function setupPaletteDrop() {
  const drop = document.getElementById('palette-drop');
  const fileInput = document.getElementById('palette-file');

  // 点击或回车触发文件选择
  drop.addEventListener('click', (e) => {
    if (e.target === fileInput) return;
    fileInput.click();
  });
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadImageFile(file);
    fileInput.value = ''; // 允许重复选同一文件
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.add('palette-drop--active');
    });
  });
  ['dragleave', 'dragend'].forEach((evt) => {
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove('palette-drop--active');
    });
  });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    drop.classList.remove('palette-drop--active');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadImageFile(file);
  });
}

/* ========== 初始化 ========== */
function initColor() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // 色彩转换
  setConvertColor([convertState.r, convertState.g, convertState.b], 'init');
  document.getElementById('convert-hex').addEventListener('input', onHexInput);
  document.getElementById('convert-r').addEventListener('input', onRgbInput);
  document.getElementById('convert-g').addEventListener('input', onRgbInput);
  document.getElementById('convert-b').addEventListener('input', onRgbInput);
  document.getElementById('convert-h').addEventListener('input', onHslInput);
  document.getElementById('convert-s').addEventListener('input', onHslInput);
  document.getElementById('convert-l').addEventListener('input', onHslInput);
  document.getElementById('btn-convert-picker').addEventListener('click', onConvertPicker);
  if (typeof EyeDropper === 'undefined') {
    document.getElementById('btn-convert-picker').hidden = true;
  }
  document.getElementById('btn-copy-rgb').addEventListener('click', () => {
    const { r, g, b } = convertState;
    copyAndFeedback(`rgb(${r}, ${g}, ${b})`, document.getElementById('btn-copy-rgb'));
  });
  document.getElementById('btn-copy-hsl').addEventListener('click', () => {
    const [h, s, l] = rgbToHsl(convertState.r, convertState.g, convertState.b);
    copyAndFeedback(`hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`, document.getElementById('btn-copy-hsl'));
  });

  // 对比度
  updateContrast();
  document.getElementById('contrast-fg').addEventListener('input', updateContrast);
  document.getElementById('contrast-bg').addEventListener('input', updateContrast);

  // 取色器
  setupPickerSupport();
  document.getElementById('picker-start').addEventListener('click', onPickerStart);
  document.getElementById('btn-copy-picker-hex').addEventListener('click', () => {
    copyAndFeedback(document.getElementById('picker-hex').textContent, document.getElementById('btn-copy-picker-hex'));
  });
  document.getElementById('btn-copy-picker-rgb').addEventListener('click', () => {
    copyAndFeedback(document.getElementById('picker-rgb').textContent, document.getElementById('btn-copy-picker-rgb'));
  });
  document.getElementById('btn-copy-picker-hsl').addEventListener('click', () => {
    copyAndFeedback(document.getElementById('picker-hsl').textContent, document.getElementById('btn-copy-picker-hsl'));
  });

  // 渐变
  updateGradient();
  document.getElementById('gradient-start').addEventListener('input', updateGradient);
  document.getElementById('gradient-end').addEventListener('input', updateGradient);
  document.getElementById('gradient-angle').addEventListener('input', updateGradient);
  document.getElementById('btn-copy-gradient').addEventListener('click', () => {
    copyAndFeedback(document.getElementById('gradient-code').textContent, document.getElementById('btn-copy-gradient'));
  });

  // 调色板
  setupPaletteDrop();
  document.getElementById('palette-count').addEventListener('change', processPalette);
}

export { initColor };
