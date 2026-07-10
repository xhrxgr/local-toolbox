/**
 * 文本对比工具核心逻辑
 * - LCS 最长公共子序列算法（行级 / 字符级）
 * - 并排 / 内联两种视图
 * - 逐行 / 逐字两种对比模式
 * - 忽略空白 / 忽略大小写
 * - 导出 unified diff（.patch）
 * 全部本地运行，无任何网络请求
 */

/* ========== 模块状态 ========== */
let leftTA, rightTA, warningEl, statsEl, statAdd, statDel, statEq, emptyEl, viewContainer;
let currentLineDiff = null;
let currentOptions = null;
let compareTimer = null;
let warningTimer = null;

/* ========== 工具函数 ========== */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 行级归一化（只用于比较，不影响显示原文）
function normalizeLine(line, options) {
  let r = line;
  if (options.ignoreWhitespace) r = r.replace(/\s+/g, ' ').trim();
  if (options.ignoreCase) r = r.toLowerCase();
  return r;
}

/* ========== LCS 通用算法 ==========
 * aRaw / bRaw 为原始数组，keyFn 提取比较键（支持忽略空白/大小写）
 * 返回 [{type:'equal'|'delete'|'insert', value}]，value 为原始元素
 */
function diffLcs(aRaw, bRaw, keyFn) {
  const aKey = aRaw.map(keyFn);
  const bKey = bRaw.map(keyFn);
  const m = aKey.length, n = bKey.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aKey[i - 1] === bKey[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (aKey[i - 1] === bKey[j - 1]) {
      result.unshift({ type: 'equal', value: aRaw[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      result.unshift({ type: 'delete', value: aRaw[i - 1] });
      i--;
    } else {
      result.unshift({ type: 'insert', value: bRaw[j - 1] });
      j--;
    }
  }
  while (i > 0) { result.unshift({ type: 'delete', value: aRaw[i - 1] }); i--; }
  while (j > 0) { result.unshift({ type: 'insert', value: bRaw[j - 1] }); j--; }
  return result;
}

/* ========== 构建 segments（带行号 + 逐字增强） ==========
 * line 模式：equal / delete / insert
 * char 模式：相邻 delete+insert 配对做字符级 LCS，合并为 change 段
 */
function buildSegments(lineDiff, options) {
  const segments = [];
  const charMode = options.mode === 'char';
  let aNo = 1, bNo = 1;
  let i = 0;
  const n = lineDiff.length;
  while (i < n) {
    const item = lineDiff[i];
    if (item.type === 'equal') {
      segments.push({ type: 'equal', aLineNo: aNo, bLineNo: bNo, text: item.value });
      aNo++; bNo++; i++;
      continue;
    }
    // 收集连续的非 equal 块
    const dels = [];
    const ins = [];
    while (i < n && lineDiff[i].type !== 'equal') {
      if (lineDiff[i].type === 'delete') dels.push({ no: aNo++, text: lineDiff[i].value });
      else ins.push({ no: bNo++, text: lineDiff[i].value });
      i++;
    }
    if (charMode) {
      const pairs = Math.min(dels.length, ins.length);
      for (let k = 0; k < pairs; k++) {
        const cd = diffLcs(
          dels[k].text.split(''),
          ins[k].text.split(''),
          (c) => (options.ignoreCase ? c.toLowerCase() : c)
        );
        segments.push({
          type: 'change',
          aLineNo: dels[k].no, aText: dels[k].text,
          bLineNo: ins[k].no, bText: ins[k].text,
          charDiff: cd,
        });
      }
      for (let k = pairs; k < dels.length; k++) {
        segments.push({ type: 'delete', aLineNo: dels[k].no, text: dels[k].text });
      }
      for (let k = pairs; k < ins.length; k++) {
        segments.push({ type: 'insert', bLineNo: ins[k].no, text: ins[k].text });
      }
    } else {
      for (const d of dels) segments.push({ type: 'delete', aLineNo: d.no, text: d.text });
      for (const x of ins) segments.push({ type: 'insert', bLineNo: x.no, text: x.text });
    }
  }
  return segments;
}

/* ========== 字符级 diff 渲染 ==========
 * side='left'：显示 equal + delete（delete 高亮）
 * side='right'：显示 equal + insert（insert 高亮）
 */
function renderCharDiffHtml(charDiff, side) {
  let html = '';
  for (const part of charDiff) {
    if (part.type === 'equal') {
      html += escapeHtml(part.value);
    } else if (part.type === 'delete' && side === 'left') {
      html += `<span class="char-del">${escapeHtml(part.value)}</span>`;
    } else if (part.type === 'insert' && side === 'right') {
      html += `<span class="char-ins">${escapeHtml(part.value)}</span>`;
    }
  }
  return html === '' ? '&nbsp;' : html;
}

function cellContent(cell) {
  if (cell.charDiff) {
    return renderCharDiffHtml(cell.charDiff, cell.type === 'delete' ? 'left' : 'right');
  }
  const t = escapeHtml(cell.text);
  return t === '' ? '&nbsp;' : t;
}

/* ========== 并排视图 ========== */
function buildSideBySideRows(segments) {
  const rows = [];
  for (const seg of segments) {
    if (seg.type === 'equal') {
      rows.push({
        left: { no: seg.aLineNo, text: seg.text, type: 'equal' },
        right: { no: seg.bLineNo, text: seg.text, type: 'equal' },
      });
    } else if (seg.type === 'delete') {
      rows.push({ left: { no: seg.aLineNo, text: seg.text, type: 'delete' }, right: null });
    } else if (seg.type === 'insert') {
      rows.push({ left: null, right: { no: seg.bLineNo, text: seg.text, type: 'insert' } });
    } else if (seg.type === 'change') {
      rows.push({
        left: { no: seg.aLineNo, text: seg.aText, type: 'delete', charDiff: seg.charDiff },
        right: { no: seg.bLineNo, text: seg.bText, type: 'insert', charDiff: seg.charDiff },
      });
    }
  }
  return rows;
}

function renderSplit(segments) {
  const rows = buildSideBySideRows(segments);
  if (rows.length === 0) { viewContainer.innerHTML = ''; return; }
  let html = '<table class="diff-table diff-table--split">';
  html += '<colgroup><col class="diff-col-ln"><col class="diff-col-code"><col class="diff-col-ln"><col class="diff-col-code"></colgroup>';
  html += '<thead><tr><th class="diff-th" colspan="2">原文</th><th class="diff-th" colspan="2">修改后</th></tr></thead><tbody>';
  for (const r of rows) {
    const lNo = r.left ? `<td class="diff-ln">${r.left.no}</td>` : '<td class="diff-ln diff-ln--empty"></td>';
    const lCode = r.left
      ? `<td class="diff-code diff-code--${r.left.type}">${cellContent(r.left)}</td>`
      : '<td class="diff-code diff-code--empty"></td>';
    const rNo = r.right ? `<td class="diff-ln">${r.right.no}</td>` : '<td class="diff-ln diff-ln--empty"></td>';
    const rCode = r.right
      ? `<td class="diff-code diff-code--${r.right.type}">${cellContent(r.right)}</td>`
      : '<td class="diff-code diff-code--empty"></td>';
    html += `<tr>${lNo}${lCode}${rNo}${rCode}</tr>`;
  }
  html += '</tbody></table>';
  viewContainer.innerHTML = html;
}

/* ========== 内联视图 ========== */
function buildInlineRows(segments) {
  const rows = [];
  for (const seg of segments) {
    if (seg.type === 'equal') {
      rows.push({ prefix: ' ', no: seg.aLineNo, text: seg.text, type: 'equal' });
    } else if (seg.type === 'delete') {
      rows.push({ prefix: '-', no: seg.aLineNo, text: seg.text, type: 'delete' });
    } else if (seg.type === 'insert') {
      rows.push({ prefix: '+', no: seg.bLineNo, text: seg.text, type: 'insert' });
    } else if (seg.type === 'change') {
      rows.push({ prefix: '-', no: seg.aLineNo, text: seg.aText, type: 'delete', charDiff: seg.charDiff, charSide: 'left' });
      rows.push({ prefix: '+', no: seg.bLineNo, text: seg.bText, type: 'insert', charDiff: seg.charDiff, charSide: 'right' });
    }
  }
  return rows;
}

function renderInline(segments) {
  const rows = buildInlineRows(segments);
  if (rows.length === 0) { viewContainer.innerHTML = ''; return; }
  let html = '<table class="diff-table diff-table--inline">';
  html += '<colgroup><col class="diff-col-ln"><col class="diff-col-sign"><col class="diff-col-code"></colgroup>';
  html += '<tbody>';
  for (const r of rows) {
    const content = r.charDiff
      ? renderCharDiffHtml(r.charDiff, r.charSide)
      : (escapeHtml(r.text) === '' ? '&nbsp;' : escapeHtml(r.text));
    html += `<tr><td class="diff-ln">${r.no}</td><td class="diff-sign diff-sign--${r.type}">${r.prefix}</td><td class="diff-code diff-code--${r.type}">${content}</td></tr>`;
  }
  html += '</tbody></table>';
  viewContainer.innerHTML = html;
}

/* ========== 渲染入口 ========== */
function render() {
  if (!currentLineDiff) { showEmpty(); return; }
  const segments = buildSegments(currentLineDiff, currentOptions);
  if (currentOptions.view === 'split') renderSplit(segments);
  else renderInline(segments);
}

/* ========== 导出 unified diff（.patch） ==========
 * 基于 lineDiff（行级），context = 3
 */
function generatePatch(lineDiff, aLabel, bLabel, context) {
  const n = lineDiff.length;
  const lines = ['--- ' + aLabel, '+++ ' + bLabel];

  const changeIdx = [];
  for (let i = 0; i < n; i++) if (lineDiff[i].type !== 'equal') changeIdx.push(i);
  if (changeIdx.length === 0) return lines.join('\n') + '\n';

  // 预计算每个索引对应的 a/b 行号
  const aLineAt = new Array(n);
  const bLineAt = new Array(n);
  let a = 1, b = 1;
  for (let i = 0; i < n; i++) {
    aLineAt[i] = a;
    bLineAt[i] = b;
    if (lineDiff[i].type === 'equal') { a++; b++; }
    else if (lineDiff[i].type === 'delete') a++;
    else b++;
  }

  // 合并相邻变更块为 hunk（间隔 <= 2*context+1 合并）
  const hunks = [];
  let hs = Math.max(0, changeIdx[0] - context);
  let he = Math.min(n - 1, changeIdx[0] + context);
  for (let k = 1; k < changeIdx.length; k++) {
    const cs = changeIdx[k] - context;
    if (cs <= he + 1) {
      he = Math.min(n - 1, changeIdx[k] + context);
    } else {
      hunks.push([hs, he]);
      hs = Math.max(0, changeIdx[k] - context);
      he = Math.min(n - 1, changeIdx[k] + context);
    }
  }
  hunks.push([hs, he]);

  for (const [hStart, hEnd] of hunks) {
    const aStart = aLineAt[hStart];
    const bStart = bLineAt[hStart];
    let aCount = 0, bCount = 0;
    const body = [];
    for (let i = hStart; i <= hEnd; i++) {
      const item = lineDiff[i];
      if (item.type === 'equal') { body.push(' ' + item.value); aCount++; bCount++; }
      else if (item.type === 'delete') { body.push('-' + item.value); aCount++; }
      else { body.push('+' + item.value); bCount++; }
    }
    const aPart = aCount === 0 ? `${aStart - 1},0` : `${aStart},${aCount}`;
    const bPart = bCount === 0 ? `${bStart - 1},0` : `${bStart},${bCount}`;
    lines.push(`@@ -${aPart} +${bPart} @@`);
    lines.push(...body);
  }
  return lines.join('\n') + '\n';
}

function exportPatch() {
  if (!currentLineDiff) {
    showWarning('请先输入文本并对比', true);
    return;
  }
  const hasChange = currentLineDiff.some((d) => d.type !== 'equal');
  if (!hasChange) {
    showWarning('两段文本相同，没有差异可导出', true);
    return;
  }
  const patch = generatePatch(currentLineDiff, '原文', '修改后', 3);
  const blob = new Blob([patch], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'changes.patch';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ========== 选项 / 状态 ========== */
function getOptions() {
  return {
    view: document.getElementById('diff-view').value,
    mode: document.getElementById('diff-mode').value,
    ignoreWhitespace: document.getElementById('diff-ignore-ws').checked,
    ignoreCase: document.getElementById('diff-ignore-case').checked,
  };
}

function showEmpty() {
  emptyEl.hidden = false;
  viewContainer.innerHTML = '';
}

function hideEmpty() {
  emptyEl.hidden = true;
}

function showWarning(msg, autoHide) {
  warningEl.textContent = msg;
  warningEl.hidden = false;
  clearTimeout(warningTimer);
  if (autoHide) {
    warningTimer = setTimeout(() => { warningEl.hidden = true; }, 2500);
  }
}

function hideWarning() {
  clearTimeout(warningTimer);
  warningEl.hidden = true;
}

/* ========== 对比主流程 ========== */
function compare() {
  const textA = leftTA.value;
  const textB = rightTA.value;
  const options = getOptions();
  const aLines = textA === '' ? [] : textA.split('\n');
  const bLines = textB === '' ? [] : textB.split('\n');

  if (aLines.length === 0 && bLines.length === 0) {
    currentLineDiff = null;
    currentOptions = options;
    hideWarning();
    statsEl.hidden = true;
    showEmpty();
    return;
  }

  const maxLines = Math.max(aLines.length, bLines.length);
  if (maxLines > 5000) {
    showWarning('⚠ 文本过大（' + maxLines + ' 行），可能影响性能');
  } else {
    hideWarning();
  }

  const lineDiff = diffLcs(aLines, bLines, (l) => normalizeLine(l, options));
  currentLineDiff = lineDiff;
  currentOptions = options;

  let add = 0, del = 0, eq = 0;
  for (const item of lineDiff) {
    if (item.type === 'equal') eq++;
    else if (item.type === 'delete') del++;
    else add++;
  }
  statAdd.textContent = add;
  statDel.textContent = del;
  statEq.textContent = eq;
  statsEl.hidden = false;

  hideEmpty();
  render();
}

function scheduleCompare() {
  clearTimeout(compareTimer);
  compareTimer = setTimeout(compare, 300);
}

function swap() {
  const a = leftTA.value;
  leftTA.value = rightTA.value;
  rightTA.value = a;
  compare();
}

function clearAll() {
  leftTA.value = '';
  rightTA.value = '';
  hideWarning();
  statsEl.hidden = true;
  currentLineDiff = null;
  showEmpty();
}

/* ========== 初始化 ========== */
function initDiff() {
  leftTA = document.getElementById('diff-left');
  rightTA = document.getElementById('diff-right');
  warningEl = document.getElementById('diff-warning');
  statsEl = document.getElementById('diff-stats');
  statAdd = document.getElementById('stat-add');
  statDel = document.getElementById('stat-del');
  statEq = document.getElementById('stat-eq');
  emptyEl = document.getElementById('diff-empty');
  viewContainer = document.getElementById('diff-view-container');

  document.getElementById('btn-diff-compare').addEventListener('click', compare);
  document.getElementById('btn-diff-export').addEventListener('click', exportPatch);
  document.getElementById('btn-diff-swap').addEventListener('click', swap);
  document.getElementById('btn-diff-clear').addEventListener('click', clearAll);

  // 选项变更 -> 重新对比（视图/对比模式/忽略项均影响结果或渲染）
  document.getElementById('diff-view').addEventListener('change', compare);
  document.getElementById('diff-mode').addEventListener('change', compare);
  document.getElementById('diff-ignore-ws').addEventListener('change', compare);
  document.getElementById('diff-ignore-case').addEventListener('change', compare);

  // 输入自动对比（防抖）
  leftTA.addEventListener('input', scheduleCompare);
  rightTA.addEventListener('input', scheduleCompare);

  // Ctrl+Enter 立即对比
  [leftTA, rightTA].forEach((ta) => {
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        compare();
      }
    });
  });

  showEmpty();
}

export { initDiff };
