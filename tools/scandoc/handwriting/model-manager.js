/**
 * 去手写模型：懒加载与缓存管理
 *
 * 设计要点：
 *  1. 首屏零加载——本模块的静态 import 只有 URL，不含模型内容与运行时；
 *  2. 用户主动点击「开始擦除」后才按需拉取 ONNX 运行时与模型；
 *  3. 模型字节存 Cache Storage，二次访问直接命中，离线也能用；
 *  4. 每次读取都做 SHA-256 校验，损坏的缓存会被删除并允许重试。
 */
import modelUrl from './models/migan.onnx?url';
import ortWasmUrl from './runtime/ort-wasm-simd-threaded.wasm?url';
import ortMjsUrl from './runtime/ort-wasm-simd-threaded.mjs?url';

/** 模型指纹：与 models/migan.onnx.sha256 一致，版本变更时同步更新 */
export const MODEL_INFO = {
  name: 'MI-GAN（移动图像修复 GAN）',
  purpose: '按掩码修复被笔迹覆盖的背景',
  license: 'MIT（Picsart AI Research, ICCV 2023）',
  size: 28079181,
  sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
};

/** 推理运行时体积（onnxruntime-web CPU 版，不含 WebGPU） */
const RUNTIME_BYTES = { wasm: 13_600_000, mjs: 60_000 };

const CACHE_NAME = 'inkerase-models-v1';
const MODEL_CACHE_KEY = new Request(new URL(modelUrl, location.href).href);

/** 运行时资源体积之和（用于展示总下载量） */
export const RUNTIME_SIZE = RUNTIME_BYTES.wasm + RUNTIME_BYTES.mjs;

/* ========== 缓存读写 ========== */

async function openCache() {
  return caches.open(CACHE_NAME);
}

/** 模型是否已在缓存中且通过校验 */
export async function isModelCached() {
  if (!('caches' in self)) return false;
  try {
    const cache = await openCache();
    const hit = await cache.match(MODEL_CACHE_KEY);
    return !!hit;
  } catch {
    return false;
  }
}

/** 申请持久化存储（浏览器可能拒绝，失败不影响功能） */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** 计算 SHA-256（十六进制） */
async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 确保模型可用：命中缓存则直接返回 ArrayBuffer，否则下载并写入缓存
 * @param {(loaded:number,total:number)=>void} onProgress 下载进度回调
 * @returns {Promise<ArrayBuffer>}
 */
export async function ensureModel(onProgress) {
  // 1. 优先读缓存
  if ('caches' in self) {
    try {
      const cache = await openCache();
      const hit = await cache.match(MODEL_CACHE_KEY);
      if (hit) {
        const buf = await hit.arrayBuffer();
        onProgress?.(buf.byteLength, buf.byteLength);
        if (await sha256Hex(buf) === MODEL_INFO.sha256) {
          return buf;
        }
        // 校验失败：清掉坏缓存重新下载
        await cache.delete(MODEL_CACHE_KEY);
      }
    } catch {
      // 缓存不可用时退回直接下载
    }
  }

  // 2. 从站点自身下载（模型与页面同源，不经过任何第三方）
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`模型下载失败（HTTP ${res.status}）`);

  const total = Number(res.headers.get('content-length')) || MODEL_INFO.size;
  const reader = res.body?.getReader();
  let buf;
  if (reader) {
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
    buf = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    buf = buf.buffer;
  } else {
    buf = await res.arrayBuffer();
  }

  // 3. 完整性校验：不通过就报错，绝不把坏文件当模型用
  const hash = await sha256Hex(buf);
  if (hash !== MODEL_INFO.sha256) {
    throw new Error('模型完整性校验失败（文件可能下载不完整），请重试');
  }

  // 4. 写入缓存供下次使用
  if ('caches' in self) {
    try {
      const cache = await openCache();
      await cache.put(MODEL_CACHE_KEY, new Response(buf, {
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
    } catch {
      // 存储配额不足等：本次仍可继续使用，只是不再缓存
    }
  }
  return buf;
}

/** 清除模型缓存 */
export async function clearModelCache() {
  if (!('caches' in self)) return;
  try {
    const cache = await openCache();
    await cache.delete(MODEL_CACHE_KEY);
  } catch {
    // 忽略
  }
}

/** 推理运行时的 wasm 路径配置（交给 Worker 使用） */
export function runtimeWasmPaths() {
  // ?url 导入的已经是构建后的绝对地址，直接用，不要再基于 location 拼接
  return { wasm: ortWasmUrl, mjs: ortMjsUrl };
}

export { modelUrl };