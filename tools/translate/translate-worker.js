/**
 * 离线翻译 Worker
 *
 * 模型在 Worker 内运行，避免推理阻塞主线程。首次由 Transformers.js 下载
 * 到浏览器 Cache Storage，之后离线可用；文本只留在本地，不上传服务器。
 *
 * 协议：
 *   入 { type: 'init'|'translate'|'preload', text?, direction?, host?, seq? }
 *   出 { type: 'log'|'progress'|'seg'|'token'|'model-ready'|'result'|'error', ... }
 *     - seg  { index, total }  多块翻译时的进度
 *     - token { text }         流式译文片段，主线程按顺序拼接
 *
 * 架构说明：用 opus-mt（MarianMT，~74M 参数，q8 后约 28MB/方向）。
 * 考虑过 NLLB-200-distilled-600M（质量更好），但 q8 也要 850MB+，
 * 网页场景不可接受，故维持 opus-mt。
 */
import { pipeline, env, TextStreamer } from '@huggingface/transformers';

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

/** 判断文本主语言：有汉字视为中文，否则英文。
 *  注意：worker 入口文件顶层不要写 export —— rolldown 对带 export 的
 *  worker 入口走另一条打包路径，npm 依赖不会内联进产物，运行时直接报
 *  变量未定义（实测踩过；asr/llm/hash 等无 export 的 worker 均正常）。 */
function detectDirection(text) {
  return /[\u3400-\u9fff]/.test(text) ? 'zh-en' : 'en-zh';
}

/**
 * 把一个段落切成不超过 maxChars 的翻译块。
 * opus-mt 对超长输入会截断（模型位置编码限制），按句子边界切块；
 * 句号/问号/感叹号等留在句尾，不丢标点。
 */
function chunkParagraph(text, maxChars = 380) {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.。！!？?；;]+[.。！!？?；;]*\s*/g) || [text];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    // 单句超长只能硬切（极罕见：无标点的长串）
    if (s.length > maxChars) {
      if (cur) { chunks.push(cur.trim()); cur = ''; }
      for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars));
      continue;
    }
    if ((cur + s).length > maxChars) { chunks.push(cur.trim()); cur = s; }
    else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

/** 生成上限按输入长度定：过短浪费生成时间，过长截断译文 */
function maxTokensFor(text) {
  // 中文约 1 字/token，英文约 0.3 词/token；留 1.6 倍余量 + 起止开销
  return Math.min(512, Math.max(64, Math.ceil(text.length * 1.6) + 32));
}

async function translate(text, direction, seq) {
  const pipe = await ensurePipe(direction);

  // 按段落保持原文结构；段内按句子切块，逐块翻译并流式送出
  const paragraphs = text.split('\n');
  const chunksPerPara = paragraphs.map((p) => (p.trim() ? chunkParagraph(p) : null));
  const total = chunksPerPara.reduce((n, c) => n + (c ? c.length : 0), 0);

  let outIndex = 0;
  const outputs = [];
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const chunks = chunksPerPara[pi];
    if (!chunks) { outputs.push(''); continue; }
    const translated = [];
    for (const chunk of chunks) {
      post('seg', { seq, index: outIndex + 1, total, direction });
      let acc = '';
      const streamer = new TextStreamer(pipe.tokenizer, {
        skip_special_tokens: true,
        callback_function: (t) => {
          if (!t) return;
          acc += t;
          post('token', { seq, text: t });
        },
      });
      const out = await pipe(chunk, { max_new_tokens: maxTokensFor(chunk), streamer });
      translated.push((acc || out?.[0]?.translation_text || '').trim());
      outIndex++;
    }
    outputs.push(translated.join(' '));
    // 段落之间的换行在流式输出里补上（最后一段之后不补）
    if (pi < paragraphs.length - 1) post('token', { seq, text: '\n' });
  }
  return outputs.join('\n');
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
      const out = await translate(text, direction, msg.seq);
      post('result', { text: out, direction, seq: msg.seq });
      return;
    }
  } catch (err) {
    post('error', { message: String((err && err.message) || err) });
  }
};
