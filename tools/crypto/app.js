/**
 * 加解密工具核心逻辑
 * 3 个 Tab：AES 加解密（Web Crypto）/ 古典密码 / 编码（非加密）
 * 全部本地运行，无任何网络请求，不引入第三方库
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

function flashCopyBtn(btn) {
  const original = btn.textContent;
  btn.textContent = '已复制';
  btn.classList.add('meta-btn--success');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('meta-btn--success');
  }, 1200);
}

/* ========== 字节 / 编码工具 ========== */
function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex) {
  const clean = hex.replace(/\s+/g, '').toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean)) throw new Error('含非法 hex 字符');
  if (clean.length % 2 !== 0) throw new Error('hex 长度必须为偶数');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.substr(i, 2), 16);
  }
  return out;
}

// 字节数组 → base64（分块避免 fromCharCode.apply 栈溢出）
function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function strToBytes(str) {
  return new TextEncoder().encode(str);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/* ========== AES 加解密 ========== */
const PBKDF2_ITERATIONS = 100000;
const SALT_LEN = 16;
const GCM_IV_LEN = 12;
const CBC_IV_LEN = 16;

function getIvLen(algo) {
  return algo === 'AES-GCM' ? GCM_IV_LEN : CBC_IV_LEN;
}

// 解析 hex 密钥 → 32 字节
function parseKeyHex(hex) {
  const clean = hex.trim().replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('密钥必须为 64 个 hex 字符（32 字节）');
  }
  return hexToBytes(clean);
}

// PBKDF2 派生密钥
async function deriveKeyPbkdf2(password, salt, algo) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: algo, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// 直接导入 hex 密钥
async function importDirectKey(keyBytes, algo) {
  return await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: algo, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// 根据当前选择获取密钥
async function getKey(algo, kdf, salt) {
  if (kdf === 'pbkdf2') {
    const password = document.getElementById('aes-password').value;
    if (!password) throw new Error('请输入密码');
    return await deriveKeyPbkdf2(password, salt, algo);
  }
  const keyHex = document.getElementById('aes-key-hex').value;
  const keyBytes = parseKeyHex(keyHex);
  return await importDirectKey(keyBytes, algo);
}

let aesCurrentFile = null; // 当前拖入/选择的文件
let aesResultBytes = null; // 最近一次结果字节（供下载）

async function runAes() {
  const algo = document.getElementById('aes-algo').value;
  const mode = document.querySelector('input[name="aes-mode"]:checked').value;
  const kdf = document.querySelector('input[name="aes-kdf"]:checked').value;
  const ivLen = getIvLen(algo);

  const output = document.getElementById('aes-output');
  const meta = document.getElementById('aes-meta');
  const resultBox = document.getElementById('aes-result');
  const dlBtn = document.getElementById('btn-aes-download');

  try {
    if (mode === 'encrypt') {
      // 获取明文
      let plaintext;
      if (aesCurrentFile) {
        plaintext = new Uint8Array(await aesCurrentFile.arrayBuffer());
      } else {
        const text = document.getElementById('aes-input').value;
        if (!text) throw new Error('请输入明文');
        plaintext = strToBytes(text);
      }

      // salt：PBKDF2 模式下可手动指定或自动生成；直接密钥模式无 salt
      let salt;
      if (kdf === 'pbkdf2') {
        const saltHex = document.getElementById('aes-salt').value.trim();
        if (saltHex) {
          salt = hexToBytes(saltHex);
          if (salt.length !== SALT_LEN) {
            throw new Error(`Salt 必须为 ${SALT_LEN} 字节（${SALT_LEN * 2} hex 字符）`);
          }
        } else {
          salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
        }
      } else {
        salt = new Uint8Array(0);
      }

      // IV
      const iv = crypto.getRandomValues(new Uint8Array(ivLen));

      // 密钥
      const key = await getKey(algo, kdf, salt);

      // 加密
      const cipherBuf = await crypto.subtle.encrypt({ name: algo, iv }, key, plaintext);
      const ciphertext = new Uint8Array(cipherBuf);

      // 拼接输出：salt + iv + ciphertext（GCM 自带认证标签）
      const result = new Uint8Array(salt.length + iv.length + ciphertext.length);
      result.set(salt, 0);
      result.set(iv, salt.length);
      result.set(ciphertext, salt.length + iv.length);
      aesResultBytes = result;

      // 格式化输出
      const outFormat = document.querySelector('input[name="aes-out-format"]:checked').value;
      output.value = outFormat === 'base64' ? bytesToBase64(result) : bytesToHex(result);

      // 元信息
      const parts = [`算法：${algo}`];
      parts.push(kdf === 'pbkdf2'
        ? `密钥派生：PBKDF2（${PBKDF2_ITERATIONS} 次，SHA-256）`
        : '密钥派生：直接密钥');
      if (kdf === 'pbkdf2') parts.push(`Salt：${bytesToHex(salt)}`);
      parts.push(`IV：${bytesToHex(iv)}`);
      parts.push(`密文：${ciphertext.length} 字节`);
      parts.push(`总输出：${result.length} 字节`);
      meta.textContent = parts.join(' · ');

      // 文件输入时显示下载按钮
      dlBtn.hidden = !aesCurrentFile;
    } else {
      // 解密
      let inputBytes;
      if (aesCurrentFile) {
        inputBytes = new Uint8Array(await aesCurrentFile.arrayBuffer());
      } else {
        const text = document.getElementById('aes-input').value.trim();
        if (!text) throw new Error('请输入密文');
        const inFormat = document.querySelector('input[name="aes-in-format"]:checked').value;
        inputBytes = inFormat === 'base64' ? base64ToBytes(text) : hexToBytes(text);
      }

      // 解析 salt + iv + ciphertext
      let salt, iv, ciphertext;
      if (kdf === 'pbkdf2') {
        if (inputBytes.length < SALT_LEN + ivLen) throw new Error('输入数据过短，无法解析 salt+iv');
        salt = inputBytes.slice(0, SALT_LEN);
        iv = inputBytes.slice(SALT_LEN, SALT_LEN + ivLen);
        ciphertext = inputBytes.slice(SALT_LEN + ivLen);
      } else {
        if (inputBytes.length < ivLen) throw new Error('输入数据过短，无法解析 iv');
        salt = new Uint8Array(0);
        iv = inputBytes.slice(0, ivLen);
        ciphertext = inputBytes.slice(ivLen);
      }

      const key = await getKey(algo, kdf, salt);

      const plainBuf = await crypto.subtle.decrypt({ name: algo, iv }, key, ciphertext);
      const plaintext = new Uint8Array(plainBuf);
      aesResultBytes = plaintext;

      // 尝试 UTF-8 解码，失败则显示 hex
      let outStr;
      let isBinary = false;
      try {
        outStr = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
      } catch {
        isBinary = true;
        outStr = bytesToHex(plaintext);
      }
      output.value = outStr;

      if (isBinary) {
        meta.innerHTML = `<span class="meta-error">注意：解密结果非有效 UTF-8 文本，已显示为 hex。可点击"下载结果"保存原始字节。</span>`;
      } else {
        const parts = [`算法：${algo}`];
        parts.push(kdf === 'pbkdf2' ? '密钥派生：PBKDF2' : '密钥派生：直接密钥');
        if (kdf === 'pbkdf2') parts.push(`Salt：${bytesToHex(salt)}`);
        parts.push(`IV：${bytesToHex(iv)}`);
        parts.push(`明文：${plaintext.length} 字节`);
        meta.textContent = parts.join(' · ');
      }

      dlBtn.hidden = false;
    }
    resultBox.hidden = false;
  } catch (e) {
    output.value = '';
    aesResultBytes = null;
    meta.innerHTML = `<span class="meta-error">${mode === 'encrypt' ? '加密' : '解密'}失败：${escapeHtml(e.message)}</span>`;
    resultBox.hidden = false;
    dlBtn.hidden = true;
  }
}

function clearAes() {
  document.getElementById('aes-input').value = '';
  document.getElementById('aes-output').value = '';
  document.getElementById('aes-meta').textContent = '';
  document.getElementById('aes-result').hidden = true;
  document.getElementById('btn-aes-download').hidden = true;
  document.getElementById('aes-file-name').textContent = '点击选择文件';
  document.getElementById('aes-dropzone-primary').textContent = '或拖入文件作为输入（任意类型）';
  document.getElementById('aes-file').value = '';
  aesCurrentFile = null;
  aesResultBytes = null;
}

function downloadAesResult() {
  if (!aesResultBytes) return;
  const mode = document.querySelector('input[name="aes-mode"]:checked').value;
  const blob = new Blob([aesResultBytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const baseName = aesCurrentFile ? aesCurrentFile.name.replace(/\.[^.]+$/, '') : 'result';
  a.download = mode === 'encrypt' ? `${baseName}.enc` : `${baseName}.dec`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setupAesDropzone() {
  const dz = document.getElementById('aes-dropzone');
  const fileInput = document.getElementById('aes-file');
  const nameEl = document.getElementById('aes-file-name');
  const primaryEl = document.getElementById('aes-dropzone-primary');

  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.add('hash-dropzone--active');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.remove('hash-dropzone--active');
    });
  });
  dz.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) {
      aesCurrentFile = file;
      nameEl.textContent = file.name;
      primaryEl.textContent = '已选择文件（点击重新选择）';
    }
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
      aesCurrentFile = file;
      nameEl.textContent = file.name;
      primaryEl.textContent = '已选择文件（点击重新选择）';
    }
  });
}

// 切换加密/解密模式时更新 UI
function updateAesMode() {
  const mode = document.querySelector('input[name="aes-mode"]:checked').value;
  const isEncrypt = mode === 'encrypt';
  document.getElementById('aes-out-format-row').hidden = !isEncrypt;
  document.getElementById('aes-in-format-row').hidden = isEncrypt;
  document.getElementById('aes-input-label').textContent = isEncrypt ? '明文输入' : '密文输入';
  document.getElementById('aes-input').placeholder = isEncrypt
    ? '输入要加密的文本（Ctrl+Enter 执行）'
    : '输入密文（Base64 或 Hex，Ctrl+Enter 执行）';
}

// 切换密钥派生方式时更新 UI
function updateAesKdf() {
  const kdf = document.querySelector('input[name="aes-kdf"]:checked').value;
  document.getElementById('aes-pbkdf2-fields').hidden = kdf !== 'pbkdf2';
  document.getElementById('aes-direct-fields').hidden = kdf !== 'direct';
}

/* ========== 古典密码 ========== */
// 凯撒位移
function caesarShift(text, shift, decrypt = false) {
  const s = decrypt ? (26 - ((shift % 26) + 26) % 26) % 26 : ((shift % 26) + 26) % 26;
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      out += String.fromCharCode(((code - 65 + s) % 26) + 65);
    } else if (code >= 97 && code <= 122) {
      out += String.fromCharCode(((code - 97 + s) % 26) + 97);
    } else {
      out += ch;
    }
  }
  return out;
}

function rot13(text) {
  return caesarShift(text, 13);
}

// ROT47：可打印 ASCII 字符旋转（33-126）
function rot47(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 33 && code <= 126) {
      out += String.fromCharCode(((code - 33 + 47) % 94) + 33);
    } else {
      out += ch;
    }
  }
  return out;
}

// 维吉尼亚密码
function vigenere(text, key, decrypt = false) {
  const cleanKey = key.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (!cleanKey) throw new Error('密钥必须包含至少一个字母');
  let out = '';
  let ki = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    let base = 0;
    if (code >= 65 && code <= 90) base = 65;
    else if (code >= 97 && code <= 122) base = 97;
    else { out += ch; continue; }

    const k = cleanKey.charCodeAt(ki % cleanKey.length) - 65;
    const shift = decrypt ? (26 - k) % 26 : k;
    out += String.fromCharCode(((code - base + shift) % 26) + base);
    ki++;
  }
  return out;
}

// Atbash：a↔z, A↔Z
function atbash(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      out += String.fromCharCode(90 - (code - 65));
    } else if (code >= 97 && code <= 122) {
      out += String.fromCharCode(122 - (code - 97));
    } else {
      out += ch;
    }
  }
  return out;
}

// XOR 加密：UTF-8 字节级 XOR，输出 Latin-1 字符串
function xorCipher(text, key) {
  if (!key) throw new Error('请输入密钥');
  const textBytes = strToBytes(text);
  const keyBytes = strToBytes(key);
  const out = new Uint8Array(textBytes.length);
  for (let i = 0; i < textBytes.length; i++) {
    out[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  let str = '';
  for (let i = 0; i < out.length; i++) str += String.fromCharCode(out[i]);
  return str;
}

// XOR 解密：输入 Latin-1 字符串，输出 UTF-8 文本
function xorDecrypt(text, key) {
  if (!key) throw new Error('请输入密钥');
  const textBytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) textBytes[i] = text.charCodeAt(i) & 0xff;
  const keyBytes = strToBytes(key);
  const out = new Uint8Array(textBytes.length);
  for (let i = 0; i < textBytes.length; i++) {
    out[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(out);
}

// 模逆（扩展欧几里得）
function modInverse(a, m) {
  a = ((a % m) + m) % m;
  for (let x = 1; x < m; x++) {
    if ((a * x) % m === 1) return x;
  }
  return -1;
}

// 仿射密码：E(x) = (a*x + b) mod 26，D(y) = a^-1 * (y - b) mod 26
function affine(text, a, b, decrypt = false) {
  const aInv = modInverse(a, 26);
  if (aInv === -1) {
    throw new Error(`a=${a} 与 26 不互质，请选择 1,3,5,7,9,11,15,17,19,21,23,25`);
  }
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      if (decrypt) {
        out += String.fromCharCode(((aInv * (code - 65 - b + 26 * 10)) % 26 + 26) % 26 + 65);
      } else {
        out += String.fromCharCode(((a * (code - 65) + b) % 26) + 65);
      }
    } else if (code >= 97 && code <= 122) {
      if (decrypt) {
        out += String.fromCharCode(((aInv * (code - 97 - b + 26 * 10)) % 26 + 26) % 26 + 97);
      } else {
        out += String.fromCharCode(((a * (code - 97) + b) % 26) + 97);
      }
    } else {
      out += ch;
    }
  }
  return out;
}

function runClassical(decrypt = false) {
  const algo = document.getElementById('classical-algo').value;
  const input = document.getElementById('classical-input').value;
  const output = document.getElementById('classical-output');
  const errorEl = document.getElementById('classical-error');
  errorEl.hidden = true;
  try {
    let result = '';
    switch (algo) {
      case 'caesar': {
        const shift = parseInt(document.getElementById('caesar-shift').value, 10);
        result = caesarShift(input, shift, decrypt);
        break;
      }
      case 'rot13':
        result = rot13(input);
        break;
      case 'rot47':
        result = rot47(input);
        break;
      case 'vigenere': {
        const key = document.getElementById('vigenere-key').value;
        result = vigenere(input, key, decrypt);
        break;
      }
      case 'atbash':
        result = atbash(input); // 对称
        break;
      case 'xor': {
        const key = document.getElementById('xor-key').value;
        result = decrypt ? xorDecrypt(input, key) : xorCipher(input, key);
        break;
      }
      case 'affine': {
        const a = parseInt(document.getElementById('affine-a').value, 10);
        const b = parseInt(document.getElementById('affine-b').value, 10);
        if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('请输入有效的 a / b 系数');
        result = affine(input, a, b, decrypt);
        break;
      }
    }
    output.value = result;
  } catch (e) {
    output.value = '';
    errorEl.textContent = `${decrypt ? '解密' : '加密'}失败：${e.message}`;
    errorEl.hidden = false;
  }
}

function clearClassical() {
  document.getElementById('classical-input').value = '';
  document.getElementById('classical-output').value = '';
  document.getElementById('classical-error').hidden = true;
}

// 按算法切换选项区显隐
function updateClassicalOptions() {
  const algo = document.getElementById('classical-algo').value;
  document.querySelectorAll('.classical-opt').forEach((el) => {
    el.hidden = el.dataset.algo !== algo;
  });
}

/* ========== 编码（非加密） ========== */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Base32 编码（RFC 4648）
function base32Encode(bytes) {
  let out = '';
  let buffer = 0;
  let bitsLeft = 0;
  for (let i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i];
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      out += BASE32_ALPHABET[(buffer >> bitsLeft) & 0x1f];
    }
  }
  if (bitsLeft > 0) {
    out += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  }
  while (out.length % 8 !== 0) out += '=';
  return out;
}

function base32Decode(str) {
  const clean = str.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  const out = [];
  let buffer = 0;
  let bitsLeft = 0;
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`无效的 Base32 字符：${ch}`);
    buffer = (buffer << 5) | idx;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      out.push((buffer >> bitsLeft) & 0xff);
    }
  }
  return new Uint8Array(out);
}

// 摩斯电码表（ITU 标准）
const MORSE_TABLE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.',
  G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
  M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.',
  '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
  '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-',
  '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.',
  '$': '...-..-', '@': '.--.-.',
};
const MORSE_REVERSE = {};
for (const [k, v] of Object.entries(MORSE_TABLE)) MORSE_REVERSE[v] = k;

function morseEncode(str) {
  const upper = str.toUpperCase();
  const words = upper.split(/\s+/);
  return words
    .map((word) =>
      Array.from(word)
        .map((ch) => MORSE_TABLE[ch] || '')
        .filter(Boolean)
        .join(' ')
    )
    .join(' / ');
}

function morseDecode(str) {
  const words = str.trim().split(/\s*\/\s*|\s{3,}/);
  return words
    .map((word) =>
      word
        .split(/\s+/)
        .filter(Boolean)
        .map((code) => MORSE_REVERSE[code] || '')
        .join('')
    )
    .join(' ');
}

function binaryEncode(str) {
  const bytes = strToBytes(str);
  return Array.from(bytes).map((b) => b.toString(2).padStart(8, '0')).join(' ');
}

function binaryDecode(str) {
  const parts = str.trim().split(/\s+/).filter(Boolean);
  const bytes = parts.map((p) => {
    if (!/^[01]{1,8}$/.test(p)) throw new Error(`无效的二进制段：${p}`);
    return parseInt(p, 2);
  });
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function hexEncode(str) {
  return bytesToHex(strToBytes(str));
}

function hexDecode(str) {
  return new TextDecoder().decode(hexToBytes(str));
}

function base64EncodeStr(str) {
  return bytesToBase64(strToBytes(str));
}

function base64DecodeStr(str) {
  return new TextDecoder().decode(base64ToBytes(str));
}

function urlEncode(str) {
  return encodeURIComponent(str);
}

function urlDecode(str) {
  return decodeURIComponent(str);
}

function htmlEncode(str) {
  return str.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function htmlDecode(str) {
  const el = document.createElement('textarea');
  el.innerHTML = str; // 浏览器解析实体，仅读取 .value 不插入 DOM
  return el.value;
}

function runEncoding(encode = true) {
  const type = document.getElementById('encoding-type').value;
  const input = document.getElementById('encoding-input').value;
  const output = document.getElementById('encoding-output');
  const errorEl = document.getElementById('encoding-error');
  errorEl.hidden = true;
  try {
    let result = '';
    switch (type) {
      case 'base64':
        result = encode ? base64EncodeStr(input) : base64DecodeStr(input);
        break;
      case 'base32':
        result = encode ? base32Encode(strToBytes(input)) : new TextDecoder().decode(base32Decode(input));
        break;
      case 'hex':
        result = encode ? hexEncode(input) : hexDecode(input);
        break;
      case 'morse':
        result = encode ? morseEncode(input) : morseDecode(input);
        break;
      case 'binary':
        result = encode ? binaryEncode(input) : binaryDecode(input);
        break;
      case 'url':
        result = encode ? urlEncode(input) : urlDecode(input);
        break;
      case 'html':
        result = encode ? htmlEncode(input) : htmlDecode(input);
        break;
    }
    output.value = result;
  } catch (e) {
    output.value = '';
    errorEl.textContent = `${encode ? '编码' : '解码'}失败：${e.message}`;
    errorEl.hidden = false;
  }
}

function clearEncoding() {
  document.getElementById('encoding-input').value = '';
  document.getElementById('encoding-output').value = '';
  document.getElementById('encoding-error').hidden = true;
}

/* ========== 初始化 ========== */
function initCrypto() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // 填充凯撒位移选项 1-25
  const caesarSelect = document.getElementById('caesar-shift');
  for (let i = 1; i <= 25; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i;
    caesarSelect.appendChild(opt);
  }
  caesarSelect.value = 3;

  // AES：算法/模式/派生方式联动
  document.querySelectorAll('input[name="aes-mode"]').forEach((r) => {
    r.addEventListener('change', updateAesMode);
  });
  document.querySelectorAll('input[name="aes-kdf"]').forEach((r) => {
    r.addEventListener('change', updateAesKdf);
  });
  document.getElementById('aes-gen-salt').addEventListener('click', () => {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    document.getElementById('aes-salt').value = bytesToHex(salt);
  });

  document.getElementById('btn-aes-run').addEventListener('click', runAes);
  document.getElementById('btn-aes-clear').addEventListener('click', clearAes);
  document.getElementById('btn-aes-download').addEventListener('click', downloadAesResult);
  document.getElementById('aes-input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runAes();
    }
  });
  setupAesDropzone();

  // AES 结果复制
  document.getElementById('btn-copy-aes').addEventListener('click', async (e) => {
    const v = document.getElementById('aes-output').value;
    if (!v) return;
    const ok = await copyText(v);
    if (ok) flashCopyBtn(e.currentTarget);
  });

  // 古典密码
  document.getElementById('classical-algo').addEventListener('change', updateClassicalOptions);
  document.getElementById('btn-classical-encrypt').addEventListener('click', () => runClassical(false));
  document.getElementById('btn-classical-decrypt').addEventListener('click', () => runClassical(true));
  document.getElementById('btn-classical-clear').addEventListener('click', clearClassical);
  document.getElementById('classical-input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runClassical(false);
    }
  });
  document.getElementById('btn-copy-classical').addEventListener('click', async (e) => {
    const v = document.getElementById('classical-output').value;
    if (!v) return;
    const ok = await copyText(v);
    if (ok) flashCopyBtn(e.currentTarget);
  });

  // 编码
  document.getElementById('btn-encode').addEventListener('click', () => runEncoding(true));
  document.getElementById('btn-decode').addEventListener('click', () => runEncoding(false));
  document.getElementById('btn-encoding-clear').addEventListener('click', clearEncoding);
  document.getElementById('encoding-input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runEncoding(true);
    }
  });
  document.getElementById('btn-copy-encoding').addEventListener('click', async (e) => {
    const v = document.getElementById('encoding-output').value;
    if (!v) return;
    const ok = await copyText(v);
    if (ok) flashCopyBtn(e.currentTarget);
  });

  // 初始化 UI 状态
  updateClassicalOptions();
}

export { initCrypto };
