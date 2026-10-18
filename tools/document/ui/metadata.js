/**
 * 文件元数据刷新：Excel 工作表下拉选项、PDF 页数提示
 * 依赖文件内容，异步读取，失败时静默保持默认值（转换时报具体错误）
 * 用序列号丢弃过期结果，避免快切文件时旧读取覆盖新读取
 */
import { TAB_MODULE_LOADERS } from '../tab-loaders.js';
import { PDF_OP_HINTS } from '../operations.js';

let sheetSeq = 0;
let pdfSeq = 0;

/** Excel 操作：读取工作表名称填充下拉框 */
export async function refreshSheetOptions(files, op, opId) {
  const sel = document.getElementById('excel-sheet');
  if (!sel) return;

  const isExcelOp = opId === 'excel-to-csv' || opId === 'excel-to-json';
  if (!isExcelOp || files.length === 0) {
    sel.innerHTML = '<option value="0">（读取文件后显示工作表列表）</option>';
    return;
  }
  const seq = ++sheetSeq;
  try {
    const mod = await TAB_MODULE_LOADERS.excel();
    const names = await mod.readSheetNames(files[0]);
    if (seq !== sheetSeq) return; // 已有更新的读取，丢弃过期结果
    sel.innerHTML = names
      .map((n, i) => `<option value="${i}">${escapeHtml(n)}</option>`)
      .join('');
  } catch {
    // 文件不是有效 Excel：保持默认项
  }
}

/** PDF 操作：在提示行展示源文件页数 */
export async function refreshPdfPageHint(files, op, opId) {
  const hintEl = document.getElementById('pdf-op-hint');
  if (!hintEl) return;

  const base = PDF_OP_HINTS[opId] || '';
  const needsCount = opId === 'pdf-split' || opId === 'pdf-extract' || opId === 'pdf-rotate';
  if (!needsCount || files.length === 0 || !op || op.inputType !== 'file') {
    hintEl.textContent = base;
    return;
  }
  const seq = ++pdfSeq;
  try {
    const mod = await TAB_MODULE_LOADERS.pdf();
    const count = await mod.readPdfPageCount(files[0]);
    if (seq !== pdfSeq) return; // 已有更新的读取，丢弃过期结果
    hintEl.textContent = `源文件共 ${count} 页。${base}`;
  } catch {
    hintEl.textContent = base;
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
