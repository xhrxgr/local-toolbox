/* 静态资源本地缓存 Service Worker
 *
 * 目标：首次访问后把静态资源缓存到本地，二次访问（含中国访问 GitHub Pages）
 * 直接从本地读取；同时保证线上更新后用户拿到的永远是最新内容。
 *
 * 策略（按请求类型分流）：
 * 1. 页面导航（HTML）：网络优先，网络失败才回退缓存。
 *    —— 保证页面内容永远最新（部署后刷新即生效），离线时仍可打开已访问过的页面
 * 2. 同源带内容 hash 的资源（assets/main-CGMe-iIS.js、migan-xxx.onnx 等）：
 *    缓存优先，不发起网络请求。hash 即内容寻址，文件永不变，无需校验
 * 3. 同源无 hash 资源（favicon.svg 等）：stale-while-revalidate，
 *    先返回缓存，后台拉取最新版替换
 * 4. 跨域 CDN 资源（ffmpeg core / tesseract worker·core·语言数据）：
 *    缓存优先。代码里按版本号锁定 URL，内容不可变，与同源 hash 资源同理
 *
 * 跨源隔离（COOP/COEP）：
 * - 只对 COI_PATHS 白名单里的页面注入响应头（当前：ASR 页），
 *   其他页面完全不走注入分支。原因：COEP 会拦掉 no-cors 的跨域子资源，
 *   白名单之外的工具不该承担这个风险。
 * - 必须给白名单页的「所有响应」注入，包括 Worker 脚本本身 ——
 *   只给导航注入会让隔离页创建 Worker 时全部被拦（实测，见下方注释）。
 * - 用 credentialless 而非 require-corp：huggingface.co 的模型响应
 *   Access-Control-Allow-Origin 是 https://huggingface.co（非 *），
 *   require-corp 下会被拦；credentialless 实测可正常加载模型与
 *   ffmpeg core / tesseract 语言包。
 * - 首次访问时 SW 还没接管页面，需要 reload 一次才能让隔离生效；
 *   reload 逻辑在 assets/js/common.js 的 setupCrossOriginIsolation()。
 * - 这是从独立 coi-serviceworker 合并进来的能力：一个 SW 同时管缓存与隔离，
 *   避免两个 SW 抢同一 scope（历史上因此踩过坑，见提交 da338c2）。
 *
 * 缓存管理：
 * - 缓存名带 SW_VERSION，activate 时删除旧版本缓存（改策略时升版本号即可全量刷新）
 * - 条目数超 MAX_ENTRIES 时按插入序淘汰最旧的，防止反复部署后旧 hash 无限堆积
 *
 * 注意：本文件在 public/ 下原样拷贝到站点根目录，不能被 Vite 加 hash。
 * 仅在 production 注册（见 assets/js/common.js），dev 模式不注册。
 */

const SW_VERSION = 'v2';
const CACHE_NAME = `toolbox-${SW_VERSION}`;
const MAX_ENTRIES = 250;

/* 需要跨源隔离的页面路径前缀（相对站点根，不含 base 前缀）。
   默认空数组 = 全站不启用。

   当前 ASR 页启用，为将来接入 sherpa-onnx 流式识别铺路（SharedArrayBuffer）。
   关键实现约束（2026-11-12 实测，详见 .workbuddy/memory/2026-11-12.md）：
   必须给「白名单页的所有响应」注入 COOP/COEP —— 包括 Worker 脚本本身。
   早期只给页面导航注入、漏掉 Worker 脚本，导致隔离页创建 Worker 时
   全部 ERR_BLOCKED_BY_RESPONSE，一度误判为「SW + COEP 不兼容」。
   改成全响应注入后，同源 Worker、HF 模型、ffmpeg core、tesseract 语言包
   实测均正常；只有 no-cors 的跨域 script 会被拦（项目里没有这种用法）。
   其他页面完全不走注入分支，行为与合并前一致。 */
const COI_PATHS = ['/tools/asr/', '/tools/ffmpeg/'];
const COI_MODE = 'credentialless';

/* 带内容 hash 的静态资源：路径中含 8 位以上 hash 串 + 已知静态扩展名。
   bat/cmd/ps1 是实用脚本页的分发文件（tools/scripts/），
   同样由构建产出、文件名带 hash —— 漏掉它们会走 SWR，
   实测在 Service Worker 控制下页面内 fetch 得到 204 空响应，
   卡片上的文件大小显示不出来，下载路径也因此不稳。 */
const HASHED_ASSET_RE = /[.-][A-Za-z0-9_-]{8,}\.(?:js|mjs|css|woff2?|png|jpe?g|gif|svg|webp|ico|wasm|data|onnx|txt|bat|cmd|ps1)$/i;

/* 跨域可缓存资源类型（ffmpeg core 的 .wasm/.js、tesseract 的 .traineddata.gz 等） */
const CROSS_ORIGIN_ASSET_RE = /\.(?:js|mjs|wasm|data|onnx|traineddata|traineddata\.gz|gz|json|zip)(?:[?#]|$)/i;

/* Transformers.js 自己用 Cache API 缓存 Whisper 模型（键就是文件 URL），
   SW 若再缓存一份会重复占 40MB，容易撑爆配额。
   这些请求交给库自己管理，SW 不拦截。 */
const TRANSFORMERS_MODEL_RE = /(?:huggingface\.co|hf-mirror\.(?:com|net))\/(?:onnx-community|Xenova)\//i;

/* 离线且无对应缓存时的兜底页 */
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>离线 - 网页工具箱</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0;
         display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  .box { max-width: 420px; padding: 24px; text-align: center; }
  h1 { font-size: 18px; margin: 0 0 12px; font-weight: 600; }
  p { color: #94a3b8; font-size: 14px; line-height: 1.7; margin: 0; }
</style>
</head>
<body>
  <div class="box">
    <h1>当前处于离线状态</h1>
    <p>该页面尚未缓存到本地。恢复网络连接后重试；已访问过的页面在离线时也可打开。</p>
  </div>
</body>
</html>`;

self.addEventListener('install', () => {
  // 立即接管，不等旧 SW 控制下的页面关闭
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 删除旧版本缓存（SW_VERSION 变更时全量清理）
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** 这个请求是否属于需要跨源隔离的页面。
 *
 *  难点：Worker 里创建的子 Worker，其 clientId 指向「父 Worker」而不是页面。
 *  ORT 的 threaded wasm 会在 Worker 内用
 *  `new Worker(new URL(import.meta.url))` 创建 em-pthread 子 Worker，
 *  这个子 Worker 的脚本请求（asr-runtime/*.mjs）若不带 COEP 就会被拦。
 *
 *  所以除了「发起者页面在白名单」，还要认两类 ASR 专属资源：
 *  1. 请求 URL 本身在 asr-runtime/ 下（wasm / mjs）
 *  2. 发起者本身是 asr-worker（Worker 内发起的子请求）
 *  这些资源只有 ASR 页会用，给它们注入 COEP 不会影响其他工具。
 */
const ASR_RUNTIME_RE = /\/asr-runtime\//;
const ASR_WORKER_RE = /\/asr-worker-[\w-]+\.js$/;
// ffmpeg 多线程内核的 pthread 子 Worker 与 @ffmpeg/ffmpeg 的 classWorkerURL
// 都不在页面路径下，clientId 指向父 Worker，必须按资源路径单独认。
const FFMPEG_RUNTIME_RE = /\/ffmpeg-runtime\//;
const FFMPEG_WORKER_RE = /ffmpeg-core\.worker\.js$|@ffmpeg\/|ffmpeg-core\.js$/;

async function isCoiRequest(event, url) {
  if (!COI_PATHS.length) return false;
  if (event.request.mode === 'navigate') return needsCoi(url);
  if (ASR_RUNTIME_RE.test(url.pathname) || FFMPEG_RUNTIME_RE.test(url.pathname)) return true;
  if (event.clientId) {
    const client = await self.clients.get(event.clientId);
    if (client) {
      const clientUrl = new URL(client.url);
      if (needsCoi(clientUrl)) return true;
      const p = clientUrl.pathname;
      if (ASR_RUNTIME_RE.test(p) || ASR_WORKER_RE.test(p)
          || FFMPEG_RUNTIME_RE.test(p) || FFMPEG_WORKER_RE.test(p)) return true;
    }
  }
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // 决策：先算缓存策略（同步返回 Promise），再按来源决定是否注入 COEP。
  // 必须在这次 tick 内调用 respondWith，所以把两步包在同一个 Promise 里。
  // 跨域模型文件交给 Transformers.js 自己缓存，SW 不碰（避免 40MB 存两遍）。
  const skipCaching = TRANSFORMERS_MODEL_RE.test(url.href);

  event.respondWith((async () => {
    let response;

    if (req.mode === 'navigate') {
      response = await networkFirstNavigation(req);
    } else if (url.origin === self.origin) {
      if (url.pathname.endsWith('/sw.js')) {
        // SW 脚本自身走浏览器原生更新机制，不缓存也不注入
        return fetch(req);
      }
      response = HASHED_ASSET_RE.test(url.pathname)
        ? await cacheFirst(req)
        : await staleWhileRevalidate(req);
    } else if (!skipCaching && CROSS_ORIGIN_ASSET_RE.test(url.pathname)) {
      response = await cacheFirst(req);
    } else {
      response = await fetch(req);
    }

    // 白名单页的所有响应都要带 COOP/COEP，包括 Worker 脚本 ——
    // 只给导航注入而漏掉 Worker 脚本，会导致隔离页无法创建 Worker
    // （实测 ERR_BLOCKED_BY_RESPONSE，详见 .workbuddy/memory/2026-11-12.md）。
    if (await isCoiRequest(event, url)) return withCoiHeaders(response);
    return response;
  })());
});

/** 站点根路径（GitHub Pages 上是 /local-toolbox/，本地是 /）。
    SW 脚本固定在站点根，用它的 scope 推断即可，不依赖构建时变量。
    注意 registration.scope 是完整 URL，必须取 .pathname 才能和
   request 的 pathname 比较 —— 直接拿 URL 字符串比较永远不匹配。 */
function siteBase() {
  const pathname = new URL(self.registration.scope).pathname;
  return pathname.replace(/\/$/, ''); // 例如 '' 或 '/local-toolbox'
}

/** 这个导航请求是否需要跨源隔离 */
function needsCoi(url) {
  if (!COI_PATHS.length) return false;
  const base = siteBase();
  let path = url.pathname;
  if (base && path.startsWith(base + '/')) path = path.slice(base.length);
  else if (base && path === base) path = '/';
  return COI_PATHS.some((p) => path === p || path.startsWith(p));
}

/** 给响应加上 COOP/COEP 头（返回新 Response，原响应的 body 可继续流式的读） */
function withCoiHeaders(resp) {
  if (!resp) return resp;
  const headers = new Headers(resp.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', COI_MODE);
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

async function networkFirstNavigation(req) {
  const cache = await caches.open(CACHE_NAME);
  const coi = needsCoi(new URL(req.url));
  try {
    const fresh = await fetch(req);
    // 只缓存成功响应，避免把 404 页写进缓存
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return coi ? withCoiHeaders(fresh) : fresh;
  } catch (err) {
    const cached = await cache.match(req);
    // 缓存页也要带头，否则离线打开白名单页时隔离会失效
    if (cached) return coi ? withCoiHeaders(cached) : cached;
    // 深层页面未缓存过：回退到缓存的首页，用户可从首页进入已缓存的工具
    const home = await cache.match(new URL('./', self.registration.scope), { ignoreSearch: true });
    if (home) return coi ? withCoiHeaders(home) : home;
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  // opaque 响应（无 CORS 头的跨域资源）status 为 0，同样缓存
  if (fresh && (fresh.ok || fresh.type === 'opaque')) {
    await trimAndPut(cache, req, fresh.clone());
  }
  return fresh;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const revalidate = fetch(req)
    .then((fresh) => {
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    })
    .catch(() => cached);
  return cached || revalidate;
}

/* 写入缓存并控制条目数：cache.keys() 按插入序返回，超限时淘汰最旧条目。
   线上反复部署会产生新 hash 文件，旧条目在此自然淘汰，不会无限增长。 */
async function trimAndPut(cache, req, response) {
  await cache.put(req, response);
  const keys = await cache.keys();
  if (keys.length > MAX_ENTRIES) {
    const excess = keys.length - MAX_ENTRIES;
    await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
  }
}
