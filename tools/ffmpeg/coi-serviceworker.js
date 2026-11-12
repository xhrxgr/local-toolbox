/* 历史 coi-serviceworker 的清理脚本
 *
 * 早期版本（提交 fa81e00）曾用 coi-serviceworker 在 GitHub Pages 上补发
 * COOP/COEP 头。那个 SW 注册在 /tools/ffmpeg/ 下，与站点全局缓存 SW
 * （public/sw.js，scope 为站点根）形成嵌套 scope —— 两个 SW 抢同一批请求，
 * 且旧 SW 强制给所有响应加 COEP: require-corp，反而拦掉了 module worker
 * （提交 da338c2 记录了这次事故）。
 *
 * 现在跨源隔离能力已合并进全局 SW（见 public/sw.js 的 COI_PATHS），
 * 本文件只负责：历史浏览器下次更新到这里时，注销旧的嵌套 SW、清掉它的缓存，
 * 然后重新加载页面，让全局 SW 接管。新访客不会注册本脚本。
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