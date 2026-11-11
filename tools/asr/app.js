/**
 * 语音转文字（ASR）核心逻辑
 *
 * 流程：麦克风录音 / 音频文件 → Web Audio 解码为 16kHz 单声道 Float32Array
 *      → Worker 内 Whisper 模型推理 → 文本
 * 音频与模型推理全程在浏览器本地，不上传任何服务器。
 */
import { copyWithFeedback, flashHint } from '/assets/js/clipboard.js';
import { downloadBlob } from '/assets/js/download.js';
import { showToast } from '/assets/js/toast.js';
import { mountResourcePanel } from '/assets/js/resource-hub.js';
import {
  ASR_HOST_MIRROR,
  ASR_HOST_OFFICIAL,
  ASR_MODEL_TOTAL,
  ASR_MODEL_FILES,
  getAsrHost,
  setAsrHost,
} from './model-registry.js';

const TARGET_RATE = 16000; // Whisper 要求的采样率

/* ========== 状态 ========== */
let worker = null;
let reqSeq = 0;
let pending = null; // { id, resolve, reject }
let busy = false;

let sourceType = 'record';
let fileAudio = null;   // Float32Array
let fileInfo = null;    // { name, duration, size }

let recorder = null;
let recordChunks = [];
let recordStart = 0;
let recordTimer = null;
let audioContext = null;
let analyser = null;
let waveFrame = null;

/* ========== DOM ========== */
const $ = (id) => document.getElementById(id);

function setBusy(on) {
  busy = on;
  $('btn-transcribe').disabled = on || (!fileAudio && sourceType === 'file') || (sourceType === 'record' && !recordChunks.length);
  $('btn-cancel').disabled = !on;
  $('btn-record').disabled = on || !!recorder;
  $('btn-stop').disabled = on || !recorder;
  for (const el of document.querySelectorAll('.asr-tab')) el.disabled = on;
  $('asr-language').disabled = on;
  $('asr-host').disabled = on;
}

function showError(msg) {
  const el = $('asr-error');
  el.hidden = false;
  el.textContent = msg;
}

function hideError() {
  $('asr-error').hidden = true;
  $('asr-error').textContent = '';
}

/* ========== 进度 ========== */
const fileProgress = new Map();

function resetProgress() {
  fileProgress.clear();
  $('asr-progress').hidden = false;
  $('asr-progress-title').textContent = '准备中…';
  $('asr-progress-pct').textContent = '';
  $('asr-progress-fill').style.width = '0%';
  $('asr-progress-status').textContent = '';
  $('asr-progress-files').textContent = '';
  $('asr-empty').hidden = true;
  $('asr-result').hidden = true;
}

function renderProgress() {
  // 用「已完成文件数 / 总文件数」+ 当前文件百分比给出整体进度。
  // 模型各文件体积差异大，按件均分会有跳跃；这里按体积加权更接近真实。
  let doneBytes = 0;
  let active = null;
  for (const f of ASR_MODEL_FILES) {
    const p = fileProgress.get(f.name) || 0;
    doneBytes += f.size * p;
    if (p > 0 && p < 1 && (!active || p > active.p)) active = { name: f.name, p };
  }
  const overall = Math.min(100, Math.round((doneBytes / ASR_MODEL_TOTAL) * 100));
  $('asr-progress-fill').style.width = overall + '%';
  $('asr-progress-pct').textContent = overall + '%';
  if (active) {
    $('asr-progress-status').textContent = `正在下载 ${active.name} · ${Math.round(active.p * 100)}%`;
  }
  const lines = ASR_MODEL_FILES.map((f) => {
    const p = fileProgress.get(f.name) || 0;
    const mark = p >= 1 ? '完成' : p > 0 ? Math.round(p * 100) + '%' : '等待';
    return `${f.name} · ${mark}`;
  });
  $('asr-progress-files').textContent = lines.join('\n');
}

function friendlyFileName(raw) {
  if (!raw) return '';
  const name = String(raw).split('/').pop();
  return name || String(raw).slice(0, 60);
}

/* ========== Worker 管理 ========== */
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./asr-worker.js', import.meta.url), { type: 'module' });

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'log':
        $('asr-progress-status').textContent = data.message;
        break;
      case 'file-start':
        fileProgress.set(friendlyFileName(data.file), 0);
        renderProgress();
        break;
      case 'progress': {
        const name = friendlyFileName(data.file);
        fileProgress.set(name, Math.max(fileProgress.get(name) || 0, data.progress || 0));
        $('asr-progress-title').textContent = '首次使用：下载语音识别模型';
        renderProgress();
        break;
      }
      case 'file-done':
        fileProgress.set(friendlyFileName(data.file), 1);
        renderProgress();
        break;
      case 'model-ready':
        $('asr-progress-title').textContent = '模型已就绪';
        $('asr-progress-status').textContent = data.webgpu ? 'WebGPU 加速已启用' : 'WASM 推理已就绪';
        renderProgress();
        break;
      case 'status':
        $('asr-progress-status').textContent = data.message;
        break;
      case 'result':
        if (pending && pending.id === data.id) {
          hideError();
          showResult(data);
          finishPending();
        }
        break;
      case 'cancelled':
        if (pending && pending.id === data.id) {
          showToast('已取消转写', 'info');
          finishPending();
        }
        break;
      case 'error':
        if (pending && pending.id === data.id) {
          showError('转写失败：' + (data.message || '未知错误') + '\n\n可尝试切换模型下载源后重试，或查看浏览器控制台了解详情。');
          console.error('[ASR] worker error:', data);
          finishPending();
        }
        break;
      default:
        break;
    }
  };

  worker.onerror = (e) => {
    showError('识别引擎启动失败：' + (e.message || '未知错误'));
    if (pending) finishPending();
    worker = null;
  };

  return worker;
}

function finishPending() {
  pending = null;
  setBusy(false);
  $('asr-progress').hidden = true;
}

/* ========== 音频处理 ========== */
/** 任意 AudioBuffer → 16kHz 单声道 Float32Array */
function resampleTo16k(buffer) {
  const ch = buffer.getChannelData(0);
  const ratio = buffer.sampleRate / TARGET_RATE;
  if (Math.abs(buffer.sampleRate - TARGET_RATE) < 1) {
    return new Float32Array(ch);
  }
  const outLen = Math.max(1, Math.round(ch.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    // 线性插值足够 Whisper 使用；高采样率下混叠影响可忽略
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(ch.length - 1, i0 + 1);
    const t = src - i0;
    out[i] = ch[i0] * (1 - t) + ch[i1] * t;
  }
  return out;
}

async function getAudioContext() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') await audioContext.resume();
  return audioContext;
}

/** 文件 → Float32Array */
async function decodeFile(file) {
  const ctx = await getAudioContext();
  const bytes = await file.arrayBuffer();
  let buffer;
  try {
    buffer = await ctx.decodeAudioData(bytes);
  } catch {
    throw new Error('无法解码该音频文件，请换用 MP3 / WAV / M4A / OGG 等常见格式');
  }
  return {
    audio: resampleTo16k(buffer),
    duration: buffer.duration,
    size: file.size,
    name: file.name,
  };
}

/* ========== 录音 ========== */
async function startRecord() {
  hideError();
  if (!navigator.mediaDevices?.getUserMedia) {
    showError('当前浏览器不支持麦克风录音，请使用音频文件方式，或换用 HTTPS 环境访问。');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recordChunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) recordChunks.push(e.data); };
    recorder.onstart = () => {
      $('record-box').classList.add('asr-record-box--recording');
      $('record-hint').textContent = '正在录音…';
      recordStart = Date.now();
      recordTimer = setInterval(() => {
        const s = Math.floor((Date.now() - recordStart) / 1000);
        $('record-time').textContent = `已录音 ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} · 建议不超过 30 秒`;
      }, 250);
      startWave(stream);
      setBusy(false);
    };
    recorder.onstop = async () => {
      clearInterval(recordTimer);
      stopWave();
      stream.getTracks().forEach((t) => t.stop());
      $('record-box').classList.remove('asr-record-box--recording');
      $('record-hint').textContent = '录音完成，可开始转写';
      $('record-time').textContent = `时长 ${((Date.now() - recordStart) / 1000).toFixed(1)} 秒`;
      if (recordChunks.length) {
        try {
          const blob = new Blob(recordChunks, { type: recorder.mimeType || 'audio/webm' });
          const file = new File([blob], 'recording.webm', { type: blob.type });
          const decoded = await decodeFile(file);
          fileAudio = decoded.audio;
          fileInfo = { name: '麦克风录音', duration: decoded.duration, size: blob.size };
          setBusy(false);
        } catch (e) {
          showError(e.message);
        }
      }
    };
    recorder.start();
  } catch (e) {
    showError('无法访问麦克风：' + (e.message || '请检查浏览器权限设置'));
  }
}

function stopRecord() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

/* ========== 波形可视化 ========== */
function startWave(stream) {
  const box = $('wave-box');
  box.hidden = false;
  const canvas = $('wave-canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  const c = canvas.getContext('2d');

  (async () => {
    const ctx = await getAudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const draw = () => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      c.clearRect(0, 0, canvas.width, canvas.height);
      const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6366f1';
      c.strokeStyle = color;
      c.lineWidth = 2 * dpr;
      c.beginPath();
      const step = canvas.width / data.length;
      for (let i = 0; i < data.length; i++) {
        const y = (data[i] / 128) * (canvas.height / 2);
        if (i === 0) c.moveTo(0, y); else c.lineTo(i * step, y);
      }
      c.stroke();
      waveFrame = requestAnimationFrame(draw);
    };
    draw();
  })().catch(() => { /* 波形失败不影响录音 */ });
}

function stopWave() {
  if (waveFrame) cancelAnimationFrame(waveFrame);
  waveFrame = null;
  analyser = null;
  $('wave-box').hidden = true;
}

/* ========== 结果 ========== */
function showResult(data) {
  $('asr-output').value = data.text || '';
  const bits = [];
  if (fileInfo) bits.push(`${fileInfo.name} · ${fileInfo.duration.toFixed(1)} 秒`);
  if (data.language) bits.push(`语言：${data.language}`);
  bits.push(data.host === ASR_HOST_MIRROR ? '镜像源' : '官方源');
  $('asr-result-meta').textContent = bits.join(' · ');
  $('asr-result').hidden = false;
}

/* ========== 转写调度 ========== */
function startTranscribe() {
  const audio = fileAudio;
  if (!audio || !audio.length) {
    showToast('请先录音或选择音频文件', 'warning');
    return;
  }
  hideError();
  resetProgress();
  setBusy(true);

  const w = getWorker();
  const id = ++reqSeq;
  pending = { id };

  w.postMessage({
    id,
    type: 'transcribe',
    payload: {
      audio,
      host: getAsrHost(),
      options: { language: $('asr-language').value || null },
    },
  });
}

function cancelTranscribe() {
  if (!pending || !worker) return;
  cancelled = true;
  // 模型下载阶段库内部 fetch 无法从外部中断，
  // 直接 terminate Worker 才能真正停下；下次转写会重新创建 Worker。
  // 已完整下载的文件仍在 Cache API 里，不会白下。
  worker.terminate();
  worker = null;
  pending = null;
  setBusy(false);
  $('asr-progress').hidden = true;
  showToast('已取消转写', 'info');
}

/* ========== 文件选择 ========== */
async function loadFile(file) {
  if (!file) return;
  hideError();
  try {
    const decoded = await decodeFile(file);
    fileAudio = decoded.audio;
    fileInfo = { name: file.name, duration: decoded.duration, size: file.size };
    $('asr-file-name').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
    $('asr-file-info').hidden = false;
    $('asr-file-detail').textContent = `时长 ${decoded.duration.toFixed(1)} 秒 · 已转为 16kHz 单声道`;
    setBusy(false);
  } catch (e) {
    showError(e.message);
  }
}

function clearFile() {
  fileAudio = null;
  fileInfo = null;
  $('asr-file').value = '';
  $('asr-file-info').hidden = true;
  $('asr-file-name').textContent = '支持 MP3 / WAV / M4A / OGG / WebM / FLAC';
  setBusy(false);
}

/* ========== 初始化 ========== */
function switchSource(type) {
  sourceType = type;
  for (const tab of document.querySelectorAll('.asr-tab')) {
    const active = tab.dataset.source === type;
    tab.classList.toggle('asr-tab--active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  for (const panel of document.querySelectorAll('.asr-source')) {
    panel.classList.toggle('asr-source--active', panel.dataset.source === type);
  }
  setBusy(false);
}

function initEvents() {
  for (const tab of document.querySelectorAll('.asr-tab')) {
    tab.addEventListener('click', () => switchSource(tab.dataset.source));
  }

  $('btn-record').addEventListener('click', startRecord);
  $('btn-stop').addEventListener('click', stopRecord);
  $('btn-transcribe').addEventListener('click', startTranscribe);
  $('btn-cancel').addEventListener('click', cancelTranscribe);

  const fileInput = $('asr-file');
  const dropzone = $('asr-dropzone');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    loadFile(e.dataTransfer.files[0]);
  });
  document.addEventListener('paste', (e) => {
    if (sourceType !== 'file' || busy) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('audio/'));
    if (item) { e.preventDefault(); loadFile(item.getAsFile()); }
  });

  $('btn-asr-remove').addEventListener('click', clearFile);

  const hostSel = $('asr-host');
  hostSel.value = getAsrHost() === ASR_HOST_MIRROR ? 'mirror' : 'official';
  hostSel.addEventListener('change', () => {
    const isMirror = hostSel.value === 'mirror';
    setAsrHost(isMirror ? ASR_HOST_MIRROR : ASR_HOST_OFFICIAL);
    // 换源后丢弃旧的 Worker，下次转写重新按新源加载
    if (worker) {
      worker.postMessage({ type: 'reset', id: ++reqSeq });
      worker.terminate();
      worker = null;
    }
    fileProgress.clear();
    showToast(
      isMirror ? '已切换镜像源，首次转写需重新下载模型' : '已切换官方源，首次转写需重新下载模型',
      'info',
      4000
    );
  });

  $('btn-asr-copy').addEventListener('click', (e) => {
    const text = $('asr-output').value;
    if (!text.trim()) { flashHint(e.currentTarget, '暂无内容'); return; }
    copyWithFeedback(text, e.currentTarget);
  });
  $('btn-asr-download').addEventListener('click', () => {
    const text = $('asr-output').value;
    if (!text.trim()) { showToast('暂无内容可下载', 'warning'); return; }
    const name = fileInfo?.name?.replace(/\.[^.]+$/, '') || 'transcript';
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
  });
}

function initScripts() {
  initEvents();
  mountResourcePanel('#resource-panel', 'asr');
  setBusy(false);
}

export { initScripts };
