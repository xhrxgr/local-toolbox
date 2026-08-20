/* 兼容性清理脚本
 * 旧版本页面通过 coi-serviceworker 在 GitHub Pages 上补发 COOP/COEP 头以实现跨源隔离。
 * 现改用单线程 FFmpeg 内核（不依赖 SharedArrayBuffer），已不再需要跨源隔离，
 * 且旧 SW 固定给响应加的 COEP 头反而会导致 Chrome 拦截内核资源。
 * 此文件放在与旧 SW 相同的路径，浏览器下次更新时会用本脚本替换旧 SW，
 * 随即清理缓存并自我注销，使历史访问过的浏览器脱离 SW 控制。
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await clients.matchAll({ includeUncontrolled: true });
    await Promise.all(clients.map((c) => c.navigate(c.url)));
  })());
});