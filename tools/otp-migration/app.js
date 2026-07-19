/**
 * TOTP 迁移工具
 * 解析 Google Authenticator 导出二维码，生成标准 otpauth:// 链接
 * 全部本地运行，零网络请求
 */
import QRCode from 'qrcode';
import jsQR from 'jsqr';

let accounts = [];
let rafId = null;
let lastEpoch = -1;

/* ========== Protobuf Varint 解析 ========== */
function readVarint(buf, pos) {
  let result = 0n, shift = 0n, byte;
  do {
    if (pos >= buf.length) throw new Error('varint 越界');
    byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
  } while (byte & 0x80);
  return [result, pos];
}

function parseFields(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const fieldNo = Number(key >> 3n);
    const wireType = Number(key & 7n);
    if (wireType === 0) {
      let v;
      [v, pos] = readVarint(buf, pos);
      fields.push({ fieldNo, varint: v });
    } else if (wireType === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      len = Number(len);
      fields.push({ fieldNo, bytes: buf.slice(pos, pos + len) });
      pos += len;
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      throw new Error('不支持的 wire type: ' + wireType);
    }
  }
  return fields;
}

/* ========== 解析 Migration Payload ========== */
function parseOtp(buf) {
  const otp = {};
  const dec = new TextDecoder();
  for (const f of parseFields(buf)) {
    switch (f.fieldNo) {
      case 1: otp.secret = f.bytes; break;
      case 2: otp.name = dec.decode(f.bytes); break;
      case 3: otp.issuer = dec.decode(f.bytes); break;
      case 4: otp.algorithm = Number(f.varint); break;
      case 5: otp.digits = Number(f.varint); break;
      case 6: otp.type = Number(f.varint); break;
      case 7: otp.counter = f.varint; break;
    }
  }
  return otp;
}

function parseMigrationPayload(bytes) {
  const payload = { otps: [] };
  for (const f of parseFields(bytes)) {
    if (f.fieldNo === 1) payload.otps.push(parseOtp(f.bytes));
    else if (f.fieldNo === 3) payload.batchSize = Number(f.varint);
    else if (f.fieldNo === 4) payload.batchIndex = Number(f.varint);
  }
  return payload;
}

/* ========== data 参数提取 + Base64 解码 ========== */
function migrationLinkToBytes(input) {
  const m = input.trim().match(/data=([^&\s]+)/);
  if (!m) throw new Error('链接里找不到 data 参数');
  let b64 = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/* ========== Base32 编码 (RFC 4648) ========== */
function base32Encode(bytes) {
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ABC[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ABC[(value << (5 - bits)) & 31];
  return out;
}

/* ========== 构建 otpauth:// URL ========== */
const ALGO_NAME_TO_ID = { 0: 'SHA1', 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' };
const ALGO_ID_TO_HASH = { 0: 'SHA-1', 1: 'SHA-1', 2: 'SHA-256', 3: 'SHA-512' };

function buildOtpauthUrl(otp) {
  if (!otp.secret || otp.secret.length === 0) {
    throw new Error('密钥为空，无法生成 otpauth URL');
  }
  if (otp.algorithm === 4) {
    throw new Error('MD5 算法不被 Web Crypto 支持，无法生成可用 URL');
  }
  const type = otp.type === 1 ? 'hotp' : 'totp';
  const name = otp.name || '';
  const label = otp.issuer
    ? encodeURIComponent(otp.issuer) + ':' + encodeURIComponent(name)
    : encodeURIComponent(name);
  const p = ['secret=' + base32Encode(otp.secret)];
  if (otp.issuer) p.push('issuer=' + encodeURIComponent(otp.issuer));
  const algo = ALGO_NAME_TO_ID[otp.algorithm];
  if (algo && algo !== 'SHA1') p.push('algorithm=' + algo);
  if (otp.digits === 2) p.push('digits=8');
  if (type === 'hotp') p.push('counter=' + (otp.counter ?? 0n).toString());
  return 'otpauth://' + type + '/' + label + '?' + p.join('&');
}

/* ========== HOTP / TOTP 计算 (Web Crypto) ========== */
function algoId(otp) {
  if (otp.algorithm === 4) throw new Error('MD5 算法不被 Web Crypto 支持');
  return ALGO_ID_TO_HASH[otp.algorithm] || 'SHA-1';
}

function digitsCount(otp) {
  if (otp.digits === 2) return 8;
  return 6;
}

async function hotp(secretBytes, counter, hash, digits) {
  if (hash === 'MD5') throw new Error('Web Crypto 不支持 MD5');
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash }, false, ['sign']);
  // counter 可能是 BigInt（来自 Protobuf varint）或 Number，统一用 BigInt 拆高低 32 位，避免大数精度丢失
  const c = BigInt(counter);
  const hi = Number((c >> 32n) & 0xffffffffn);
  const lo = Number(c & 0xffffffffn);
  const msg = new DataView(new ArrayBuffer(8));
  msg.setUint32(0, hi);
  msg.setUint32(4, lo);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg.buffer));
  const off = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

async function computeTotp(otp) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  return hotp(otp.secret, counter, algoId(otp), digitsCount(otp));
}

function getTotpCounter() {
  return Math.floor(Date.now() / 1000 / 30);
}

function getRemainingSeconds() {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

/* ========== 解析输入 ========== */
function parseInput(text) {
  const lines = text
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const allOtps = [];
  const errors = [];
  for (const line of lines) {
    try {
      const bytes = migrationLinkToBytes(line);
      const payload = parseMigrationPayload(bytes);
      for (const otp of payload.otps) {
        // 标记无效算法/空 secret，跳过 URL 生成
        otp._algo = (function () {
          try { return algoId(otp); } catch { return 'MD5(不支持)'; }
        })();
        otp._digits = digitsCount(otp);
        try {
          otp._url = buildOtpauthUrl(otp);
        } catch (e) {
          otp._url = null;
          otp._error = e.message;
        }
        allOtps.push(otp);
      }
    } catch (e) {
      console.error('解析失败:', line, e);
      errors.push({ line: line.slice(0, 60) + (line.length > 60 ? '...' : ''), msg: e.message });
    }
  }
  if (errors.length) {
    flashToast(`${errors.length} 条链接解析失败：${errors[0].msg}`, 'error');
  }
  return allOtps;
}

/* ========== UI 渲染 ========== */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAccounts() {
  const section = document.getElementById('results-section');
  const list = document.getElementById('accounts-list');
  const empty = document.getElementById('results-empty');
  const actions = document.getElementById('results-actions');

  if (!accounts.length) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  empty.hidden = accounts.length > 0;
  actions.hidden = false;

  list.innerHTML = accounts
    .map(
      (acct, i) => {
        const hasError = !acct._url;
        return `
    <div class="acct-card glass${hasError ? ' acct-card--error' : ''}" id="acct-${i}">
      <div class="acct-card__header">
        <div class="acct-card__title">
          <span class="acct-card__issuer">${escapeHtml(acct.issuer || '无发行方')}</span>
          <span class="acct-card__name">${escapeHtml(acct.name)}</span>
        </div>
        <div class="acct-card__meta">
          <span class="acct-card__type">${acct.type === 1 ? 'HOTP' : 'TOTP'}</span>
          <span class="acct-card__info">${acct._digits}位 · ${escapeHtml(acct._algo)}</span>
        </div>
      </div>
      <div class="acct-card__body">
        <div class="acct-card__code" id="code-${i}">${hasError ? '不支持' : '------'}</div>
        <div class="acct-card__countdown">
          ${hasError ? '<span class="acct-card__warn">⚠</span>' : `
          <svg viewBox="0 0 40 40" class="acct-card__ring">
            <circle cx="20" cy="20" r="17" fill="none" stroke="var(--border)" stroke-width="2.5" />
            <circle cx="20" cy="20" r="17" fill="none" stroke="var(--accent)" stroke-width="2.5"
              stroke-dasharray="106.8" stroke-dashoffset="0" stroke-linecap="round"
              transform="rotate(-90 20 20)" id="ring-${i}" />
          </svg>
          <span class="acct-card__seconds" id="secs-${i}">30</span>`}
        </div>
      </div>
      ${hasError ? `<p class="acct-card__errmsg">${escapeHtml(acct._error)}</p>` : `
      <div class="acct-card__actions">
        <button class="btn btn-secondary btn-sm" data-action="qrcode" data-index="${i}">显示二维码</button>
        <button class="btn btn-secondary btn-sm" data-action="copy" data-index="${i}">复制链接</button>
      </div>`}
    </div>`;
      }
    )
    .join('');

  // 绑定按钮事件（跳过错误卡片）
  list.querySelectorAll('[data-action="qrcode"]').forEach((btn) => {
    btn.addEventListener('click', () => showQrModal(parseInt(btn.dataset.index)));
  });
  list.querySelectorAll('[data-action="copy"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.index);
      const ok = await copyText(accounts[idx]._url);
      if (ok) {
        const orig = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      } else {
        flashToast('复制失败', 'error');
      }
    });
  });

  // 开始实时 TOTP 刷新
  startTick();
}

/* ========== 实时 TOTP tick ========== */
async function tick() {
  try {
    const epoch = getTotpCounter();
    const remaining = getRemainingSeconds();

    if (epoch !== lastEpoch) {
      lastEpoch = epoch;
      // 重新计算所有 TOTP 验证码（并行加速，账号多时不卡帧）
      await Promise.all(accounts.map(async (acct, i) => {
        if (acct.type === 1) return; // HOTP 不自动刷新
        if (!acct._url) return; // 错误账号不计算
        try {
          const code = await computeTotp(acct);
          const codeEl = document.getElementById('code-' + i);
          if (codeEl) {
            // 6 位：前 3 后 3 分组；8 位：前 4 后 4
            const mid = code.length / 2;
            codeEl.textContent = code.slice(0, mid) + ' ' + code.slice(mid);
          }
        } catch (e) {
          const codeEl = document.getElementById('code-' + i);
          if (codeEl) codeEl.textContent = 'ERROR';
          console.error('TOTP 计算失败:', e);
        }
      }));
    }

    // 更新环形倒计时（仅对有效账号，错误账号无 ring 元素）
    for (let i = 0; i < accounts.length; i++) {
      if (!accounts[i]._url) continue;
      const ring = document.getElementById('ring-' + i);
      const secs = document.getElementById('secs-' + i);
      if (ring) {
        const progress = remaining / 30;
        ring.style.strokeDashoffset = 106.8 * (1 - progress);
        if (remaining <= 5) ring.style.stroke = '#ef4444';
        else ring.style.stroke = 'var(--accent)';
      }
      if (secs) secs.textContent = remaining;
    }
  } catch (e) {
    console.error('tick 异常:', e);
  }
  rafId = requestAnimationFrame(tick);
}

function startTick() {
  lastEpoch = -1;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function stopTick() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/* ========== 二维码弹窗 ========== */
async function showQrModal(index) {
  const overlay = document.getElementById('qr-overlay');
  const canvas = document.getElementById('qr-canvas');
  const urlText = document.getElementById('qr-url-text');

  urlText.textContent = accounts[index]._url;

  try {
    const size = Math.min(window.innerWidth * 0.8, 400);
    // 深色主题下用浅色前景、深色背景；浅色主题反之。保证扫描器能识别（必须有强对比）
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const darkColor = isDark ? '#f8fafc' : '#0f172a';
    const lightColor = isDark ? '#0f172a' : '#ffffff';
    await QRCode.toCanvas(canvas, accounts[index]._url, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: darkColor, light: lightColor },
    });
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
  } catch (e) {
    console.error('QR 生成失败:', e);
    flashToast('二维码生成失败: ' + e.message, 'error');
  }

  overlay.hidden = false;
}

function hideQrModal() {
  document.getElementById('qr-overlay').hidden = true;
}

/* ========== 复制到剪贴板 ========== */
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
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }
}

/* ========== 截图识别 (jsQR) ========== */
async function decodeImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height);
    return result ? result.data : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function handleImageFiles(files) {
  const texts = [];
  let totalImages = 0;
  let failed = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    totalImages++;
    try {
      const data = await decodeImageFile(file);
      if (data) texts.push(data);
      else failed++;
    } catch (e) {
      failed++;
      console.error('图片解码失败:', e);
    }
  }
  if (texts.length) {
    const ta = document.getElementById('input-text');
    ta.value = ta.value + (ta.value ? '\n' : '') + texts.join('\n');
  }
  // 用户反馈
  if (totalImages > 0) {
    const msg = texts.length
      ? `识别成功 ${texts.length} 个二维码${failed ? `（${failed} 个失败）` : ''}，请点击"解析"`
      : `${totalImages} 张图片均未识别出二维码`;
    flashToast(msg, texts.length ? 'success' : 'error');
  }
}

/* ========== 轻量 toast ========== */
let toastTimer = null;
function flashToast(msg, type = 'info') {
  let el = document.getElementById('totp-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'totp-toast';
    el.className = 'totp-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'totp-toast totp-toast--' + type;
  el.classList.add('totp-toast--show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('totp-toast--show');
  }, 2800);
}

/* ========== 下载 txt ========== */
function downloadTxt() {
  const valid = accounts.filter((a) => a._url);
  if (!valid.length) {
    flashToast('没有可导出的有效账号', 'error');
    return;
  }
  const content = valid.map((a) => a._url).join('\n');
  const blob = new Blob(['\uFEFF' + content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'totp-accounts.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const skipped = accounts.length - valid.length;
  if (skipped > 0) {
    flashToast(`已导出 ${valid.length} 个账号（跳过 ${skipped} 个无效）`, 'info');
  }
}

/* ========== 清空 ========== */
function clearAll() {
  accounts = [];
  lastEpoch = -1;
  stopTick();
  document.getElementById('results-section').hidden = true;
  document.getElementById('accounts-list').innerHTML = '';
  document.getElementById('results-actions').hidden = true;
  document.getElementById('input-text').value = '';
}

/* ========== 初始化 ========== */
function initTotpMigration() {
  const input = document.getElementById('input-text');
  const parseBtn = document.getElementById('btn-parse');
  const clearBtn = document.getElementById('btn-clear');
  const downloadBtn = document.getElementById('btn-download');
  const fileInput = document.getElementById('img-input');
  const dropZone = document.getElementById('drop-zone');

  parseBtn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) {
      flashToast('请先粘贴迁移链接或拖入二维码截图', 'info');
      return;
    }
    accounts = parseInput(text);
    if (!accounts.length) {
      input.style.borderColor = '#ef4444';
      setTimeout(() => { input.style.borderColor = ''; }, 2000);
      flashToast('未解析出任何账号，请检查链接格式', 'error');
      return;
    }
    const errCount = accounts.filter(a => !a._url).length;
    if (errCount > 0) {
      flashToast(`解析出 ${accounts.length} 个账号（${errCount} 个算法不支持）`, 'info');
    } else {
      flashToast(`解析出 ${accounts.length} 个账号`, 'success');
    }
    renderAccounts();
  });

  clearBtn.addEventListener('click', clearAll);
  downloadBtn.addEventListener('click', downloadTxt);

  // 二维码弹窗关闭
  document.getElementById('qr-overlay-close').addEventListener('click', hideQrModal);
  document.getElementById('qr-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) hideQrModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('qr-overlay').hidden) {
      hideQrModal();
    }
  });

  // 拖放截图识别
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length) {
      handleImageFiles(fileInput.files);
      fileInput.value = '';
    }
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drop-zone--active');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drop-zone--active');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drop-zone--active');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleImageFiles(e.dataTransfer.files);
    }
  });

  // Ctrl+V 粘贴截图
  document.addEventListener('paste', (e) => {
    if (!e.clipboardData || !e.clipboardData.items) return;
    const files = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) handleImageFiles(files);
  });
}

export { initTotpMigration };