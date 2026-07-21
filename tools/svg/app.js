/**
 * SVG 优化器核心逻辑
 * 纯字符串/正则处理，不依赖 DOMParser，无任何第三方库
 * 全部本地运行，无任何网络请求
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

/* ========== 选项读取 ========== */
function readOptions() {
  const opts = {};
  document.querySelectorAll('#svg-options input[type="checkbox"]').forEach((cb) => {
    opts[cb.dataset.opt] = cb.checked;
  });
  return opts;
}

/* ========== 优化核心：纯字符串/正则处理 ========== */
function optimizeSvg(svg, options) {
  let result = svg;
  if (options.removeXmlDecl) {
    result = result.replace(/<\?xml[\s\S]*?\?>/g, '');
  }
  if (options.removeDoctype) {
    result = result.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  }
  if (options.removeComments) {
    result = result.replace(/<!--[\s\S]*?-->/g, '');
  }
  if (options.removeEditorNs) {
    // 去除 inkscape: sodipodi: i: sketch: Illustrator: 命名空间属性
    result = result.replace(/\s(?:inkscape|sodipodi|i|sketch|Illustrator):[a-zA-Z-]+="[^"]*"/g, '');
    // 去除命名空间声明
    result = result.replace(/\sxmlns:(?:inkscape|sodipodi|i|sketch|Illustrator)="[^"]*"/g, '');
  }
  if (options.removeMetadata) {
    result = result.replace(/<metadata[\s\S]*?<\/metadata>/gi, '');
  }
  if (options.removeEmptyDesc) {
    result = result.replace(/<title>\s*<\/title>/gi, '').replace(/<desc>\s*<\/desc>/gi, '');
  }
  if (options.collapseWhitespace) {
    // 去除标签间的空白（保留属性引号内空白）+ 合并连续空格 + 去首尾空白
    result = result.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/gm, '');
  }
  if (options.removeDefaultAttrs) {
    // 去除常见默认值属性（可省略的默认值）
    const defaults = [
      /\sstroke="none"/g,
      /\sfill="black"/gi,
      /\sstroke-width="1"/gi,
      /\sstroke-linecap="butt"/gi,
      /\sstroke-linejoin="miter"/gi,
      /\sfill-rule="nonzero"/gi,
      /\sclip-rule="nonzero"/gi,
      /\sopacity="1"/gi,
      /\sfill-opacity="1"/gi,
      /\sstroke-opacity="1"/gi,
    ];
    defaults.forEach((re) => { result = result.replace(re, ''); });
  }
  if (options.removeEmptyGroups) {
    // 反复移除空 <g></g>（可能嵌套，循环到稳定）
    let prev;
    do {
      prev = result;
      result = result.replace(/<g[^>]*>\s*<\/g>/gi, '');
    } while (result !== prev);
  }
  return result.trim();
}

/* ========== 字节大小 ========== */
function byteLength(str) {
  return new TextEncoder().encode(str).length;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

/* ========== 预览 ========== */
function svgToDataUrl(svg) {
  // UTF-8 安全的 base64 编码（处理多字节字符）
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function renderPreview(containerId, svg) {
  const el = document.getElementById(containerId);
  if (!svg || !svg.trim()) {
    el.innerHTML = '<div class="svg-preview-empty">暂无内容</div>';
    return;
  }
  const img = document.createElement('img');
  img.alt = 'SVG 预览';
  img.onerror = () => {
    el.innerHTML = '<div class="svg-preview-empty meta-error">SVG 解析失败</div>';
  };
  img.src = svgToDataUrl(svg);
  el.innerHTML = '';
  el.appendChild(img);
}

/* ========== 状态 ========== */
let originalSvg = '';   // 当前 textarea 中的原始 SVG（用于"还原"参考）
let optimizedSvg = '';  // 最近一次优化结果

/* ========== 文件读取 ========== */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

/* ========== 拖放区 ========== */
function setupDropzone() {
  const dz = document.getElementById('svg-dropzone');
  const fileInput = document.getElementById('svg-file');
  const nameEl = document.getElementById('svg-file-name');
  const textEl = document.getElementById('svg-input');

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
  dz.addEventListener('drop', async (e) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
      nameEl.textContent = '请拖入 .svg 文件';
      return;
    }
    nameEl.textContent = file.name;
    try {
      const text = await readFileAsText(file);
      textEl.value = text;
      handleInputChange();
    } catch (err) {
      nameEl.textContent = '读取失败：' + err.message;
    }
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    nameEl.textContent = file.name;
    try {
      const text = await readFileAsText(file);
      textEl.value = text;
      handleInputChange();
    } catch (err) {
      nameEl.textContent = '读取失败：' + err.message;
    }
  });

  // textarea 内容变化时清空文件名（用户手动编辑触发 input 事件，文件加载不会触发）
  textEl.addEventListener('input', () => {
    nameEl.textContent = '或点击此处选择文件';
    fileInput.value = '';
    handleInputChange();
  });
}

/* ========== 输入变化时更新原始预览，清空优化结果 ========== */
function handleInputChange() {
  const text = document.getElementById('svg-input').value;
  originalSvg = text;
  renderPreview('preview-original', text);
  optimizedSvg = '';
  renderPreview('preview-optimized', '');
  document.getElementById('svg-stats').hidden = true;
}

/* ========== 优化 ========== */
function doOptimize() {
  const text = document.getElementById('svg-input').value;
  if (!text.trim()) return;
  originalSvg = text;
  const opts = readOptions();
  try {
    const result = optimizeSvg(text, opts);
    optimizedSvg = result;
    renderPreview('preview-original', text);
    renderPreview('preview-optimized', result);
    updateStats(text, result);
  } catch (e) {
    optimizedSvg = '';
    document.getElementById('preview-optimized').innerHTML =
      `<div class="svg-preview-empty meta-error">优化失败：${escapeHtml(e.message)}</div>`;
    document.getElementById('svg-stats').hidden = true;
  }
}

function updateStats(original, optimized) {
  const origBytes = byteLength(original);
  const optBytes = byteLength(optimized);
  const saved = origBytes - optBytes;
  const pct = origBytes > 0 ? (saved / origBytes) * 100 : 0;
  document.getElementById('stat-original').textContent = formatSize(origBytes);
  document.getElementById('stat-optimized').textContent = formatSize(optBytes);
  document.getElementById('stat-saved').textContent =
    `${formatSize(saved)}（${pct.toFixed(1)}%）`;
  document.getElementById('svg-stats').hidden = false;
}

/* ========== 复制结果 ========== */
async function copyResult(e) {
  if (!optimizedSvg) return;
  const ok = await copyText(optimizedSvg);
  if (ok) flashCopyBtn(e.currentTarget);
}

/* ========== 下载 ========== */
function downloadResult() {
  if (!optimizedSvg) return;
  const blob = new Blob([optimizedSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'optimized.svg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ========== 还原：清空优化结果，恢复原始预览 ========== */
function doReset() {
  optimizedSvg = '';
  renderPreview('preview-optimized', '');
  document.getElementById('svg-stats').hidden = true;
  if (originalSvg) {
    renderPreview('preview-original', originalSvg);
  }
}

/* ========== 工具 ========== */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ========== 初始化 ========== */
function initSvg() {
  setupDropzone();
  document.getElementById('btn-svg-optimize').addEventListener('click', doOptimize);
  document.getElementById('btn-svg-copy').addEventListener('click', copyResult);
  document.getElementById('btn-svg-download').addEventListener('click', downloadResult);
  document.getElementById('btn-svg-reset').addEventListener('click', doReset);
  document.getElementById('svg-input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doOptimize();
    }
  });
}

export { initSvg };
