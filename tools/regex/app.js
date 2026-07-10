/**
 * 正则测试器核心逻辑
 * 实时解析正则 + 高亮预览 / 匹配列表 / 替换预览
 * 全部本地运行，无任何网络请求
 */

/* ========== 常用预设 ========== */
const PRESETS = {
  email: { pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', flags: 'g' },
  url: { pattern: 'https?://[^\\s]+', flags: 'g' },
  phone: { pattern: '1[3-9]\\d{9}', flags: 'g' },
  ipv4: { pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b', flags: 'g' },
  idcard: { pattern: '\\b[1-9]\\d{5}(?:19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]\\b', flags: 'g' },
  postal: { pattern: '\\b[1-9]\\d{5}\\b', flags: 'g' },
  hexcolor: { pattern: '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b', flags: 'g' },
  date: { pattern: '\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}', flags: 'g' },
};

/* ========== 通用工具 ========== */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getFlags() {
  const flags = [];
  document.querySelectorAll('#regex-flags input[type="checkbox"]').forEach((cb) => {
    if (cb.checked) flags.push(cb.value);
  });
  return flags.join('');
}

function setFlags(flagStr) {
  document.querySelectorAll('#regex-flags input[type="checkbox"]').forEach((cb) => {
    cb.checked = flagStr.includes(cb.value);
  });
}

function showError(msg) {
  document.getElementById('regex-error').textContent = msg;
}

function clearError() {
  document.getElementById('regex-error').textContent = '';
}

/* ========== 结果子 Tab 切换 ========== */
function switchTab(mode) {
  document.querySelectorAll('.mode-tab').forEach((t) => {
    t.classList.toggle('mode-tab--active', t.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-panel').forEach((p) => {
    p.classList.toggle('mode-panel--active', p.id === `panel-${mode}`);
  });
}

/* ========== 正则构建与匹配 ========== */
function buildRegex(pattern, flags) {
  // 无效正则会抛出，由调用方 try/catch
  return new RegExp(pattern, flags);
}

// 收集所有匹配（g 标志取全部，否则只取第一个）
// 每个 match: { match, index, groups, captures }
function getAllMatches(regex, text) {
  const matches = [];
  if (regex.global) {
    let m;
    let guard = 0;
    while ((m = regex.exec(text)) !== null) {
      matches.push({
        match: m[0],
        index: m.index,
        groups: m.groups,
        captures: m.slice(1),
      });
      // 零长度匹配时手动推进，避免死循环
      if (m.index === regex.lastIndex) {
        regex.lastIndex++;
      }
      if (++guard > 100000) break;
    }
  } else {
    const m = regex.exec(text);
    if (m) {
      matches.push({
        match: m[0],
        index: m.index,
        groups: m.groups,
        captures: m.slice(1),
      });
    }
  }
  return matches;
}

/* ========== 渲染：高亮预览 ========== */
function renderHighlight(text, matches) {
  const el = document.getElementById('highlight-output');
  if (!matches.length) {
    el.innerHTML = '<div class="empty-state">无匹配结果</div>';
    return;
  }
  let html = '';
  let last = 0;
  for (const m of matches) {
    html += escapeHtml(text.slice(last, m.index));
    html += '<mark>' + escapeHtml(m.match) + '</mark>';
    last = m.index + m.match.length;
  }
  html += escapeHtml(text.slice(last));
  el.innerHTML = html;
}

/* ========== 渲染：捕获组 ========== */
function renderGroups(m) {
  const parts = [];
  if (m.captures && m.captures.length) {
    m.captures.forEach((c, i) => {
      if (c === undefined) return;
      parts.push(
        `<span class="group-item"><span class="group-key">$${i + 1}</span><span class="group-val">${escapeHtml(c)}</span></span>`
      );
    });
  }
  if (m.groups) {
    for (const [name, val] of Object.entries(m.groups)) {
      if (val === undefined) continue;
      parts.push(
        `<span class="group-item group-named"><span class="group-key">${escapeHtml(name)}</span><span class="group-val">${escapeHtml(val)}</span></span>`
      );
    }
  }
  if (!parts.length) return '<span class="empty-cell">—</span>';
  return `<div class="group-list">${parts.join('')}</div>`;
}

/* ========== 渲染：匹配列表 ========== */
function renderMatchList(matches) {
  const el = document.getElementById('match-list-output');
  if (!matches.length) {
    el.innerHTML = '<div class="empty-state">无匹配结果</div>';
    return;
  }
  const rows = matches
    .map((m, i) => {
      const matchCell = m.match.length
        ? escapeHtml(m.match)
        : '<span class="empty-cell">（空匹配）</span>';
      return `<tr>
        <td class="col-idx">${i + 1}</td>
        <td class="col-match">${matchCell}</td>
        <td class="col-pos">${m.index}</td>
        <td class="col-groups">${renderGroups(m)}</td>
      </tr>`;
    })
    .join('');
  el.innerHTML = `<table class="match-table">
    <thead><tr><th>#</th><th>匹配文本</th><th>索引</th><th>捕获组</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/* ========== 渲染：替换预览 ========== */
function renderReplace(regex, text) {
  const out = document.getElementById('replace-output');
  const replacement = document.getElementById('replace-pattern').value;
  if (!text) {
    out.value = '';
    return;
  }
  try {
    // 原生 replace 支持 $1 $2 $& $` $' $<name> 等特殊变量
    out.value = text.replace(regex, replacement);
  } catch (e) {
    out.value = '替换失败：' + e.message;
  }
}

/* ========== 主更新流程 ========== */
function updateAll() {
  const pattern = document.getElementById('regex-pattern').value;
  const text = document.getElementById('regex-text').value;
  const flags = getFlags();

  // 同步标志位显示
  document.getElementById('regex-flags-display').textContent = flags;

  const highlightEl = document.getElementById('highlight-output');
  const listEl = document.getElementById('match-list-output');
  const replaceOut = document.getElementById('replace-output');
  const countEl = document.getElementById('result-count');

  // 空正则：不执行匹配，清空结果
  if (!pattern) {
    clearError();
    highlightEl.innerHTML = '<div class="empty-state">请输入正则表达式</div>';
    listEl.innerHTML = '<div class="empty-state">请输入正则表达式</div>';
    replaceOut.value = '';
    countEl.textContent = '';
    return;
  }

  // 构建正则（捕获异常，无效时不崩溃）
  let regex;
  try {
    regex = buildRegex(pattern, flags);
  } catch (e) {
    showError('正则表达式无效：' + e.message);
    highlightEl.innerHTML = '<div class="empty-state">正则无效</div>';
    listEl.innerHTML = '<div class="empty-state">正则无效</div>';
    replaceOut.value = '';
    countEl.textContent = '';
    return;
  }
  clearError();

  const matches = getAllMatches(regex, text);

  // 匹配数统计
  if (!text) {
    countEl.textContent = '';
  } else if (matches.length === 0) {
    countEl.textContent = '无匹配结果';
  } else {
    countEl.textContent = `共 ${matches.length} 个匹配`;
  }

  renderHighlight(text, matches);
  renderMatchList(matches);
  // 复用已构建的正则（exec 循环结束后 lastIndex 已归零；replace 也会重置）
  renderReplace(regex, text);
}

/* 仅更新替换预览（替换字符串变化时调用，避免重算匹配） */
function updateReplace() {
  const pattern = document.getElementById('regex-pattern').value;
  const text = document.getElementById('regex-text').value;
  if (!pattern || !text) {
    document.getElementById('replace-output').value = '';
    return;
  }
  let regex;
  try {
    regex = buildRegex(pattern, getFlags());
  } catch {
    return;
  }
  renderReplace(regex, text);
}

/* ========== 初始化 ========== */
function initRegex() {
  // 结果子 Tab 切换
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // 预设：填入正则 + 标志位
  document.getElementById('regex-preset').addEventListener('change', (e) => {
    const key = e.target.value;
    if (!key || !PRESETS[key]) return;
    document.getElementById('regex-pattern').value = PRESETS[key].pattern;
    setFlags(PRESETS[key].flags);
    updateAll();
  });

  // 实时输入
  document.getElementById('regex-pattern').addEventListener('input', updateAll);
  document.getElementById('regex-text').addEventListener('input', updateAll);
  document.getElementById('replace-pattern').addEventListener('input', updateReplace);
  document.querySelectorAll('#regex-flags input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', updateAll);
  });

  // 首次渲染
  updateAll();
}

export { initRegex };
