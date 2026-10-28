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

/* 带内容 hash 的静态资源：路径中含 8 位以上 hash 串 + 已知静态扩展名。
   bat/cmd/ps1 是实用脚本页的分发文件（tools/scripts/），
   同样由构建产出、文件名带 hash —— 漏掉它们会走 SWR，
   实测在 Service Worker 控制下页面内 fetch 得到 204 空响应，
   卡片上的文件大小显示不出来，下载路径也因此不稳。 */
const HASHED_ASSET_RE = /[.-][A-Za-z0-9_-]{8,}\.(?:js|mjs|css|woff2?|png|jpe?g|gif|svg|webp|ico|wasm|data|onnx|txt|bat|cmd|ps1)$/i;

/* 跨域可缓存资源类型（ffmpeg core 的 .wasm/.js、tesseract 的 .traineddata.gz 等） */
const CROSS_ORIGIN_ASSET_RE = /\.(?:js|mjs|wasm|data|onnx|traineddata|traineddata\.gz|gz|json|zip)(?:[?#]|$)/i;

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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // 1. 页面导航：网络优先，失败回退缓存
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  if (url.origin === self.origin) {
    // SW 脚本自身不缓存：浏览器对 SW 脚本有独立更新机制，
    // 混进业务缓存只会在管理列表里造成困惑
    if (url.pathname.endsWith('/sw.js')) return;

    // 2/3. 同源静态资源：hash 文件缓存优先，其余 SWR
    if (HASHED_ASSET_RE.test(url.pathname)) {
      event.respondWith(cacheFirst(req));
    } else {
      event.respondWith(staleWhileRevalidate(req));
    }
    return;
  }

  // 4. 跨域 CDN 资源：缓存优先；其余跨域请求不拦截
  if (CROSS_ORIGIN_ASSET_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirstNavigation(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    // 只缓存成功响应，避免把 404 页写进缓存
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // 深层页面未缓存过：回退到缓存的首页，用户可从首页进入已缓存的工具
    const home = await cache.match(new URL('./', self.registration.scope), { ignoreSearch: true });
    if (home) return home;
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
