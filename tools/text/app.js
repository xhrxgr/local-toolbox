/**
 * 文本工具集
 * 全部本地处理，无依赖
 */
function initText() {
  const $ = (id) => document.getElementById(id);
  const inputEl = $('text-input');
  const outputEl = $('text-output');
  const opSelect = $('text-op');
  const statsEl = $('text-stats');
  const replaceOpts = $('replace-options');
  const prefixOpts = $('prefix-options');
  const suffixOpts = $('suffix-options');
  const metaEl = $('text-meta');

  /* ========== 操作切换：显隐参数区 ========== */
  function updateOpUI() {
    const op = opSelect.value;
    replaceOpts.hidden = !(op === 'replace' || op === 'replace-regex');
    prefixOpts.hidden = op !== 'add-prefix';
    suffixOpts.hidden = op !== 'add-suffix';
    $('replace-ci-wrap').hidden = op !== 'replace';
    statsEl.hidden = true;
  }
  opSelect.addEventListener('change', updateOpUI);

  /* ========== 执行操作 ========== */
  function run() {
    const text = inputEl.value;
    const op = opSelect.value;
    let result = '';
    let meta = '';

    try {
      switch (op) {
        case 'stats':
          showStats(text);
          outputEl.value = '';
          return;

        // 大小写
        case 'upper': result = text.toUpperCase(); break;
        case 'lower': result = text.toLowerCase(); break;
        case 'title': result = text.replace(/\b\w/g, c => c.toUpperCase()); break;
        case 'sentence': result = text.replace(/(^\s*|[.!?。！？]\s+)([a-z\u4e00-\u9fa5])/g, (_, p1, p2) => p1 + p2.toUpperCase()); break;
        case 'camel': {
          const parts = text.split(/[\s_-]+/).filter(Boolean);
          result = parts.map((p, i) => i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
          break;
        }
        case 'snake': result = text.trim().split(/[\s-]+/).filter(Boolean).map(p => p.toLowerCase()).join('_'); break;
        case 'kebab': result = text.trim().split(/[\s_]+/).filter(Boolean).map(p => p.toLowerCase()).join('-'); break;

        // 去重/排序
        case 'dedup-line': result = dedupLines(text, false); break;
        case 'dedup-line-sort': result = dedupLines(text, true); break;
        case 'sort-asc': result = text.split('\n').sort((a, b) => a.localeCompare(b)).join('\n'); break;
        case 'sort-desc': result = text.split('\n').sort((a, b) => b.localeCompare(a)).join('\n'); break;
        case 'sort-len': result = text.split('\n').sort((a, b) => a.length - b.length).join('\n'); break;
        case 'reverse-line': result = text.split('\n').map(l => [...l].reverse().join('')).join('\n'); break;
        case 'reverse-all': result = [...text].reverse().join(''); break;
        case 'reverse-line-order': result = text.split('\n').reverse().join('\n'); break;
        case 'remove-empty': result = text.split('\n').filter(l => l.trim() !== '').join('\n'); break;
        case 'trim-line': result = text.split('\n').map(l => l.trim()).join('\n'); break;

        // Tab/空格
        case 'tab-to-space': result = text.replace(/\t/g, '    '); break;
        case 'space-to-tab': result = text.replace(/    /g, '\t'); break;

        // 替换
        case 'replace': {
          const from = $('replace-from').value;
          const to = $('replace-to').value;
          const global = $('replace-global').checked;
          const ci = $('replace-ci').checked;
          if (!from) { result = text; break; }
          const flags = (global ? 'g' : '') + (ci ? 'i' : '');
          const re = new RegExp(escapeRegex(from), flags);
          result = text.replace(re, to);
          const matches = text.match(new RegExp(escapeRegex(from), 'g' + (ci ? 'i' : ''))) || [];
          meta = `替换了 ${matches.length} 处`;
          break;
        }
        case 'replace-regex': {
          const from = $('replace-from').value;
          const to = $('replace-to').value;
          const global = $('replace-global').checked;
          if (!from) { result = text; break; }
          let flags = global ? 'g' : '';
          // 自动检测现有 flags
          const m = from.match(/^\/(.+)\/([gimsuy]*)$/);
          let re;
          try {
            if (m) {
              re = new RegExp(m[1], m[2] + (global && !m[2].includes('g') ? 'g' : ''));
            } else {
              re = new RegExp(from, flags);
            }
          } catch (e) {
            meta = '正则错误：' + e.message;
            result = text;
            break;
          }
          result = text.replace(re, to);
          const allMatches = text.match(re.global ? re : new RegExp(re.source, re.flags + 'g')) || [];
          meta = `替换了 ${allMatches.length} 处`;
          break;
        }

        // 前后缀
        case 'add-prefix': {
          const p = $('prefix-text').value;
          result = text.split('\n').map(l => p + l).join('\n');
          break;
        }
        case 'add-suffix': {
          const s = $('suffix-text').value;
          result = text.split('\n').map(l => l + s).join('\n');
          break;
        }
        case 'add-line-num': {
          const lines = text.split('\n');
          const maxLen = String(lines.length).length;
          result = lines.map((l, i) => `${String(i + 1).padStart(maxLen, '0')}  ${l}`).join('\n');
          break;
        }
        case 'remove-duplicate-chars': result = text.replace(/(.)\1+/g, '$1'); break;

        default:
          result = text;
      }
    } catch (e) {
      meta = '错误：' + e.message;
      result = text;
    }

    outputEl.value = result;
    metaEl.textContent = meta;
  }

  /* ========== 显示统计 ========== */
  function showStats(text) {
    const lines = text.split('\n');
    const nonEmptyLines = lines.filter(l => l.trim() !== '').length;
    const chars = text.length;
    const charsNoSpace = text.replace(/\s/g, '').length;
    // 单词数：英文按空白拆，中文按字符
    const enWords = (text.match(/[a-zA-Z0-9_]+/g) || []).length;
    const cnChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const words = enWords + cnChars;
    const bytes = new TextEncoder().encode(text).length;

    $('stat-chars').textContent = chars;
    $('stat-chars-nospace').textContent = charsNoSpace;
    $('stat-words').textContent = words;
    $('stat-lines').textContent = lines.length;
    $('stat-nonempty').textContent = nonEmptyLines;
    $('stat-bytes').textContent = bytes;
    statsEl.hidden = false;
    metaEl.textContent = `共 ${lines.length} 行 / ${words} 词 / ${chars} 字符 / ${bytes} 字节`;
  }

  /* ========== 工具函数 ========== */
  function dedupLines(text, sort) {
    const seen = new Set();
    const result = [];
    for (const line of text.split('\n')) {
      if (!seen.has(line)) {
        seen.add(line);
        result.push(line);
      }
    }
    if (sort) result.sort((a, b) => a.localeCompare(b));
    return result.join('\n');
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ========== 事件绑定 ========== */
  $('btn-run').addEventListener('click', run);
  $('btn-swap').addEventListener('click', () => {
    if (!outputEl.value) return;
    inputEl.value = outputEl.value;
    outputEl.value = '';
    metaEl.textContent = '已用结果替换输入';
  });
  $('btn-clear').addEventListener('click', () => {
    inputEl.value = '';
    outputEl.value = '';
    statsEl.hidden = true;
    metaEl.textContent = '';
  });
  $('btn-copy').addEventListener('click', () => {
    if (!outputEl.value) return;
    navigator.clipboard.writeText(outputEl.value).then(() => {
      const btn = $('btn-copy');
      const orig = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(() => alert('复制失败，请手动选择'));
  });

  // Ctrl+Enter 执行
  inputEl.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') run();
  });

  updateOpUI();
}

export { initText };
