/**
 * JWT 解析工具核心逻辑
 * 解析 header.payload.signature 三段，检查过期状态，解释标准声明
 * 纯前端运行，无任何网络请求
 */

const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjk5OTk5OTk5OTksImlzcyI6ImxvY2FsLXRvb2xib3gifQ.signatureplaceholder';

/* 标准 claims 中文说明 */
const CLAIM_DESC = {
  iss: '签发者',
  sub: '主题（用户标识）',
  aud: '受众',
  exp: '过期时间',
  nbf: '生效时间',
  iat: '签发时间',
  jti: '唯一标识',
};

/* 时间戳声明：自动转可读时间 */
const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat']);

/* ========== base64url 解码 ========== */
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) base64 += '='.repeat(4 - pad);
  const decoded = atob(base64);
  // 处理 UTF-8
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/* base64url → bytes（用于 signature 转 hex） */
function base64UrlToBytes(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) base64 += '='.repeat(4 - pad);
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ========== 通用工具 ========== */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function formatDuration(sec) {
  sec = Math.abs(sec);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  const parts = [];
  if (days) parts.push(days + ' 天');
  if (hours) parts.push(hours + ' 小时');
  if (mins) parts.push(mins + ' 分');
  if (!days && !hours) parts.push(secs + ' 秒');
  return parts.join(' ') || '0 秒';
}

function tsToReadable(ts) {
  if (typeof ts !== 'number' || !isFinite(ts)) return null;
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
}

/* 格式化声明值：时间戳声明附加可读时间 */
function formatClaimValue(key, value) {
  if (TIME_CLAIMS.has(key) && typeof value === 'number') {
    const readable = tsToReadable(value);
    return readable ? `${value}（${readable}）` : String(value);
  }
  if (value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/* ========== 状态判定 ========== */
function judgeStatus(payload) {
  const now = Math.floor(Date.now() / 1000);
  const hasExp = typeof payload.exp === 'number';
  const hasNbf = typeof payload.nbf === 'number';

  // 未生效优先判定
  if (hasNbf && payload.nbf > now) {
    return { type: 'red', text: '未生效', detail: '生效时间在未来，距生效还有 ' + formatDuration(payload.nbf - now) };
  }
  if (!hasExp) {
    return { type: 'blue', text: '无过期时间', detail: 'payload 中缺少 exp 字段，无法判断是否过期' };
  }
  const remaining = payload.exp - now;
  if (remaining <= 0) {
    return { type: 'red', text: '已过期', detail: '已过期 ' + formatDuration(-remaining) };
  }
  if (remaining < 86400) {
    return { type: 'yellow', text: '即将过期', detail: '剩余 ' + formatDuration(remaining) + '（不足 24 小时）' };
  }
  return { type: 'green', text: '有效', detail: '剩余 ' + formatDuration(remaining) };
}

/* ========== 渲染 ========== */
function renderBanner(status) {
  const el = document.getElementById('jwt-banner');
  el.className = 'jwt-banner jwt-banner--' + status.type;
  el.innerHTML = `
    <div class="jwt-banner__head">
      <span class="jwt-banner__dot"></span>
      <span class="jwt-banner__title">${escapeHtml(status.text)}</span>
    </div>
    <div class="jwt-banner__detail">${escapeHtml(status.detail)}</div>
  `;
  el.hidden = false;
}

function hideBanner() {
  const el = document.getElementById('jwt-banner');
  el.hidden = true;
  el.innerHTML = '';
}

function renderPartCard(cardId, label, content, copyValue) {
  const el = document.getElementById(cardId);
  el.innerHTML = `
    <div class="jwt-card__head">
      <span class="jwt-card__label">${label}</span>
      <button class="jwt-copy" data-copy="${encodeURIComponent(copyValue)}">复制</button>
    </div>
    <pre class="jwt-card__pre">${escapeHtml(content)}</pre>
  `;
}

function renderClaims(payload) {
  const el = document.getElementById('claims-section');
  const keys = Object.keys(payload);
  if (!keys.length) {
    el.innerHTML = '<div class="jwt-claims__head">声明详情</div><div class="jwt-claims__empty">Payload 无声明字段</div>';
    return;
  }
  const rows = keys
    .map((k) => {
      const isStandard = Object.prototype.hasOwnProperty.call(CLAIM_DESC, k);
      const desc = isStandard ? CLAIM_DESC[k] : '自定义声明';
      const valueStr = formatClaimValue(k, payload[k]);
      const tag = isStandard
        ? '<span class="jwt-claims__tag jwt-claims__tag--std">标准</span>'
        : '<span class="jwt-claims__tag jwt-claims__tag--custom">自定义</span>';
      return `
        <tr>
          <td class="jwt-claims__key">${escapeHtml(k)}${tag}</td>
          <td class="jwt-claims__desc">${escapeHtml(desc)}</td>
          <td class="jwt-claims__val">${escapeHtml(valueStr)}</td>
        </tr>`;
    })
    .join('');
  el.innerHTML = `
    <div class="jwt-claims__head">声明详情</div>
    <div class="jwt-claims__wrap">
      <table class="jwt-claims__table">
        <thead>
          <tr><th>字段</th><th>含义</th><th>值</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function hideResults() {
  hideBanner();
  ['card-header', 'card-payload', 'card-signature'].forEach((id) => {
    document.getElementById(id).innerHTML = '';
  });
  document.getElementById('claims-section').innerHTML = '';
}

function showError(msg) {
  hideResults();
  const err = document.getElementById('jwt-error');
  err.textContent = msg;
  err.hidden = false;
}

function hideError() {
  const err = document.getElementById('jwt-error');
  err.hidden = true;
  err.textContent = '';
}

/* ========== 绑定复制按钮（每次渲染后重新绑定） ========== */
function bindCopy() {
  document.querySelectorAll('.jwt-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = decodeURIComponent(btn.dataset.copy || '');
      const ok = await copyText(text);
      if (ok) {
        const original = btn.textContent;
        btn.textContent = '已复制';
        btn.classList.add('jwt-copy--success');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('jwt-copy--success');
        }, 1200);
      }
    });
  });
}

/* ========== 主解析 ========== */
function parseAndRender() {
  const input = document.getElementById('jwt-input').value.trim();
  hideError();
  if (!input) {
    hideResults();
    return;
  }

  const parts = input.split('.');
  if (parts.length !== 3) {
    showError('JWT 格式错误：需要恰好 3 段（header.payload.signature），当前 ' + parts.length + ' 段');
    return;
  }
  if (!parts[0] || !parts[1] || !parts[2]) {
    showError('JWT 格式错误：存在空段，三段都不能为空');
    return;
  }

  let header, payload;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]));
  } catch (e) {
    showError('Header 解码失败：' + e.message);
    return;
  }
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch (e) {
    showError('Payload 解码失败：' + e.message);
    return;
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    showError('Payload 不是有效的 JSON 对象');
    return;
  }

  let sigHex;
  try {
    sigHex = bytesToHex(base64UrlToBytes(parts[2]));
  } catch (e) {
    showError('Signature 解码失败：' + e.message);
    return;
  }

  // 渲染结果
  const headerStr = JSON.stringify(header, null, 2);
  const payloadStr = JSON.stringify(payload, null, 2);
  renderPartCard('card-header', 'Header', headerStr, headerStr);
  renderPartCard('card-payload', 'Payload', payloadStr, payloadStr);
  renderPartCard('card-signature', 'Signature（hex）', sigHex, sigHex);
  renderBanner(judgeStatus(payload));
  renderClaims(payload);
  bindCopy();
}

/* ========== 初始化 ========== */
function initJwt() {
  const input = document.getElementById('jwt-input');

  // 输入即解析
  input.addEventListener('input', parseAndRender);

  // 载入示例
  document.getElementById('btn-jwt-sample').addEventListener('click', () => {
    input.value = SAMPLE_JWT;
    parseAndRender();
  });

  // 清空
  document.getElementById('btn-jwt-clear').addEventListener('click', () => {
    input.value = '';
    hideError();
    hideResults();
  });

  // Ctrl+Enter 触发解析
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      parseAndRender();
    }
  });
}

export { initJwt };
