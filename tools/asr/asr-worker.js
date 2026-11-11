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
  // WASM 已放站点同源，由 SW 的 SWR 策略缓存。
  // 关掉库自带的 WASM 缓存，避免同一份 26MB 存两遍撑爆配额。
  env.useWasmCache = false;
  env.backends.onnx.wasm.proxy = true; // 让 ONNX 在 worker 内跑，不阻塞

  // WASM 运行时走站点同源（构建时从 Transformers.js 自带的 ORT 同步到
  // public/asr-runtime/，Vite 原样拷进 dist），避免依赖 jsdelivr CDN。
  // 用 BASE_URL 适配 GitHub Pages 的 /local-toolbox/ 子路径。
  const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '');
  const wasmBase = `${self.location.origin}${base}/asr-runtime/`;
  env.backends.onnx.wasm.wasmPaths = {
    wasm: wasmBase + 'ort-wasm-simd-threaded.asyncify.wasm',
    mjs: wasmBase + 'ort-wasm-simd-threaded.asyncify.mjs',
  };

  const useWebGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  log(useWebGpu ? '检测到 WebGPU，优先使用 GPU 加速' : '使用 WASM 推理（无需跨源隔离）');

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
