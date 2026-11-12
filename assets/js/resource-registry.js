/**
 * 离线资源清单（共享数据源）
 *
 * 三个工具依赖大文件：ffmpeg 转换内核、OCR 运行时与语言包、
 * 扫描文档去手写模型与推理运行时。资源中心的「一键下载全部」与各工具页
 * 的「离线资源」面板共用本清单，避免两处各维护一份导致显示与实际不符。
 *
 * 资源下载后落在 Cache Storage（工具自有缓存或浏览器缓存），
 * 运行时用同一 URL 再取即命中缓存；删除则从所有缓存移除该 URL。
 */

/* ========== SIMD 探测（字节序列与 tesseract.js 内部一致） ========== */
const SIMD_BYTES = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const RELAXED_SIMD_BYTES = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);

function detectSimd() {
  try {
    return WebAssembly.validate(SIMD_BYTES);
  } catch {
    return false;
  }
}

function detectRelaxedSimd() {
  try {
    return WebAssembly.validate(RELAXED_SIMD_BYTES);
  } catch {
    return false;
  }
}

/* ========== 缓存操作（不依赖具体缓存名） ========== */

/** 某个 URL 是否已缓存在任意缓存里 */
export async function urlCachedAnywhere(url) {
  if (!('caches' in window)) return false;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    try {
      if (await cache.match(url)) return true;
    } catch {
      /* 忽略单个缓存的错误 */
    }
  }
  return false;
}

/** 从所有缓存里移除某个 URL */
export async function removeUrlEverywhere(url) {
  if (!('caches' in window)) return;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    try {
      await cache.delete(url);
    } catch {
      /* 忽略 */
    }
  }
}

/** 多个 URL 是否都已缓存 */
async function allCached(urls) {
  for (const url of urls) {
    if (!(await urlCachedAnywhere(url))) return false;
  }
  return true;
}

/* ========== ffmpeg 转换内核（双内核） ==========
 * 跨源隔离可用时用 @ffmpeg/core-mt 多线程内核（实测 12s 720p 转码快约 2.2 倍），
 * 不可用（老浏览器 / SW 未接管 / 隔离失败）时回退到 @ffmpeg/core 单线程内核。
 *
 * 实测约束（见 tools/asr/ffmpeg-bench.html 的基准数据）：
 * - 多线程内核必须显式传 -threads N，现有代码的 -threads 0 会静默卡死
 * - pthread 子 Worker 的 ffmpeg-core.worker.js 必须同源（不能用 Blob URL，
 *   也不能走跨域 CDN），所以站点内自托管一份，由 SW 注入 COEP 头。
 * - 两个内核版本不同，缓存名必须分开，否则会互相覆盖。
 */
export const FFMPEG_CORE_ST_VERSION = '0.12.6';
export const FFMPEG_CORE_MT_VERSION = '0.12.10';

function coreSources(pkg, version) {
  return [
    `https://unpkg.com/${pkg}@${version}/dist/esm`,
    `https://cdn.jsdelivr.net/npm/${pkg}@${version}/dist/esm`,
    `https://fastly.jsdelivr.net/npm/${pkg}@${version}/dist/esm`,
    `https://esm.sh/${pkg}@${version}/dist/esm`,
  ];
}

/** 单线程内核（回退用）：2 个文件 */
export const FFMPEG_CORE_ST = {
  version: FFMPEG_CORE_ST_VERSION,
  sources: coreSources('@ffmpeg/core', FFMPEG_CORE_ST_VERSION),
  cacheName: `ffmpeg-core-v${FFMPEG_CORE_ST_VERSION}`,
  files: [
    { name: 'ffmpeg-core.js', mime: 'text/javascript', size: 114494 },
    { name: 'ffmpeg-core.wasm', mime: 'application/wasm', size: 32129114 },
  ],
  multiThread: false,
};

/** 多线程内核：3 个文件。worker.js 由站点同源提供，不走这里的多源回退 */
export const FFMPEG_CORE_MT = {
  version: FFMPEG_CORE_MT_VERSION,
  sources: coreSources('@ffmpeg/core-mt', FFMPEG_CORE_MT_VERSION),
  cacheName: `ffmpeg-core-mt-v${FFMPEG_CORE_MT_VERSION}`,
  files: [
    { name: 'ffmpeg-core.js', mime: 'text/javascript', size: 128947 },
    { name: 'ffmpeg-core.wasm', mime: 'application/wasm', size: 32718323 },
  ],
  workerFile: 'ffmpeg-runtime/ffmpeg-core.worker.js',
  multiThread: true,
  threads: 4,
};

/** 站点 base 前缀（GitHub Pages 是 /local-toolbox/） */
export function siteBase() {
  return (typeof import.meta.env !== 'undefined' && import.meta.env.BASE_URL) || '/';
}

/** 按当前隔离状态选内核。isolated 由调用方传入，本模块不碰 window */
export function pickFFmpegCore(isolated) {
  return isolated ? FFMPEG_CORE_MT : FFMPEG_CORE_ST;
}

/** 某个源下的完整文件 URL 列表 */
function ffmpegUrls(core, base) {
  return core.files.map((f) => `${base}/${f.name}`);
}

/** 生成一个 ffmpeg 内核资源条目（单/多线程各一份，共用下载与清理逻辑） */
function makeFFmpegCoreResource(core, { id, name, desc }) {
  const totalSize = core.files.reduce((sum, f) => sum + f.size, 0);
  return {
    id,
    name,
    desc,
    size: totalSize,
    files: ffmpegUrls(core, core.sources[0]),
    async isCached() {
      for (const base of core.sources) {
        if (await allCached(ffmpegUrls(core, base))) return true;
      }
      return false;
    },
    async download(onProgress) {
      const cache = ('caches' in window) ? await caches.open(core.cacheName).catch(() => null) : null;
      let lastErr = null;
      for (const base of core.sources) {
        try {
          let loaded = 0;
          for (const file of core.files) {
            const buf = await fetchWithProgress(`${base}/${file.name}`, (l) => {
              loaded = l;
              onProgress?.(l, file.size);
            });
            if (cache) {
              try { await cache.put(`${base}/${file.name}`, new Response(buf)); } catch { /* 配额不足时本次仍可用 */ }
            }
          }
          onProgress?.(totalSize, totalSize);
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      throw new Error(`所有 CDN 源均不可用：${lastErr?.message || '未知错误'}`);
    },
    async remove() {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const base of core.sources) {
          for (const url of ffmpegUrls(core, base)) {
            try { await cache.delete(url); } catch { /* 忽略 */ }
          }
        }
      }
    },
  };
}

/* ========== OCR 运行时与语言包 ========== */
export const TESSERACT_VERSION = '7.0.0';
export const TESSERACT_CORE_VERSION = '7.0.0';
export const CDN_WORKER = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`;
export const CDN_CORE = `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_CORE_VERSION}`;
const TESSDATA_BASE = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';
/* 工具默认引擎为 LSTM_ONLY，对应 tesseract.js 内部的 4.0.0_best_int 目录 */
const LSTM_LANG_DIR = '4.0.0_best_int';

/** 语言包 URL（与 tesseract.js 内部默认规则一致，运行时才能命中缓存） */
export function langDataUrl(lang) {
  return `${TESSDATA_BASE}/${lang}/${LSTM_LANG_DIR}/${lang}.traineddata.gz`;
}

/** core 变体：按设备 SIMD 支持选择，与 tesseract.js 的 getCore 规则一致 */
export function ocrCoreUrl() {
  if (detectRelaxedSimd()) return `${CDN_CORE}/tesseract-core-relaxedsimd-lstm.wasm.js`;
  if (detectSimd()) return `${CDN_CORE}/tesseract-core-simd-lstm.wasm.js`;
  return `${CDN_CORE}/tesseract-core-lstm.wasm.js`;
}

const OCR_LANGS = [
  { lang: 'chi_sim', name: '中文（简体）语言包', size: 1678000 },
  { lang: 'eng', name: '英文语言包', size: 2883000 },
  { lang: 'chi_tra', name: '中文（繁体）语言包', size: 1617000 },
];

const OCR_WORKER_SIZE = 108000;
const OCR_CORE_SIZE = 3805000;

/* ========== 下载辅助：带进度的 fetch ========== */

/**
 * 流式下载并报告进度。
 * @param {string} url
 * @param {(loaded:number,total:number)=>void} onProgress
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchWithProgress(url, onProgress) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const total = Number(resp.headers.get('content-length')) || 0;
  if (!resp.body || !onProgress) return resp.arrayBuffer();

  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return buf.buffer;
}

/* ========== 资源定义 ========== */

/**
 * 资源条目结构：
 *   id / name / desc / size（字节，预估值）
 *   files：涉及的文件 URL（用于删除与统计）
 *   isCached() / download(onProgress) / remove()
 */
export const RESOURCE_GROUPS = [
  {
    id: 'ffmpeg',
    title: '多媒体转换',
    toolPath: '/tools/ffmpeg/',
    resources: [
      makeFFmpegCoreResource(FFMPEG_CORE_MT, {
        id: 'ffmpeg-core-mt',
        name: 'FFmpeg 多线程内核',
        desc: '跨源隔离环境下使用的 @ffmpeg/core-mt（含 pthread 子 Worker）。实测长视频转码比单线程快约 2 倍。现代浏览器走这一套。',
      }),
      makeFFmpegCoreResource(FFMPEG_CORE_ST, {
        id: 'ffmpeg-core',
        name: 'FFmpeg 单线程内核',
        desc: '不支持跨源隔离时的回退内核（@ffmpeg/core）。功能完整但长视频转码较慢；保留预下载可让老浏览器也离线可用。',
      }),
    ],
  },
  {
    id: 'ocr',
    title: 'OCR 图片识字',
    toolPath: '/tools/ocr/',
    resources: [
      {
        id: 'ocr-runtime',
        name: 'OCR 运行时',
        desc: 'tesseract.js 的 worker 与推理内核（core 变体按设备 SIMD 支持自动选择），识别引擎本身所需。',
        size: OCR_WORKER_SIZE + OCR_CORE_SIZE,
        files: [CDN_WORKER, ocrCoreUrl()],
        async isCached() {
          return allCached([CDN_WORKER, ocrCoreUrl()]);
        },
        async download(onProgress) {
          const worker = await fetchWithProgress(CDN_WORKER, (l) => onProgress?.(l, OCR_WORKER_SIZE));
          onProgress?.(OCR_WORKER_SIZE, OCR_WORKER_SIZE + OCR_CORE_SIZE);
          await fetchWithProgress(ocrCoreUrl(), (l) => onProgress?.(OCR_WORKER_SIZE + l, OCR_WORKER_SIZE + OCR_CORE_SIZE));
        },
        async remove() {
          await removeUrlEverywhere(CDN_WORKER);
          await removeUrlEverywhere(ocrCoreUrl());
        },
      },
      ...OCR_LANGS.map(({ lang, name, size }) => ({
        id: `ocr-lang-${lang}`,
        name,
        desc: `识别 ${lang} 所需的语言数据（${name.replace('语言包', '')}），OCR 工具的语言下拉里可切换。`,
        size,
        files: [langDataUrl(lang)],
        async isCached() {
          return urlCachedAnywhere(langDataUrl(lang));
        },
        async download(onProgress) {
          await fetchWithProgress(langDataUrl(lang), (l) => onProgress?.(l, size));
        },
        async remove() {
          await removeUrlEverywhere(langDataUrl(lang));
        },
      })),
    ],
  },
  {
    id: 'asr',
    title: '语音转文字',
    toolPath: '/tools/asr/',
    resources: [
      {
        id: 'asr-model',
        name: 'Whisper 语音识别模型',
        desc: 'Whisper-tiny 的 INT8 量化模型（编码器 + 解码器 + 分词器），首次转写时由浏览器下载并缓存；预下载后离线也能转写。',
        size: 43_000_000,
        files: [],
        async isCached() {
          const mod = await import('/tools/asr/model-registry.js');
          // 只认官方源：那是默认下载源，也是预下载写入的键。
          // 镜像源是用户手动切换后的临时选择，不作为「已缓存」判定。
          for (const f of mod.ASR_MODEL_FILES) {
            if (!(await urlCachedAnywhere(mod.asrModelUrl(mod.ASR_HOST_OFFICIAL, f.name)))) return false;
          }
          return true;
        },
        async download(onProgress) {
          const mod = await import('/tools/asr/model-registry.js');
          const total = mod.ASR_MODEL_TOTAL;
          let loaded = 0;
          // Transformers.js 默认用 Cache API 的 "transformers-cache" 缓存，
          // 键就是文件的完整 URL。这里按同样的键写入，预下载才能真正生效。
          const cache = ('caches' in window) ? await caches.open('transformers-cache') : null;
          for (const f of mod.ASR_MODEL_FILES) {
            const url = mod.asrModelUrl(mod.ASR_HOST_OFFICIAL, f.name);
            const buf = await fetchWithProgress(url, (l) => onProgress?.(loaded + l, total));
            loaded += buf.byteLength || f.size;
            if (cache) {
              try {
                await cache.put(url, new Response(buf, {
                  headers: { 'Content-Type': f.name.endsWith('.onnx') ? 'application/octet-stream' : 'application/json' },
                }));
              } catch { /* 配额不足时本次仍可用 */ }
            }
          }
        },
        async remove() {
          const mod = await import('/tools/asr/model-registry.js');
          for (const name of mod.ASR_MODEL_FILES) {
            for (const host of [mod.ASR_HOST_OFFICIAL, mod.ASR_HOST_MIRROR]) {
              await removeUrlEverywhere(mod.asrModelUrl(host, name));
            }
          }
        },
      },
    ],
  },
  {
    id: 'scandoc',
    title: '扫描文档',
    toolPath: '/tools/scandoc/',
    resources: [
      {
        id: 'scandoc-model',
        name: '去手写模型（MI-GAN）',
        desc: '擦除红蓝笔迹时用的图像修复模型，与站点同源不经过第三方，下载后带 SHA-256 完整性校验。',
        size: 28079181,
        files: [],
        async isCached() {
          const mod = await import('/tools/scandoc/handwriting/model-manager.js');
          return mod.isModelCached();
        },
        async download(onProgress) {
          const mod = await import('/tools/scandoc/handwriting/model-manager.js');
          await mod.ensureModel((loaded, total) => onProgress?.(loaded, total || 28079181));
        },
        async remove() {
          const mod = await import('/tools/scandoc/handwriting/model-manager.js');
          await mod.clearModelCache();
        },
      },
      {
        id: 'scandoc-runtime',
        name: '推理运行时（ONNX Runtime）',
        desc: '模型推理用的 wasm 运行时，与站点同源；浏览器会缓存同源静态资源。',
        size: 13600000 + 60000,
        files: [],
        async isCached() {
          const mod = await import('/tools/scandoc/handwriting/model-manager.js');
          const { wasm, mjs } = mod.runtimeWasmPaths();
          return allCached([wasm, mjs]);
        },
        async download(onProgress) {
          const mod = await import('/tools/scandoc/handwriting/model-manager.js');
          const { wasm, mjs } = mod.runtimeWasmPaths();
          let loaded = 0;
          for (const url of [wasm, mjs]) {
            const buf = await fetchWithProgress(url, (l) => onProgress?.(loaded + l, 13600000 + 60000));
            loaded += buf.byteLength;
          }
        },
        async remove() {
          const mod = await import('/tools/scandoc/handwriting/model-manager.js');
          const { wasm, mjs } = mod.runtimeWasmPaths();
          await removeUrlEverywhere(wasm);
          await removeUrlEverywhere(mjs);
        },
      },
    ],
  },
];

/** 全部资源条目（扁平） */
export function allResources() {
  return RESOURCE_GROUPS.flatMap((g) => g.resources);
}

/** 按工具 id 取资源列表 */
export function resourcesOfTool(toolId) {
  const group = RESOURCE_GROUPS.find((g) => g.id === toolId);
  return group ? group.resources : [];
}

/** 资源总大小（字节） */
export function totalSize(resources = allResources()) {
  return resources.reduce((sum, r) => sum + (r.size || 0), 0);
}
