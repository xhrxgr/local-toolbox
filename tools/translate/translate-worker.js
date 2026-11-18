/**
 * 离线翻译 Worker
 *
 * 模型在 Worker 内运行，避免推理阻塞主线程。首次由 Transformers.js 下载
 * 到浏览器 Cache Storage，之后离线可用；文本只留在本地，不上传服务器。
 *
 * 协议：
 *   入 { type: 'init'|'translate'|'preload', text?, direction?, host? }
 *   出 { type: 'log'|'progress'|'model-ready'|'result'|'error', ... }
 */
import { pipeline, env } from '@huggingface/transformers';

const MODEL_ZH_EN = 'Xenova/opus-mt-zh-en';
const MODEL_EN_ZH = 'Xenova/opus-mt-en-zh';
const HOST_OFFICIAL = 'https://huggingface.co';

const pipes = new Map();     // direction -> pipeline
const loading = new Map();   // direction -> Promise
let host = HOST_OFFICIAL;

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

/** 复用 ASR 的同源 WASM 运行时，避免依赖外部 CDN */
function setupEnv() {
  env.allowLocalModels = false;
  env.remoteHost = host;
  env.useBrowserCache = true;
  env.useWasmCache = false; // WASM 走 SW 的缓存策略，不重复存一份
  const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '');
  const wasmBase = `${self.location.origin}${base}/asr-runtime/`;
  // 翻译页不在 COI 白名单里，用 asyncify 单线程版本（无需 SharedArrayBuffer）
  env.backends.onnx.wasm.wasmPaths = {
    wasm: wasmBase + 'ort-wasm-simd-threaded.asyncify.wasm',
    mjs: wasmBase + 'ort-wasm-simd-threaded.asyncify.mjs',
  };
  env.backends.onnx.wasm.numThreads = 1;
}

function modelId(direction) {
  return direction === 'en-zh' ? MODEL_EN_ZH : MODEL_ZH_EN;
}

async function ensurePipe(direction, requestedHost) {
  if (requestedHost && requestedHost !== host) {
    host = requestedHost;
    // host 变了要重建，否则 env.remoteHost 仍指向旧地址
    pipes.clear();
    loading.clear();
  }
  if (pipes.has(direction)) return pipes.get(direction);
  if (loading.has(direction)) return loading.get(direction);

  setupEnv();
  const id = modelId(direction);
  post('log', { message: `正在加载 ${direction === 'en-zh' ? '英→中' : '中→英'} 模型（首次需要下载）…` });

  const p = pipeline('translation', id, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (e) => {
      if (e.status === 'progress' && typeof e.progress === 'number') {
        post('progress', { file: e.file || '', progress: e.progress, direction });
      } else if (e.status === 'done') {
        post('progress', { file: e.file || '', progress: 100, direction, done: true });
      }
    },
  }).then((pipe) => {
    pipes.set(direction, pipe);
    loading.delete(direction);
    post('model-ready', { direction });
    return pipe;
  }).catch((err) => {
    loading.delete(direction);
    throw err;
  });

  loading.set(direction, p);
  return p;
}

/** 判断文本主语言：有汉字视为中文，否则英文 */
export function detectDirection(text) {
  return /[\u3400-\u9fff]/.test(text) ? 'zh-en' : 'en-zh';
}

async function translate(text, direction) {
  const pipe = await ensurePipe(direction);
  // opus-mt 对超长句会截断，按行分段翻译后拼回
  const lines = text.split('\n');
  const results = [];
  for (const line of lines) {
    if (!line.trim()) { results.push(''); continue; }
    const out = await pipe(line, { max_new_tokens: 512 });
    results.push(out?.[0]?.translation_text ?? '');
  }
  return results.join('\n');
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'init' || msg.type === 'preload') {
      const dirs = msg.direction && msg.direction !== 'auto'
        ? [msg.direction]
        : ['zh-en', 'en-zh'];
      for (const d of dirs) await ensurePipe(d, msg.host);
      post('ready');
      return;
    }
    if (msg.type === 'translate') {
      const text = (msg.text || '').trim();
      if (!text) { post('result', { text: '' }); return; }
      const direction = msg.direction && msg.direction !== 'auto'
        ? msg.direction
        : detectDirection(text);
      post('log', { message: `正在翻译（${direction === 'en-zh' ? '英→中' : '中→英'}）…` });
      const out = await translate(text, direction);
      post('result', { text: out, direction, seq: msg.seq });
      return;
    }
  } catch (err) {
    post('error', { message: String((err && err.message) || err) });
  }
};
