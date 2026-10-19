/**
 * 文档转换工具核心逻辑（协调层）
 *
 * 职责：Tab / 操作切换、UI 显隐编排、转换流程控制、结果分发。
 * 具体行为拆分为独立模块：
 *   operations.js   操作配置表（纯配置）
 *   tab-loaders.js  各 Tab 处理模块动态加载表
 *   ui/toast.js     Toast 通知
 *   ui/download.js  文件下载 / ZIP 打包
 *   ui/clipboard.js 复制到剪贴板
 *   ui/file-list.js 文件集合状态 + 列表渲染 + 拖拽排序
 *   ui/preview.js   HTML 结果预览
 *   ui/paste.js     粘贴支持
 *   ui/metadata.js  工作表下拉 / PDF 页数提示刷新
 *   handlers/       各 Tab 转换处理器
 */
import { escapeHtml, getFileKind, formatFileSize } from './handlers/utils.js';
import { OPERATIONS, TEXT_LABELS, TEXT_HINTS } from './operations.js';
import { TAB_MODULE_LOADERS } from './tab-loaders.js';
import { showToast } from './ui/toast.js';
import { downloadBlob, downloadAllAsZip } from './ui/download.js';
import { copyText } from './ui/clipboard.js';
import { getFiles, addFiles, removeFileAt, clearFiles, renderFileList, setFilesChangedHandler } from './ui/file-list.js';
import { setPreviewMode, setPreviewResult, resetPreview } from './ui/preview.js';
import { handlePaste } from './ui/paste.js';
import { refreshSheetOptions, refreshPdfPageHint } from './ui/metadata.js';

// 状态
let currentTab = 'pdf';
let isConverting = false;

/* ========== 获取当前操作 ========== */
function getCurrentOp() {
  const opSelect = document.querySelector(`.tab-panel[data-panel="${currentTab}"] .setting__select[id$="-op"]`);
  if (!opSelect) return null;
  return OPERATIONS[opSelect.value] || null;
}

function getCurrentOpId() {
  const opSelect = document.querySelector(`.tab-panel[data-panel="${currentTab}"] .setting__select[id$="-op"]`);
  return opSelect ? opSelect.value : null;
}

/* ========== 文件变化后的元数据刷新 ========== */
function refreshMetadata() {
  const op = getCurrentOp();
  const opId = getCurrentOpId();
  refreshSheetOptions(getFiles(), op, opId);
  refreshPdfPageHint(getFiles(), op, opId);
}

/* ========== UI 更新：根据当前操作显示对应输入区 ========== */
function updateUIForOp() {
  const op = getCurrentOp();
  if (!op) return;

  const uploadSection = document.getElementById('upload-section');
  const textInputSection = document.getElementById('text-input-section');
  const fileInput = document.getElementById('file-input');
  const textFileInput = document.getElementById('text-file-input');
  const uploadText = document.getElementById('upload-text');
  const uploadHint = document.getElementById('upload-hint');
  const textInputLabel = document.getElementById('text-input-label');
  const textInputHint = document.getElementById('text-input-hint');

  // PDF / Excel 操作选项显隐
  const opId = getCurrentOpId();
  document.getElementById('pdf-image-format-setting').hidden = opId !== 'pdf-to-image';
  document.getElementById('pdf-rotate-setting').hidden = opId !== 'pdf-rotate';
  document.getElementById('pdf-split-setting').hidden = opId !== 'pdf-split';
  document.getElementById('pdf-extract-setting').hidden = opId !== 'pdf-extract';
  document.getElementById('excel-sheet-setting').hidden = !(opId === 'excel-to-csv' || opId === 'excel-to-json');
  document.getElementById('csv-separator-setting').hidden = !op.separator;
  document.getElementById('md-full-doc-setting').hidden = !op.fullDoc;

  if (op.inputType === 'file') {
    uploadSection.hidden = false;
    textInputSection.hidden = true;
    fileInput.accept = op.accept || '';
    fileInput.multiple = op.multiple;
    uploadText.textContent = op.multiple ? '选择或拖入多个文件' : '选择或拖入文件';
    uploadHint.textContent = `支持：${op.accept || '任意文件'}${op.multiple ? ' · 列表内可拖拽排序' : ' · 也可按 Ctrl+V 粘贴'}`;
  } else {
    uploadSection.hidden = true;
    textInputSection.hidden = false;
    textFileInput.accept = op.textAccept || '.txt,.md,.html,.csv,.json';
    textInputLabel.textContent = TEXT_LABELS[opId] || '输入内容';
    textInputHint.textContent = TEXT_HINTS[opId] || '支持直接粘贴内容。';
  }

  refreshMetadata();

  // 隐藏结果区
  document.getElementById('text-result-section').hidden = true;
  document.getElementById('file-result-section').hidden = true;
  resetPreview();
}

/* ========== Tab 切换 ========== */
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('mode-tab--active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.hidden = p.dataset.panel !== tab;
    p.classList.toggle('tab-panel--active', p.dataset.panel === tab);
  });
  // 「图片去手写」是完整独立布局：隐藏转换用的公共上传区与结果区
  const isInk = tab === 'image';
  document.getElementById('upload-section').hidden = isInk;
  document.getElementById('text-result-section').hidden = isInk;
  document.getElementById('file-result-section').hidden = isInk;
  if (isInk) {
    mountInkPanel();
    return;
  }
  updateUIForOp();
}

/** 首次进入图片 Tab 时才加载笔迹消除模块：保持首屏零模型、零推理代码 */
let inkMounted = false;
function mountInkPanel() {
  if (inkMounted) return;
  inkMounted = true;
  import('./inkerase/app.js').then(m => m.initInkErase()).catch(err => {
    inkMounted = false;
    console.error('[图片去手写] 模块加载失败', err);
    showToast('笔迹消除模块加载失败，请刷新重试', 'error');
  });
}

/* ========== 文本类操作：从文件导入 ========== */
function importTextFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('text-input').value = String(reader.result ?? '');
    showToast(`已导入 ${file.name}`, 'success');
  };
  reader.onerror = () => showToast(`读取失败：${file.name}`, 'error');
  reader.readAsText(file);
}

/* ========== 收集当前操作上下文（传给 handler） ========== */
function buildContext() {
  return {
    // 文件列表取快照：转换期间用户继续导入不会改动本次处理
    files: [...getFiles()],
    text: document.getElementById('text-input').value,
    options: {
      'pdf-image-format':  document.getElementById('pdf-image-format')?.value,
      'pdf-rotate-angle':  document.getElementById('pdf-rotate-angle')?.value,
      'pdf-split-ranges':  document.getElementById('pdf-split-ranges')?.value,
      'pdf-extract-pages': document.getElementById('pdf-extract-pages')?.value,
      'excel-sheet':       document.getElementById('excel-sheet')?.value,
      'csv-separator':     document.getElementById('csv-separator')?.value ?? ',',
      'md-full-doc':       document.getElementById('md-full-doc')?.checked ?? false,
    },
    setProgress,
    getBaseName,
  };
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

function getBaseName(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

/* ========== 转换按钮忙碌状态（防重复提交） ========== */
function setConvertBusy(busy) {
  isConverting = busy;
  const btn = document.getElementById('btn-convert');
  const text = document.getElementById('btn-convert-text');
  if (!btn || !text) return;
  btn.disabled = busy;
  btn.classList.toggle('btn--loading', busy);
  text.textContent = busy ? '转换中...' : '开始转换';
}

/* ========== 转换入口 ========== */
async function convert() {
  if (isConverting) return;
  const opId = getCurrentOpId();
  const op = OPERATIONS[opId];
  if (!op) return;

  // 校验输入
  if (op.inputType === 'file' && getFiles().length === 0) {
    showToast('请先选择文件', 'warning');
    return;
  }
  if (op.inputType === 'text') {
    const text = document.getElementById('text-input').value;
    if (!text.trim()) {
      showToast('请先输入内容', 'warning');
      return;
    }
  }

  // 隐藏旧结果
  document.getElementById('text-result-section').hidden = true;
  document.getElementById('file-result-section').hidden = true;
  showProgress(true);
  setProgress('加载处理模块...', '', 5);
  setConvertBusy(true);

  try {
    const module = await TAB_MODULE_LOADERS[op.tab]();
    const handler = module.HANDLERS[opId];
    if (!handler) throw new Error('未实现的操作: ' + opId);

    const result = await handler(buildContext());
    showProgress(false);
    showResult(op, result);
  } catch (err) {
    console.error('[文档转换失败]', err);
    showProgress(false);
    showToast('转换失败：' + friendlyError(err), 'error', 6000);
  } finally {
    setConvertBusy(false);
  }
}

/** 把第三方库的英文报错转成用户能看懂的中文（未命中则透传原文） */
function friendlyError(err) {
  const msg = err?.message || String(err);
  const rules = [
    [/encrypted|password/i, 'PDF 已加密，请先解密后再转换'],
    [/Invalid PDF|PDFParseError|not a PDF/i, 'PDF 文件已损坏或格式不正确'],
    [/No valid images|unsupported image/i, '图片格式不受支持，请换 JPG / PNG'],
    [/Cannot read properties of null/i, '文件内容为空或结构异常'],
    [/out of memory|RangeError|Array buffer/i, '文件过大导致内存不足，请换小文件或减少数量'],
    [/Failed to fetch|NetworkError/i, '处理库加载失败，请检查网络后重试'],
    [/JSZip|zip/i, '文件结构异常（压缩包损坏）'],
  ];
  for (const [pattern, text] of rules) {
    if (pattern.test(msg)) return text;
  }
  return msg;
}

/* ========== 结果展示 ========== */
function showResult(op, result) {
  if (op.outputType === 'text') {
    const section = document.getElementById('text-result-section');
    const resultEl = document.getElementById('text-result');
    const downloadBtn = document.getElementById('btn-download-text');
    const viewToggle = document.getElementById('result-view-toggle');
    resultEl.textContent = result.text;
    // 通用兜底：解析器对损坏文件可能返回空内容或控制字符乱码，明确告知用户
    if (!result.text || !result.text.trim() || /\0{4,}/.test(result.text)) {
      showToast('未从文件中解析到有效内容，请确认文件是否损坏或格式是否正确', 'warning', 5000);
    }
    if (result.filename) {
      downloadBtn.hidden = false;
      downloadBtn.onclick = () => {
        const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, result.filename);
      };
    } else {
      downloadBtn.hidden = true;
    }

    // HTML 类结果提供「预览 / 源码」切换
    viewToggle.hidden = !op.preview;
    if (op.preview) {
      setPreviewResult(result);
      setPreviewMode('source');
    } else {
      resetPreview();
    }
    section.hidden = false;
  } else if (op.outputType === 'file') {
    const section = document.getElementById('file-result-section');
    const listEl = document.getElementById('result-list');
    const statsEl = document.getElementById('result-stats');
    const downloadAllBtn = document.getElementById('btn-download-all');
    const zipBtn = document.getElementById('btn-download-zip');

    const items = Array.isArray(result) ? result : [result];
    statsEl.textContent = `共 ${items.length} 个文件`;

    listEl.innerHTML = items.map((item, i) => `
      <li class="result-item">
        <span class="result-item__kind">${getFileKind(item.filename)}</span>
        <span class="result-item__name" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</span>
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
      zipBtn.hidden = false;
      zipBtn.onclick = () => downloadAllAsZip(items);
    } else {
      downloadAllBtn.hidden = true;
      zipBtn.hidden = true;
    }

    section.hidden = false;
  }
}

/* ========== 复制结果 ========== */
async function copyResult() {
  const ok = await copyText(document.getElementById('text-result').textContent);
  const btn = document.getElementById('btn-copy-result');
  if (ok) {
    const original = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } else {
    showToast('复制失败，请手动选择文本复制', 'error');
  }
}

/* ========== 初始化 ========== */
function initDocument() {
  setFilesChangedHandler(refreshMetadata);

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
    addFiles(e.target.files, getCurrentOp());
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
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, getCurrentOp());
  });

  // 清空全部
  document.getElementById('btn-clear-all').addEventListener('click', () => clearFiles(getCurrentOp()));

  // 转换按钮
  document.getElementById('btn-convert').addEventListener('click', convert);

  // 复制结果
  document.getElementById('btn-copy-result').addEventListener('click', copyResult);

  // 预览 / 源码切换
  document.getElementById('btn-view-source').addEventListener('click', () => setPreviewMode('source'));
  document.getElementById('btn-view-preview').addEventListener('click', () => setPreviewMode('preview'));

  // 文本类操作：从文件导入
  const textFileInput = document.getElementById('text-file-input');
  document.getElementById('btn-upload-text').addEventListener('click', () => textFileInput.click());
  textFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) importTextFile(e.target.files[0]);
    e.target.value = '';
  });

  // 粘贴（文件 / 文本）
  document.addEventListener('paste', (e) => handlePaste(e, { getOp: getCurrentOp, addFiles }));

  // 阻止页面默认拖放行为
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // 初始化 UI
  updateUIForOp();
}

export { initDocument };
