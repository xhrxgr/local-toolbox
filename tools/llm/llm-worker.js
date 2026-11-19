/**
 * 本地大模型推理 Worker
 *
 * 模型完全在浏览器内运行，对话内容不上传。首次由 Transformers.js 下载到
 * Cache Storage，之后可离线使用。
 *
 * 协议：
 *   入 { type: 'load'|'generate'|'reset'|'local-files',
 *        model?, prompt?, maxTokens?, host?, files? }
 *   出 { type: 'log'|'progress'|'model-ready'|'token'|'done'|'error'|'local-ready', ... }
 *
 * 本地模型文件：主线程把用户选中的文件夹（File 列表）传进来，
 * 这里覆盖 env.fetch 优先从这些文件返回 Response，没有的再走网络。
 */
import { pipeline, env, TextStreamer } from '@huggingface/transformers';

const MODELS = {
  local: {
    id: 'local/imported-model',   // 仅作占位；文件由 env.fetch 从本地 Map 提供
    label: '本地导入模型',
    dtype: 'q4f16',
  },
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

// 用户导入的本地模型文件：Map<文件名或相对路径, File>
let localFiles = new Map();
const originalFetch = env.fetch;

/** 覆盖 env.fetch：本地文件优先，未命中的交给原始 fetch */
function installLocalFetch() {
  env.fetch = async (urlOrPath, opts) => {
    const raw = typeof urlOrPath === 'string' ? urlOrPath : urlOrPath.toString();
    // 取路径里最后两段做键，兼容 "onnx/model_q4f16.onnx" 这种子目录
    let pathname = raw;
    try { pathname = new URL(raw).pathname; } catch { /* 相对路径直接用 */ }
    const clean = decodeURIComponent(pathname).replace(/^\/+/, '');
    const parts = clean.split('/');
    const basename = parts[parts.length - 1];
    const rel = parts.slice(-2).join('/');

    const file = localFiles.get(clean) || localFiles.get(rel) || localFiles.get(basename)
      || [...localFiles].find(([k]) => k.endsWith('/' + basename))?.[1];
    if (file) {
      post('log', { message: `使用本地文件：${basename}` });
      return new Response(file, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }
    // 本地文件没覆盖到，且是模型文件 → 明确失败，避免误从网络下载同名文件
    if (/\.(json|onnx|model|safetensors|txt)$/i.test(basename)) {
      throw new Error(`本地模型缺少文件：${basename}（已导入 ${localFiles.size} 个文件）`);
    }
    // WASM 运行时等非模型资源仍走原始 fetch
    return originalFetch(urlOrPath, opts);
  };
}

function restoreFetch() {
  env.fetch = originalFetch;
}

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

function setupEnv() {
  env.allowLocalModels = false;
  env.remoteHost = host;
  // 魔搭路径模板（见 translate-worker.js 同处注释）
  env.remotePathTemplate = host === 'https://modelscope.cn'
    ? 'models/{model}/resolve/master/'
    : '{model}/resolve/{revision}/';
  env.useBrowserCache = localFiles.size === 0;  // 本地文件模式不能读缓存里的旧模型
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
  setupEnv();
  const usingLocal = localFiles.size > 0;
  if (usingLocal) installLocalFetch();
  post('log', {
    message: usingLocal
      ? `正在从本地文件加载 ${cfg.label}…`
      : `正在加载 ${cfg.label}（单线程 WASM，约 112~460MB）…`,
  });

  const dtype = key === 'local' ? detectLocalDtype() : cfg.dtype;
  loadPromise = pipeline('text-generation', cfg.id, {
    dtype,
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

/** 从导入的文件名推断 dtype：model_q4f16.onnx -> q4f16 */
function detectLocalDtype() {
  for (const name of localFiles.keys()) {
    const m = /(?:^|\/)model_([a-z0-9]+)\.onnx$/i.exec(name);
    if (m) {
      const d = m[1].toLowerCase();
      // Transformers.js 认识的 dtype 名
      if (['q4', 'q4f16', 'int8', 'uint8', 'fp16', 'bnb4', 'q4f16'].includes(d)) return d;
      if (d === 'quantized') return 'q8';
    }
  }
  return 'q4f16'; // 兜底
}

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
    if (msg.type === 'local-files') {
      // files: [{ name, file }]，name 是相对文件夹的路径（如 onnx/model_q4f16.onnx）
      localFiles = new Map((msg.files || []).map((f) => [f.name, f.file]));
      generator = null;
      currentKey = null;
      loadPromise = null;
      restoreFetch();
      post('local-ready', { count: localFiles.size });
      return;
    }
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
