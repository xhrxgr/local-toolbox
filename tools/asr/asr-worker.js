/**
 * ASR 推理 Worker
 *
 * 语音识别跑在独立线程，避免 ONNX 推理阻塞主线程导致界面卡死。
 * 模型由 Transformers.js 下载并缓存在浏览器 Cache Storage，
 * 音频数据只在 Worker 内处理，不上传任何服务器。
 */
import { pipeline, env } from '@huggingface/transformers';
import { ASR_MODEL_ID, ASR_HOST_OFFICIAL } from './model-registry.js';

let transcriber = null;
let loadPromise = null;
let cancelled = false;
let currentModelHost = null;
// Worker 里没有 localStorage：下载源由主线程在 transcribe 消息里传入
let requestedHost = ASR_HOST_OFFICIAL;

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

function log(message) {
  post('log', { message });
}

/**
 * 加载模型。
 * 模型下载慢（首次约 40MB），因此缓存 loadPromise：
 * 多次调用共用同一次加载，且失败后允许重试。
 */
async function ensureModel() {
  if (transcriber) return transcriber;
  if (loadPromise) return loadPromise;

  const host = requestedHost || ASR_HOST_OFFICIAL;
  // Transformers.js 用 remoteHost 拼接模型文件路径。
  // 官方源与镜像源的路径规则一致，只是域名不同。
  env.allowLocalModels = false;
  env.remoteHost = host;
  env.useBrowserCache = true;   // 模型走 Cache API（库自己管）
  // WASM 由 SW 的 SWR 策略缓存（同源无 hash 资源），
  // 关掉库自带的 WASM 缓存，避免同一份 26MB 存两遍撑爆配额。
  env.useWasmCache = false;
  // WASM 运行时走站点同源（构建时从 Transformers.js 自带的 ORT 同步到
  // public/asr-runtime/，Vite 原样拷进 dist），避免依赖 jsdelivr CDN。
  // 用 BASE_URL 适配 GitHub Pages 的 /local-toolbox/ 子路径。
  const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '');
  const wasmBase = `${self.location.origin}${base}/asr-runtime/`;

  // 跨源隔离（public/sw.js 的 COI_PATHS 给 ASR 页注入 COOP/COEP）→ threaded
  // 多线程 WASM，用 SharedArrayBuffer 并行推理；否则 → asyncify 单线程回退。
  //
  // 关键前提（2026-11-12 实测踩坑，详见 .workbuddy/memory/2026-11-12.md）：
  // ORT 的 threaded wasm 会创建 em-pthread 子 Worker，其脚本用
  // `new Worker(new URL(import.meta.url), { type: 'module' })` 自引用加载。
  // 必须让这个子 Worker 的响应也带 COEP 头，否则 ERR_BLOCKED_BY_RESPONSE。
  // 所以 SW 给白名单页的「所有响应」注入 COEP（含 Worker 脚本）——
  // 早期只给导航注入、漏掉子 Worker，才误判为「SW+COEP 不兼容」。
  const isolated = self.crossOriginIsolated === true;
  const wasmFile = isolated ? 'ort-wasm-simd-threaded' : 'ort-wasm-simd-threaded.asyncify';
  env.backends.onnx.wasm.wasmPaths = {
    wasm: wasmBase + wasmFile + '.wasm',
    mjs: wasmBase + wasmFile + '.mjs',
  };
  // 线程数上限 4 是实测最优点，不要「优化」成更高：
  //   1 线程 1295ms / 2 线程 926ms / 4 线程 720-782ms / 8 线程 777ms
  // （8 线程反而略慢，见 tools/asr/bench.html 的基准方法）
  const threads = isolated
    ? Math.min(4, Math.max(1, Math.ceil((self.navigator?.hardwareConcurrency || 2) / 2)))
    : 1;
  env.backends.onnx.wasm.numThreads = threads;

  // 设备选择按实测数据定，不要改成「隔离时优先 WebGPU」：
  //   WASM 4 线程 720-782ms < WebGPU 1037-1158ms < WASM 单线程 1229-1295ms
  //   （Whisper-tiny q8、2 秒音频、NVIDIA Ampere + 12 核，独立页面重复测量）
  // 隔离时 GPU 反而更慢，且加载慢 3-5 倍；ORT 的 WebGPU 后端也需要
  // asyncify wasmPaths，与 threaded wasmPaths 冲突（webgpuInit is not a function）。
  // 非隔离时拿不到 SharedArrayBuffer，只能用 WebGPU 或单线程 WASM。
  const useWebGpu = !isolated && typeof navigator !== 'undefined' && !!navigator.gpu;
  log(isolated
    ? `跨源隔离已生效，WASM ${threads} 线程并行推理`
    : useWebGpu ? '检测到 WebGPU，使用 GPU 加速' : 'WASM 单线程推理');

  loadPromise = pipeline(
    'automatic-speech-recognition',
    ASR_MODEL_ID,
    {
      dtype: 'q8',
      device: useWebGpu ? 'webgpu' : 'wasm',
      progress_callback: (p) => {
        if (cancelled) return;
        if (p.status === 'progress' && typeof p.progress === 'number') {
          post('progress', { file: p.file || '', progress: p.progress });
        } else if (p.status === 'done') {
          post('file-done', { file: p.file || '' });
        } else if (p.status === 'initiate') {
          post('file-start', { file: p.file || '' });
        }
      },
    }
  ).then((pipe) => {
    transcriber = pipe;
    currentModelHost = host;
    loadPromise = null;
    post('model-ready', { webgpu: useWebGpu, host });
    return pipe;
  }).catch((err) => {
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

/**
 * 转写音频。
 * @param {Float32Array} audio 16kHz 单声道采样
 * @param {object} opts { language: 'chinese'|'english'|null, task }
 */
async function transcribe(audio, opts = {}) {
  cancelled = false;
  const pipe = await ensureModel();
  if (cancelled) throw new Error('cancelled');

  post('status', { message: '正在识别语音…' });
  const started = performance.now();

  // 分块处理长音频，块间重叠 5 秒保持语义连续
  const result = await pipe(audio, {
    language: opts.language || null,
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  if (cancelled) throw new Error('cancelled');
  post('status', { message: `识别完成（${Math.round(performance.now() - started)}ms）` });
  return result;
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};

  if (type === 'cancel') {
    cancelled = true;
    post('cancelled', { id });
    return;
  }

  if (type === 'reset') {
    // 用户切换下载源后，丢弃旧实例重新加载
    transcriber = null;
    loadPromise = null;
    cancelled = false;
    post('reset-done', { id });
    return;
  }

  if (type !== 'transcribe') return;

  try {
    if (payload.host && payload.host !== requestedHost) {
      // 下载源变了：丢弃旧实例，让 ensureModel 用新源重新加载
      transcriber = null;
      loadPromise = null;
      requestedHost = payload.host;
    }
    // payload.audio 是 Float32Array，结构化克隆时按值传递
    const result = await transcribe(payload.audio, payload.options || {});
    post('result', {
      id,
      text: result?.text ?? '',
      chunks: result?.chunks ?? null,
      language: result?.language ?? null,
      host: currentModelHost,
    });
  } catch (err) {
    if (cancelled || err?.message === 'cancelled') {
      post('cancelled', { id });
    } else {
      post('error', { id, message: String(err?.message || err), stack: String(err?.stack || '').slice(0, 800) });
    }
  }
};
