/**
 * zxing-wasm 解码后端（惰性加载）
 *
 * 为什么需要它：主解码管线（assets/js/qr-decoder.js）走的是「检测定位图案 →
 * 全局单应性矫正 → 重采样 → jsQR」路线。几何误差会沿单应性累积，
 * 在低模块密度（每模块不足 2 像素）或强透视下会静默失败。
 *
 * zxing-cpp 用的是另一套采样策略：定位后按模块网格局部采样，
 * 对几何形变更宽容。两者在实测中互补 —— 主管线能读出的强弯曲码
 * zxing 读不出，zxing 能读出的极小码主管线读不出。
 *
 * 工程要点：
 *   1. 惰性动态 import：首屏不加载，只在主管线失败时才拉起来。
 *   2. wasm 走本地资源（?url 导入 + locateFile 覆盖），
 *      不走 jsDelivr CDN —— 这是纯前端离线工具，不能依赖外网。
 *   3. wasm 体积 947KB（gzip 约 411KB），reader-only 版本，
 *      已排除 writer 代码。
 */

/** zxing-wasm 的模块级实例缓存（避免重复编译 wasm） */
let zxingModule = null;
/** 正在加载的 promise（并发调用时复用同一次加载） */
let zxingLoading = null;
/** 加载失败标记：失败后不再重试，避免每次识别都卡几秒 */
let zxingFailed = false;

/**
 * 加载 zxing reader 模块。
 *
 * @returns {Promise<{readBarcodes: Function} | null>} 失败返回 null，不抛异常
 */
export async function loadZxing() {
  if (zxingModule) return zxingModule;
  if (zxingFailed) return null;
  if (zxingLoading) return zxingLoading;

  zxingLoading = (async () => {
    try {
      // 两个 import 并行发起：wasm 二进制与 JS 胶水层
      const [zx, wasm] = await Promise.all([
        import('zxing-wasm/reader'),
        import('zxing-wasm/reader/zxing_reader.wasm?url'),
      ]);
      // 覆盖默认的 jsDelivr CDN 定位，强制从本站资源加载 wasm。
      // 默认行为在离线环境与国内网络下都会失败。
      zx.prepareZXingModule({
        overrides: { locateFile: () => wasm.default },
      });
      zxingModule = zx;
      return zx;
    } catch {
      zxingFailed = true;
      return null;
    } finally {
      zxingLoading = null;
    }
  })();

  return zxingLoading;
}

/** 预热：在用户空闲时提前把 wasm 拉下来并编译，摊掉首次的加载延迟 */
export function prewarmZxing() {
  if (zxingModule || zxingLoading || zxingFailed) return;
  // 用 requestIdleCallback 之类的方式延后，避免抢占首屏资源。
  // 这里用 setTimeout 兜底：Safari 不支持 requestIdleCallback。
  // 额外延迟 1.5 秒是刻意选的：给首屏渲染与布局留出时间，
  // 又不至于让用户等到真正识别时 wasm 还没就绪。
  const idle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (fn) => setTimeout(fn, 1);
  setTimeout(() => idle(() => { loadZxing(); }), 1500);
}

/**
 * 用 zxing 解码一张 ImageData。
 *
 * @param {ImageData} imageData
 * @param {object} opts
 *   tryHarder   开启重试模式（旋转、反色等）
 * @returns {Promise<string | null>} 解出的文本，失败返回 null
 */
export async function decodeWithZxing(imageData, opts = {}) {
  const zx = await loadZxing();
  if (!zx) return null;

  try {
    const res = await zx.readBarcodes(imageData, {
      tryHarder: opts.tryHarder !== false,
      tryRotate: true,
      tryInvert: true,
      formats: opts.formats || ['QRCode'],
    });
    if (res && res[0] && res[0].text) return res[0].text;
  } catch {
    // 解码失败不算致命，调用方会走下一档
  }
  return null;
}
