/**
 * JSON 工具核心逻辑
 * 格式化 / 压缩 / 校验 / 转义 / 反转义 / 排序 / 树形展示 / JSONPath 查询
 * 全部本地运行，无任何网络请求
 */

/* ========== 模块状态 ========== */
let viewMode = 'text'; // 'text' | 'tree'
let outputText = '';   // 最近一次输出的文本
let currentData = null; // 最近一次解析出的数据（用于树形渲染）

/* ========== DOM 引用 ========== */
const $ = (id) => document.getElementById(id);

const inputEl = () => $('json-input');
const outputEl = () => $('json-output');
const treeEl = () => $('json-tree');

/* ========== 通用：复制到剪贴板 ========== */
async function copyText(text) {
  if (!text) return false;
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

/* ========== 元信息与状态 ========== */
function calcDepth(value, current = 0) {
  if (value === null || typeof value !== 'object') return current;
  let max = current + 1;
  const items = Array.isArray(value) ? value : Object.values(value);
  for (const item of items) {
    const d = calcDepth(item, current + 1);
    if (d > max) max = d;
  }
  return max;
}

function updateMeta(input) {
  const chars = input.length;
  const bytes = new TextEncoder().encode(input).length;
  let depth = '—';
  if (input.trim()) {
    try {
      depth = calcDepth(JSON.parse(input));
    } catch {
      depth = '—';
    }
  }
  $('meta-chars').textContent = `字符数 ${chars}`;
  $('meta-bytes').textContent = `字节数 ${bytes}`;
  $('meta-depth').textContent = `层级深度 ${depth}`;
}

function showStatus(msg, type) {
  const el = $('meta-status');
  el.textContent = msg || '';
  el.classList.remove('json-meta__status--ok', 'json-meta__status--err');
  if (type === 'ok') el.classList.add('json-meta__status--ok');
  else if (type === 'err') el.classList.add('json-meta__status--err');
}

/* ========== 视图模式 ========== */
function applyViewMode() {
  const out = outputEl();
  const tree = treeEl();
  const btn = $('btn-view-toggle');
  if (viewMode === 'tree') {
    out.hidden = true;
    tree.hidden = false;
    btn.textContent = '文本视图';
  } else {
    out.hidden = false;
    tree.hidden = true;
    btn.textContent = '树形视图';
  }
}

function setViewMode(mode) {
  viewMode = mode;
  applyViewMode();
}

function renderOutput() {
  outputEl().value = outputText || '';
  if (viewMode === 'tree') renderTree(currentData);
}

function setResult(text, data) {
  outputText = text || '';
  currentData = data === undefined ? null : data;
  renderOutput();
}

/* ========== 格式化 / 压缩 ========== */
function formatJSON(space) {
  const input = inputEl().value;
  if (!input.trim()) {
    showStatus('输入为空', 'err');
    return;
  }
  try {
    const parsed = JSON.parse(input);
    const result = JSON.stringify(parsed, null, space);
    setResult(result, parsed);
    updateMeta(input);
    showStatus('格式化成功', 'ok');
  } catch (e) {
    handleParseError(input, e);
  }
}

function compressJSON() {
  const input = inputEl().value;
  if (!input.trim()) {
    showStatus('输入为空', 'err');
    return;
  }
  try {
    const parsed = JSON.parse(input);
    const result = JSON.stringify(parsed);
    setResult(result, parsed);
    updateMeta(input);
    showStatus('压缩成功', 'ok');
  } catch (e) {
    handleParseError(input, e);
  }
}

/* ========== 校验 ========== */
function validateJSON() {
  const input = inputEl().value;
  updateMeta(input);
  if (!input.trim()) {
    showStatus('输入为空', 'err');
    return;
  }
  try {
    JSON.parse(input);
    showStatus('✓ JSON 有效', 'ok');
  } catch (e) {
    handleParseError(input, e, false);
  }
}

/* ========== 错误定位 ========== */
function posToLineCol(str, pos) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos && i < str.length; i++) {
    if (str[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

function handleParseError(input, e, clearOutput = true) {
  const msg = e.message || String(e);
  const posMatch = msg.match(/position\s+(\d+)/i);
  let detail = msg;
  if (posMatch) {
    const pos = parseInt(posMatch[1], 10);
    const { line, col } = posToLineCol(input, pos);
    detail = `${msg}（第 ${line} 行，第 ${col} 列）`;
  }
  if (clearOutput) setResult('', null);
  updateMeta(input);
  showStatus('✗ ' + detail, 'err');
}

/* ========== 转义 / 反转义 ========== */
function escapeText() {
  const input = inputEl().value;
  if (!input) {
    showStatus('输入为空', 'err');
    return;
  }
  // 顺序：先反斜杠，再引号，再控制字符
  const result = input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  setViewMode('text');
  setResult(result, null);
  updateMeta(input);
  showStatus('转义完成', 'ok');
}

function unescapeText() {
  const input = inputEl().value;
  if (!input) {
    showStatus('输入为空', 'err');
    return;
  }
  // 单次扫描，避免 \\ 与 \n 歧义
  const result = input.replace(/\\(\\|"|n|r|t|f|b|\/)/g, (m, ch) => {
    switch (ch) {
      case '\\': return '\\';
      case '"': return '"';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'f': return '\f';
      case 'b': return '\b';
      case '/': return '/';
      default: return m;
    }
  });
  setViewMode('text');
  setResult(result, null);
  updateMeta(input);
  showStatus('反转义完成', 'ok');
}

/* ========== 递归排序 ========== */
function sortRecursive(value) {
  if (Array.isArray(value)) {
    return value.map(sortRecursive);
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const out = {};
    keys.forEach((k) => {
      out[k] = sortRecursive(value[k]);
    });
    return out;
  }
  return value;
}

function sortJSON() {
  const input = inputEl().value;
  if (!input.trim()) {
    showStatus('输入为空', 'err');
    return;
  }
  try {
    const parsed = JSON.parse(input);
    const sorted = sortRecursive(parsed);
    const result = JSON.stringify(sorted, null, 2);
    setResult(result, sorted);
    updateMeta(input);
    showStatus('排序完成', 'ok');
  } catch (e) {
    handleParseError(input, e);
  }
}

/* ========== JSONPath 查询 ========== */
function queryPath() {
  const input = inputEl().value;
  const path = $('json-path-input').value.trim();
  if (!input.trim()) {
    showStatus('输入为空', 'err');
    return;
  }
  if (!path) {
    showStatus('请输入 JSONPath 表达式', 'err');
    return;
  }

  // 字符白名单校验，防止注入
  if (!/^[$.a-zA-Z0-9_\[\]'"]+$/.test(path)) {
    showStatus('JSONPath 包含非法字符', 'err');
    return;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch (e) {
    handleParseError(input, e, false);
    return;
  }

  // 规范化表达式：去掉前导 $，保证以 . 或 [ 开头（或为空=根）
  let expr = path;
  if (expr.startsWith('$')) expr = expr.slice(1);
  if (expr && !expr.startsWith('.') && !expr.startsWith('[')) {
    expr = '.' + expr;
  }

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('data', '"use strict"; return data' + expr);
    const result = fn(data);
    if (result === undefined) {
      showStatus('查询结果为空（路径不存在）', 'err');
      return;
    }
    const text = typeof result === 'object' && result !== null
      ? JSON.stringify(result, null, 2)
      : JSON.stringify(result);
    setResult(text, result);
    updateMeta(input);
    showStatus('查询成功', 'ok');
  } catch (e) {
    showStatus('查询失败：' + (e.message || e), 'err');
  }
}

/* ========== 树形渲染 ========== */
function renderTree(data) {
  const container = treeEl();
  container.innerHTML = '';
  if (data === null || data === undefined) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = '暂无可展示的数据，请先格式化或排序';
    container.appendChild(empty);
    return;
  }
  container.appendChild(renderNode(data, null, 0));
}

function renderNode(value, key, depth) {
  const node = document.createElement('div');
  node.className = 'tree-node';
  node.style.paddingLeft = depth * 20 + 'px';

  const header = document.createElement('div');
  header.className = 'tree-node__header';

  // 折叠箭头占位（叶子节点留空保持对齐）
  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  header.appendChild(toggle);

  if (key !== null) {
    const keyEl = document.createElement('span');
    keyEl.className = 'tree-key';
    keyEl.textContent = Array.isArray(value) && Number.isInteger(key)
      ? key + ':'
      : JSON.stringify(key) + ':';
    header.appendChild(keyEl);
  }

  if (value === null) {
    appendValue(header, 'null', 'tree-value--null');
    node.appendChild(header);
    return node;
  }
  if (typeof value === 'string') {
    appendValue(header, '"' + value + '"', 'tree-value--string');
    node.appendChild(header);
    return node;
  }
  if (typeof value === 'number') {
    appendValue(header, String(value), 'tree-value--number');
    node.appendChild(header);
    return node;
  }
  if (typeof value === 'boolean') {
    appendValue(header, String(value), 'tree-value--boolean');
    node.appendChild(header);
    return node;
  }

  // 容器类型：对象 / 数组
  const isArr = Array.isArray(value);
  const keys = isArr ? value : Object.keys(value);
  const count = isArr ? value.length : keys.length;

  const countEl = document.createElement('span');
  countEl.className = 'tree-count';
  countEl.textContent = isArr ? `[${count}]` : `{${count}}`;
  header.appendChild(countEl);

  if (count === 0) {
    // 空容器，不可折叠
    node.appendChild(header);
    return node;
  }

  toggle.textContent = '▼';
  header.classList.add('tree-node__header--collapsible');

  const children = document.createElement('div');
  children.className = 'tree-children';
  if (isArr) {
    value.forEach((item, i) => {
      children.appendChild(renderNode(item, i, depth + 1));
    });
  } else {
    keys.forEach((k) => {
      children.appendChild(renderNode(value[k], k, depth + 1));
    });
  }

  header.addEventListener('click', () => {
    const collapsed = node.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▶' : '▼';
  });

  node.appendChild(header);
  node.appendChild(children);
  return node;
}

function appendValue(header, text, cls) {
  const v = document.createElement('span');
  v.className = 'tree-value ' + cls;
  v.textContent = text;
  header.appendChild(v);
}

/* ========== 清空 / 复制 ========== */
function clearAll() {
  inputEl().value = '';
  setResult('', null);
  $('json-path-input').value = '';
  updateMeta('');
  showStatus('', '');
}

async function copyOutput() {
  const ok = await copyText(viewMode === 'tree' ? JSON.stringify(currentData, null, 2) : outputText);
  flashButton($('btn-copy-out'), ok);
}

async function copyInput() {
  const ok = await copyText(inputEl().value);
  flashButton($('btn-copy-in'), ok);
}

function flashButton(btn, ok) {
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = ok ? '已复制' : '失败';
  btn.classList.add('json-pane__btn--success');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('json-pane__btn--success');
  }, 1200);
}

/* ========== 初始化 ========== */
function initJson() {
  $('btn-format2').addEventListener('click', () => formatJSON(2));
  $('btn-format4').addEventListener('click', () => formatJSON(4));
  $('btn-compress').addEventListener('click', compressJSON);
  $('btn-validate').addEventListener('click', validateJSON);
  $('btn-escape').addEventListener('click', escapeText);
  $('btn-unescape').addEventListener('click', unescapeText);
  $('btn-sort').addEventListener('click', sortJSON);
  $('btn-view-toggle').addEventListener('click', () => {
    setViewMode(viewMode === 'text' ? 'tree' : 'text');
    renderOutput();
  });
  $('btn-query').addEventListener('click', queryPath);
  $('btn-clear').addEventListener('click', clearAll);
  $('btn-copy-in').addEventListener('click', copyInput);
  $('btn-copy-out').addEventListener('click', copyOutput);

  // Ctrl+Enter 触发格式化（2 空格）
  inputEl().addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      formatJSON(2);
    }
  });

  // JSONPath 输入框回车触发查询
  $('json-path-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      queryPath();
    }
  });

  // 输出区聚焦全选
  outputEl().addEventListener('focus', () => outputEl().select());

  // 初始化元信息
  updateMeta('');
  applyViewMode();
}

export { initJson };
