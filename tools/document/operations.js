/**
 * 文档转换工具：操作配置表（纯配置，无逻辑）
 *
 * 字段说明：
 *   tab          所属 Tab
 *   inputType    'file' | 'text'
 *   accept       文件选择器 accept 属性
 *   textAccept   文本类操作「从文件导入」接受的类型
 *   multiple     是否允许多选（多选操作支持拖拽排序）
 *   outputType   'file' | 'text'
 *   fileExt      输出文件扩展名（outputType=file 时）
 *   preview      'html' 表示文本结果支持渲染预览
 *   fullDoc      是否提供「封装完整 HTML 文档」开关
 *   separator    是否提供 CSV 分隔符选项
 */

export const OPERATIONS = {
  // PDF
  'pdf-to-image':  { tab: 'pdf',    label: 'PDF → 图片',      inputType: 'file', accept: '.pdf',    multiple: false, outputType: 'file', fileExt: 'png' },
  'image-to-pdf':  { tab: 'pdf',    label: '图片 → PDF',      inputType: 'file', accept: 'image/*', multiple: true,  outputType: 'file', fileExt: 'pdf' },
  'pdf-to-text':   { tab: 'pdf',    label: 'PDF → 文本',      inputType: 'file', accept: '.pdf',    multiple: false, outputType: 'text' },
  'pdf-merge':     { tab: 'pdf',    label: 'PDF 合并',        inputType: 'file', accept: '.pdf',    multiple: true,  outputType: 'file', fileExt: 'pdf' },
  'pdf-split':     { tab: 'pdf',    label: 'PDF 拆分',        inputType: 'file', accept: '.pdf',    multiple: false, outputType: 'file', fileExt: 'pdf' },
  'pdf-rotate':    { tab: 'pdf',    label: 'PDF 旋转',        inputType: 'file', accept: '.pdf',    multiple: false, outputType: 'file', fileExt: 'pdf' },
  'pdf-extract':   { tab: 'pdf',    label: 'PDF 提取指定页',  inputType: 'file', accept: '.pdf',    multiple: false, outputType: 'file', fileExt: 'pdf' },
  // Word
  'word-to-html':  { tab: 'word',   label: 'Word → HTML',     inputType: 'file', accept: '.docx',   multiple: false, outputType: 'text', preview: 'html' },
  'word-to-text':  { tab: 'word',   label: 'Word → 文本',     inputType: 'file', accept: '.docx',   multiple: false, outputType: 'text' },
  'word-to-pdf':   { tab: 'word',   label: 'Word → PDF',      inputType: 'file', accept: '.docx',   multiple: false, outputType: 'file', fileExt: 'pdf' },
  'md-to-word':    { tab: 'word',   label: 'Markdown → Word', inputType: 'text', accept: null, textAccept: '.md,.markdown,.txt', multiple: false, outputType: 'file', fileExt: 'docx' },
  'html-to-word':  { tab: 'word',   label: 'HTML → Word',     inputType: 'text', accept: null, textAccept: '.html,.htm,.txt', multiple: false, outputType: 'file', fileExt: 'docx' },
  'txt-to-word':   { tab: 'word',   label: 'TXT → Word',      inputType: 'text', accept: null, textAccept: '.txt', multiple: false, outputType: 'file', fileExt: 'docx' },
  // Excel / CSV
  'excel-to-csv':  { tab: 'excel',  label: 'Excel → CSV',     inputType: 'file', accept: '.xlsx,.xls', multiple: false, outputType: 'text', separator: true },
  'excel-to-json': { tab: 'excel',  label: 'Excel → JSON',    inputType: 'file', accept: '.xlsx,.xls', multiple: false, outputType: 'text' },
  'csv-to-json':   { tab: 'excel',  label: 'CSV → JSON',      inputType: 'text', accept: null, textAccept: '.csv,.tsv,.txt', multiple: false, outputType: 'text' },
  'json-to-csv':   { tab: 'excel',  label: 'JSON → CSV',      inputType: 'text', accept: null, textAccept: '.json,.txt', multiple: false, outputType: 'text', separator: true },
  'csv-to-excel':  { tab: 'excel',  label: 'CSV → Excel',     inputType: 'text', accept: null, textAccept: '.csv,.tsv,.txt', multiple: false, outputType: 'file', fileExt: 'xlsx' },
  // MD / HTML
  'md-to-html':    { tab: 'mdhtml', label: 'Markdown → HTML', inputType: 'text', accept: null, textAccept: '.md,.markdown,.txt', multiple: false, outputType: 'text', preview: 'html', fullDoc: true },
  'html-to-md':    { tab: 'mdhtml', label: 'HTML → Markdown', inputType: 'text', accept: null, textAccept: '.html,.htm,.txt', multiple: false, outputType: 'text' },
  'md-to-pdf':     { tab: 'mdhtml', label: 'Markdown → PDF',  inputType: 'text', accept: null, textAccept: '.md,.markdown,.txt', multiple: false, outputType: 'file', fileExt: 'pdf' },
  'html-to-pdf':   { tab: 'mdhtml', label: 'HTML → PDF',      inputType: 'text', accept: null, textAccept: '.html,.htm,.txt', multiple: false, outputType: 'file', fileExt: 'pdf' },
  'txt-to-pdf':    { tab: 'mdhtml', label: 'TXT → PDF',       inputType: 'text', accept: null, textAccept: '.txt', multiple: false, outputType: 'file', fileExt: 'pdf' },
  // RTF
  'rtf-to-text':   { tab: 'rtf',    label: 'RTF → 文本',      inputType: 'file', accept: '.rtf',    multiple: false, outputType: 'text' },
  'rtf-to-html':   { tab: 'rtf',    label: 'RTF → HTML',      inputType: 'file', accept: '.rtf',    multiple: false, outputType: 'text', preview: 'html' },
  // EPUB
  'epub-to-text':  { tab: 'epub',   label: 'EPUB → 文本',     inputType: 'file', accept: '.epub',   multiple: false, outputType: 'text' },
  'epub-to-html':  { tab: 'epub',   label: 'EPUB → HTML',     inputType: 'file', accept: '.epub',   multiple: false, outputType: 'text', preview: 'html' },
};

/* ========== 文本输入标签 / 提示 ========== */
export const TEXT_LABELS = {
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

export const TEXT_HINTS = {
  'md-to-word': '支持 GFM 语法。可直接粘贴，或点击「从文件导入」上传 .md / .txt 文件。',
  'html-to-word': '粘贴 HTML 源码，或导入 .html / .txt 文件。片段或完整文档均可。',
  'txt-to-word': '粘贴文本，或导入 .txt 文件。空行分段为段落。',
  'csv-to-json': '粘贴 CSV 内容，或导入 .csv / .tsv 文件。首行作为表头。',
  'json-to-csv': '粘贴 JSON 数组（对象数组），或导入 .json 文件。',
  'csv-to-excel': '粘贴 CSV 内容，或导入 .csv / .tsv 文件。首行作为表头。',
  'md-to-html': '支持 GFM 语法。可直接粘贴，或导入 .md / .txt 文件。',
  'html-to-md': '粘贴 HTML 源码，或导入 .html 文件。',
  'md-to-pdf': '支持 GFM 语法。可直接粘贴，或导入 .md / .txt 文件。',
  'html-to-pdf': '粘贴完整 HTML 文档，或导入 .html 文件。',
  'txt-to-pdf': '粘贴文本，或导入 .txt 文件。保留换行与空格。',
};

/* ========== PDF 操作提示（页数由 metadata 模块动态填充） ========== */
export const PDF_OP_HINTS = {
  'pdf-to-image': '逐页渲染为图片，2x 清晰度。',
  'pdf-to-text': '提取全部页面文本。',
  'pdf-merge': '按列表顺序合并，可拖拽调整顺序。',
  'pdf-split': '用逗号分隔多个区间，每个区间生成一个 PDF。页码从 1 开始。',
  'pdf-rotate': '所有页统一旋转。',
  'pdf-extract': '逗号分隔单页或区间，页码从 1 开始。',
};

/* ========== 大文件警告阈值 ========== */
export const BIG_FILE_BYTES = 80 * 1024 * 1024;
