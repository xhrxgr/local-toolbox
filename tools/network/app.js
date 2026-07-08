/**
 * 网络工具核心逻辑
 * 5 个模式：
 * 1. 延迟测试 (HTTP Ping) - fetch no-cors HEAD 多次采样
 * 2. 连接诊断 (TCPing)   - Performance Resource Timing 拆解 DNS/TCP/TLS/TTFB
 * 3. 网速测试            - fetch 流式下载 + XHR 上传，实时进度
 * 4. DNS 查询            - DNS-over-HTTPS (Cloudflare / Google)
 * 5. 网络信息            - navigator.connection + 公网 IP/地理位置
 */

/* ========== Tab 切换 ========== */
function switchTab(mode) {
  document.querySelectorAll('.mode-tab').forEach(t => {
    t.classList.toggle('mode-tab--active', t.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-panel').forEach(p => {
    p.classList.toggle('mode-panel--active', p.id === `panel-${mode}`);
  });
  // 进入网络信息面板时自动加载
  if (mode === 'info') loadNetInfo();
}

/* ========== 工具函数 ========== */
function normalizeUrl(input) {
  let url = input.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
  if (bytesPerSec < 1048576) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  if (bytesPerSec < 1073741824) return (bytesPerSec / 1048576).toFixed(2) + ' MB/s';
  return (bytesPerSec / 1073741824).toFixed(2) + ' GB/s';
}

function formatMs(ms) {
  if (ms < 1) return ms.toFixed(2) + ' ms';
  if (ms < 100) return ms.toFixed(1) + ' ms';
  return Math.round(ms) + ' ms';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ========== 目标信息解析（DoH + IP 地理位置查询）========== */
// 通过 DoH 查询域名 A 记录，返回 IP 数组
async function resolveDomain(domain) {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`, {
      headers: { 'Accept': 'application/dns-json' },
      cache: 'no-store',
    });
    const data = await res.json();
    if (data.Answer) {
      return data.Answer.filter(a => a.type === 1).map(a => a.data);
    }
    return [];
  } catch {
    return [];
  }
}

// 查询 IP 的地理位置（ipapi.co 支持 CORS，免费版有速率限制）
async function lookupIpGeo(ip) {
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, { cache: 'no-store' });
    const data = await res.json();
    if (data.error) return { ip, error: data.reason || '查询失败' };
    return {
      ip,
      city: data.city || '',
      region: data.region || '',
      country: data.country_name || '',
      countryCode: data.country_code || '',
      org: data.org || '',
      timezone: data.timezone || '',
    };
  } catch {
    return { ip, error: '查询失败' };
  }
}

// 显示目标信息（域名 + 解析 IP + 服务器地理位置）
async function showTargetInfo(url, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.hidden = false;
  el.innerHTML = '<div class="target-info__loading">解析目标信息中…</div>';
  try {
    const hostname = new URL(url).hostname;
    const ips = await resolveDomain(hostname);
    if (ips.length === 0) {
      el.innerHTML = `
        <div class="target-info__row"><span class="target-info__label">目标域名</span><code>${hostname}</code></div>
        <div class="target-info__row target-info__row--error">无法解析 IP（域名可能不存在或 DoH 失败）</div>`;
      return;
    }
    // 查询第一个 IP 的地理位置（多个 IP 通常同机房，查一个即可）
    const geo = await lookupIpGeo(ips[0]);
    let html = `<div class="target-info__row"><span class="target-info__label">目标域名</span><code>${hostname}</code></div>`;
    html += `<div class="target-info__row"><span class="target-info__label">解析 IP</span><code>${ips.join(', ')}</code></div>`;
    if (geo.error) {
      html += `<div class="target-info__row target-info__row--warn"><span class="target-info__label">服务器位置</span><code>地理位置查询失败（${geo.error}）</code></div>`;
    } else {
      const locParts = [geo.country, geo.region, geo.city].filter(Boolean);
      html += `<div class="target-info__row"><span class="target-info__label">服务器位置</span><code>${locParts.join(' / ') || '未知'}${geo.countryCode ? ' (' + geo.countryCode + ')' : ''}</code></div>`;
      if (geo.org) html += `<div class="target-info__row"><span class="target-info__label">服务器 ISP</span><code>${geo.org}</code></div>`;
    }
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = `<div class="target-info__row target-info__row--error">目标信息获取失败：${e.message}</div>`;
  }
}

/* ========== 模式 1：延迟测试 (HTTP Ping) ========== */
const pingState = { running: false, samples: [], sent: 0, recv: 0 };

async function pingOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const sep = url.includes('?') ? '&' : '?';
  const target = url + sep + '_t=' + Date.now();
  const t0 = performance.now();
  try {
    await fetch(target, { mode: 'no-cors', method: 'HEAD', cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    return { ok: true, rtt: performance.now() - t0 };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') return { ok: false, rtt: 0, error: '超时' };
    return { ok: false, rtt: 0, error: '网络错误' };
  }
}

function updatePingStats() {
  const sent = pingState.sent;
  const recv = pingState.recv;
  const rtts = pingState.samples;
  document.getElementById('ping-sent').textContent = sent;
  document.getElementById('ping-recv').textContent = recv;
  const lossRate = sent > 0 ? ((sent - recv) / sent * 100).toFixed(1) + '%' : '—';
  document.getElementById('ping-loss').textContent = lossRate;

  if (rtts.length === 0) {
    ['ping-min', 'ping-avg', 'ping-max', 'ping-mdev'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    return;
  }
  const min = Math.min(...rtts);
  const max = Math.max(...rtts);
  const avg = rtts.reduce((a, b) => a + b, 0) / rtts.length;
  const mdev = rtts.length > 1
    ? Math.sqrt(rtts.reduce((s, r) => s + (r - avg) ** 2, 0) / rtts.length)
    : 0;
  document.getElementById('ping-min').textContent = formatMs(min);
  document.getElementById('ping-avg').textContent = formatMs(avg);
  document.getElementById('ping-max').textContent = formatMs(max);
  document.getElementById('ping-mdev').textContent = formatMs(mdev);
}

function appendPingLog(seq, result) {
  const log = document.getElementById('ping-log');
  // 清除空状态
  if (log.querySelector('.empty-state')) log.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'ping-row ' + (result.ok ? 'ping-row--ok' : 'ping-row--fail');
  const rttText = result.ok ? formatMs(result.rtt) : '—';
  const statusText = result.ok ? 'OK' : result.error || '失败';
  row.innerHTML = `<span class="ping-seq">${seq}</span><span class="ping-rtt">${rttText}</span><span class="ping-status">${statusText}</span>`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

async function startPing() {
  const url = normalizeUrl(document.getElementById('ping-url').value);
  if (!url) return;
  const count = parseInt(document.getElementById('ping-count').value) || 10;
  const interval = parseInt(document.getElementById('ping-interval').value) || 1000;
  const timeout = parseInt(document.getElementById('ping-timeout').value) || 5000;

  // 先解析并显示目标信息（不阻塞 ping 主流程）
  showTargetInfo(url, 'ping-target-info');

  pingState.running = true;
  pingState.samples = [];
  pingState.sent = 0;
  pingState.recv = 0;
  document.getElementById('ping-log').innerHTML = '';
  updatePingStats();
  document.getElementById('btn-ping-start').disabled = true;
  document.getElementById('btn-ping-stop').disabled = false;

  for (let i = 0; i < count; i++) {
    if (!pingState.running) break;
    pingState.sent++;
    const result = await pingOnce(url, timeout);
    if (result.ok) {
      pingState.recv++;
      pingState.samples.push(result.rtt);
    }
    appendPingLog(i + 1, result);
    updatePingStats();
    if (i < count - 1 && pingState.running) await sleep(interval);
  }

  pingState.running = false;
  document.getElementById('btn-ping-start').disabled = false;
  document.getElementById('btn-ping-stop').disabled = true;
}

function stopPing() {
  pingState.running = false;
}

/* ========== 模式 2：连接诊断 (TCPing) ========== */
async function runDiag() {
  const url = normalizeUrl(document.getElementById('diag-url').value);
  const resultEl = document.getElementById('diag-result');
  const noteEl = document.getElementById('diag-note');
  if (!url) return;

  // 先解析并显示目标信息（不阻塞诊断主流程）
  showTargetInfo(url, 'diag-target-info');

  resultEl.innerHTML = '<div class="empty-state">诊断中…</div>';
  noteEl.textContent = '';
  performance.clearResourceTimings();

  const sep = url.includes('?') ? '&' : '?';
  const target = url + sep + '_t=' + Date.now();
  const t0 = performance.now();
  let fetchOk = false;
  let corsError = false;

  try {
    await fetch(target, { mode: 'cors', cache: 'no-store' });
    fetchOk = true;
  } catch (e) {
    // CORS 失败，回退 no-cors
    corsError = true;
    try {
      await fetch(target, { mode: 'no-cors', cache: 'no-store' });
      fetchOk = true;
    } catch (e2) {
      fetchOk = false;
    }
  }
  const totalWall = performance.now() - t0;

  // 等待 Resource Timing 条目写入
  await sleep(50);
  const entries = performance.getEntriesByName(target);
  const entry = entries[entries.length - 1];

  if (!entry) {
    resultEl.innerHTML = `<div class="diag-error">无法获取性能数据。总耗时：${formatMs(totalWall)}</div>`;
    return;
  }

  // 提取各阶段耗时
  const dns = entry.domainLookupEnd - entry.domainLookupStart;
  const tcp = entry.connectEnd - entry.connectStart;
  const tls = entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0;
  const ttfb = entry.responseStart - entry.requestStart;
  const content = entry.responseEnd - entry.responseStart;
  const total = entry.responseEnd - entry.fetchStart;

  // 判断是否被 Timing-Allow-Origin 限制
  const restricted = (entry.domainLookupStart === 0 && entry.requestStart === 0);
  if (restricted) {
    noteEl.textContent = '⚠ 目标未发送 Timing-Allow-Origin 头，DNS/TCP/TLS/TTFB 细节被限制为 0，仅总耗时可用。';
  } else if (corsError) {
    noteEl.textContent = '⚠ CORS 预检失败（已回退 no-cors），但 Timing-Allow-Origin 头存在，各阶段耗时可用。';
  }

  const phases = [
    { name: 'DNS 查询', value: dns, color: 'dns' },
    { name: 'TCP 连接', value: tcp, color: 'tcp' },
    { name: 'TLS 握手', value: tls, color: 'tls' },
    { name: 'TTFB（首字节）', value: ttfb, color: 'ttfb' },
    { name: '内容传输', value: content, color: 'content' },
  ];
  const maxVal = Math.max(...phases.map(p => p.value), 1);

  let html = '<div class="diag-summary">总耗时：<strong>' + formatMs(total) + '</strong></div>';
  html += '<div class="diag-bars">';
  phases.forEach(p => {
    const pct = restricted ? 0 : (p.value / maxVal * 100);
    const valText = restricted ? '受限' : formatMs(p.value);
    html += `
      <div class="diag-bar-row">
        <span class="diag-bar-label">${p.name}</span>
        <div class="diag-bar-track"><div class="diag-bar-fill diag-bar-fill--${p.color}" style="width:${pct}%"></div></div>
        <span class="diag-bar-value">${valText}</span>
      </div>`;
  });
  html += '</div>';

  // 详细信息
  html += '<div class="diag-detail">';
  html += `<div class="diag-detail-row"><span>请求 URL</span><code>${url}</code></div>`;
  html += `<div class="diag-detail-row"><span>协议</span><code>${new URL(url).protocol}</code></div>`;
  if (entry.transferSize !== undefined) {
    html += `<div class="diag-detail-row"><span>传输大小</span><code>${formatBytes(entry.transferSize)}</code></div>`;
    html += `<div class="diag-detail-row"><span>解码大小</span><code>${formatBytes(entry.decodedBodySize)}</code></div>`;
  }
  html += '</div>';

  resultEl.innerHTML = html;
}

/* ========== 模式 3：网速测试 ========== */
let speedRunning = false;

async function runDownloadTest() {
  const baseBtn = document.getElementById('btn-speed-down');
  const baseUrl = document.getElementById('speed-down-url').value;
  const size = parseInt(document.getElementById('speed-down-size').value);
  const url = baseUrl + size;
  const progressEl = document.getElementById('speed-down-progress');
  const fillEl = document.getElementById('speed-down-fill');
  const textEl = document.getElementById('speed-down-text');
  const resultEl = document.getElementById('speed-down-result');

  speedRunning = true;
  baseBtn.disabled = true;
  baseBtn.textContent = '下载中…';
  progressEl.hidden = false;
  fillEl.style.width = '0%';
  textEl.textContent = '0 MB/s';
  resultEl.innerHTML = '';

  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok && res.status !== 0) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    let received = 0;
    let lastUpdate = t0;
    while (true) {
      if (!speedRunning) break;
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      const now = performance.now();
      if (now - lastUpdate > 200) {
        const elapsed = (now - t0) / 1000;
        const speed = received / elapsed;
        const pct = Math.min(received / size * 100, 100);
        fillEl.style.width = pct + '%';
        textEl.textContent = formatSpeed(speed) + ' (' + pct.toFixed(0) + '%)';
        lastUpdate = now;
      }
    }
    const totalTime = (performance.now() - t0) / 1000;
    const avgSpeed = received / totalTime;
    fillEl.style.width = '100%';
    textEl.textContent = formatSpeed(avgSpeed);
    resultEl.innerHTML = `
      <div class="speed-result__row"><span>下载量</span><strong>${formatBytes(received)}</strong></div>
      <div class="speed-result__row"><span>耗时</span><strong>${totalTime.toFixed(2)} s</strong></div>
      <div class="speed-result__row speed-result__row--highlight"><span>平均速度</span><strong>${formatSpeed(avgSpeed)}</strong></div>`;
  } catch (e) {
    resultEl.innerHTML = `<div class="diag-error">下载失败：${e.message}（目标可能不支持 CORS）</div>`;
  } finally {
    speedRunning = false;
    baseBtn.disabled = false;
    baseBtn.textContent = '开始下载';
  }
}

function runUploadTest() {
  const baseBtn = document.getElementById('btn-speed-up');
  const url = document.getElementById('speed-up-url').value;
  const size = parseInt(document.getElementById('speed-up-size').value);
  const progressEl = document.getElementById('speed-up-progress');
  const fillEl = document.getElementById('speed-up-fill');
  const textEl = document.getElementById('speed-up-text');
  const resultEl = document.getElementById('speed-up-result');

  speedRunning = true;
  baseBtn.disabled = true;
  baseBtn.textContent = '上传中…';
  progressEl.hidden = false;
  fillEl.style.width = '0%';
  textEl.textContent = '准备中…';
  resultEl.innerHTML = '';

  // 生成指定大小的随机数据
  const buffer = new Uint8Array(size);
  crypto.getRandomValues(buffer);
  const blob = new Blob([buffer]);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');

  const t0 = performance.now();
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = e.loaded / e.total * 100;
      const elapsed = (performance.now() - t0) / 1000;
      const speed = e.loaded / elapsed;
      fillEl.style.width = pct + '%';
      textEl.textContent = formatSpeed(speed) + ' (' + pct.toFixed(0) + '%)';
    }
  };

  xhr.onload = () => {
    const totalTime = (performance.now() - t0) / 1000;
    const avgSpeed = size / totalTime;
    fillEl.style.width = '100%';
    textEl.textContent = formatSpeed(avgSpeed);
    resultEl.innerHTML = `
      <div class="speed-result__row"><span>上传量</span><strong>${formatBytes(size)}</strong></div>
      <div class="speed-result__row"><span>耗时</span><strong>${totalTime.toFixed(2)} s</strong></div>
      <div class="speed-result__row speed-result__row--highlight"><span>平均速度</span><strong>${formatSpeed(avgSpeed)}</strong></div>`;
    speedRunning = false;
    baseBtn.disabled = false;
    baseBtn.textContent = '开始上传';
  };

  xhr.onerror = () => {
    resultEl.innerHTML = `<div class="diag-error">上传失败（目标可能不支持 CORS）</div>`;
    speedRunning = false;
    baseBtn.disabled = false;
    baseBtn.textContent = '开始上传';
  };

  xhr.send(blob);
}

/* ========== 模式 4：DNS 查询 ========== */
async function queryDNS() {
  const domain = document.getElementById('dns-domain').value.trim();
  const type = document.getElementById('dns-type').value;
  const provider = document.getElementById('dns-provider').value;
  const resultEl = document.getElementById('dns-result');
  if (!domain) return;

  resultEl.innerHTML = '<div class="empty-state">查询中…</div>';

  const dohUrl = provider === 'cloudflare'
    ? `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`
    : `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`;

  try {
    const res = await fetch(dohUrl, {
      headers: provider === 'cloudflare' ? { 'Accept': 'application/dns-json' } : {},
      cache: 'no-store',
    });
    const data = await res.json();

    if (data.Status !== 0 && data.Status !== undefined) {
      const statusNames = { 1: '格式错误', 2: '服务器失败', 3: '域名不存在', 5: '拒绝查询' };
      resultEl.innerHTML = `<div class="diag-error">DNS 查询失败：${statusNames[data.Status] || '状态 ' + data.Status}</div>`;
      return;
    }

    const answers = data.Answer || data.Authority || [];
    if (answers.length === 0) {
      resultEl.innerHTML = `<div class="diag-error">未找到 ${type} 记录</div>`;
      return;
    }

    let html = '<table class="dns-table"><thead><tr><th>名称</th><th>类型</th><th>TTL</th><th>值</th></tr></thead><tbody>';
    const typeNames = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA', 257: 'CAA' };
    answers.forEach(a => {
      html += `<tr><td>${a.name}</td><td>${typeNames[a.type] || a.type}</td><td>${a.TTL}s</td><td class="dns-value">${a.data}</td></tr>`;
    });
    html += '</tbody></table>';
    resultEl.innerHTML = html;
  } catch (e) {
    resultEl.innerHTML = `<div class="diag-error">查询失败：${e.message}</div>`;
  }
}

/* ========== 模式 5：网络信息 ========== */
// 带 5s 超时的 fetch，避免单源慢响应拖累整体检测
async function fetchWithTimeout(url, opts = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// JSONP 请求（用于不支持 CORS 的国内 IP 查询服务，如 pconline）
function jsonp(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const cbName = '__jsonp_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP 超时'));
    }, timeoutMs);
    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };
    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cbName;
    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP 加载失败'));
    };
    document.head.appendChild(script);
  });
}

// 多源出口 IP 对比：并发请求多个 IP 查询服务，按 IPv4/IPv6 分组对比
// 仅当同一协议栈内出现多个不同 IP 时，才判定为 VPN 分流（双栈环境下 v4/v6 不同属正常）
async function loadExitCompare() {
  const el = document.getElementById('exit-compare');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">正在检测出口 IP…</div>';

  // 检测源：境外通用 + 强制 v4/v6 端点（icanhazip 子域分别只走对应协议栈）
  // 注：原 ipw.cn 国内端点已关停（2026-04 平台下线，DNS 记录清空），已移除
  const sources = [
    {
      name: 'Cloudflare Trace',
      region: '境外·双栈',
      url: 'https://www.cloudflare.com/cdn-cgi/trace',
      parse: async (res) => {
        const obj = {};
        (await res.text()).split('\n').forEach(l => {
          const idx = l.indexOf('=');
          if (idx > 0) obj[l.slice(0, idx)] = l.slice(idx + 1);
        });
        return { ip: obj.ip, loc: obj.loc || '', org: obj.colo ? 'Colo: ' + obj.colo : '' };
      },
    },
    {
      name: 'ipify.org',
      region: '境外·双栈',
      url: 'https://api.ipify.org?format=json',
      parse: async (res) => {
        const d = await res.json();
        return { ip: d.ip, loc: '', org: '' };
      },
    },
    {
      name: 'ipwho.is',
      region: '境外·双栈',
      url: 'https://ipwho.is/',
      parse: async (res) => {
        const d = await res.json();
        if (!d.success) throw new Error(d.message || '查询失败');
        return {
          ip: d.ip,
          loc: [d.country, d.region, d.city].filter(Boolean).join(' / '),
          org: d.connection?.isp || '',
        };
      },
    },
    {
      name: 'ipinfo.io',
      region: '境外·双栈',
      url: 'https://ipinfo.io/json',
      parse: async (res) => {
        const d = await res.json();
        return { ip: d.ip, loc: [d.country, d.region, d.city].filter(Boolean).join(' / '), org: d.org };
      },
    },
    {
      name: 'icanhazip (v4)',
      region: '境外·强制IPv4',
      url: 'https://ipv4.icanhazip.com/',
      parse: async (res) => ({ ip: (await res.text()).trim(), loc: '', org: '' }),
    },
    {
      name: 'icanhazip (v6)',
      region: '境外·强制IPv6',
      url: 'https://ipv6.icanhazip.com/',
      parse: async (res) => ({ ip: (await res.text()).trim(), loc: '', org: '' }),
    },
  ];

  // 并发请求所有检测源
  const results = await Promise.allSettled(
    sources.map(async (s) => {
      const res = await fetchWithTimeout(s.url, {}, 5000);
      const data = await s.parse(res);
      return { ...s, ...data };
    })
  );

  // 按 IPv4/IPv6 分组收集 IP（含冒号为 IPv6，否则 IPv4）
  const v4Ips = new Set();
  const v6Ips = new Set();
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value.ip) {
      const ip = r.value.ip;
      if (ip.includes(':')) v6Ips.add(ip);
      else v4Ips.add(ip);
    }
  });

  // 渲染检测结果列表（用 index 关联 sources，失败行也显示源名称/区域/URL）
  let html = '<div class="exit-compare__list">';
  results.forEach((r, i) => {
    const s = sources[i];
    if (r.status === 'fulfilled') {
      const v = r.value;
      const ver = v.ip ? (v.ip.includes(':') ? 'IPv6' : 'IPv4') : '';
      html += `
        <div class="exit-compare__row">
          <div class="exit-compare__source">
            <span class="exit-compare__name">${v.name}</span>
            <span class="exit-compare__region">${v.region}</span>
            ${ver ? `<span class="exit-compare__version exit-compare__version--${ver.toLowerCase()}">${ver}</span>` : ''}
          </div>
          <div class="exit-compare__ip">${v.ip || '—'}</div>
          <div class="exit-compare__loc">${v.loc || v.org || '—'}</div>
        </div>`;
    } else {
      const reason = r.reason;
      let errMsg;
      if (reason?.name === 'AbortError') errMsg = '超时';
      else if (reason?.message) errMsg = reason.message;
      else errMsg = 'Failed to fetch';
      html += `
        <div class="exit-compare__row exit-compare__row--error">
          <div class="exit-compare__source">
            <span class="exit-compare__name">${s.name}</span>
            <span class="exit-compare__region">${s.region}</span>
            <span class="exit-compare__url" title="${s.url}">${s.url.replace(/^https?:\/\//, '').split('/')[0]}</span>
          </div>
          <div class="exit-compare__ip">请求失败</div>
          <div class="exit-compare__loc">${errMsg}</div>
        </div>`;
    }
  });
  html += '</div>';

  // 结论：仅同一协议栈内多个 IP 才判定为分流
  const totalIps = v4Ips.size + v6Ips.size;
  if (totalIps === 0) {
    html += '<div class="exit-compare__conclusion exit-compare__conclusion--error">所有检测源均请求失败，无法判断出口 IP</div>';
  } else {
    const splitDetails = [];
    if (v4Ips.size > 1) {
      splitDetails.push(`IPv4 检测到 ${v4Ips.size} 个不同地址：${[...v4Ips].map(ip => '<code>' + ip + '</code>').join('、')}`);
    }
    if (v6Ips.size > 1) {
      splitDetails.push(`IPv6 检测到 ${v6Ips.size} 个不同地址：${[...v6Ips].map(ip => '<code>' + ip + '</code>').join('、')}`);
    }

    if (splitDetails.length > 0) {
      html += `<div class="exit-compare__conclusion exit-compare__conclusion--warn">⚠ 同一协议栈内存在多个出口 IP，疑似 VPN 分流（不同检测源经不同代理节点出口）：<br>${splitDetails.join('<br>')}</div>`;
    } else {
      const stacks = [];
      if (v4Ips.size === 1) stacks.push(`IPv4 <code>${[...v4Ips][0]}</code>`);
      if (v6Ips.size === 1) stacks.push(`IPv6 <code>${[...v6Ips][0]}</code>`);
      const dualNote = (v4Ips.size === 1 && v6Ips.size === 1) ? '（双栈环境，v4 与 v6 地址不同属正常）' : '';
      html += `<div class="exit-compare__conclusion exit-compare__conclusion--ok">✓ 各协议栈出口 IP 一致${dualNote}：${stacks.join('，')}。未检测到 VPN 分流。</div>`;
    }
  }

  html += '<div class="exit-compare__tip">说明：检测源均为境外服务，仅反映访问境外服务时的出口 IP。含强制 IPv4 / IPv6 端点可单独探测各协议栈出口。如需判断访问特定网站是否经 VPN，建议在"延迟测试"面板测试该网站，结合"服务器位置"对比。</div>';

  el.innerHTML = html;
}

async function loadNetInfo() {
  const grid = document.getElementById('info-grid');
  grid.innerHTML = '<div class="empty-state">加载中…</div>';

  // 公网 IP + 地理位置查询链：国内源优先（精度好）→ 境外补充
  // 国内源 pconline 对中国大陆 IP 的市级精度远好于境外服务（境外库常定位到 ISP 注册地）
  // 任一源成功即采用其结果，带 5s 超时避免慢响应拖累
  let ipInfo = null;
  const ipSources = [
    {
      type: 'jsonp',
      url: 'https://whois.pconline.com.cn/ipJson.jsp?json=true',
      parse: (data) => ({
        ip: data.ip,
        city: data.city || '',
        region: data.pro || '',
        country: data.pro ? '中国' : '',
        org: data.region || data.addr || '',
        timezone: 'Asia/Shanghai',
        source: 'pconline（国内）',
      }),
    },
    {
      type: 'fetch',
      url: 'https://ipinfo.io/json',
      parse: async (res) => {
        const d = await res.json();
        return {
          ip: d.ip,
          city: d.city || '',
          region: d.region || '',
          country: d.country ? d.country : '',
          org: d.org || '',
          timezone: d.timezone || '',
          source: 'ipinfo.io',
        };
      },
    },
    {
      type: 'fetch',
      url: 'https://ipwho.is/',
      parse: async (res) => {
        const d = await res.json();
        if (!d.success) throw new Error(d.message || '查询失败');
        return {
          ip: d.ip,
          city: d.city || '',
          region: d.region || '',
          country: d.country ? d.country + ' (' + (d.country_code || '') + ')' : '',
          org: d.connection?.isp || '',
          timezone: d.timezone?.id || '',
          source: 'ipwho.is',
        };
      },
    },
    {
      type: 'fetch',
      url: 'https://ipapi.co/json/',
      parse: async (res) => {
        const d = await res.json();
        if (d.error) throw new Error(d.reason || '查询失败');
        return {
          ip: d.ip,
          city: d.city || '',
          region: d.region || '',
          country: d.country_name ? d.country_name + ' (' + (d.country_code || '') + ')' : '',
          org: d.org || '',
          timezone: d.timezone || '',
          source: 'ipapi.co',
        };
      },
    },
    {
      type: 'fetch',
      url: 'https://www.cloudflare.com/cdn-cgi/trace',
      parse: async (res) => {
        const obj = {};
        (await res.text()).split('\n').forEach(l => {
          const idx = l.indexOf('=');
          if (idx > 0) obj[l.slice(0, idx)] = l.slice(idx + 1);
        });
        return { ip: obj.ip, city: '', region: '', country: obj.loc || '', org: obj.colo ? 'Colo: ' + obj.colo : '', timezone: '', source: 'Cloudflare Trace' };
      },
    },
    {
      type: 'fetch',
      url: 'https://api.ipify.org?format=json',
      parse: async (res) => {
        const d = await res.json();
        return { ip: d.ip, city: '', region: '', country: '', org: '', timezone: '', source: 'ipify.org' };
      },
    },
  ];
  for (const s of ipSources) {
    try {
      if (s.type === 'jsonp') {
        const data = await jsonp(s.url, 5000);
        ipInfo = s.parse(data);
      } else {
        const res = await fetchWithTimeout(s.url, {}, 5000);
        ipInfo = await s.parse(res);
      }
      if (ipInfo.ip) break;
    } catch { /* 继续尝试下一个源 */ }
  }

  let ipHtml;
  if (ipInfo && ipInfo.ip) {
    const items = [
      { label: '公网 IP', value: ipInfo.ip },
      { label: '城市', value: ipInfo.city || '—' },
      { label: '地区', value: ipInfo.region || '—' },
      { label: '国家', value: ipInfo.country || '—' },
      { label: 'ISP', value: ipInfo.org || '—' },
      { label: '时区', value: ipInfo.timezone || '—' },
    ];
    ipHtml = items.map(i => `
      <div class="info-card glass">
        <span class="info-card__label">${i.label}</span>
        <span class="info-card__value">${i.value}</span>
      </div>`).join('');
    ipHtml += `<div class="info-card glass info-card--source"><span class="info-card__label">数据来源</span><span class="info-card__value">${ipInfo.source}</span></div>`;
  } else {
    ipHtml = '<div class="info-card glass"><span class="info-card__label">公网 IP</span><span class="info-card__value">所有源均查询失败</span></div>';
  }

  grid.innerHTML = `
    <div class="info-section">
      <h3 class="info-section-title">公网 IP 与地理位置</h3>
      <div class="info-cards">${ipHtml}</div>
      <div class="info-note">说明：IP 地理位置基于数据库查询，国内源（pconline）对中国大陆 IP 精度较好（市级），境外源常定位到 ISP 注册地（如北京）。优先采用国内源结果，数据来源标注于上方卡片。</div>
    </div>
    <div class="info-section">
      <h3 class="info-section-title">多源出口 IP 对比（VPN 路由检测）</h3>
      <div class="exit-compare" id="exit-compare"><div class="empty-state">正在检测…</div></div>
    </div>`;

  // 自动触发多源出口 IP 检测（无需手动点击）
  loadExitCompare();
}

/* ========== 初始化 ========== */
function initNetwork() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // 延迟测试
  document.getElementById('btn-ping-start').addEventListener('click', startPing);
  document.getElementById('btn-ping-stop').addEventListener('click', stopPing);

  // 连接诊断
  document.getElementById('btn-diag').addEventListener('click', runDiag);

  // 网速测试
  document.getElementById('btn-speed-down').addEventListener('click', runDownloadTest);
  document.getElementById('btn-speed-up').addEventListener('click', runUploadTest);

  // DNS 查询
  document.getElementById('btn-dns').addEventListener('click', queryDNS);
  document.getElementById('dns-domain').addEventListener('keydown', e => { if (e.key === 'Enter') queryDNS(); });

  // 网络信息
  document.getElementById('btn-info-refresh').addEventListener('click', loadNetInfo);
  document.getElementById('btn-exit-compare').addEventListener('click', loadExitCompare);

  // 首次加载网络信息（后台静默）
  loadNetInfo();
}

export { initNetwork };
