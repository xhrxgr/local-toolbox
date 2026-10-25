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

/* ========== ffmpeg 转换内核 ========== */
export const FFMPEG_CORE_VERSION = '0.12.6';
export const FFMPEG_CORE_SOURCES = [
  `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`,
  `https://fastly.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`,
  `https://esm.sh/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`,
];
export const FFMPEG_CACHE_NAME = `ffmpeg-core-v${FFMPEG_CORE_VERSION}`;
export const FFMPEG_CORE_FILES = [
  { name: 'ffmpeg-core.js', mime: 'text/javascript', size: 114494 },
  { name: 'ffmpeg-core.wasm', mime: 'application/wasm', size: 32129114 },
];

/** 某个源下的完整文件 URL 列表 */
function ffmpegUrls(base) {
  return FFMPEG_CORE_FILES.map((f) => `${base}/${f.name}`);
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
      {
        id: 'ffmpeg-core',
        name: 'FFmpeg 转换内核',
        desc: '音视频转码用的 wasm 内核（ffmpeg-core.js + ffmpeg-core.wasm），多源回退下载，命中缓存后转码不再等待联网。',
        size: 114494 + 32129114,
        files: ffmpegUrls(FFMPEG_CORE_SOURCES[0]),
        async isCached() {
          for (const base of FFMPEG_CORE_SOURCES) {
            if (await allCached(ffmpegUrls(base))) return true;
          }
          return false;
        },
        async download(onProgress) {
          const cache = ('caches' in window) ? await caches.open(FFMPEG_CACHE_NAME).catch(() => null) : null;
          let lastErr = null;
          for (const base of FFMPEG_CORE_SOURCES) {
            try {
              let loaded = 0;
              for (const file of FFMPEG_CORE_FILES) {
                const buf = await fetchWithProgress(`${base}/${file.name}`, (l) => {
                  loaded = l;
                  onProgress?.(l, file.size);
                });
                if (cache) {
                  try {
                    await cache.put(`${base}/${file.name}`, new Response(buf));
                  } catch {
                    /* 配额不足时本次仍可用 */
                  }
                }
              }
              onProgress?.(loaded + FFMPEG_CORE_FILES[0].size, FFMPEG_CORE_FILES[0].size + FFMPEG_CORE_FILES[1].size);
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
            for (const base of FFMPEG_CORE_SOURCES) {
              for (const url of ffmpegUrls(base)) {
                try {
                  await cache.delete(url);
                } catch {
                  /* 忽略 */
                }
              }
            }
          }
        },
      },
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
