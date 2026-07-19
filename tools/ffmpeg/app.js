/**
 * FFmpeg 音视频转换工具
 * 浏览器本地处理，文件不上传云端
 * 支持：格式转换 / 提取音频 / 视频裁剪
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg = null;
let loadingSectionVisible = false;
let files = [];                // 所有文件
let selectedIndex = -1;        // 当前选中的文件索引
let inputFile = null;          // 兼容旧代码：当前选中的文件
let currentMode = 'convert';
let selectedQuality = 'high';

/* ========== 质量预设 (CRF) ========== */
const QUALITY_PRESETS = {
  low: { crf: '35', bitrate: '500k' },
  medium: { crf: '23', bitrate: '2M' },
  high: { crf: '18', bitrate: '8M' },
  lossless: { crf: '0', bitrate: '0' },
};

/* ========== 格式到扩展名映射 ========== */
const FORMAT_EXT = {
  mp4: 'mp4', webm: 'webm', mkv: 'mkv', avi: 'avi', mov: 'mov',
  flv: 'flv', wmv: 'wmv', ogv: 'ogv', ts: 'ts', m4v: 'm4v',
  '3gp': '3gp', gif: 'gif', amv: 'amv',
  mp3: 'mp3', aac: 'aac', wav: 'wav', flac: 'flac', ogg: 'ogg',
  opus: 'opus', wma: 'wma', m4a: 'm4a', aiff: 'aiff', ac3: 'ac3',
  jpg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', bmp: 'bmp',
  tiff: 'tiff',
};

/* ========== 音频格式 ========== */
const AUDIO_FORMATS = ['mp3', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wma', 'm4a', 'aiff', 'ac3'];

/* ========== 图片格式 ========== */
const IMAGE_FORMATS = ['jpg', 'png', 'webp', 'avif', 'bmp', 'tiff'];

/* ========== 视频格式 ========== */
const VIDEO_FORMATS = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'ogv', 'ts', 'm4v', '3gp', 'gif', 'amv'];

/* ========== 分辨率预设 ========== */
const RESOLUTION_PRESETS = {
  '4320p': { w: 7680, h: 4320 },
  '2160p': { w: 3840, h: 2160 },
  '1440p': { w: 2560, h: 1440 },
  '1080p': { w: 1920, h: 1080 },
  '720p': { w: 1280, h: 720 },
  '480p': { w: 854, h: 480 },
  '360p': { w: 640, h: 360 },
};

/* ========== 编码器对应的格式兼容性 ========== */
const VCODEC_MAP = {
  libx264: 'mp4',
  libx265: 'mp4',
  'libvpx-vp9': 'webm',
  libvpx: 'webm',
  'libaom-av1': 'mp4',
};

const ACODEC_MAP = {
  aac: 'mp4',
  libmp3lame: 'mp3',
  libopus: 'webm',
  libvorbis: 'webm',
  flac: 'mkv',
  pcm_s16le: 'wav',
};

/* ========== 初始化 FFmpeg（多源回退 + Cache API 持久化缓存） ========== */
const FFMPEG_CORE_VERSION = '0.12.6';
const FFMPEG_CORE_SOURCES = [
  `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`,
  `https://fastly.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`,
  `https://esm.sh/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`,
];
const FFMPEG_CACHE_NAME = 'ffmpeg-core-v0.12.6';
const FFMPEG_CORE_FILES = [
  { name: 'ffmpeg-core.js', mime: 'text/javascript' },
  { name: 'ffmpeg-core.wasm', mime: 'application/wasm' },
];

// 运行时检测 FFmpeg 内核支持的编码器/复用器（用于动态启用/禁用 AMV 等特殊格式）
let availableEncoders = null;
let availableMuxers = null;

async function detectFFmpegCapabilities() {
  if (availableEncoders && availableMuxers) return;
  availableEncoders = new Set();
  availableMuxers = new Set();
  const encRe = /^\s*[VAS][A-Z.]{5}\s+(\w+)\s+/;
  const muxRe = /^\s*[DE. ]{1,4}\s(\w+)\s{2,}/;
  const logCollector = ({ message }) => {
    const e = message.match(encRe);
    if (e) availableEncoders.add(e[1]);
    const m = message.match(muxRe);
    if (m) availableMuxers.add(m[1]);
  };
  ffmpeg.on('log', logCollector);
  try {
    await ffmpeg.exec(['-hide_banner', '-encoders']);
    await ffmpeg.exec(['-hide_banner', '-muxers']);
  } catch {}
  ffmpeg.off('log', logCollector);
  console.log('[FFmpeg] 可用编码器:', [...availableEncoders].sort().join(', '));
  console.log('[FFmpeg] 可用复用器:', [...availableMuxers].sort().join(', '));
  // 根据 AMV 支持情况更新 UI
  updateAmvOptionState();
}

// 根据内核能力动态启用/禁用 AMV 选项
function updateAmvOptionState() {
  const amvSupported = availableEncoders?.has('amv') && availableMuxers?.has('amv');
  document.querySelectorAll('option[value="amv"]').forEach(opt => {
    if (amvSupported) {
      opt.disabled = false;
      opt.textContent = 'AMV';
    } else {
      opt.disabled = true;
      opt.textContent = 'AMV（当前内核不支持）';
    }
  });
}

// 拉取单个 core 文件：先查所有源的缓存 → 命中直接返回；否则多源回退 fetch → 成功后写回缓存
async function fetchCoreFile(file) {
  const cache = ('caches' in window) ? await caches.open(FFMPEG_CACHE_NAME).catch(() => null) : null;

  // 1) 遍历源查缓存（任一源命中即可）
  if (cache) {
    for (const base of FFMPEG_CORE_SOURCES) {
      const fullUrl = `${base}/${file.name}`;
      try {
        const cached = await cache.match(fullUrl);
        if (cached) {
          const buf = await cached.arrayBuffer();
          return { blobUrl: URL.createObjectURL(new Blob([buf], { type: file.mime })), cacheHit: true };
        }
      } catch {}
    }
  }

  // 2) 多源回退 fetch
  let lastErr = null;
  for (const base of FFMPEG_CORE_SOURCES) {
    const fullUrl = `${base}/${file.name}`;
    try {
      const resp = await fetch(fullUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: file.mime }));
      // 写回缓存
      if (cache) {
        try { await cache.put(fullUrl, new Response(buf)); } catch {}
      }
      return { blobUrl, cacheHit: false };
    } catch (e) {
      console.warn(`[FFmpeg] 源失败 ${fullUrl}:`, e.message);
      lastErr = e;
    }
  }
  throw new Error(`加载 ${file.name} 失败: ${lastErr?.message || '所有 CDN 源均不可用'}`);
}

async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;

  // GitHub Pages 等静态托管不支持 COOP/COEP 头，SharedArrayBuffer 不可用
  if (!self.crossOriginIsolated) {
    throw new Error('当前环境不支持 SharedArrayBuffer（FFmpeg 多线程必需）。请使用本地 npm run dev 或自托管服务器（需配置 COOP/COEP 响应头）运行此工具。');
  }

  const loadingSection = document.getElementById('loading-section');
  loadingSection.hidden = false;
  const loadingText = document.getElementById('loading-text');
  const originalText = loadingText?.textContent;
  if (loadingText) loadingText.textContent = '正在加载 FFmpeg 内核（首次约 31MB，缓存后秒载）...';

  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => { console.log('[FFmpeg]', message); });

  try {
    // 并行拉取两个文件（每个内部自己处理缓存 + 多源回退）
    const results = await Promise.all(FFMPEG_CORE_FILES.map(fetchCoreFile));
    const cacheHit = results.every(r => r.cacheHit);
    if (loadingText && cacheHit) loadingText.textContent = '正在从本地缓存加载 FFmpeg 内核...';
    await ffmpeg.load({ coreURL: results[0].blobUrl, wasmURL: results[1].blobUrl });
    // 检测内核支持的编码器/复用器（await 确保后续 pre-check 能用）
    await detectFFmpegCapabilities().catch(e => console.warn('[FFmpeg] 能力检测失败:', e.message));
  } catch (err) {
    ffmpeg = null;
    throw err;
  } finally {
    if (loadingText) loadingText.textContent = originalText;
    loadingSection.hidden = true;
  }
  return ffmpeg;
}

/* ========== MIME 类型识别 (浏览器对 .MTS/.M2TS/.TS 经常识别不出) ========== */
const VIDEO_MIME_MAP = {
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  ts: 'video/mp2t',
  mod: 'video/mp2t',
  amv: 'video/amv',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
};

function getFileMimeType(file) {
  // 优先用浏览器推断的 type，否则按扩展名映射
  if (file.type && file.type !== '') return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return VIDEO_MIME_MAP[ext] || 'video/mp2t';
}

/* ========== 文件大小格式化 ========== */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/* ========== 多文件管理 ========== */

function addFiles(newFiles) {
  for (const f of newFiles) {
    if (f.size > 200 * 1024 * 1024) {
      const toast = document.getElementById('warning-toast');
      toast.hidden = false;
      setTimeout(() => { toast.hidden = true; }, 5000);
    }
    const dup = files.find(e => e.name === f.name && e.size === f.size && e.lastModified === f.lastModified);
    if (dup) {
      console.log('跳过重复文件:', f.name);
      continue;
    }
    files.push(f);
  }

  if (files.length > 0 && selectedIndex < 0) {
    selectFile(0);
  }
  renderFileList();
  updateUploadUI();
}

function selectFile(index) {
  if (index < 0 || index >= files.length) return;
  selectedIndex = index;
  inputFile = files[index];
  renderFileList();
  updateUploadUI();
  if (currentMode === 'trim') loadTrimPreview();
}

function removeFile(index) {
  if (index < 0 || index >= files.length) return;
  files.splice(index, 1);
  if (files.length === 0) {
    selectedIndex = -1;
    inputFile = null;
    unloadTrimPreview();
  } else if (index === selectedIndex) {
    selectFile(Math.min(index, files.length - 1));
  } else if (index < selectedIndex) {
    selectedIndex--;
    inputFile = files[selectedIndex];
  }
  renderFileList();
  updateUploadUI();
}

function clearAllFiles() {
  files = [];
  selectedIndex = -1;
  inputFile = null;
  unloadTrimPreview();
  stopAudioMeter();
  renderFileList();
  updateUploadUI();
  document.getElementById('progress-section').hidden = true;
  document.getElementById('download-section').hidden = true;
  document.getElementById('btn-convert').hidden = false;
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-percent').textContent = '0%';
  document.getElementById('progress-eta').textContent = '';
}

function renderFileList() {
  const list = document.getElementById('file-list-items');
  const count = document.getElementById('file-list-count');
  const fileList = document.getElementById('file-list');

  if (files.length === 0) { fileList.hidden = true; return; }
  fileList.hidden = false;
  count.textContent = `${files.length} 个文件`;

  list.innerHTML = files.map((f, i) => {
    const sel = i === selectedIndex;
    const ext = f.name.split('.').pop()?.toUpperCase() || '?';
    return `
      <div class="file-item ${sel ? 'file-item--selected' : ''}" data-index="${i}">
        <span class="file-item__icon">${getFileIcon(ext)}</span>
        <span class="file-item__name" title="${f.name}">${f.name}</span>
        <span class="file-item__size">${formatFileSize(f.size)}</span>
        <button class="file-item__remove" data-action="remove" data-index="${i}" title="移除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  }).join('');

  list.querySelectorAll('.file-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="remove"]')) return;
      selectFile(parseInt(el.dataset.index));
    });
  });
  list.querySelectorAll('[data-action="remove"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(parseInt(btn.dataset.index));
    });
  });
}

function getFileIcon(ext) {
  const m = { MP4:'🎬',MOV:'🎬',MKV:'🎬',AVI:'🎬',WEBM:'🎬',FLV:'🎬',WMV:'🎬',MTS:'📹',M2TS:'📹',TS:'📹',AMV:'🎬','3GP':'🎬',OGV:'🎬',MP3:'🎵',AAC:'🎵',WAV:'🎵',FLAC:'🎵',OGG:'🎵',OPUS:'🎵',M4A:'🎵',WMA:'🎵',AIFF:'🎵',AC3:'🎵',JPG:'🖼',JPEG:'🖼',PNG:'🖼',WEBP:'🖼',GIF:'🖼',BMP:'🖼',AVIF:'🖼',TIFF:'🖼',SVG:'🖼' };
  return m[ext] || '📄';
}

function updateUploadUI() {
  document.getElementById('upload-area').hidden = files.length > 0;
  document.getElementById('btn-convert').disabled = files.length === 0;
}

/* ========== 时间解析 (HH:MM:SS 或 秒数) ========== */
function parseTime(input) {
  if (!input || input.trim() === '') return null;
  const trimmed = input.trim();
  // HH:MM:SS 或 HH:MM:SS.ms
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    if (parts.length === 3) {
      return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    }
    if (parts.length === 2) {
      return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
  }
  // 纯秒数
  return parseFloat(trimmed);
}

/* ========== 获取输出文件名 ========== */
function getOutputName(format, sourceName) {
  const ext = FORMAT_EXT[format] || format;
  // 用源文件名（去掉扩展名）+ _converted + 新扩展名
  if (sourceName) {
    const base = sourceName.replace(/\.[^.]+$/, '');
    return `${base}_converted.${ext}`;
  }
  return `output.${ext}`;
}

/* ========== 获取 MIME 类型 ========== */
function getMimeType(format) {
  if (AUDIO_FORMATS.includes(format)) return `audio/${format === 'aac' ? 'aac' : format === 'm4a' ? 'mp4' : format}`;
  if (IMAGE_FORMATS.includes(format)) return `image/${format === 'jpg' ? 'jpeg' : format}`;
  if (format === 'gif') return 'image/gif';
  if (format === 'amv') return 'video/x-msvideo';
  return `video/${format}`;
}

/* ========== 格式转换 ========== */
/* ========== 任务队列 + 阶段化进度控制 ========== */
const Stage = {
  IDLE: 'idle',
  LOAD_FFMPEG: '加载 FFmpeg 内核',
  READ_FILE: '读取文件到内存',
  CONVERT: '执行转码',
  READ_RESULT: '读取处理结果',
  DONE: '完成',
};

const taskQueue = {
  items: [],          // [{ file, mode, status, progress }]
  currentIndex: -1,
  results: [],        // [{ file, blob, format, cancelled }]
  abortRequested: false,   // 放弃当前
  abortAll: false,         // 放弃全部
  isRunning: false,
};

function setStage(stage, status, pct) {
  const titleEl = document.getElementById('progress-stage-title');
  const statusEl = document.getElementById('progress-stage-status');
  const pctEl = document.getElementById('progress-stage-pct');
  const fillEl = document.getElementById('progress-fill');
  if (titleEl) titleEl.textContent = stage;
  if (statusEl) statusEl.textContent = status || '';
  if (pctEl) pctEl.textContent = `${Math.round(pct || 0)}%`;
  if (fillEl) fillEl.style.width = `${Math.round(pct || 0)}%`;
}

function renderTaskQueue() {
  const listEl = document.getElementById('task-queue-list');
  const countEl = document.getElementById('task-queue-count');
  const overallEl = document.getElementById('task-queue-overall');
  const queueEl = document.getElementById('task-queue');
  if (!listEl) return;

  if (taskQueue.items.length === 0) {
    queueEl.hidden = true;
    return;
  }
  queueEl.hidden = false;

  const total = taskQueue.items.length;
  const done = taskQueue.items.filter(i => i.status === 'done' || i.status === 'cancelled' || i.status === 'failed').length;
  countEl.textContent = `${done}/${total}`;

  // 总进度 = (已完成任务数 + 当前任务进度) / 总数
  const currentItem = taskQueue.items[taskQueue.currentIndex];
  const currentProgress = currentItem ? currentItem.progress || 0 : 0;
  const overall = ((done + currentProgress) / total) * 100;
  overallEl.textContent = `总进度 ${Math.round(overall)}%`;

  listEl.innerHTML = taskQueue.items.map((item, i) => {
    const isCurrent = i === taskQueue.currentIndex;
    const cls = isCurrent ? 'task-item--current' : item.status === 'done' ? 'task-item--done' : item.status === 'cancelled' ? 'task-item--cancelled' : '';
    // 状态图标（不使用 ▶ 避免误导可展开）
    const icon = item.status === 'done' ? '✓' : item.status === 'cancelled' ? '⊘' : item.status === 'failed' ? '✗' : isCurrent ? '●' : '○';
    const statusText = item.status === 'done' ? '完成' : item.status === 'cancelled' ? '已放弃' : item.status === 'failed' ? `失败：${item.error || '未知错误'}` : isCurrent ? `${Math.round((item.progress || 0) * 100)}%` : '等待';
    return `<li class="task-item ${cls}">
      <span class="task-item__icon">${icon}</span>
      <span class="task-item__name" title="${item.file.name}">${item.file.name}</span>
      <span class="task-item__status">${statusText}</span>
    </li>`;
  }).join('');
}

async function runTaskQueue() {
  if (taskQueue.isRunning) return;
  taskQueue.isRunning = true;
  taskQueue.abortRequested = false;
  taskQueue.abortAll = false;
  taskQueue.results = [];

  document.getElementById('progress-section').hidden = false;
  document.getElementById('progress-actions').hidden = false;
  document.getElementById('download-section').hidden = true;
  document.getElementById('btn-convert').hidden = true;

  for (let i = 0; i < taskQueue.items.length; i++) {
    if (taskQueue.abortAll) break;
    taskQueue.currentIndex = i;
    const item = taskQueue.items[i];
    item.status = 'running';
    item.progress = 0;
    renderTaskQueue();

    try {
      const result = await runSingleTask(item, (fileProgress) => {
        item.progress = fileProgress;
        renderTaskQueue();
      });
      // 成功完成（runSingleTask 内部已设 done 或抛错）
    } catch (err) {
      if (err && err.message === '__CANCELLED__') {
        item.status = 'cancelled';
      } else {
        console.error(`[任务失败] ${item.file.name}:`, err);
        item.status = 'failed';
        item.error = err.message || String(err);
      }
    }
  }

  taskQueue.isRunning = false;
  taskQueue.currentIndex = -1;
  renderTaskQueue();
  showResults();
}

async function runSingleTask(item, onProgress) {
  const { file, mode } = item;
  // 把 inputFile 临时指向当前文件
  const prevInput = inputFile;
  inputFile = file;

  try {
    setStage(Stage.READ_FILE, `正在读取 ${file.name}...`, 0);
    onProgress(0.05);

    const result = await executeMode(mode, file, (stage, status, pct) => {
      setStage(stage, status, pct);
      onProgress(pct / 100);
    });

    if (result.cancelled) {
      throw new Error('__CANCELLED__');
    }

    item.status = 'done';
    taskQueue.results.push({ file, blob: result.blob, format: result.format, cancelled: false });
    return { cancelled: false };
  } finally {
    inputFile = prevInput;
  }
}

async function executeMode(mode, file, onStage) {
  // 把三个 do* 函数包装一下，让它们支持阶段化进度 + 中断
  if (mode === 'convert') return await executeConvert(file, onStage);
  if (mode === 'extract') return await executeExtract(file, onStage);
  if (mode === 'trim') return await executeTrim(file, onStage);
  throw new Error('未知模式: ' + mode);
}

async function executeConvert(file, onStage) {
  const outputFormat = document.getElementById('output-format').value;
  const isAudio = AUDIO_FORMATS.includes(outputFormat);
  const isImage = IMAGE_FORMATS.includes(outputFormat);

  onStage(Stage.LOAD_FFMPEG, '检查 FFmpeg 内核...', 5);
  await loadFFmpeg();

  const inputExt = file.name.split('.').pop()?.toLowerCase() || 'mp4';
  const inputName = `input_${Date.now()}.${inputExt}`;
  const outputName = getOutputName(outputFormat, file.name);

  onStage(Stage.READ_FILE, `正在读取 ${file.name}...`, 10);
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  const args = ['-i', inputName];
  // ... （保留原 doConvert 的命令构建逻辑）
  if (isImage) {
    if (outputFormat === 'jpg') args.push('-q:v', '2');
    else if (outputFormat === 'png') args.push('-compression_level', '6');
    else if (outputFormat === 'webp') args.push('-quality', '80');
    args.push('-frames:v', '1', '-update', '1', outputName);
  } else if (isAudio) {
    const acodec = document.getElementById('audio-codec').value;
    const abitrate = document.getElementById('audio-bitrate').value;
    const customAbitrate = document.getElementById('custom-abitrate').value;
    args.push('-vn', '-threads', '0');
    // 格式→编码器自动映射：某些音频容器要求特定编码器
    const audioFormatCodecMap = {
      wma: 'wmav2',
      aiff: 'pcm_s16be',
    };
    const effectiveCodec = (acodec === 'copy') ? 'copy' : (audioFormatCodecMap[outputFormat] || acodec);
    if (effectiveCodec === 'copy') args.push('-c:a', 'copy');
    else args.push('-c:a', effectiveCodec);
    if (effectiveCodec !== 'copy') {
      if (abitrate === 'custom' && customAbitrate) args.push('-b:a', customAbitrate);
      else if (abitrate !== 'auto') args.push('-b:a', abitrate);
    }
    args.push(outputName);
  } else {
    const vcodec = document.getElementById('video-codec').value;
    const acodec = document.getElementById('audio-codec').value;
    const resolution = document.getElementById('resolution-preset').value;
    const customW = document.getElementById('custom-width').value;
    const customH = document.getElementById('custom-height').value;
    const fps = document.getElementById('fps').value;
    const customFps = document.getElementById('custom-fps').value;
    const vbitrate = document.getElementById('video-bitrate').value;
    const customVbitrate = document.getElementById('custom-vbitrate').value;
    const abitrate = document.getElementById('audio-bitrate').value;
    const customAbitrate = document.getElementById('custom-abitrate').value;
    const presetSpeed = document.getElementById('preset-speed').value;
    const quality = QUALITY_PRESETS[selectedQuality];
    const deinterlace = document.querySelector('input[name="deinterlace"]:checked')?.value || 'auto';
    const needDeinterlace = deinterlace === 'on' || (deinterlace === 'auto' && ['mts', 'm2ts', 'ts', 'mod'].includes(inputExt));

    args.push('-threads', '0');
    let actualVcodec = vcodec;
    if (needDeinterlace && vcodec === 'copy') actualVcodec = 'libx264';

    if (actualVcodec === 'copy') args.push('-c:v', 'copy');
    else args.push('-c:v', actualVcodec);
    if (acodec === 'copy') args.push('-c:a', 'copy');
    else args.push('-c:a', acodec);
    if (actualVcodec !== 'copy') args.push('-preset', presetSpeed);

    if (actualVcodec !== 'copy') {
      if (vbitrate === 'auto') args.push('-crf', quality.crf);
      else if (vbitrate === 'custom' && customVbitrate) args.push('-b:v', customVbitrate);
      else args.push('-b:v', vbitrate);
    }
    if (acodec !== 'copy') {
      if (abitrate === 'custom' && customAbitrate) args.push('-b:a', customAbitrate);
      else if (abitrate !== 'auto') args.push('-b:a', abitrate);
      else args.push('-b:a', '128k');
    }

    const vfParts = [];
    if (needDeinterlace) vfParts.push('bwdif=mode=send_field:parity=auto:deint=all');
    if (resolution !== 'original') {
      if (resolution === 'custom' && customW && customH) vfParts.push(`scale=${customW}:${customH}`);
      else {
        const res = RESOLUTION_PRESETS[resolution];
        if (res) vfParts.push(`scale=${res.w}:${res.h}:force_original_aspect_ratio=decrease,pad=${res.w}:${res.h}:(ow-iw)/2:(oh-ih)/2`);
      }
    }
    if (vfParts.length > 0) args.push('-vf', vfParts.join(','));

    if (fps !== 'original') {
      if (fps === 'custom' && customFps) args.push('-r', customFps);
      else args.push('-r', fps);
    }
    if (outputFormat === 'gif') {
      // GIF 容器只接受 gif 编码器，强制覆盖用户选的视频编码器
      const cvIdx = args.indexOf('-c:v');
      if (cvIdx >= 0) args[cvIdx + 1] = 'gif';
      else args.push('-c:v', 'gif');
      // 移除 -preset（gif 编码器不支持）
      const psIdx = args.indexOf('-preset');
      if (psIdx >= 0) args.splice(psIdx, 2);
      // 移除 -crf / -b:v（gif 编码器不支持）
      const crfIdx = args.indexOf('-crf');
      if (crfIdx >= 0) args.splice(crfIdx, 2);
      const bvIdx = args.indexOf('-b:v');
      if (bvIdx >= 0) args.splice(bvIdx, 2);
      const vfIdx = args.indexOf('-vf');
      if (vfIdx >= 0) args[vfIdx + 1] += ',fps=10,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse';
      else args.push('-vf', 'fps=10,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse');
    }
    if (['mp4', 'mov', 'm4v'].includes(outputFormat) && vcodec !== 'copy') args.push('-movflags', '+faststart');
    args.push(outputName);
  }

  // AMV 输出特殊处理：覆盖编码参数为 AMV 专用编码器
  // AMV 容器要求：amv 视频 + adpcm_ima_amv 音频 + yuvj420p + mono + 22050Hz
  // block_size 必须 = sample_rate / frame_rate（22050/fps 必须整除），否则 muxer 报错
  // 用户可选帧率：10/14/15/18/21/25/30（都是 22050 的因数）
  if (outputFormat === 'amv') {
    const needCodecs = ['amv', 'adpcm_ima_amv'];
    const missing = needCodecs.filter(c => availableEncoders && !availableEncoders.has(c));
    if (missing.length > 0 || (availableMuxers && !availableMuxers.has('amv'))) {
      throw new Error(`当前 FFmpeg 内核不支持 AMV 编码（缺少: ${missing.join(', ') || 'amv 复用器'}）`);
    }
    // 读取用户选的 AMV 帧率（默认 15）
    const amvFps = parseInt(document.getElementById('fps').value) || 15;
    const blockSize = 22050 / amvFps;
    if (!Number.isInteger(blockSize)) {
      throw new Error(`AMV 帧率 ${amvFps} 不合法：22050 必须能被帧率整除`);
    }
    const newArgs = ['-i', inputName];
    const amvW = document.getElementById('custom-width').value || '160';
    const amvH = document.getElementById('custom-height').value || '128';
    newArgs.push('-vf', `scale=${amvW}:${amvH}`, '-pix_fmt', 'yuvj420p', '-r', String(amvFps),
      '-c:v', 'amv', '-c:a', 'adpcm_ima_amv', '-ac', '1', '-ar', '22050',
      '-block_size', String(blockSize),
      '-threads', '0', '-f', 'amv', '-y', outputName);
    args.length = 0;
    args.push(...newArgs);
  }

  // 注册进度回调
  const convertProgressHandler = ({ progress }) => {
    if (taskQueue.abortRequested) return;
    if (!isFinite(progress)) return;
    const pct = Math.min(95, 10 + Math.max(0, Math.min(1, progress)) * 85);
    onStage(Stage.CONVERT, `正在转换 ${file.name}...`, pct);
  };
  const convertLogHandler = ({ message }) => {
    if (message && !message.includes('frame=')) {
      onStage(Stage.CONVERT, `正在转换 ${file.name}... ${message.slice(0, 60)}`, undefined);
    }
  };
  ffmpeg.on('progress', convertProgressHandler);
  ffmpeg.on('log', convertLogHandler);

  onStage(Stage.CONVERT, `开始转换 → ${outputFormat.toUpperCase()}`, 10);
  try {
    await ffmpeg.exec(args);
  } catch (err) {
    if (taskQueue.abortRequested) {
      return { cancelled: true };
    }
    throw err;
  } finally {
    ffmpeg.off('progress', convertProgressHandler);
    ffmpeg.off('log', convertLogHandler);
  }

  onStage(Stage.READ_RESULT, '正在读取处理结果...', 96);
  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data.buffer], { type: getMimeType(outputFormat) });

  // 输出大小校验：0 字节说明转码实际失败（exec 不一定抛错）
  if (blob.size === 0) {
    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}
    const hint = outputFormat === 'amv'
      ? 'AMV 编码器不可用：当前 FFmpeg.wasm 构建未包含 AMV 编码支持，无法输出 AMV 格式'
      : `输出文件为空，转码失败（目标格式 ${outputFormat} 可能不被当前 FFmpeg 内核支持）`;
    throw new Error(hint);
  }

  try { await ffmpeg.deleteFile(inputName); } catch {}
  try { await ffmpeg.deleteFile(outputName); } catch {}

  onStage(Stage.DONE, '完成', 100);
  return { cancelled: false, blob, format: outputFormat };
}

// 音频格式→编码器映射（格式名不能直接当编码器名用）
const EXTRACT_FORMAT_TO_CODEC = {
  mp3: 'libmp3lame',
  aac: 'aac',
  wav: 'pcm_s16le',
  flac: 'flac',
  ogg: 'libvorbis',
  opus: 'libopus',
  m4a: 'aac',
};

async function executeExtract(file, onStage) {
  // 简化实现：调用原来的 doExtractAudio 逻辑
  onStage(Stage.LOAD_FFMPEG, '检查 FFmpeg 内核...', 5);
  await loadFFmpeg();

  const format = document.getElementById('extract-format').value;
  const inputExt = file.name.split('.').pop()?.toLowerCase() || 'mp4';
  const inputName = `input_${Date.now()}.${inputExt}`;
  const outputName = getOutputName(format, file.name);

  onStage(Stage.READ_FILE, `正在读取 ${file.name}...`, 10);
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  const args = ['-i', inputName, '-vn', '-threads', '0'];
  if (format === 'copy') {
    args.push('-c:a', 'copy');
  } else {
    const codec = EXTRACT_FORMAT_TO_CODEC[format] || format;
    args.push('-c:a', codec);
    const abitrate = document.getElementById('extract-bitrate').value;
    if (abitrate === 'custom') {
      const custom = document.getElementById('custom-extract-bitrate').value;
      if (custom) args.push('-b:a', custom);
    } else if (abitrate !== 'auto') {
      args.push('-b:a', abitrate);
    }
  }
  args.push(outputName);

  ffmpeg.on('progress', ({ progress }) => {
    if (!isFinite(progress)) return;
    const pct = Math.min(95, 10 + Math.max(0, Math.min(1, progress)) * 85);
    onStage(Stage.CONVERT, `正在提取音频...`, pct);
  });
  onStage(Stage.CONVERT, `开始提取 → ${format.toUpperCase()}`, 10);
  try {
    await ffmpeg.exec(args);
  } catch (err) {
    if (taskQueue.abortRequested) return { cancelled: true };
    throw err;
  } finally {
    ffmpeg.off('progress');
  }

  onStage(Stage.READ_RESULT, '正在读取结果...', 96);
  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data.buffer], { type: `audio/${format === 'aac' ? 'aac' : format === 'm4a' ? 'mp4' : format}` });

  if (blob.size === 0) {
    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}
    throw new Error(`提取失败：输出为空（目标格式 ${format} 可能不被支持）`);
  }

  try { await ffmpeg.deleteFile(inputName); } catch {}
  try { await ffmpeg.deleteFile(outputName); } catch {}

  onStage(Stage.DONE, '完成', 100);
  return { cancelled: false, blob, format };
}

async function executeTrim(file, onStage) {
  onStage(Stage.LOAD_FFMPEG, '检查 FFmpeg 内核...', 5);
  await loadFFmpeg();

  const format = document.getElementById('trim-format').value;
  const trimMode = document.querySelector('input[name="trim-mode"]:checked')?.value || 'fast';
  const parsedStart = parseTime(document.getElementById('trim-start').value);
  if (parsedStart !== null && isNaN(parsedStart)) throw new Error('入点时间格式无效');
  const startTime = parsedStart || 0;
  const endTimeRaw = document.getElementById('trim-end').value;
  const endTime = endTimeRaw ? parseTime(endTimeRaw) : null;
  if (endTimeRaw && isNaN(endTime)) throw new Error('出点时间格式无效');
  if (endTime !== null && !isNaN(endTime) && endTime > 0 && startTime >= endTime) {
    throw new Error('入点必须小于出点');
  }

  const inputExt = file.name.split('.').pop()?.toLowerCase() || 'mp4';
  const inputName = `input_${Date.now()}.${inputExt}`;
  const outputName = getOutputName(format, file.name);

  onStage(Stage.READ_FILE, `正在读取 ${file.name}...`, 10);
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  const args = [];
  if (format === 'copy' || trimMode === 'fast') {
    if (startTime > 0) args.push('-ss', startTime.toString());
    args.push('-i', inputName);
    if (endTime !== null && !isNaN(endTime)) {
      const dur = endTime - startTime;
      if (dur > 0) args.push('-t', dur.toString());
    }
    args.push('-c', 'copy');
  } else {
    args.push('-i', inputName);
    args.push('-threads', '0');
    if (startTime > 0) args.push('-ss', startTime.toString());
    if (endTime !== null && !isNaN(endTime)) {
      const dur = endTime - startTime;
      if (dur > 0) args.push('-t', dur.toString());
    }
    const vcodec = document.getElementById('trim-vcodec').value;
    const acodec = document.getElementById('trim-acodec').value;
    if (vcodec !== 'copy') args.push('-c:v', vcodec, '-preset', 'veryfast');
    if (acodec === 'copy') args.push('-c:a', 'copy');
    else args.push('-c:a', acodec, '-b:a', '128k');
  }

  // AMV 裁剪特殊处理：覆盖编码参数为 AMV 专用编码器
  if (format === 'amv') {
    const needCodecs = ['amv', 'adpcm_ima_amv'];
    const missing = needCodecs.filter(c => availableEncoders && !availableEncoders.has(c));
    if (missing.length > 0 || (availableMuxers && !availableMuxers.has('amv'))) {
      try { await ffmpeg.deleteFile(inputName); } catch {}
      throw new Error(`当前 FFmpeg 内核不支持 AMV 编码（缺少: ${missing.join(', ') || 'amv 复用器'}）`);
    }
    const amvFps = 15;
    const blockSize = 22050 / amvFps;
    // 重新构造 args：保留 -i 和时间参数，替换编码参数
    const newArgs = ['-i', inputName];
    if (startTime > 0) newArgs.push('-ss', startTime.toString());
    if (endTime !== null && !isNaN(endTime)) {
      const dur = endTime - startTime;
      if (dur > 0) newArgs.push('-t', dur.toString());
    }
    newArgs.push('-vf', 'scale=160:128', '-pix_fmt', 'yuvj420p', '-r', String(amvFps),
      '-c:v', 'amv', '-c:a', 'adpcm_ima_amv', '-ac', '1', '-ar', '22050',
      '-block_size', String(blockSize),
      '-threads', '0', '-f', 'amv', '-y', outputName);
    args.length = 0;
    args.push(...newArgs);
  } else {
    args.push(outputName);
  }

  ffmpeg.on('progress', ({ progress }) => {
    if (!isFinite(progress)) return;
    const pct = Math.min(95, 10 + Math.max(0, Math.min(1, progress)) * 85);
    onStage(Stage.CONVERT, `正在裁剪...`, pct);
  });
  onStage(Stage.CONVERT, `开始裁剪 → ${format.toUpperCase()}`, 10);
  try {
    await ffmpeg.exec(args);
  } catch (err) {
    if (taskQueue.abortRequested) return { cancelled: true };
    throw err;
  } finally {
    ffmpeg.off('progress');
  }

  onStage(Stage.READ_RESULT, '正在读取结果...', 96);
  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data.buffer], { type: getMimeType(format) });

  if (blob.size === 0) {
    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}
    throw new Error(`裁剪失败：输出为空（目标格式 ${format} 可能不被支持）`);
  }

  try { await ffmpeg.deleteFile(inputName); } catch {}
  try { await ffmpeg.deleteFile(outputName); } catch {}

  onStage(Stage.DONE, '完成', 100);
  return { cancelled: false, blob, format };
}

function showResults() {
  const section = document.getElementById('download-section');
  const listEl = document.getElementById('result-list');
  const statsEl = document.getElementById('download-stats');

  // 过滤掉放弃的
  const valid = taskQueue.results.filter(r => !r.cancelled && r.blob);
  if (valid.length === 0) {
    section.hidden = true;
    document.getElementById('progress-section').hidden = true;
    document.getElementById('btn-convert').hidden = false;
    return;
  }

  section.hidden = false;
  document.getElementById('progress-section').hidden = true;
  statsEl.textContent = `共 ${valid.length} 个文件成功`;

  listEl.innerHTML = valid.map((r, i) => {
    const sizeMB = (r.blob.size / 1024 / 1024).toFixed(1);
    const url = URL.createObjectURL(r.blob);
    const dlName = r.file.name.replace(/\.[^.]+$/, '') + `_converted.${r.format}`;
    return `<li class="result-item">
      <span class="result-item__name" title="${r.file.name}">${dlName}</span>
      <span class="result-item__size">${sizeMB} MB</span>
      <a class="result-item__dl" href="${url}" download="${dlName}">下载</a>
      <button class="result-item__skip" data-i="${i}">放弃</button>
    </li>`;
  }).join('');

  // 单个放弃
  listEl.querySelectorAll('.result-item__skip').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i);
      const r = valid[i];
      if (r.blob) {
        // 释放对应的 blob URL
        const li = btn.closest('li');
        const link = li.querySelector('.result-item__dl');
        if (link && link.href.startsWith('blob:')) {
          URL.revokeObjectURL(link.href);
        }
        li.remove();
        // 更新统计
        const remaining = listEl.querySelectorAll('li').length;
        if (remaining === 0) {
          section.hidden = true;
          document.getElementById('btn-convert').hidden = false;
        } else {
          statsEl.textContent = `共 ${remaining} 个文件保留`;
        }
      }
    });
  });
}

function bindCancelButtons() {
  document.getElementById('btn-cancel-current').addEventListener('click', async () => {
    if (!taskQueue.isRunning) return;
    taskQueue.abortRequested = true;
    setStage('已请求中断', '正在停止当前任务...', 0);
    // 终止 FFmpeg 实例，触发当前 ffmpeg.exec 抛出
    if (ffmpeg) {
      try { ffmpeg.terminate(); } catch (e) {}
    }
    ffmpeg = null;  // 下次 loadFFmpeg 会重建
  });

  document.getElementById('btn-cancel-all').addEventListener('click', async () => {
    if (!taskQueue.isRunning) return;
    taskQueue.abortAll = true;
    taskQueue.abortRequested = true;
    setStage('已请求中断全部', '正在停止所有任务...', 0);
    if (ffmpeg) {
      try { ffmpeg.terminate(); } catch (e) {}
    }
    ffmpeg = null;
  });

  document.getElementById('btn-download-all').addEventListener('click', () => {
    // 触发每个 li 中的 a 链接依次下载
    document.querySelectorAll('#result-list .result-item__dl').forEach((a, i) => {
      setTimeout(() => a.click(), i * 200);
    });
  });

  document.getElementById('btn-clear-result').addEventListener('click', () => {
    document.querySelectorAll('#result-list .result-item__dl').forEach(a => {
      if (a.href.startsWith('blob:')) URL.revokeObjectURL(a.href);
    });
    document.getElementById('download-section').hidden = true;
    document.getElementById('result-list').innerHTML = '';
    document.getElementById('btn-convert').hidden = false;
  });
}



/* ========== 模式切换 ========== */
function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('mode-tab--active'));
  document.querySelector(`.mode-tab[data-mode="${mode}"]`).classList.add('mode-tab--active');

  document.getElementById('settings-convert').hidden = mode !== 'convert';
  document.getElementById('settings-extract-audio').hidden = mode !== 'extract-audio';
  document.getElementById('settings-trim').hidden = mode !== 'trim';

  // 切换到剪辑模式时加载视频预览
  if (mode === 'trim' && inputFile) {
    loadTrimPreview();
  } else {
    unloadTrimPreview();
  }
}

/* ========== 视频裁剪预览 ========== */
let trimState = {
  duration: 0,
  start: 0,
  end: 0,
  videoUrl: null,
};

/* ========== 强制播放：用 FFmpeg 解封装后通过 MSE 直接喂给浏览器 ========== */
async function forcePlayVideo(file) {
  const video = document.getElementById('trim-video');
  const warning = document.getElementById('trim-codec-warning');
  const transcodeBtn = document.getElementById('btn-transcode-for-preview');
  const vLoading = document.getElementById('trim-video-loading');
  const vLoadingText = document.getElementById('trim-video-loading-text');
  const vLoadingFill = document.getElementById('trim-video-loading-fill');
  const globalLoading = document.getElementById('loading-section');

  warning.hidden = true;
  transcodeBtn.hidden = true;
  vLoading.hidden = false;
  vLoadingText.textContent = '正在加载 FFmpeg 内核...';
  vLoadingFill.style.width = '0%';

  try {
    await loadFFmpeg();

    const inputExt = file.name.split('.').pop()?.toLowerCase() || 'mts';
    const isInterlacedSource = ['mts', 'm2ts', 'ts', 'mod'].includes(inputExt);
    const deinterlaceEnabled = document.getElementById('trim-deinterlace-enabled')?.checked ?? true;
    const shouldDeinterlace = isInterlacedSource && deinterlaceEnabled;
    const inputName = `forceplay_input.${inputExt}`;
    const outputName = 'forceplay_output.mp4';

    vLoadingText.textContent = '正在读取文件...';
    vLoadingFill.style.width = '5%';
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    vLoadingFill.style.width = '15%';

    // 构造转码命令：预览用途，跳过音频，720p 限制，tune fastdecode
    const vfChain = [];
    if (shouldDeinterlace) vfChain.push('bwdif=mode=send_field:parity=auto:deint=all');
    vfChain.push("scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease");
    vfChain.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
    const vfStr = vfChain.join(',');

    const buildArgs = () => [
      '-i', inputName,
      '-vf', vfStr,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '23',
      '-an',
      '-threads', '0',
      '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-y', outputName,
    ];

    // 绑定进度回调（仅本次 exec 有效）
    const progressHandler = ({ progress }) => {
      // 进度区间 15% → 90%
      const p = Math.max(0, Math.min(1, progress || 0));
      const pct = Math.round(15 + p * 75);
      vLoadingFill.style.width = pct + '%';
      vLoadingText.textContent = `正在去隔行处理... ${pct}%`;
    };
    ffmpeg.on('progress', progressHandler);

    try {
      if (shouldDeinterlace) {
        vLoadingText.textContent = '正在去隔行处理...';
        try {
          await ffmpeg.exec(buildArgs());
        } catch {
          // bwdif 不可用 → yadif → 直接重编码
          const fallbackVf = vfChain[0] === 'bwdif=mode=send_field:parity=auto:deint=all'
            ? ['yadif=mode=send_field:parity=auto:deint=all', ...vfChain.slice(1)].join(',')
            : vfStr;
          vLoadingText.textContent = 'bwdif 不可用，回退 yadif...';
          vLoadingFill.style.width = '15%';
          try {
            await ffmpeg.exec([
              '-i', inputName,
              '-vf', fallbackVf,
              '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '23',
              '-an', '-threads', '0',
              '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
              '-y', outputName,
            ]);
          } catch {
            vLoadingText.textContent = '去隔行滤镜不可用，直接重编码...';
            vLoadingFill.style.width = '15%';
            await ffmpeg.exec([
              '-i', inputName,
              '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '23',
              '-an', '-threads', '0',
              '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
              '-y', outputName,
            ]);
          }
        }
      } else {
        // 逐行源：流复制
        vLoadingText.textContent = '正在转换容器格式（流复制）...';
        try {
          await ffmpeg.exec([
            '-i', inputName,
            '-c', 'copy',
            '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
            '-y', outputName,
          ]);
        } catch {
          vLoadingText.textContent = '流复制失败，正在重新编码...';
          vLoadingFill.style.width = '15%';
          await ffmpeg.exec(buildArgs());
        }
      }
    } finally {
      ffmpeg.off('progress', progressHandler);
    }

    vLoadingText.textContent = '正在加载预览...';
    vLoadingFill.style.width = '95%';
    const data = await ffmpeg.readFile(outputName);
    const mp4Buffer = new Uint8Array(data.buffer);

    // 用 MediaSource 直接喂给 video
    const mediaSource = new MediaSource();
    if (trimState.videoUrl) URL.revokeObjectURL(trimState.videoUrl);
    trimState.videoUrl = URL.createObjectURL(mediaSource);
    video.src = trimState.videoUrl;

    const sourceOpen = new Promise((resolve, reject) => {
      mediaSource.addEventListener('sourceopen', () => {
        try {
          const codecCandidates = [
            'video/mp4; codecs="avc1.640028,mp4a.40.2"',
            'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
            'video/mp4; codecs="avc1.640028"',
            'video/mp4; codecs="avc1.42E01E"',
            'video/mp4',
          ];
          let mime = null;
          for (const c of codecCandidates) {
            if (c === 'video/mp4' || MediaSource.isTypeSupported(c)) { mime = c; break; }
          }
          if (!mime) { reject(new Error('MSE 不支持')); return; }

          const sb = mediaSource.addSourceBuffer(mime);
          sb.addEventListener('updateend', () => {
            if (!sb.updating && mediaSource.readyState === 'open') {
              try { mediaSource.endOfStream(); } catch {}
            }
          });
          sb.addEventListener('error', () => {
            try {
              mediaSource.removeSourceBuffer(sb);
              const vo = mime.split(',')[0].trim();
              const sb2 = mediaSource.addSourceBuffer(vo);
              sb2.addEventListener('updateend', () => {
                if (!sb2.updating && mediaSource.readyState === 'open') try { mediaSource.endOfStream(); } catch {}
              });
              sb2.appendBuffer(mp4Buffer);
            } catch (e2) { reject(e2); }
          });
          sb.appendBuffer(mp4Buffer);
          resolve();
        } catch (e) { reject(e); }
      }, { once: true });
    });

    await sourceOpen;
    vLoading.hidden = true;
    warning.hidden = true;
    if (globalLoading) globalLoading.hidden = true;
    vLoadingFill.style.width = '100%';

    // 主动触发 loadedmetadata 让时间轴初始化（MSE 下 video 不会自动派发）
    if (video.duration && isFinite(video.duration)) {
      trimState.duration = video.duration;
      trimState.start = 0;
      trimState.end = video.duration;
      document.getElementById('trim-duration').textContent = formatTime(trimState.duration);
      updateTrimUI();
      try { video.currentTime = 0.1; } catch {}
      const meter = document.getElementById('audio-meter');
      if (meter && !audioMeter.ctx) setupAudioMeter(video, meter);
    } else {
      // 兜底：等 loadedmetadata
      const onMeta = () => {
        trimState.duration = video.duration;
        trimState.start = 0;
        trimState.end = video.duration;
        document.getElementById('trim-duration').textContent = formatTime(trimState.duration);
        updateTrimUI();
        try { video.currentTime = 0.1; } catch {}
        const meter = document.getElementById('audio-meter');
        if (meter && !audioMeter.ctx) setupAudioMeter(video, meter);
        video.removeEventListener('loadedmetadata', onMeta);
      };
      video.addEventListener('loadedmetadata', onMeta);
    }

    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}
  } catch (err) {
    console.error('[强制播放] 失败:', err.message);
    vLoading.hidden = true;
    warning.hidden = false;
    transcodeBtn.hidden = false;
    if (globalLoading) globalLoading.hidden = true;
    document.getElementById('trim-warning-reason').textContent = '转码失败: ' + (err.message || '未知错误');
  }
}

/** 降级播放：blob URL 方式（对 Chrome 原生支持的格式有效） */
function fallbackPlay(file) {
  const video = document.getElementById('trim-video');
  const warning = document.getElementById('trim-codec-warning');

  if (trimState.videoUrl) URL.revokeObjectURL(trimState.videoUrl);
  const mimeType = getFileMimeType(file);
  const blob = new Blob([file], { type: mimeType });
  trimState.videoUrl = URL.createObjectURL(blob);
  video.src = trimState.videoUrl;

  // 如果还是失败，显示警告 + 手动转码按钮
  const onError = () => {
    if (trimState.duration > 0) return;
    warning.hidden = false;
    document.getElementById('btn-transcode-for-preview').hidden = false;
  };
  video.addEventListener('error', onError, { once: true });
}

function loadTrimPreview() {
  const video = document.getElementById('trim-video');
  const preview = document.getElementById('trim-preview');
  const warning = document.getElementById('trim-codec-warning');
  const transcodeBtn = document.getElementById('btn-transcode-for-preview');
  if (!inputFile) {
    preview.hidden = true;
    return;
  }

  preview.hidden = false;
  warning.hidden = true;
  transcodeBtn.hidden = true;
  trimState.duration = 0;

  // 先尝试浏览器原生播放，不支持则显示警告
  fallbackPlay(inputFile);

  // 读取元数据成功
  video.addEventListener('loadedmetadata', () => {
    trimState.duration = video.duration;
    trimState.start = 0;
    trimState.end = video.duration;
    document.getElementById('trim-duration').textContent = formatTime(trimState.duration);
    updateTrimUI();
    try { video.currentTime = 0.1; } catch {}
    // 启动音频电平表
    const meter = document.getElementById('audio-meter');
    setupAudioMeter(video, meter);
  }, { once: true });

  // 播放失败时显示警告，引导用户手动转码
  const onError = () => {
    if (trimState.duration > 0) return;
    warning.hidden = false;
    transcodeBtn.hidden = false;
  };
  video.addEventListener('error', onError, { once: true });
}

function unloadTrimPreview() {
  const preview = document.getElementById('trim-preview');
  const video = document.getElementById('trim-video');
  preview.hidden = true;
  if (trimState.videoUrl) {
    URL.revokeObjectURL(trimState.videoUrl);
    trimState.videoUrl = null;
  }
  video.removeAttribute('src');
  video.load();
}

function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function timeToSeconds(str) {
  return parseTime(str) || 0;
}

function updateTrimUI() {
  if (!trimState.duration) return;
  const startPct = (trimState.start / trimState.duration) * 100;
  const endPct = (trimState.end / trimState.duration) * 100;
  document.getElementById('trim-selected').style.left = startPct + '%';
  document.getElementById('trim-selected').style.width = (endPct - startPct) + '%';
  document.getElementById('trim-handle-start').style.left = startPct + '%';
  document.getElementById('trim-handle-end').style.left = endPct + '%';

  const video = document.getElementById('trim-video');
  if (video && !video.seeking) {
    document.getElementById('trim-current').textContent = formatTime(video.currentTime);
  }

  // 同步输入框
  document.getElementById('trim-start').value = formatTimeShort(trimState.start);
  document.getElementById('trim-end').value = trimState.end >= trimState.duration ? '' : formatTimeShort(trimState.end);
}

function formatTimeShort(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/* ========== 音频电平表（实时波形/音量条） ========== */
let audioMeter = {
  ctx: null,
  analyser: null,
  source: null,
  rafId: null,
  history: new Array(80).fill(0),  // 最近 80 帧音量历史（滚动条形图）
};

function setupAudioMeter(videoEl, canvasEl) {
  if (!window.AudioContext && !window.webkitAudioContext) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;

  if (!audioMeter.ctx) {
    audioMeter.ctx = new Ctx();
    audioMeter.analyser = audioMeter.ctx.createAnalyser();
    audioMeter.analyser.fftSize = 256;
    audioMeter.source = audioMeter.ctx.createMediaElementSource(videoEl);
    audioMeter.source.connect(audioMeter.analyser);
    audioMeter.analyser.connect(audioMeter.ctx.destination);
  }

  if (audioMeter.ctx.state === 'suspended') audioMeter.ctx.resume();
  canvasEl.hidden = false;

  const ctx2d = canvasEl.getContext('2d');
  const bufLen = audioMeter.analyser.frequencyBinCount;
  const data = new Uint8Array(bufLen);

  function draw() {
    audioMeter.rafId = requestAnimationFrame(draw);
    if (videoEl.paused) {
      // 暂停时衰减历史
      audioMeter.history = audioMeter.history.map(v => v * 0.85);
    } else {
      audioMeter.analyser.getByteTimeDomainData(data);
      // 计算 RMS 电平
      let sum = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / bufLen);
      audioMeter.history.shift();
      audioMeter.history.push(rms);
    }

    // 绘制滚动条形图
    const w = canvasEl.width = canvasEl.clientWidth;
    const h = canvasEl.height = canvasEl.clientHeight;
    ctx2d.clearRect(0, 0, w, h);

    const barW = w / audioMeter.history.length;
    audioMeter.history.forEach((v, i) => {
      const x = i * barW;
      const barH = Math.min(h - 2, v * h * 2.5);
      // 颜色梯度：低音量绿、中音量黄、高音量红
      const ratio = v / 1.0;
      const r = Math.min(255, ratio * 2 * 255);
      const g = Math.min(255, (1 - Math.abs(ratio - 0.5) * 2) * 255);
      ctx2d.fillStyle = `rgb(${r}, ${g}, 80)`;
      ctx2d.fillRect(x, h - barH, Math.max(1, barW - 0.5), barH);
    });
  }
  draw();
}

function stopAudioMeter() {
  if (audioMeter.rafId) {
    cancelAnimationFrame(audioMeter.rafId);
    audioMeter.rafId = null;
  }
  const canvasEl = document.getElementById('audio-meter');
  if (canvasEl) {
    canvasEl.hidden = true;
    const ctx2d = canvasEl.getContext('2d');
    ctx2d.clearRect(0, 0, canvasEl.width, canvasEl.height);
  }
  audioMeter.history = new Array(80).fill(0);
}

function setupTrimTimeline() {
  const video = document.getElementById('trim-video');
  const timeline = document.getElementById('trim-timeline');
  const playBtn = document.getElementById('trim-play-btn');
  const playIcon = playBtn.querySelector('svg');
  const startHandle = document.getElementById('trim-handle-start');
  const endHandle = document.getElementById('trim-handle-end');

  // 播放/暂停
  playBtn.addEventListener('click', () => {
    if (video.paused) {
      video.play();
      playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    } else {
      video.pause();
      playIcon.innerHTML = '<polygon points="6 4 20 12 6 20 6 4"/>';
    }
  });

  // 播放结束
  video.addEventListener('ended', () => {
    playIcon.innerHTML = '<polygon points="6 4 20 12 6 20 6 4"/>';
  });

  // 视频时间更新
  video.addEventListener('timeupdate', () => {
    document.getElementById('trim-current').textContent = formatTime(video.currentTime);
    // 播放到出点时暂停
    if (video.currentTime >= trimState.end) {
      video.pause();
      video.currentTime = trimState.end;
      playIcon.innerHTML = '<polygon points="6 4 20 12 6 20 6 4"/>';
    }
    // 更新播放头
    if (trimState.duration) {
      const pct = (video.currentTime / trimState.duration) * 100;
      document.getElementById('trim-playhead').style.left = pct + '%';
    }
  });

  // 点击轨道跳转
  timeline.addEventListener('click', (e) => {
    if (e.target.classList.contains('trim-timeline__handle')) return;
    const rect = timeline.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const t = Math.max(0, Math.min(1, pct)) * trimState.duration;
    if (!isFinite(t)) return;
    // 跳转前先暂停，避免 currentTime 抖动
    video.pause();
    video.currentTime = t;
  });

  // 拖动播放头（点击播放头位置跳转）
  const playhead = document.getElementById('trim-playhead');
  if (playhead) {
    let draggingPlayhead = false;
    playhead.style.cursor = 'ew-resize';
    playhead.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!trimState.duration || !isFinite(trimState.duration)) return;
      draggingPlayhead = true;
      video.pause();
    });
    document.addEventListener('mousemove', (e) => {
      if (!draggingPlayhead) return;
      if (!trimState.duration || !isFinite(trimState.duration)) return;
      const rect = timeline.getBoundingClientRect();
      if (rect.width === 0) return;
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = pct * trimState.duration;
      // 限制在 [start, end] 范围内
      const clamped = Math.max(trimState.start, Math.min(trimState.end, t));
      if (isFinite(clamped)) video.currentTime = clamped;
    });
    document.addEventListener('mouseup', () => { draggingPlayhead = false; });
  }

  // 拖动把手
  function makeHandleDraggable(handle, isStart) {
    let dragging = false;
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!trimState.duration || !isFinite(trimState.duration)) return;
      dragging = true;
      video.pause();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      if (!trimState.duration || !isFinite(trimState.duration)) return;
      const rect = timeline.getBoundingClientRect();
      if (rect.width === 0) return;
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = pct * trimState.duration;
      if (isStart) {
        trimState.start = Math.max(0, Math.min(t, trimState.end - 0.1));
        if (isFinite(trimState.start)) video.currentTime = trimState.start;
      } else {
        trimState.end = Math.max(trimState.start + 0.1, Math.min(t, trimState.duration));
        if (isFinite(trimState.end)) video.currentTime = trimState.end;
      }
      updateTrimUI();
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }
  makeHandleDraggable(startHandle, true);
  makeHandleDraggable(endHandle, false);

  // 输入框手动输入同步
  document.getElementById('trim-start').addEventListener('change', function () {
    const t = timeToSeconds(this.value);
    trimState.start = Math.max(0, Math.min(t, trimState.end - 0.1));
    if (isFinite(trimState.start)) video.currentTime = trimState.start;
    updateTrimUI();
  });
  document.getElementById('trim-end').addEventListener('change', function () {
    if (!this.value) {
      trimState.end = trimState.duration;
    } else {
      const t = timeToSeconds(this.value);
      trimState.end = Math.max(t, trimState.start + 0.1);
    }
    if (isFinite(trimState.end)) video.currentTime = Math.min(video.currentTime || 0, trimState.end);
    updateTrimUI();
  });

  // 方向键微调入点/出点
  function bindTrimArrowKeys(inputEl, isStart) {
    inputEl.addEventListener('keydown', (e) => {
      if (!trimState.duration || !isFinite(trimState.duration)) return;
      const step = e.shiftKey ? 1.0 : 0.1;   // Shift+方向键 = ±1s, 否则 ±0.1s
      const minV = isStart ? 0 : trimState.start + 0.1;
      const maxV = isStart ? trimState.end - 0.1 : trimState.duration;
      let changed = false;
      if (e.key === 'ArrowLeft') {
        if (isStart) trimState.start = Math.max(minV, trimState.start - step);
        else trimState.end = Math.max(minV, trimState.end - step);
        changed = true;
      } else if (e.key === 'ArrowRight') {
        if (isStart) trimState.start = Math.min(maxV, trimState.start + step);
        else trimState.end = Math.min(maxV, trimState.end + step);
        changed = true;
      }
      if (changed) {
        e.preventDefault();
        // 同步视频头到当前边界
        if (isFinite(trimState.start) && isStart) video.currentTime = trimState.start;
        else if (isFinite(trimState.end) && !isStart) video.currentTime = trimState.end;
        updateTrimUI();
        inputEl.value = formatTimeShort(isStart ? trimState.start : trimState.end);
      }
    });
  }
  bindTrimArrowKeys(document.getElementById('trim-start'), true);
  bindTrimArrowKeys(document.getElementById('trim-end'), false);
}

/* ========== 更新输出格式提示 ========== */
function updateFormatHint() {
  const format = document.getElementById('output-format').value;
  const hint = document.getElementById('upload-hint');

  if (AUDIO_FORMATS.includes(format)) {
    hint.textContent = '当前输出为音频格式，视频将被静音转换';
  } else if (IMAGE_FORMATS.includes(format)) {
    hint.textContent = '当前输出为图片格式，将截取第一帧';
  } else {
    hint.textContent = '支持全部常见音视频 / 图片格式';
  }
}

/* ========== 事件绑定 ========== */
export function initFFmpeg() {
  // === 上传区 ===
  const uploadArea = document.getElementById('upload-area');
  const fileInput = document.getElementById('file-input');

  uploadArea.addEventListener('click', (e) => {
    // 防止点到内部元素时重复触发
    if (e.target !== fileInput) {
      fileInput.click();
    }
  });

  fileInput.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) addFiles(Array.from(e.target.files));
    fileInput.value = '';
  });

  // 拖放
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) addFiles(Array.from(e.dataTransfer.files));
  });

  // 全局拖放（防止浏览器默认打开文件）
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => { e.preventDefault(); });

  // 防止下拉框滚轮滚动时关闭并滚动主页面
  // 仅在 select 真正展开期间（mousedown 后到 change/blur 前）拦截 wheel
  let selectExpanded = false;
  document.addEventListener('mousedown', (e) => {
    if (e.target?.tagName === 'SELECT') {
      selectExpanded = true;
    } else if (document.activeElement?.tagName === 'SELECT') {
      // 点击其他区域 → 主动 blur select，避免它保持焦点拦截滚轮
      document.activeElement.blur();
      selectExpanded = false;
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target?.tagName === 'SELECT') {
      e.target.blur();
      selectExpanded = false;
    }
  });
  // select 失焦（Esc / 点击外部 / Tab）→ 清标记
  document.addEventListener('focusout', (e) => {
    if (e.target?.tagName === 'SELECT') selectExpanded = false;
  });
  document.addEventListener('wheel', (e) => {
    // 仅在 select 展开期间拦截 wheel，未展开时不影响页面滚动
    if (selectExpanded && document.activeElement?.tagName === 'SELECT') {
      e.preventDefault();
    }
  }, { passive: false });

  // === 清空全部 ===
  document.getElementById('btn-clear-all').addEventListener('click', clearAllFiles);

  // === 模式切换 ===
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });

  // === 手动转码按钮 ===
  document.getElementById('btn-transcode-for-preview').addEventListener('click', async () => {
    await forcePlayVideo(inputFile);
  });

  // === 初始化裁剪时间轴 ===
  setupTrimTimeline();

  // === 格式选择更新提示 + 编码器/帧率自动筛选 ===见下方 output-format change 监听

  // === AMV 帧率筛选：AMV 要求 sample_rate % frame_rate === 0（22050 的因数）===
  // AMV 支持的帧率：10/14/15/18/21/25/30（block_size = 22050/fps 自动计算）
  const AMV_FPS_RATES = [10, 14, 15, 18, 21, 25, 30];
  const fpsSelect = document.getElementById('fps');
  const originalFpsOptions = fpsSelect.innerHTML;

  // 格式→编码器映射表（容器对编解码器的硬性约束）
  const FORMAT_CODEC_MAP = {
    webm: { vcodec: 'libvpx-vp9', acodec: 'libopus', vcodecOptions: ['libvpx-vp9', 'libvpx'], acodecOptions: ['libopus', 'libvorbis'] },
    ogv:  { vcodec: 'libtheora', acodec: 'libvorbis', vcodecOptions: ['libtheora'], acodecOptions: ['libvorbis'] },
  };
  // 音频格式→强制编码器映射（容器要求特定编码器）
  const AUDIO_FORMAT_CODEC_MAP = {
    wma: 'wmav2',
    aiff: 'pcm_s16be',
  };

  function filterFpsForAmv() {
    const fmt = document.getElementById('output-format').value;
    const customFps = document.getElementById('custom-fps');
    if (fmt === 'amv') {
      fpsSelect.innerHTML = AMV_FPS_RATES.map(r => `<option value="${r}">${r} fps</option>`).join('');
      fpsSelect.value = '15';
      customFps.hidden = true;
    } else {
      fpsSelect.innerHTML = originalFpsOptions;
    }
  }

  // 格式切换时自动调整编码器选项 & 视频/图片输出时隐藏/显示视频设置
  const vcodecSelect = document.getElementById('video-codec');
  const acodecSelect = document.getElementById('audio-codec');
  const originalVcodecOptions = vcodecSelect.innerHTML;
  const originalAcodecOptions = acodecSelect.innerHTML;

  // 视频相关设置项（音频/图片输出时应隐藏）
  const VIDEO_SETTING_IDS = [
    'setting-vcodec',     // 视频编码器
    'setting-resolution', // 分辨率
    'setting-fps',        // 帧率
    'setting-vbitrate',   // 视频码率
    'setting-preset-speed', // 编码速度
    'setting-quality',    // 输出质量（CRF）
    'setting-deinterlace', // 去隔行
  ];

  function updateVideoSettingsVisibility() {
    const fmt = document.getElementById('output-format').value;
    const hideVideo = AUDIO_FORMATS.includes(fmt) || IMAGE_FORMATS.includes(fmt);
    VIDEO_SETTING_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.hidden = hideVideo;
    });
    // 图片输出时额外隐藏音频码率（图片无音频流）
    const hideAudio = IMAGE_FORMATS.includes(fmt);
    const abitrateSetting = document.getElementById('setting-abitrate');
    if (abitrateSetting) abitrateSetting.hidden = hideAudio;
    // 更新 copy-mode 提示
    updateCopyModeUI();
  }

  function filterCodecsForFormat() {
    const fmt = document.getElementById('output-format').value;
    const isAudio = AUDIO_FORMATS.includes(fmt);
    const isImage = IMAGE_FORMATS.includes(fmt);

    if (isImage) {
      // 图片输出：展示完整编码器选项但隐藏视频设置（由 updateVideoSettingsVisibility 处理）
      vcodecSelect.innerHTML = originalVcodecOptions;
      acodecSelect.innerHTML = originalAcodecOptions;
    } else if (isAudio) {
      // 音频输出：展示完整编码器选项但隐藏视频设置
      vcodecSelect.innerHTML = originalVcodecOptions;
      acodecSelect.innerHTML = originalAcodecOptions;
    } else {
      const map = FORMAT_CODEC_MAP[fmt];
      if (map) {
        // 视频格式：只保留该格式支持的编码器选项
        vcodecSelect.innerHTML = map.vcodecOptions.map(v => {
          const labels = { 'libvpx-vp9': 'VP9 (libvpx-vp9)', 'libvpx': 'VP8 (libvpx)', 'libtheora': 'Theora (libtheora)' };
          return `<option value="${v}">${labels[v] || v}</option>`;
        }).join('');
        vcodecSelect.value = map.vcodec;
        acodecSelect.innerHTML = map.acodecOptions.map(a => {
          const labels = { 'libopus': 'Opus (libopus)', 'libvorbis': 'Vorbis (libvorbis)' };
          return `<option value="${a}">${labels[a] || a}</option>`;
        }).join('');
        acodecSelect.value = map.acodec;
      } else if (AUDIO_FORMAT_CODEC_MAP[fmt]) {
        // 音频格式：锁定为容器要求的编码器
        vcodecSelect.innerHTML = originalVcodecOptions;
        const forcedCodec = AUDIO_FORMAT_CODEC_MAP[fmt];
        const labels = { 'wmav2': 'WMA v2 (wmav2)', 'pcm_s16be': 'PCM 大端 (pcm_s16be)' };
        acodecSelect.innerHTML = `<option value="${forcedCodec}">${labels[forcedCodec] || forcedCodec}</option>`;
        acodecSelect.value = forcedCodec;
      } else if (fmt !== 'amv') {
        vcodecSelect.innerHTML = originalVcodecOptions;
        acodecSelect.innerHTML = originalAcodecOptions;
      }
    }
    updateVideoSettingsVisibility();
  }

  document.getElementById('output-format').addEventListener('change', () => {
    filterFpsForAmv();
    filterCodecsForFormat();
    updateFormatHint();
  });

  // === 分辨率自定义显示 ===
  document.getElementById('resolution-preset').addEventListener('change', function () {
    document.getElementById('resolution-custom').hidden = this.value !== 'custom';
  });

  // === 帧率自定义显示 ===
  document.getElementById('fps').addEventListener('change', function () {
    document.getElementById('custom-fps').hidden = this.value !== 'custom';
  });

  // === 视频码率自定义显示 ===
  document.getElementById('video-bitrate').addEventListener('change', function () {
    document.getElementById('custom-vbitrate').hidden = this.value !== 'custom';
  });

  // === 音频码率自定义显示 ===
  document.getElementById('audio-bitrate').addEventListener('change', function () {
    document.getElementById('custom-abitrate').hidden = this.value !== 'custom';
  });

  // === 流复制: 隐藏质量/码率/速度选项 (它们对 copy 无效) ===
  function updateCopyModeUI() {
    const fmt = document.getElementById('output-format').value;
    // 音频/图片输出时视频设置已由 updateVideoSettingsVisibility 隐藏，不在此重复控制
    const isVideoOutput = !AUDIO_FORMATS.includes(fmt) && !IMAGE_FORMATS.includes(fmt);

    const vcodec = document.getElementById('video-codec').value;
    const acodec = document.getElementById('audio-codec').value;

    const vCopy = vcodec === 'copy';
    const aCopy = acodec === 'copy';

    // 只在视频输出模式下控制视频相关设置显隐
    if (isVideoOutput) {
      document.getElementById('setting-vbitrate').hidden = vCopy;
      document.getElementById('setting-quality').hidden = vCopy;
      document.getElementById('setting-preset-speed').hidden = vCopy;
      document.getElementById('setting-resolution').hidden = vCopy;
      document.getElementById('setting-fps').hidden = vCopy;
    }

    document.getElementById('setting-abitrate').hidden = aCopy;

    const isAllCopy = vCopy && aCopy;
    document.getElementById('copy-mode-note').hidden = isVideoOutput ? !isAllCopy : true;

    updateSettingsSummary();
  }

  // === 提取音频: 流复制时隐藏码率 ===
  function updateExtractCopyMode() {
    const format = document.getElementById('extract-format').value;
    document.getElementById('setting-extract-bitrate').hidden = format === 'copy';
  }

  // === 更新配置摘要 (折叠时显示) ===
  function updateSettingsSummary() {
    const summary = document.getElementById('settings-convert-summary');
    if (!summary) return;
    const format = document.getElementById('output-format');
    const formatText = format.options[format.selectedIndex].text.split(' ')[0];
    const vcodec = document.getElementById('video-codec').value;
    const acodec = document.getElementById('audio-codec').value;
    const vCopy = vcodec === 'copy';
    const aCopy = acodec === 'copy';

    let parts = [formatText];
    if (vCopy && aCopy) {
      parts.push('流复制');
    } else {
      if (vCopy) parts.push('视频流复制');
      if (aCopy) parts.push('音频流复制');
    }
    summary.textContent = '· ' + parts.join(' · ');
  }

  document.getElementById('video-codec').addEventListener('change', updateCopyModeUI);
  document.getElementById('audio-codec').addEventListener('change', updateCopyModeUI);
  document.getElementById('output-format').addEventListener('change', updateSettingsSummary);
  document.getElementById('extract-format').addEventListener('change', updateExtractCopyMode);
  // 裁剪模式切换时显示/隐藏编码器选择
  document.querySelectorAll('input[name="trim-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      const isAccurate = document.querySelector('input[name="trim-mode"]:checked')?.value === 'accurate';
      document.getElementById('setting-trim-vcodec').hidden = !isAccurate;
      document.getElementById('setting-trim-acodec').hidden = !isAccurate;
    });
  });
  // 初始化裁剪编码器显隐（默认 fast 模式隐藏）
  const initTrimMode = document.querySelector('input[name="trim-mode"]:checked')?.value;
  const initAccurate = initTrimMode === 'accurate';
  document.getElementById('setting-trim-vcodec').hidden = !initAccurate;
  document.getElementById('setting-trim-acodec').hidden = !initAccurate;
  // 去隔行切换不再影响设置区显隐（解耦）
  // 初始化
  updateCopyModeUI();
  updateExtractCopyMode();

  // === 折叠/展开设置区 ===
  document.querySelectorAll('.settings-header').forEach((header) => {
    header.addEventListener('click', () => {
      const section = header.closest('.settings-section');
      section.classList.toggle('settings-section--expanded');
    });
  });

  // === 质量选择 ===
  document.querySelectorAll('.quality-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.quality-preset').forEach((b) => b.classList.remove('quality-preset--active'));
      btn.classList.add('quality-preset--active');
      selectedQuality = btn.dataset.quality;
    });
  });

  // === 开始转换 ===
  document.getElementById('btn-convert').addEventListener('click', () => {
    if (!inputFile) return;
    const modeMap = { 'convert': 'convert', 'extract-audio': 'extract', 'trim': 'trim' };
    const mode = modeMap[currentMode] || 'convert';
    // 收集所有上传文件作为任务
    taskQueue.items = files.map(f => ({ file: f, mode, status: 'pending', progress: 0 }));
    runTaskQueue();
  });

  // 绑定中断/下载按钮
  bindCancelButtons();
}