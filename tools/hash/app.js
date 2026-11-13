/**
 * UUID/哈希生成器核心逻辑
 * 2 个模式：UUID 生成（v1/v4/v7）/ 哈希计算（MD5/SHA-1/SHA-256/SHA-512 + HMAC）
 * 全部本地运行，无任何网络请求
 */

import { copyText, flashHint } from '/assets/js/clipboard.js';
import { md5 } from './md5.js';

/* ========== MD5 走 Worker ========== */
// 纯 JS 的 MD5 是同步的：20MB 文件会在主线程阻塞 329ms、100MB 约 1.6 秒，
// 期间界面完全无响应。交给 Worker 后主线程只等一个 Promise。
let md5Worker = null;
let md5Broken = false;   // Worker 建不起来或中途挂了，之后一律走同步实现
let md5Seq = 0;
const md5Pending = new Map();

function getMd5Worker() {
  if (md5Worker) return md5Worker;
  const w = new Worker(new URL('./md5-worker.js', import.meta.url), { type: 'module' });
  w.onmessage = (e) => {
    const { id, out, error } = e.data;
    const p = md5Pending.get(id);
    if (!p) return;
    md5Pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(new Uint8Array(out));
  };
  w.onerror = () => {
    // 缓冲区已经转移给 Worker，拿不回来，只能让排队的请求明确失败 ——
    // 用空的 buffer 重算会得到一个正确格式但内容错误的哈希，那更糟。
    for (const [, p] of md5Pending) p.reject(new Error('MD5 计算线程异常退出'));
    md5Pending.clear();
    md5Broken = true;
    md5Worker = null;
  };
  md5Worker = w;
  return w;
}

/** 计算 MD5：优先交给 Worker，建不起 Worker 时同步算 */
function md5Async(bytes) {
  let w = null;
  if (!md5Broken) {
    try {
      w = getMd5Worker();
    } catch {
      md5Broken = true;
    }
  }
  if (!w) return Promise.resolve(md5(bytes));

  const id = ++md5Seq;
  return new Promise((resolve, reject) => {
    md5Pending.set(id, { resolve, reject });
    // 只在「整个 buffer 就是这个视图」时转移，否则会连带丢掉视图外的数据
    const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
    try {
      if (whole) w.postMessage({ id, buf: bytes.buffer }, [bytes.buffer]);
      else w.postMessage({ id, buf: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    } catch {
      // postMessage 失败时缓冲区还没转移，同步算一份是安全的
      md5Pending.delete(id);
      md5Broken = true;
      resolve(md5(bytes));
    }
  });
}

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
// 复制实现见共享模块 assets/js/clipboard.js

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


/* ========== 哈希计算 ========== */
// 返回 { fn, block }：fn(Uint8Array) => Promise<Uint8Array>，block 为 HMAC 块大小
function getHashFn(algo) {
  if (algo === 'MD5') {
    return { fn: md5Async, block: 64 };
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
    if (!v) { flashHint(e.currentTarget, '请先计算'); return; }
    const ok = await copyText(v);
    if (ok) flashCopyBtn(e.currentTarget);
  });
  document.getElementById('btn-copy-b64').addEventListener('click', async (e) => {
    const v = document.getElementById('hash-b64').value;
    if (!v) { flashHint(e.currentTarget, '请先计算'); return; }
    const ok = await copyText(v);
    if (ok) flashCopyBtn(e.currentTarget);
  });
}

export { initHash };
