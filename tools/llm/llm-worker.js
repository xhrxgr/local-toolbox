/**
 * 本地大模型推理 Worker
 *
 * 模型完全在浏览器内运行，对话内容不上传。首次由 Transformers.js 下载到
 * Cache Storage，之后可离线使用。
 *
 * 协议：
 *   入 { type: 'load'|'generate'|'reset', model?, prompt?, maxTokens?, host? }
 *   出 { type: 'log'|'progress'|'model-ready'|'token'|'done'|'error', ... }
 */
import { pipeline, env, TextStreamer } from '@huggingface/transformers';

const MODELS = {
  qwen: {
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    label: 'Qwen2.5-0.5B',
    dtype: 'q4f16',
  },
  smollm: {
    id: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    label: 'SmolLM2-135M',
    dtype: 'q4f16',
  },
};
const HOST_OFFICIAL = 'https://huggingface.co';

let generator = null;
let currentKey = null;
let loadPromise = null;
let messages = [];          // 对话上下文 [{role, content}]
let currentStreamText = '';
let host = HOST_OFFICIAL;

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

function setupEnv() {
  env.allowLocalModels = false;
  env.remoteHost = host;
  env.useBrowserCache = true;
  env.useWasmCache = false; // WASM 由 SW 缓存，不重复存
  const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '');
  const wasmBase = `${self.location.origin}${base}/asr-runtime/`;
  // LLM 页不在 COI 白名单内（隔离会拦掉 HuggingFace 模型下载），
  // 所以始终用 asyncify 单线程版本。模型已尽量选小的（q4f16），
  // 135M 实测生成一段回复约 5~9 秒。
  const wasmFile = 'ort-wasm-simd-threaded.asyncify';
  env.backends.onnx.wasm.wasmPaths = {
    wasm: wasmBase + wasmFile + '.wasm',
    mjs: wasmBase + wasmFile + '.mjs',
  };
  env.backends.onnx.wasm.numThreads = 1;
  return { isolated, threads: env.backends.onnx.wasm.numThreads };
}

async function ensureModel(key, requestedHost) {
  if (requestedHost && requestedHost !== host) {
    host = requestedHost;
    generator = null;
    currentKey = null;
    loadPromise = null;
  }
  if (generator && currentKey === key) return generator;
  if (loadPromise) return loadPromise;

  const cfg = MODELS[key] || MODELS.qwen;
  const envInfo = setupEnv();
  post('log', {
    message: `正在加载 ${cfg.label}（单线程 WASM，约 ${(cfg.dtype === 'q4f16' ? '112~460' : '300')}MB）…`,
  });

  loadPromise = pipeline('text-generation', cfg.id, {
    dtype: cfg.dtype,
    device: 'wasm',
    progress_callback: (e) => {
      if (e.status === 'progress' && typeof e.progress === 'number') {
        post('progress', { file: e.file || '', progress: e.progress });
      } else if (e.status === 'done') {
        post('progress', { file: e.file || '', progress: 100, done: true });
      }
    },
  }).then((pipe) => {
    generator = pipe;
    currentKey = key;
    loadPromise = null;
    post('model-ready', { model: key, label: cfg.label });
    return pipe;
  }).catch((err) => {
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

/** 用 tokenizer 内置的 chat 模板拼提示词，避免手写标记与模型模板不一致 */

async function generate(prompt, maxTokens) {
  const tokenizer = generator.tokenizer;
  currentStreamText = '';
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => {
      // 模型可能吐出下一轮的 user/assistant 标记，到此截断
      const cut = text.search(/<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|\nuser\s*\n/);
      const clean = cut >= 0 ? text.slice(0, cut) : text;
      if (!clean) return;
      currentStreamText += clean;
      post('token', { text: clean });
    },
  });
  await generator(prompt, {
    max_new_tokens: maxTokens,
    do_sample: true,
    temperature: 0.7,
    top_p: 0.9,
    streamer,
  });
  // 流式回调已把完整回复发给主线程，这里只回一个结束信号
  return '';
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'load') {
      await ensureModel(msg.model, msg.host);
      return;
    }
    if (msg.type === 'reset') {
      messages = [];
      post('reset-done');
      return;
    }
    if (msg.type === 'generate') {
      const text = (msg.prompt || '').trim();
      if (!text) return;
      // 按当前模型加载，若切换模型则重新加载
      const key = msg.model || 'qwen';
      await ensureModel(key, msg.host);

      const history = [...messages, { role: 'user', content: text }];
      const prompt = generator.tokenizer.apply_chat_template(history, {
        tokenize: false,
        add_generation_prompt: true,
      });
      post('log', { message: '正在生成…（首次生成会编译计算图，需要等待）' });
      await generate(prompt, msg.maxTokens || 256);

      // 流式输出已逐段发给主线程，这里只把对话历史记下来
      const reply = currentStreamText;
      messages.push({ role: 'user', content: text });
      messages.push({ role: 'assistant', content: reply });
      post('done', { text: reply });
    }
  } catch (err) {
    post('error', { message: String((err && err.message) || err) });
  }
};
