/**
 * Markdown 预览工具核心逻辑
 * 实时渲染 + 代码高亮 + 目录跳转 + 导出 HTML
 * 全部本地运行，无任何网络请求
 */

import { marked } from 'marked';

/* ========== Marked 配置 ========== */
marked.setOptions({ gfm: true, breaks: false });

/* ========== 默认示例内容 ========== */
const DEFAULT_CONTENT = [
  '# Markdown 预览',
  '',
  '这是一个 **Markdown** 预览工具，支持 GFM 语法。',
  '',
  '## 功能特性',
  '',
  '- 实时渲染',
  '- 代码高亮',
  '- 支持 `inline code`',
  '- [链接](https://example.com)',
  '',
  '## 代码示例',
  '',
  '```javascript',
  'function hello(name) {',
  '  console.log(`Hello, ${name}!`);',
  '  return true;',
  '}',
  '```',
  '',
  '## 表格',
  '',
  '| 功能 | 支持 |',
  '|------|------|',
  '| GFM  | ✓    |',
  '| 导出 | ✓    |',
  '',
  '> 引用文本',
  '',
  '~~删除线~~',
  '',
].join('\n');

/* ========== 代码高亮：语言配置 ========== */
// 每种语言定义：关键字、注释正则、字符串正则
const LANG_CONFIG = {
  javascript: {
    keywords: 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|typeof|instanceof|in|of|try|catch|finally|throw|async|await|yield|import|export|from|default|delete|void|null|undefined|true|false|static|get|set|of',
    comment: '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/',
    string: '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`',
  },
  js: null, // 别名，使用 javascript
  typescript: {
    keywords: 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|typeof|instanceof|in|of|try|catch|finally|throw|async|await|yield|import|export|from|default|delete|void|null|undefined|true|false|static|get|set|interface|type|enum|implements|public|private|protected|readonly|namespace|declare|abstract|as|is|keyof|never|unknown|any|number|string|boolean|object|symbol|bigint',
    comment: '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/',
    string: '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`',
  },
  ts: null,
  python: {
    keywords: 'def|class|return|if|elif|else|for|while|break|continue|pass|import|from|as|try|except|finally|raise|with|lambda|global|nonlocal|yield|async|await|True|False|None|and|or|not|in|is|del|assert|self',
    comment: '#[^\\n]*',
    string: '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'',
  },
  py: null,
  bash: {
    keywords: 'if|then|else|elif|fi|for|while|do|done|case|esac|function|return|echo|exit|local|export|unset|read|set|shift|source|cd|pwd|ls|cat|grep|sed|awk|chmod|chown|sudo|apt|yum|brew|git|npm|node|python|bash|sh',
    comment: '#[^\\n]*',
    string: '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'',
  },
  sh: null,
  shell: null,
  sql: {
    keywords: 'SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|INDEX|VIEW|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|DISTINCT|AS|COUNT|SUM|AVG|MIN|MAX|UNION|ALL|PRIMARY|KEY|FOREIGN|REFERENCES|DEFAULT|UNIQUE|CONSTRAINT|CHECK|CASCADE|BEGIN|COMMIT|ROLLBACK|TRANSACTION',
    comment: '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/',
    string: "'(?:[^'\\\\]|\\\\.)*'",
    caseInsensitive: true,
  },
  json: {
    keywords: 'true|false|null',
    comment: '',
    string: '"(?:[^"\\\\]|\\\\.)*"',
  },
  html: {
    keywords: '',
    comment: '<!--[\\s\\S]*?-->',
    string: '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'',
  },
  css: {
    keywords: '',
    comment: '\\/\\*[\\s\\S]*?\\*\\/',
    string: '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'',
  },
};

/**
 * 代码高亮：基于正则，按 注释 → 字符串 → 关键字 → 数字 顺序匹配
 * 使用合并正则 + 命名分组，避免嵌套高亮（注释/字符串内的关键字不会被二次高亮）
 */
function highlightCode(block, lang) {
  let cfg = LANG_CONFIG[lang];
  if (cfg === null) cfg = LANG_CONFIG.javascript; // 别名回退
  if (!cfg) cfg = LANG_CONFIG.javascript; // 未知语言用 JS 规则做通用高亮

  const code = block.textContent;
  const flags = cfg.caseInsensitive ? 'gi' : 'g';

  const parts = [];
  if (cfg.comment) parts.push(`(?<comment>${cfg.comment})`);
  if (cfg.string) parts.push(`(?<string>${cfg.string})`);
  if (cfg.keywords) parts.push(`\\b(?<keyword>${cfg.keywords})\\b`);
  parts.push(`(?<number>\\b\\d+(?:\\.\\d+)?\\b)`);

  const re = new RegExp(parts.join('|'), flags);

  let result = '';
  let last = 0;
  let match;
  while ((match = re.exec(code)) !== null) {
    result += escapeHtml(code.slice(last, match.index));
    const text = match[0];
    const g = match.groups || {};
    if (g.comment) {
      result += `<span class="token-comment">${escapeHtml(text)}</span>`;
    } else if (g.string) {
      result += `<span class="token-string">${escapeHtml(text)}</span>`;
    } else if (g.keyword) {
      result += `<span class="token-keyword">${escapeHtml(text)}</span>`;
    } else if (g.number) {
      result += `<span class="token-number">${escapeHtml(text)}</span>`;
    } else {
      result += escapeHtml(text);
    }
    last = re.lastIndex;
    // 防止零宽匹配死循环
    if (match.index === re.lastIndex) re.lastIndex++;
  }
  result += escapeHtml(code.slice(last));
  block.innerHTML = result;
}

function highlightAllCode(preview) {
  preview.querySelectorAll('pre code[class*="language-"]').forEach((block) => {
    const lang = block.className.match(/language-(\w+)/)?.[1];
    try {
      highlightCode(block, lang);
    } catch {
      // 高亮失败时保持原样（已由 marked 转义）
    }
  });
}

/* ========== 工具函数 ========== */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '');
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function insertAtCursor(ta, text) {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  ta.value = value.slice(0, start) + text + value.slice(end);
  const newPos = start + text.length;
  ta.selectionStart = ta.selectionEnd = newPos;
}

/* ========== 渲染 ========== */
function render(state) {
  const text = state.editor.value;
  const html = marked.parse(text);
  state.preview.innerHTML = html;
  highlightAllCode(state.preview);
  buildToc(state);
}

/* ========== 目录生成 ========== */
function buildToc(state) {
  const headings = state.preview.querySelectorAll('h1, h2, h3');
  const used = {};
  const items = [];
  headings.forEach((h) => {
    let slug = slugify(h.textContent);
    if (!slug) slug = 'heading';
    if (used[slug] !== undefined) {
      used[slug]++;
      slug = `${slug}-${used[slug]}`;
    } else {
      used[slug] = 0;
    }
    h.id = slug;
    items.push({ level: Number(h.tagName[1]), text: h.textContent.trim(), id: slug });
  });
  renderTocPanel(state, items);
}

function renderTocPanel(state, items) {
  if (!items.length) {
    state.tocList.innerHTML = '<div class="md-toc-empty">暂无标题</div>';
    return;
  }
  state.tocList.innerHTML = items
    .map((item) => {
      const indent = (item.level - 1) * 14;
      return `<a class="md-toc-item md-toc-item--l${item.level}" data-target="${escapeAttr(item.id)}" style="padding-left:${12 + indent}px" title="${escapeAttr(item.text)}">${escapeHtml(item.text)}</a>`;
    })
    .join('');
  state.tocList.querySelectorAll('.md-toc-item').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const el = state.preview.querySelector(`#${CSS.escape(a.dataset.target)}`);
      if (el) {
        // 仅滚动预览容器，避免整页跳动
        const top = el.offsetTop - 8;
        state.preview.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
      }
    });
  });
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ========== 行号 ========== */
function updateGutter(state) {
  const lines = state.editor.value.split('\n').length;
  const nums = [];
  for (let i = 1; i <= lines; i++) nums.push(i);
  state.gutter.textContent = nums.join('\n');
}

/* ========== 视图切换 ========== */
function setView(state, mode) {
  state.layout.dataset.view = mode;
  state.viewBtns.forEach((b) => {
    b.classList.toggle('view-btn--active', b.dataset.view === mode);
  });
}

/* ========== 目录浮层开关 ========== */
function toggleToc(state, open) {
  const willOpen = open === undefined ? state.toc.hasAttribute('hidden') : open;
  if (willOpen) {
    state.toc.removeAttribute('hidden');
  } else {
    state.toc.setAttribute('hidden', '');
  }
}

/* ========== 导出 HTML ========== */
function buildExportDoc(title, bodyHtml) {
  const css = `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.7; color: #1f2937; background: #fff; max-width: 760px; margin: 0 auto; padding: 32px 24px; }
    h1, h2, h3, h4 { line-height: 1.3; margin: 1.4em 0 0.6em; }
    h1 { font-size: 1.9em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
    h3 { font-size: 1.2em; }
    p { margin: 0.8em 0; }
    a { color: #6366f1; }
    code { font-family: 'JetBrains Mono', Consolas, monospace; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 1em 0; }
    pre code { background: none; padding: 0; color: inherit; }
    .token-keyword { color: #c678dd; }
    .token-string { color: #98c379; }
    .token-comment { color: #7f848e; font-style: italic; }
    .token-number { color: #d19a66; }
    blockquote { border-left: 4px solid #6366f1; margin: 1em 0; padding: 0.4em 1em; color: #6b7280; background: #f8fafc; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }
    th { background: #f1f5f9; }
    img { max-width: 100%; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.6em 0; }
    ul, ol { margin: 0.8em 0; padding-left: 1.6em; }
    li { margin: 0.3em 0; }
    input[type="checkbox"] { margin-right: 0.4em; }
  `;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function exportHtml(state) {
  const bodyHtml = state.preview.innerHTML;
  const title = (state.preview.querySelector('h1')?.textContent || 'Markdown 文档').trim() || 'Markdown 文档';
  const full = buildExportDoc(title, bodyHtml);
  const blob = new Blob([full], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ========== 初始化 ========== */
function initMarkdown() {
  const editor = document.getElementById('md-editor');
  const preview = document.getElementById('md-preview');
  const gutter = document.getElementById('md-gutter');
  const layout = document.getElementById('md-layout');
  const toc = document.getElementById('md-toc');
  const tocList = document.getElementById('md-toc-list');
  const btnToc = document.getElementById('btn-toc');
  const btnExport = document.getElementById('btn-export');
  const viewSwitch = document.getElementById('view-switch');
  const viewBtns = viewSwitch.querySelectorAll('.view-btn');
  const splitBtn = viewSwitch.querySelector('[data-view="split"]');

  const state = { editor, preview, gutter, layout, toc, tocList, viewBtns };

  // 默认内容
  editor.value = DEFAULT_CONTENT;

  // 防抖渲染
  const debouncedRender = debounce(() => {
    render(state);
    updateGutter(state);
  }, 200);

  // 输入实时渲染
  editor.addEventListener('input', () => {
    updateGutter(state);
    debouncedRender();
  });

  // Tab 缩进（插入两个空格，不切换焦点）
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor(editor, '  ');
      updateGutter(state);
      render(state);
    }
  });

  // 同步行号滚动
  editor.addEventListener('scroll', () => {
    gutter.scrollTop = editor.scrollTop;
  });

  // 视图切换
  viewSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-btn');
    if (!btn) return;
    setView(state, btn.dataset.view);
  });

  // 目录浮层
  btnToc.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleToc(state);
  });
  // 点击目录项后不关闭（保留浮层便于多次跳转）
  toc.addEventListener('click', (e) => e.stopPropagation());
  // 点击外部关闭目录
  document.addEventListener('click', (e) => {
    if (!toc.hasAttribute('hidden') && !toc.contains(e.target) && e.target !== btnToc && !btnToc.contains(e.target)) {
      toggleToc(state, false);
    }
  });
  // ESC 关闭目录
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !toc.hasAttribute('hidden')) {
      toggleToc(state, false);
    }
  });

  // 导出 HTML
  btnExport.addEventListener('click', () => exportHtml(state));

  // 窄屏处理：分栏不可用，自动回退到编辑视图
  const mq = window.matchMedia('(max-width: 768px)');
  const handleMq = (e) => {
    if (e.matches) {
      splitBtn.disabled = true;
      splitBtn.classList.add('view-btn--hidden');
      if (layout.dataset.view === 'split') {
        setView(state, 'edit');
      }
    } else {
      splitBtn.disabled = false;
      splitBtn.classList.remove('view-btn--hidden');
    }
  };
  mq.addEventListener('change', handleMq);
  handleMq(mq);

  // 初次渲染 + 行号
  updateGutter(state);
  render(state);
}

export { initMarkdown };
