/**
 * 去手写：对当前页做红笔/蓝笔批注检测 + MI-GAN 修复
 *
 * 作为扫描流程中的一个处理步骤：擦除后的页面替换原图，
 * 后续的滤镜、曲面矫正、PDF 导出都照常作用于新图。
 */
import { detectColoredInk, dilate, maskRatio } from './detect-ink.js';
import { MODEL_INFO, ensureModel, isModelCached, requestPersistence, runtimeWasmPaths } from './model-manager.js';

/** 工作分辨率上限：兼顾修复质量与移动端内存（低内存设备进一步降档） */
function workLimit() {
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const lowMem = navigator.deviceMemory != null && navigator.deviceMemory <= 4;
  return (isIOS || lowMem) ? 1600 : 2200;
}

const MASK_DILATE = 3; // 检测掩码边缘比笔迹可见边缘小，不膨胀会残留一圈原色

let worker = null;
let workerIdleTimer = null;
let modelBuffer = null;

/** 模型是否已缓存（用于界面提示） */
export function modelCached() {
  return isModelCached();
}

export function modelMeta() {
  return MODEL_INFO;
}

/* ========== Worker 生命周期 ========== */

function createWorker() {
  disposeWorker();
  worker = new Worker(new URL('./inpaint-worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const onMessage = (e) => {
      const d = e.data;
      if (d.type === 'stage' && d.stage === 'session-ready') {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        resolve();
      } else if (d.type === 'error') {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        reject(new Error(d.message));
      }
    };
    const onError = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      reject(new Error('推理环境启动失败'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'init', modelBuffer: modelBuffer, wasmPaths: runtimeWasmPaths() });
  });
}

/** 空闲后销毁 Worker：ORT 的 WASM 堆不会自动归还，长期持有会在手机上累积内存 */
function scheduleWorkerDispose() {
  clearTimeout(workerIdleTimer);
  workerIdleTimer = setTimeout(() => {
    if (worker) {
      worker.postMessage({ type: 'dispose' });
      const w = worker;
      worker = null;
      setTimeout(() => w.terminate(), 200);
    }
  }, 30000);
}

function disposeWorker() {
  clearTimeout(workerIdleTimer);
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

/* ========== 主流程 ========== */

/**
 * 擦除指定页面的彩色笔迹
 * @param {object} page 页面对象（需含 img）
 * @param {'red'|'blue'} type 笔迹类型
 * @param {(stage:string, ratio:number)=>void} onStage 进度回调
 * @returns {Promise<{img: HTMLImageElement, width:number, height:number, coverage:number, ms:number}>}
 */
export async function eraseHandwriting(page, type, onStage = () => {}) {
  const limit = workLimit();
  const iw = page.img.naturalWidth;
  const ih = page.img.naturalHeight;
  const scale = Math.min(1, limit / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));

  // 1. 取当前页像素（统一到工作分辨率，控制内存峰值）
  onStage('读取页面', 0);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(page.img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  // 2. 颜色检测出掩码
  onStage('检测笔迹', 0.1);
  const mask = new Uint8Array(w * h);
  const hits = detectColoredInk(imageData.data, mask, type, 50);
  if (hits === 0) {
    canvas.width = canvas.height = 0;
    const err = new Error(type === 'red' ? '未检测到红笔笔迹' : '未检测到蓝笔笔迹');
    err.code = 'NO_INK';
    throw err;
  }
  dilate(mask, w, h, MASK_DILATE);
  const coverage = maskRatio(mask);
  if (coverage > 0.5) {
    canvas.width = canvas.height = 0;
    const err = new Error(`检测区域达 ${(coverage * 100).toFixed(0)}%，可能选错了颜色，请确认后重试`);
    err.code = 'TOO_LARGE';
    throw err;
  }

  // 3. 模型懒加载
  onStage('准备模型', 0.2);
  requestPersistence();
  modelBuffer = await ensureModel((loaded, total) => {
    onStage('下载模型', 0.2 + (total ? loaded / total : 1) * 0.35);
  });

  // 4. 推理会话
  onStage('初始化推理环境', 0.6);
  await createWorker();

  // 5. 执行修复
  onStage('AI 修复中', 0.7);
  const result = await runInference(imageData.data, mask, w, h);

  // 6. 结果转回页面图像
  onStage('生成结果', 0.95);
  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  outCanvas.getContext('2d').putImageData(result.imageData, 0, 0);
  const img = await loadImageFromCanvas(outCanvas);

  // 释放中间内存
  canvas.width = canvas.height = 0;
  outCanvas.width = outCanvas.height = 0;
  scheduleWorkerDispose();

  return { img, width: w, height: h, coverage, ms: result.ms };
}

function runInference(rgba, mask, width, height) {
  return new Promise((resolve, reject) => {
    const onMessage = (e) => {
      const d = e.data;
      if (d.type === 'result') {
        cleanup();
        // 模型输出是 CHW 三平面，需组装成 RGBA
        const data = d.data;
        const n = width * height;
        const imageData = new ImageData(width, height);
        const px = imageData.data;
        for (let i = 0; i < n; i++) {
          const p = i * 4;
          px[p] = data[i];
          px[p + 1] = data[n + i];
          px[p + 2] = data[n * 2 + i];
          px[p + 3] = 255;
        }
        resolve({ imageData, ms: d.ms });
      } else if (d.type === 'error') {
        cleanup();
        reject(new Error(d.message));
      }
    };
    const onError = () => { cleanup(); reject(new Error('推理中断')); };
    const cleanup = () => {
      worker?.removeEventListener('message', onMessage);
      worker?.removeEventListener('error', onError);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({
      type: 'run',
      image: rgba.slice().buffer,
      mask: mask.slice().buffer,
      width,
      height,
    });
  });
}

function loadImageFromCanvas(canvas) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('结果图像生成失败'));
    img.src = canvas.toDataURL('image/png');
  });
}
