/**
 * UUID/哈希生成器核心逻辑
 * 2 个模式：UUID 生成（v1/v4/v7）/ 哈希计算（MD5/SHA-1/SHA-256/SHA-512 + HMAC）
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

/* ========== 工具函数 ========== */
// 16 字节 → UUID 字符串（8-4-4-4-12）
function bytesToUuid(bytes) {
  const hex = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  );
}

// 拒绝采样法生成 [0, max) 内的安全随机整数，避免模偏差
function secureRandomInt(max) {
  if (max <= 0) return 0;
  // 用 32 位无符号空间，拒绝 ≥ limit 的值，limit 为 max 的整数倍上限
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint8Array(4);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
  } while (value >= limit);
  return value % max;
}

// 字节数组 → hex 字符串
function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
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

/* ========== UUID 生成 ========== */
// v1：60 位时间戳（1582-10-15 起的 100ns）+ 随机 clock_seq + 随机 node（不读真实 MAC）
function uuidv1(counter) {
  // 1582-10-15 00:00:00 UTC 到 1970-01-01 00:00:00 UTC 的 100ns 计数
  const GREGORIAN_OFFSET = 122192928000000000n;
  const nowMs = BigInt(Date.now());
  // 安全随机 100ns 抖动 + counter，保证同毫秒批量生成的唯一与单调
  const subMs = BigInt(secureRandomInt(10000));
  const ts = nowMs * 10000n + GREGORIAN_OFFSET + subMs + BigInt(counter);

  const timeLow = Number(ts & 0xffffffffn); // 低 32 位
  const timeMid = Number((ts >> 32n) & 0xffffn); // 中 16 位
  const timeHi = Number((ts >> 48n) & 0x0fffn); // 高 12 位
  const timeHiAndVersion = 0x1000 | timeHi; // 版本位 = 1

  const bytes = new Uint8Array(16);
  // time_low / time_mid / time_hi_and_version 均按小端写入
  bytes[0] = timeLow & 0xff;
  bytes[1] = (timeLow >>> 8) & 0xff;
  bytes[2] = (timeLow >>> 16) & 0xff;
  bytes[3] = (timeLow >>> 24) & 0xff;
  bytes[4] = timeMid & 0xff;
  bytes[5] = (timeMid >>> 8) & 0xff;
  bytes[6] = timeHiAndVersion & 0xff;
  bytes[7] = (timeHiAndVersion >>> 8) & 0xff;

  const rand = crypto.getRandomValues(new Uint8Array(8));
  bytes[8] = 0x80 | (rand[0] & 0x3f); // 变体 10xx + clock_seq 高 6 位
  bytes[9] = rand[1]; // clock_seq 低 8 位
  bytes[10] = rand[2] | 0x01; // node，置 multicast 位（本地管理，保护隐私）
  bytes[11] = rand[3];
  bytes[12] = rand[4];
  bytes[13] = rand[5];
  bytes[14] = rand[6];
  bytes[15] = rand[7];
  return bytesToUuid(bytes);
}

// v4：纯随机（原生 API）
function uuidv4() {
  return crypto.randomUUID();
}

// v7：48 位毫秒时间戳 + 随机
function uuidv7() {
  const ts = BigInt(Date.now()); // 48 位
  const rand = crypto.getRandomValues(new Uint8Array(10));
  const bytes = new Uint8Array(16);
  // 前 48 位为毫秒时间戳（大端）
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = 0x70 | (rand[0] & 0x0f); // 版本 7 + rand_a 高 4 位
  bytes[7] = rand[1]; // rand_a 低 8 位
  bytes[8] = 0x80 | (rand[2] & 0x3f); // 变体 10 + rand_b 高 6 位
  bytes[9] = rand[3];
  bytes[10] = rand[4];
  bytes[11] = rand[5];
  bytes[12] = rand[6];
  bytes[13] = rand[7];
  bytes[14] = rand[8];
  bytes[15] = rand[9];
  return bytesToUuid(bytes);
}

function generateUuids() {
  const version = document.querySelector('input[name="uuid-ver"]:checked').value;
  const countEl = document.getElementById('uuid-count');
  let count = parseInt(countEl.value, 10);
  if (!Number.isFinite(count) || count < 1) count = 1;
  if (count > 100) count = 100;
  countEl.value = count;

  const list = [];
  for (let i = 0; i < count; i++) {
    if (version === 'v1') list.push(uuidv1(i));
    else if (version === 'v4') list.push(uuidv4());
    else list.push(uuidv7());
  }
  renderUuidResult(list);
}

function renderUuidResult(list) {
  const box = document.getElementById('uuid-result');
  if (list.length === 0) {
    box.innerHTML = '<div class="uuid-empty">点击"生成"按钮创建 UUID</div>';
    return;
  }
  box.innerHTML = list
    .map(
      (u) => `
      <div class="uuid-item">
        <code class="uuid-item__value">${u}</code>
        <button class="meta-btn uuid-item__copy" data-copy="${u}">复制</button>
      </div>`
    )
    .join('');
  box.querySelectorAll('.uuid-item__copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await copyText(btn.dataset.copy);
      if (ok) flashCopyBtn(btn);
    });
  });
}

async function copyAllUuids() {
  const box = document.getElementById('uuid-result');
  const items = box.querySelectorAll('.uuid-item__value');
  if (items.length === 0) return;
  const text = Array.from(items).map((el) => el.textContent).join('\n');
  const ok = await copyText(text);
  if (ok) {
    const btn = document.getElementById('btn-uuid-copyall');
    const original = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => (btn.textContent = original), 1200);
  }
}

/* ========== MD5（纯 JS，RFC 1321） ========== */
// crypto.subtle 不支持 MD5，需自行实现
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = (() => {
  const k = new Array(64);
  for (let i = 0; i < 64; i++) {
    // T[i] = floor(2^32 * abs(sin(i+1)))
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  }
  return k;
})();

function md5(input) {
  // input: Uint8Array → Uint8Array(16)
  const origLen = input.length;
  const bitLen = origLen * 8; // JS Number 精度足够（文件大小远小于 2^50 字节）

  // 填充：0x80 + 0x00 至长度 ≡ 56 (mod 64)，再加 8 字节小端长度
  const padLen = (56 - ((origLen + 1) % 64) + 64) % 64;
  const totalLen = origLen + 1 + padLen + 8;
  const msg = new Uint8Array(totalLen);
  msg.set(input);
  msg[origLen] = 0x80;
  // 64 位小端 bit 长度
  const low = bitLen >>> 0;
  const high = Math.floor(bitLen / 0x100000000) >>> 0;
  msg[totalLen - 8] = low & 0xff;
  msg[totalLen - 7] = (low >>> 8) & 0xff;
  msg[totalLen - 6] = (low >>> 16) & 0xff;
  msg[totalLen - 5] = (low >>> 24) & 0xff;
  msg[totalLen - 4] = high & 0xff;
  msg[totalLen - 3] = (high >>> 8) & 0xff;
  msg[totalLen - 2] = (high >>> 16) & 0xff;
  msg[totalLen - 1] = (high >>> 24) & 0xff;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let chunk = 0; chunk < totalLen; chunk += 64) {
    const M = new Array(16);
    for (let i = 0; i < 16; i++) {
      const off = chunk + i * 4;
      M[i] = (msg[off] | (msg[off + 1] << 8) | (msg[off + 2] << 16) | (msg[off + 3] << 24)) >>> 0;
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      const shift = MD5_S[i];
      // 32 位循环左移
      B = (B + (((F << shift) | (F >>> (32 - shift))) >>> 0)) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const words = [a0, b0, c0, d0];
  for (let i = 0; i < 4; i++) {
    const w = words[i];
    out[i * 4] = w & 0xff;
    out[i * 4 + 1] = (w >>> 8) & 0xff;
    out[i * 4 + 2] = (w >>> 16) & 0xff;
    out[i * 4 + 3] = (w >>> 24) & 0xff;
  }
  return out;
}

/* ========== 哈希计算 ========== */
// 返回 { fn, block }：fn(Uint8Array) => Promise<Uint8Array>，block 为 HMAC 块大小
function getHashFn(algo) {
  if (algo === 'MD5') {
    return { fn: (b) => Promise.resolve(md5(b)), block: 64 };
  }
  const block = algo === 'SHA-512' ? 128 : 64;
  return {
    fn: async (b) => new Uint8Array(await crypto.subtle.digest(algo, b)),
    block,
  };
}

// 通用 HMAC（H(K'⊕opad) ∥ H(K'⊕ipad ∥ data)），兼容 MD5 与 SHA
async function hmac(hashFn, block, keyBytes, dataBytes) {
  let key = keyBytes;
  if (key.length > block) key = await hashFn(key);
  const padded = new Uint8Array(block);
  padded.set(key);
  const ipad = new Uint8Array(block);
  const opad = new Uint8Array(block);
  for (let i = 0; i < block; i++) {
    ipad[i] = padded[i] ^ 0x36;
    opad[i] = padded[i] ^ 0x5c;
  }
  const inner = new Uint8Array(block + dataBytes.length);
  inner.set(ipad);
  inner.set(dataBytes, block);
  const innerHash = await hashFn(inner);
  const outer = new Uint8Array(block + innerHash.length);
  outer.set(opad);
  outer.set(innerHash, block);
  return await hashFn(outer);
}

async function computeHash(dataBytes) {
  const algo = document.getElementById('hash-algo').value;
  const useHmac = document.getElementById('hash-hmac').checked;
  const { fn, block } = getHashFn(algo);
  if (useHmac) {
    const keyStr = document.getElementById('hash-hmac-key').value;
    const keyBytes = new TextEncoder().encode(keyStr);
    return await hmac(fn, block, keyBytes, dataBytes);
  }
  return await fn(dataBytes);
}

async function computeFromText() {
  const text = document.getElementById('hash-text').value;
  const data = new TextEncoder().encode(text);
  await runHash(data, `文本（${text.length} 字符 / ${data.length} 字节）`);
}

async function computeFromFile(file) {
  const buf = await readFileAsArrayBuffer(file);
  const data = new Uint8Array(buf);
  await runHash(data, `文件：${file.name}（${formatSize(file.size)}）`);
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsArrayBuffer(file);
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function runHash(data, sourceLabel) {
  const resultBox = document.getElementById('hash-result');
  const hexEl = document.getElementById('hash-hex');
  const b64El = document.getElementById('hash-b64');
  const metaEl = document.getElementById('hash-meta');
  const algo = document.getElementById('hash-algo').value;
  const useHmac = document.getElementById('hash-hmac').checked;
  try {
    const digest = await computeHash(data);
    hexEl.value = bytesToHex(digest);
    b64El.value = bytesToBase64(digest);
    metaEl.textContent = `${useHmac ? 'HMAC-' : ''}${algo} · ${digest.length * 8} 位 · ${sourceLabel}`;
    resultBox.hidden = false;
  } catch (e) {
    hexEl.value = '';
    b64El.value = '';
    metaEl.innerHTML = `<span class="meta-error">计算失败：${e.message}</span>`;
    resultBox.hidden = false;
  }
}

function clearHash() {
  document.getElementById('hash-text').value = '';
  document.getElementById('hash-hex').value = '';
  document.getElementById('hash-b64').value = '';
  document.getElementById('hash-meta').textContent = '';
  document.getElementById('hash-result').hidden = true;
  document.getElementById('hash-file-name').textContent = '或点击此处选择文件';
  document.getElementById('hash-file').value = '';
}

/* ========== 哈希：拖放区 ========== */
function setupDropzone() {
  const dz = document.getElementById('hash-dropzone');
  const fileInput = document.getElementById('hash-file');
  const nameEl = document.getElementById('hash-file-name');

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
      nameEl.textContent = file.name;
      computeFromFile(file);
    }
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
      nameEl.textContent = file.name;
      computeFromFile(file);
    }
  });
}

/* ========== 初始化 ========== */
function initHash() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // UUID
  document.getElementById('btn-uuid-generate').addEventListener('click', generateUuids);
  document.getElementById('btn-uuid-copyall').addEventListener('click', copyAllUuids);

  // 哈希
  document.getElementById('btn-hash-compute').addEventListener('click', computeFromText);
  document.getElementById('btn-hash-clear').addEventListener('click', clearHash);
  document.getElementById('hash-text').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      computeFromText();
    }
  });
  document.getElementById('hash-hmac').addEventListener('change', (e) => {
    document.getElementById('hash-hmac-key').hidden = !e.target.checked;
  });
  setupDropzone();

  // 结果区点击全选
  document.querySelectorAll('.hash-result__value').forEach((el) => {
    el.addEventListener('focus', () => el.select());
  });

  // 结果复制按钮
  document.getElementById('btn-copy-hex').addEventListener('click', async (e) => {
    const v = document.getElementById('hash-hex').value;
    if (!v) return;
    const ok = await copyText(v);
    if (ok) flashCopyBtn(e.currentTarget);
  });
  document.getElementById('btn-copy-b64').addEventListener('click', async (e) => {
    const v = document.getElementById('hash-b64').value;
    if (!v) return;
    const ok = await copyText(v);
    if (ok) flashCopyBtn(e.currentTarget);
  });
}

export { initHash };
