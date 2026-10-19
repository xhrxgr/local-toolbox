/**
 * 图像修复推理 Worker（ONNX Runtime Web）
 *
 * 隔离到 Worker 的原因：ORT 的 WASM 堆一旦增长不会归还给操作系统，
 * 在 iOS Safari 上主线程推理即使成功，后续滚动也会因内存超限被系统杀掉。
 * 空闲一段时间后销毁 Worker 可可靠释放内存。
 */
// 只引入 WASM（CPU）构建：不加载 WebGPU 版本，避免多打 28MB 运行时代码。
// 调研发现 LaMa 在 WebGPU 上会静默输出错误结果，MI-GAN 的 GPU 行为未经验证，
// 因此本工具只走 CPU/WASM 这条已被验证的路径。
import * as ort from 'onnxruntime-web/wasm';

let session = null;
let sessionInputNames = null;
let sessionOutputName = null;

// 全局兜底：把任何未捕获异常/未处理拒绝都带回主线程，否则只会表现为无信息的 error 事件
self.addEventListener('error', (e) => {
  self.postMessage({
    type: 'error',
    message: e.message || 'worker 内部错误',
    stack: (e.error && e.error.stack) || '',
    where: 'global-error',
  });
});
self.addEventListener('unhandledrejection', (e) => {
  self.postMessage({
    type: 'error',
    message: (e.reason && e.reason.message) || String(e.reason),
    stack: (e.reason && e.reason.stack) || '',
    where: 'unhandled-rejection',
  });
});

self.onmessage = async (e) => {
  const { type } = e.data || {};

  try {
    if (type === 'init') {
      const { wasmPaths } = e.data;
      ort.env.wasm.wasmPaths = wasmPaths;
      // Safari 不支持嵌套 Worker，多线程会静默卡住，这里必须锁单线程
      ort.env.wasm.numThreads = 1;
      // 关闭 arena 与内存模式优化：低内存设备上能显著抑制堆增长
      ort.env.wasm.simd = true;

      self.postMessage({ type: 'stage', stage: 'runtime-ready' });

      const created = await ort.InferenceSession.create(e.data.modelBuffer, {
        executionProviders: ['wasm'],
        enableCpuMemArena: false,
        enableMemPattern: false,
        graphOptimizationLevel: 'all',
      });
      session = created;
      sessionInputNames = created.inputNames;
      sessionOutputName = created.outputNames[0];
      self.postMessage({ type: 'stage', stage: 'session-ready', inputs: sessionInputNames, outputs: created.outputNames });
      return;
    }

    if (type === 'run') {
      if (!session) throw new Error('推理会话尚未初始化');
      const t0 = performance.now();
      const { image, mask, width, height } = e.data;
      // postMessage 传过来的是 ArrayBuffer，必须包成视图才能按下标访问
      const imgData = new Uint8Array(image);
      const maskData = new Uint8Array(mask);
      const feeds = await buildFeeds(imgData, maskData, width, height);
      const out = await session.run(feeds);
      const tensor = out[sessionOutputName] ?? out[Object.keys(out)[0]];
      const resultData = tensor.data;
      self.postMessage(
        { type: 'result', data: resultData, width, height, ms: Math.round(performance.now() - t0) },
        [resultData.buffer]
      );
      return;
    }

    if (type === 'dispose') {
      if (session) {
        try { await session.release(); } catch { /* 忽略 */ }
        session = null;
      }
      self.close();
      return;
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: (err && err.message) || String(err),
      stack: (err && err.stack) || '',
      inputs: sessionInputNames,
    });
  }
};

/**
 * 组装输入张量。
 * MI-GAN 流水线模型的约定（已在模型文件上核实）：
 *   image: uint8 [1,3,H,W]，CHW
 *   mask : uint8 [1,1,H,W]，0 = 待修复（挖洞），255 = 保留
 */
async function buildFeeds(image, mask, width, height) {
  const chw = toCHW(image, width, height);
  const maskData = buildMask(mask, width, height);
  const feeds = {};
  // 按模型真实输入名组装，不假设顺序
  for (const name of sessionInputNames) {
    const key = name.toLowerCase();
    if (key.includes('mask')) feeds[name] = new ort.Tensor('uint8', maskData, [1, 1, height, width]);
    else feeds[name] = new ort.Tensor('uint8', chw, [1, 3, height, width]);
  }
  return feeds;
}

/** RGBA → CHW uint8 */
function toCHW(rgba, w, h) {
  const out = new Uint8Array(w * h * 3);
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const s = i * 4;
    const d = i;
    out[d] = rgba[s];
    out[n + d] = rgba[s + 1];
    out[n * 2 + d] = rgba[s + 2];
  }
  return out;
}

/**
 * 内部掩码约定：255 = 标记为待擦除。
 * 送入模型前取反（模型侧 0 表示挖洞）。
 */
function buildMask(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? 0 : 255;
  return out;
}