/**
 * 编码转换工具核心逻辑
 * 4 个模式：Base64 / URL / ASCII / Unicode
 * 全部本地运行，无任何网络请求
 */

/* ========== Tab 切换 ========== */
function switchTab(mode) {
  document.querySelectorAll('.mode-tab').forEach((t) => {
    t.classList.toggle('mode-tab--active', t.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-panel').forEach((p) => {
    p.classList.toggle('mode-panel--active', p.id === `panel-${mode}`);
  });
}

/* ========== 通用：UTF-8 ↔ Base64 ========== */
// 处理 Unicode 字符的 Base64 编码（避免 atob/btoa 仅支持 Latin1 的限制）
function strToBase64(str) {
  // 先用 TextEncoder 把字符串转为 UTF-8 字节，再转 Base64
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToStr(b64) {
  // 清理：去掉换行、空格
  const clean = b64.replace(/\s+/g, '');
  // 校验
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error('包含非法 Base64 字符');
  }
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

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

function showMeta(el, html) {
  el.innerHTML = html;
}

function showError(el, msg) {
  el.innerHTML = `<span class="meta-error">${msg}</span>`;
}

/* ========== Base64 模式 ========== */
function b64Encode() {
  const input = document.getElementById('b64-input').value;
  const output = document.getElementById('b64-output');
  const meta = document.getElementById('b64-meta');
  if (!input) {
    output.value = '';
    showMeta(meta, '');
    return;
  }
  try {
    const result = strToBase64(input);
    output.value = result;
    const byteLen = new TextEncoder().encode(input).length;
    showMeta(meta, `输入 ${input.length} 字符 / ${byteLen} 字节 → 输出 ${result.length} 字符
      <button class="meta-btn" data-copy="${result.replace(/"/g, '&quot;')}">复制</button>`);
    bindMetaCopy(meta);
  } catch (e) {
    output.value = '';
    showError(meta, '编码失败：' + e.message);
  }
}

function b64Decode() {
  const input = document.getElementById('b64-input').value;
  const output = document.getElementById('b64-output');
  const meta = document.getElementById('b64-meta');
  if (!input) {
    output.value = '';
    showMeta(meta, '');
    return;
  }
  try {
    const result = base64ToStr(input);
    output.value = result;
    const byteLen = input.replace(/\s+/g, '').length;
    showMeta(meta, `输入 ${byteLen} 字符 → 输出 ${result.length} 字符 / ${new TextEncoder().encode(result).length} 字节
      <button class="meta-btn" data-copy="${result.replace(/"/g, '&quot;')}">复制</button>`);
    bindMetaCopy(meta);
  } catch (e) {
    output.value = '';
    showError(meta, '解码失败：' + e.message);
  }
}

function b64Swap() {
  const input = document.getElementById('b64-input');
  const output = document.getElementById('b64-output');
  const v = output.value;
  if (!v) return;
  input.value = v;
  output.value = '';
  document.getElementById('b64-meta').innerHTML = '';
}

function b64Clear() {
  document.getElementById('b64-input').value = '';
  document.getElementById('b64-output').value = '';
  document.getElementById('b64-meta').innerHTML = '';
}

/* ========== URL 编码模式 ========== */
function urlEncode() {
  const input = document.getElementById('url-input').value;
  const output = document.getElementById('url-output');
  const meta = document.getElementById('url-meta');
  const mode = document.getElementById('url-mode').value;
  if (!input) {
    output.value = '';
    showMeta(meta, '');
    return;
  }
  try {
    const result = mode === 'uri' ? encodeURI(input) : encodeURIComponent(input);
    output.value = result;
    const encodedPct = ((result.length - input.length) / Math.max(input.length, 1) * 100).toFixed(1);
    showMeta(meta, `输入 ${input.length} 字符 → 输出 ${result.length} 字符（+${encodedPct}%）
      <button class="meta-btn" data-copy="${result.replace(/"/g, '&quot;')}">复制</button>`);
    bindMetaCopy(meta);
  } catch (e) {
    output.value = '';
    showError(meta, '编码失败：' + e.message);
  }
}

function urlDecode() {
  const input = document.getElementById('url-input').value;
  const output = document.getElementById('url-output');
  const meta = document.getElementById('url-meta');
  if (!input) {
    output.value = '';
    showMeta(meta, '');
    return;
  }
  try {
    const result = decodeURIComponent(input);
    output.value = result;
    showMeta(meta, `输入 ${input.length} 字符 → 输出 ${result.length} 字符
      <button class="meta-btn" data-copy="${result.replace(/"/g, '&quot;')}">复制</button>`);
    bindMetaCopy(meta);
  } catch (e) {
    output.value = '';
    showError(meta, '解码失败：' + e.message + '（可能不是有效的 URL 编码）');
  }
}

function urlSwap() {
  const input = document.getElementById('url-input');
  const output = document.getElementById('url-output');
  const v = output.value;
  if (!v) return;
  input.value = v;
  output.value = '';
  document.getElementById('url-meta').innerHTML = '';
}

function urlClear() {
  document.getElementById('url-input').value = '';
  document.getElementById('url-output').value = '';
  document.getElementById('url-meta').innerHTML = '';
}

/* ========== ASCII 模式 ========== */
function asciiConvert() {
  const input = document.getElementById('ascii-input').value;
  const output = document.getElementById('ascii-output');
  const meta = document.getElementById('ascii-meta');
  const mode = document.getElementById('ascii-mode').value;
  if (!input) {
    output.value = '';
    showMeta(meta, '');
    return;
  }
  try {
    let result;
    if (mode === 'dec') {
      result = [...input].map((c) => c.codePointAt(0)).join(' ');
    } else if (mode === 'hex') {
      result = [...input].map((c) => '0x' + c.codePointAt(0).toString(16).toUpperCase().padStart(2, '0')).join(' ');
    } else if (mode === 'bin') {
      result = [...input].map((c) => c.codePointAt(0).toString(2).padStart(8, '0')).join(' ');
    } else {
      // char: ASCII 码 → 文本
      // 支持空格、逗号、0x 前缀
      const parts = input.split(/[\s,]+/).filter(Boolean);
      const codes = parts.map((p) => {
        if (/^0x[0-9a-fA-F]+$/i.test(p)) return parseInt(p.slice(2), 16);
        if (/^\d+$/.test(p)) return parseInt(p, 10);
        throw new Error(`无法识别的码值："${p}"`);
      });
      result = codes.map((c) => String.fromCodePoint(c)).join('');
    }
    output.value = result;
    const charCount = mode === 'char' ? result.length : [...input].length;
    showMeta(meta, `共 ${charCount} 个字符
      <button class="meta-btn" data-copy="${result.replace(/"/g, '&quot;')}">复制</button>`);
    bindMetaCopy(meta);
  } catch (e) {
    output.value = '';
    showError(meta, '转换失败：' + e.message);
  }
}

function asciiSwap() {
  const input = document.getElementById('ascii-input');
  const output = document.getElementById('ascii-output');
  const v = output.value;
  if (!v) return;
  input.value = v;
  output.value = '';
  document.getElementById('ascii-meta').innerHTML = '';
}

function asciiClear() {
  document.getElementById('ascii-input').value = '';
  document.getElementById('ascii-output').value = '';
  document.getElementById('ascii-meta').innerHTML = '';
}

/* ========== Unicode 模式 ========== */
function uniConvert() {
  const input = document.getElementById('uni-input').value;
  const output = document.getElementById('uni-output');
  const meta = document.getElementById('uni-meta');
  const mode = document.getElementById('uni-mode').value;
  if (!input) {
    output.value = '';
    showMeta(meta, '');
    return;
  }
  try {
    let result;
    if (mode === 'escape') {
      // 文本 → \uXXXX 转义（处理 BMP 外字符用代理对）
      result = [...input].map((c) => {
        const cp = c.codePointAt(0);
        if (cp <= 0xffff) {
          return '\\u' + cp.toString(16).toUpperCase().padStart(4, '0');
        }
        // 代理对
        const hi = 0xd800 + ((cp - 0x10000) >> 10);
        const lo = 0xdc00 + ((cp - 0x10000) & 0x3ff);
        return '\\u' + hi.toString(16).toUpperCase().padStart(4, '0') + '\\u' + lo.toString(16).toUpperCase().padStart(4, '0');
      }).join('');
    } else if (mode === 'codepoint') {
      // 文本 → U+XXXX 码点（支持 BMP 外字符，使用 codePointAt）
      result = [...input].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');
    } else {
      // unescape: \uXXXX 或 U+XXXX → 文本
      // 处理 \uXXXX（4位 hex）和 U+XXXX（4-6位 hex）和 代理对
      let idx = 0;
      result = '';
      const re = /\\u([0-9a-fA-F]{4})|U\+([0-9a-fA-F]{4,6})/g;
      let lastEnd = 0;
      let match;
      while ((match = re.exec(input)) !== null) {
        // 添加未匹配的原文
        result += input.slice(lastEnd, match.index);
        const hex = match[1] || match[2];
        const cp = parseInt(hex, 16);
        // 处理代理对：如果是高代理，检查下一个是否是低代理
        if (cp >= 0xd800 && cp <= 0xdbff) {
          // 检查下一个 \uXXXX 是否是低代理
          const nextMatch = /\\u([0-9a-fA-F]{4})/.exec(input.slice(re.lastIndex));
          if (nextMatch) {
            const nextCp = parseInt(nextMatch[1], 16);
            if (nextCp >= 0xdc00 && nextCp <= 0xdfff) {
              const fullCp = 0x10000 + ((cp - 0xd800) << 10) + (nextCp - 0xdc00);
              result += String.fromCodePoint(fullCp);
              re.lastIndex += nextMatch[0].length;
              lastEnd = re.lastIndex;
              continue;
            }
          }
        }
        result += String.fromCodePoint(cp);
        lastEnd = re.lastIndex;
      }
      result += input.slice(lastEnd);
    }
    output.value = result;
    const charCount = mode === 'unescape' ? [...result].length : [...input].length;
    showMeta(meta, `共 ${charCount} 个字符
      <button class="meta-btn" data-copy="${result.replace(/"/g, '&quot;')}">复制</button>`);
    bindMetaCopy(meta);
  } catch (e) {
    output.value = '';
    showError(meta, '转换失败：' + e.message);
  }
}

function uniSwap() {
  const input = document.getElementById('uni-input');
  const output = document.getElementById('uni-output');
  const v = output.value;
  if (!v) return;
  input.value = v;
  output.value = '';
  document.getElementById('uni-meta').innerHTML = '';
}

function uniClear() {
  document.getElementById('uni-input').value = '';
  document.getElementById('uni-output').value = '';
  document.getElementById('uni-meta').innerHTML = '';
}

/* ========== 元信息区复制按钮绑定 ========== */
function bindMetaCopy(metaEl) {
  metaEl.querySelectorAll('.meta-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy || '';
      const ok = await copyText(text);
      if (ok) {
        const original = btn.textContent;
        btn.textContent = '已复制';
        btn.classList.add('meta-btn--success');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('meta-btn--success');
        }, 1200);
      }
    });
  });
}

/* ========== 初始化 ========== */
function initEncoding() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // Base64
  document.getElementById('btn-b64-encode').addEventListener('click', b64Encode);
  document.getElementById('btn-b64-decode').addEventListener('click', b64Decode);
  document.getElementById('btn-b64-swap').addEventListener('click', b64Swap);
  document.getElementById('btn-b64-clear').addEventListener('click', b64Clear);

  // URL
  document.getElementById('btn-url-encode').addEventListener('click', urlEncode);
  document.getElementById('btn-url-decode').addEventListener('click', urlDecode);
  document.getElementById('btn-url-swap').addEventListener('click', urlSwap);
  document.getElementById('btn-url-clear').addEventListener('click', urlClear);

  // ASCII
  document.getElementById('btn-ascii-convert').addEventListener('click', asciiConvert);
  document.getElementById('btn-ascii-swap').addEventListener('click', asciiSwap);
  document.getElementById('btn-ascii-clear').addEventListener('click', asciiClear);

  // Unicode
  document.getElementById('btn-uni-convert').addEventListener('click', uniConvert);
  document.getElementById('btn-uni-swap').addEventListener('click', uniSwap);
  document.getElementById('btn-uni-clear').addEventListener('click', uniClear);

  // 输出区点击全选（便于复制）
  document.querySelectorAll('.codec-output').forEach((el) => {
    el.addEventListener('focus', () => el.select());
  });

  // 输入区 Ctrl+Enter 触发主操作
  const keymap = [
    { id: 'b64-input', btn: 'btn-b64-encode' },
    { id: 'url-input', btn: 'btn-url-encode' },
    { id: 'ascii-input', btn: 'btn-ascii-convert' },
    { id: 'uni-input', btn: 'btn-uni-convert' },
  ];
  keymap.forEach(({ id, btn }) => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById(btn).click();
      }
    });
  });
}

export { initEncoding };
