/**
 * 文档转换工具核心逻辑
 * 全部本地处理，文件不上传云端
 * 支持：PDF / Word / Excel-CSV / Markdown-HTML 互转
 *
 * 按需动态加载各 Tab 的处理模块（减小首屏体积）
 */

// 状态
let files = [];
let currentTab = 'pdf';

/* ========== 操作配置表 ========== */
// inputType: 'file' | 'text'
// accept: 文件选择器 accept 属性
// multiple: 是否允许多选
// outputType: 'file' | 'text'
// fileExt: 输出文件扩展名（outputType=file 时）
const OPERATIONS = {
  // PDF
  'pdf-to-image':  { tab: 'pdf',    label: 'PDF → 图片',        inputType: 'file', accept: '.pdf',                multiple: false, outputType: 'file', fileExt: 'png' },
  'image-to-pdf':  { tab: 'pdf',    label: '图片 → PDF',        inputType: 'file', accept: 'image/*',             multiple: true,  outputType: 'file', fileExt: 'pdf' },
  'pdf-to-text':   { tab: 'pdf',    label: 'PDF → 文本',        inputType: 'file', accept: '.pdf',                multiple: false, outputType: 'text' },
  'pdf-merge':     { tab: 'pdf',    label: 'PDF 合并',          inputType: 'file', accept: '.pdf',                multiple: true,  outputType: 'file', fileExt: 'pdf' },
  'pdf-split':     { tab: 'pdf',    label: 'PDF 拆分',          inputType: 'file', accept: '.pdf',                multiple: false, outputType: 'file', fileExt: 'pdf' },
  'pdf-rotate':    { tab: 'pdf',    label: 'PDF 旋转',          inputType: 'file', accept: '.pdf',                multiple: false, outputType: 'file', fileExt: 'pdf' },
  'pdf-extract':   { tab: 'pdf',    label: 'PDF 提取指定页',    inputType: 'file', accept: '.pdf',                multiple: false, outputType: 'file', fileExt: 'pdf' },
  // Word
  'word-to-html':  { tab: 'word',   label: 'Word → HTML',       inputType: 'file', accept: '.docx',               multiple: false, outputType: 'text' },
  'word-to-text':  { tab: 'word',   label: 'Word → 文本',       inputType: 'file', accept: '.docx',               multiple: false, outputType: 'text' },
  'word-to-pdf':   { tab: 'word',   label: 'Word → PDF',        inputType: 'file', accept: '.docx',               multiple: false, outputType: 'file', fileExt: 'pdf' },
  'md-to-word':    { tab: 'word',   label: 'Markdown → Word',   inputType: 'text', accept: null,                  multiple: false, outputType: 'file', fileExt: 'docx' },
  'html-to-word':  { tab: 'word',   label: 'HTML → Word',       inputType: 'text', accept: null,                  multiple: false, outputType: 'file', fileExt: 'docx' },
  'txt-to-word':   { tab: 'word',   label: 'TXT → Word',        inputType: 'text', accept: null,                  multiple: false, outputType: 'file', fileExt: 'docx' },
  // Excel / CSV
  'excel-to-csv':  { tab: 'excel',  label: 'Excel → CSV',       inputType: 'file', accept: '.xlsx,.xls',          multiple: false, outputType: 'text' },
  'excel-to-json': { tab: 'excel',  label: 'Excel → JSON',      inputType: 'file', accept: '.xlsx,.xls',          multiple: false, outputType: 'text' },
  'csv-to-json':   { tab: 'excel',  label: 'CSV → JSON',        inputType: 'text', accept: null,                  multiple: false, outputType: 'text' },
  'json-to-csv':   { tab: 'excel',  label: 'JSON → CSV',        inputType: 'text', accept: null,                  multiple: false, outputType: 'text' },
  'csv-to-excel':  { tab: 'excel',  label: 'CSV → Excel',       inputType: 'text', accept: null,                  multiple: false, outputType: 'file', fileExt: 'xlsx' },
  // MD / HTML
  'md-to-html':    { tab: 'mdhtml', label: 'Markdown → HTML',   inputType: 'text', accept: null,                  multiple: false, outputType: 'text' },
  'html-to-md':    { tab: 'mdhtml', label: 'HTML → Markdown',   inputType: 'text', accept: null,                  multiple: false, outputType: 'text' },
  'md-to-pdf':     { tab: 'mdhtml', label: 'Markdown → PDF',    inputType: 'text', accept: null,                  multiple: false, outputType: 'file', fileExt: 'pdf' },
  'html-to-pdf':   { tab: 'mdhtml', label: 'HTML → PDF',        inputType: 'text', accept: null,                  multiple: false, outputType: 'file', fileExt: 'pdf' },
  'txt-to-pdf':    { tab: 'mdhtml', label: 'TXT → PDF',         inputType: 'text', accept: null,                  multiple: false, outputType: 'file', fileExt: 'pdf' },
  // RTF
  'rtf-to-text':   { tab: 'rtf',    label: 'RTF → 文本',        inputType: 'file', accept: '.rtf',                multiple: false, outputType: 'text' },
  'rtf-to-html':   { tab: 'rtf',    label: 'RTF → HTML',        inputType: 'file', accept: '.rtf',                multiple: false, outputType: 'text' },
  // EPUB
  'epub-to-text':  { tab: 'epub',   label: 'EPUB → 文本',       inputType: 'file', accept: '.epub',               multiple: false, outputType: 'text' },
  'epub-to-html':  { tab: 'epub',   label: 'EPUB → HTML',       inputType: 'file', accept: '.epub',               multiple: false, outputType: 'text' },
};

/* ========== 动态加载各 Tab 模块（按需减小首屏体积） ========== */
const TAB_MODULE_LOADERS = {
  pdf:    () => import('./handlers/pdf.js'),
  word:   () => import('./handlers/word.js'),
  excel:  () => import('./handlers/excel.js'),
  mdhtml: () => import('./handlers/mdhtml.js'),
  rtf:    () => import('./handlers/rtf.js'),
  epub:   () => import('./handlers/epub.js'),
};

/* ========== 获取当前操作 ========== */
function getCurrentOp() {
  const opSelect = document.querySelector(`.tab-panel[data-panel="${currentTab}"] .setting__select`);
  if (!opSelect) return null;
  return OPERATIONS[opSelect.value] || null;
}

function getCurrentOpId() {
  const opSelect = document.querySelector(`.tab-panel[data-panel="${currentTab}"] .setting__select`);
  return opSelect ? opSelect.value : null;
}

/* ========== 工具函数 ========== */
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
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

function getBaseName(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

function setProgress(title, status, pct) {
  const titleEl = document.getElementById('progress-stage-title');
  const statusEl = document.getElementById('progress-stage-status');
  const pctEl = document.getElementById('progress-stage-pct');
  const fillEl = document.getElementById('progress-fill');
  if (titleEl) titleEl.textContent = title;
  if (statusEl) statusEl.textContent = status || '';
  if (pctEl) pctEl.textContent = pct != null ? `${Math.round(pct)}%` : '';
  if (fillEl && pct != null) fillEl.style.width = `${Math.round(pct)}%`;
}

function showProgress(show) {
  document.getElementById('progress-section').hidden = !show;
}

/* ========== 文件列表渲染 ========== */
function renderFileList() {
  const list = document.getElementById('file-list-items');
  const count = document.getElementById('file-list-count');
  const fileList = document.getElementById('file-list');
  const uploadArea = document.getElementById('upload-area');

  if (files.length === 0) {
    fileList.hidden = true;
    uploadArea.hidden = false;
    return;
  }
  fileList.hidden = false;
  uploadArea.hidden = true;
  count.textContent = `${files.length} 个文件`;

  list.innerHTML = files.map((f, i) => `
    <div class="file-item" data-index="${i}">
      <span class="file-item__icon">📄</span>
      <span class="file-item__name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="file-item__size">${formatFileSize(f.size)}</span>
      <button class="file-item__remove" data-action="remove" data-index="${i}" title="移除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`).join('');

  list.querySelectorAll('.file-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="remove"]')) return;
    });
  });
  list.querySelectorAll('[data-action="remove"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      files.splice(idx, 1);
      renderFileList();
    });
  });
}

function clearAllFiles() {
  files = [];
  renderFileList();
}

/* ========== UI 更新：根据当前操作显示对应输入区 ========== */
function updateUIForOp() {
  const op = getCurrentOp();
  if (!op) return;

  const uploadSection = document.getElementById('upload-section');
  const textInputSection = document.getElementById('text-input-section');
  const fileInput = document.getElementById('file-input');
  const uploadText = document.getElementById('upload-text');
  const uploadHint = document.getElementById('upload-hint');
  const textInputLabel = document.getElementById('text-input-label');

  // PDF / Excel 操作选项显隐
  const opId = getCurrentOpId();
  document.getElementById('pdf-image-format-setting').hidden = opId !== 'pdf-to-image';
  document.getElementById('pdf-rotate-setting').hidden = opId !== 'pdf-rotate';
  document.getElementById('pdf-split-setting').hidden = opId !== 'pdf-split';
  document.getElementById('pdf-extract-setting').hidden = opId !== 'pdf-extract';
  document.getElementById('excel-sheet-setting').hidden = !(opId === 'excel-to-csv' || opId === 'excel-to-json');

  if (op.inputType === 'file') {
    uploadSection.hidden = false;
    textInputSection.hidden = true;
    fileInput.accept = op.accept || '';
    fileInput.multiple = op.multiple;
    uploadText.textContent = op.multiple ? '选择或拖入多个文件' : '选择或拖入文件';
    uploadHint.textContent = `支持：${op.accept || '任意文件'}`;
  } else {
    uploadSection.hidden = true;
    textInputSection.hidden = false;
    const labels = {
      'md-to-word': 'Markdown 内容',
      'html-to-word': 'HTML 内容',
      'txt-to-word': 'TXT 文本内容',
      'csv-to-json': 'CSV 内容',
      'json-to-csv': 'JSON 内容（数组对象）',
      'csv-to-excel': 'CSV 内容',
      'md-to-html': 'Markdown 内容',
      'html-to-md': 'HTML 内容',
      'md-to-pdf': 'Markdown 内容',
      'html-to-pdf': 'HTML 内容',
      'txt-to-pdf': 'TXT 文本内容',
    };
    textInputLabel.textContent = labels[opId] || '输入内容';
  }

  // 隐藏结果区
  document.getElementById('text-result-section').hidden = true;
  document.getElementById('file-result-section').hidden = true;
}

/* ========== Tab 切换 ========== */
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('mode-tab--active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.hidden = p.dataset.panel !== tab;
    p.classList.toggle('tab-panel--active', p.dataset.panel === tab);
  });
  updateUIForOp();
}

/* ========== 文件选择 ========== */
function handleFiles(newFiles) {
  const op = getCurrentOp();
  if (!op || op.inputType !== 'file') return;

  if (op.multiple) {
    files = files.concat(Array.from(newFiles));
  } else {
    files = Array.from(newFiles).slice(0, 1);
  }
  renderFileList();
}

/* ========== 收集当前操作上下文（传给 handler） ========== */
function buildContext() {
  return {
    files,
    text: document.getElementById('text-input').value,
    options: {
      'pdf-image-format':  document.getElementById('pdf-image-format')?.value,
      'pdf-rotate-angle':  document.getElementById('pdf-rotate-angle')?.value,
      'pdf-split-ranges':  document.getElementById('pdf-split-ranges')?.value,
      'pdf-extract-pages': document.getElementById('pdf-extract-pages')?.value,
      'excel-sheet':       document.getElementById('excel-sheet')?.value,
    },
    setProgress,
    getBaseName,
  };
}

/* ========== 转换入口 ========== */
async function convert() {
  const opId = getCurrentOpId();
  const op = OPERATIONS[opId];
  if (!op) return;

  // 校验输入
  if (op.inputType === 'file' && files.length === 0) {
    alert('请先选择文件');
    return;
  }
  if (op.inputType === 'text') {
    const text = document.getElementById('text-input').value;
    if (!text.trim()) {
      alert('请先输入内容');
      return;
    }
  }

  // 隐藏旧结果
  document.getElementById('text-result-section').hidden = true;
  document.getElementById('file-result-section').hidden = true;
  showProgress(true);
  setProgress('加载处理模块...', '', 5);

  try {
    // 按需动态加载对应 Tab 的处理模块
    const tab = op.tab;
    const module = await TAB_MODULE_LOADERS[tab]();
    const handler = module.HANDLERS[opId];
    if (!handler) throw new Error('未实现的操作: ' + opId);

    const ctx = buildContext();
    const result = await handler(ctx);
    showProgress(false);
    showResult(op, result);
  } catch (err) {
    console.error('[文档转换失败]', err);
    showProgress(false);
    alert('转换失败：' + (err.message || String(err)));
  }
}

/* ========== 结果展示 ========== */
function showResult(op, result) {
  if (op.outputType === 'text') {
    const section = document.getElementById('text-result-section');
    const resultEl = document.getElementById('text-result');
    const downloadBtn = document.getElementById('btn-download-text');
    resultEl.textContent = result.text;
    if (result.filename) {
      downloadBtn.hidden = false;
      downloadBtn.onclick = () => {
        const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, result.filename);
      };
    } else {
      downloadBtn.hidden = true;
    }
    section.hidden = false;
  } else if (op.outputType === 'file') {
    const section = document.getElementById('file-result-section');
    const listEl = document.getElementById('result-list');
    const statsEl = document.getElementById('result-stats');
    const downloadAllBtn = document.getElementById('btn-download-all');

    const items = Array.isArray(result) ? result : [result];
    statsEl.textContent = `共 ${items.length} 个文件`;

    listEl.innerHTML = items.map((item, i) => `
      <li class="result-item">
        <span class="result-item__icon">📦</span>
        <span class="result-item__name">${escapeHtml(item.filename)}</span>
        <span class="result-item__size">${formatFileSize(item.blob.size)}</span>
        <button class="btn btn-sm btn-primary result-item__download" data-index="${i}">下载</button>
      </li>
    `).join('');

    listEl.querySelectorAll('.result-item__download').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        downloadBlob(items[idx].blob, items[idx].filename);
      });
    });

    if (items.length > 1) {
      downloadAllBtn.hidden = false;
      downloadAllBtn.onclick = () => {
        items.forEach((item, i) => {
          setTimeout(() => downloadBlob(item.blob, item.filename), i * 200);
        });
      };
    } else {
      downloadAllBtn.hidden = true;
    }

    section.hidden = false;
  }
}

/* ========== 复制结果 ========== */
function copyResult() {
  const text = document.getElementById('text-result').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-copy-result');
    const original = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = original; }, 1500);
  }).catch(() => alert('复制失败，请手动选择文本复制'));
}

/* ============================================================
 * 初始化
 * ============================================================ */
function initDocument() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // 操作类型切换
  document.querySelectorAll('.tab-panel .setting__select').forEach(sel => {
    sel.addEventListener('change', updateUIForOp);
  });

  // 文件选择
  const fileInput = document.getElementById('file-input');
  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  // 拖放
  const uploadArea = document.getElementById('upload-area');
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('upload-area--dragover');
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('upload-area--dragover');
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('upload-area--dragover');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  // 清空全部
  document.getElementById('btn-clear-all').addEventListener('click', clearAllFiles);

  // 转换按钮
  document.getElementById('btn-convert').addEventListener('click', convert);

  // 复制结果
  document.getElementById('btn-copy-result').addEventListener('click', copyResult);

  // 阻止页面默认拖放行为
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // 初始化 UI
  updateUIForOp();
}

export { initDocument };
