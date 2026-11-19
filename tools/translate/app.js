/**
 * 离线翻译工具
 * 模型下载与推理都在 Worker 内，主线程只管界面与消息。
 */
import { copyText, flashHint } from '/assets/js/clipboard.js';
import { getModelHost, setModelHost, HOST_MODELSCOPE } from '/assets/js/model-host.js';

export function initTranslate() {
  const $ = (id) => document.getElementById(id);
  const input = $('tr-input');
  const output = $('tr-output');
  const directionSel = $('tr-direction');
  const statusEl = $('tr-status');
  const progressBox = $('tr-progress');
  const progressFill = $('tr-progress-fill');
  const progressText = $('tr-progress-text');
  const hintEl = $('tr-hint');
  const runBtn = $('btn-run');
  const preloadBtn = $('btn-preload');
  const swapBtn = $('btn-swap');
  const langFrom = $('tr-lang-from');
  const langTo = $('tr-lang-to');
  const hostSel = $('tr-host');

  // 下载源：切换后消息里带新 host，worker 会重建模型管道；
  // 缓存键是完整 URL，换源意味着重新下载，切换时给出提示
  const HOST_KEY = 'translate-model-host';
  hostSel.value = getModelHost(HOST_KEY) === HOST_MODELSCOPE ? 'modelscope' : 'official';
  hostSel.addEventListener('change', () => {
    if (busy) { flashHint(hostSel, '下载中，稍后再切换'); return; }
    setModelHost(HOST_KEY, hostSel.value === 'modelscope' ? HOST_MODELSCOPE : 'https://huggingface.co');
    // 用户主动重新选源，允许再次尝试回退
    mirrorFallbackUsed = false;
    const mirror = hostSel.value === 'modelscope';
    setStatus(`已切换到${mirror ? '魔搭（国内）' : '官方源'}，下次下载模型时生效`);
    if (cachedDirs.size > 0 && mirror) {
      hintEl.textContent = '已缓存的模型不区分来源；切换源后如需重新下载，将使用新源。';
    }
    // host 变化后重置 worker，让后续请求走新源
    resetWorker();
  });

  let worker = null;
  let busy = false;
  let reqSeq = 0;
  let busyTimer = null;
  let busyKind = '';       // 'translate' | 'preload'
  let cachedDirs = new Set(); // 已缓存的模型方向
  let lastAction = null;      // 最近一次下载动作，供魔搭失败回退重放
  let mirrorFallbackUsed = false;

  const DIR_LABEL = { 'zh-en': '中→英', 'en-zh': '英→中' };
  // 两个方向各自的关键文件：decoder 是最大的模型文件，缓存里有它即算完整
  const KEY_FILE = { 'zh-en': 'opus-mt-zh-en', 'en-zh': 'opus-mt-en-zh' };

  function setStatus(text, kind = '') {
    statusEl.textContent = text;
    statusEl.className = 'translate-status' + (kind ? ' is-' + kind : '');
  }

  function releaseBusy() {
    busy = false;
    busyKind = '';
    runBtn.disabled = false;
    if (busyTimer) { clearTimeout(busyTimer); busyTimer = null; }
  }

  // ---------- 预下载进度聚合 ----------
  // 两个方向共约 8 个文件，单个文件的 0~100% 会来回横跳；
  // 以文件为单位聚合成总体进度：进度条 = 各文件均值的均值，文本显示已完成数。
  const dlFiles = new Map();   // 'direction|file' -> { progress, done }
  let dlDoneCount = 0;

  function renderDlProgress(currentFile, currentDir) {
    progressBox.hidden = false;
    let sum = 0;
    for (const f of dlFiles.values()) sum += f.progress;
    const total = Math.round(sum / dlFiles.size);
    progressFill.style.width = total + '%';
    progressText.textContent = `${dlDoneCount}/${dlFiles.size} 个文件`;
    const dir = DIR_LABEL[currentDir] || '';
    const name = (currentFile || '').split('/').pop();
    setStatus(`正在下载${dir ? ` ${dir}` : ''}模型：${name || '…'}`);
  }

  function applyCachedUi() {
    const both = cachedDirs.has('zh-en') && cachedDirs.has('en-zh');
    if (both) {
      setStatus('两个方向的模型均已缓存，可离线翻译', 'ready');
      preloadBtn.textContent = '模型已缓存';
      preloadBtn.disabled = true;
    } else if (cachedDirs.size > 0) {
      const have = [...cachedDirs].map((d) => DIR_LABEL[d]).join('、');
      const missing = ['zh-en', 'en-zh'].filter((d) => !cachedDirs.has(d)).map((d) => DIR_LABEL[d]).join('、');
      setStatus(`${have}模型已缓存；${missing}模型首次使用时自动下载`, 'ready');
      preloadBtn.textContent = '补齐预下载';
    }
    // 全无缓存时保持初始文案「模型未加载…」，按钮文案不变
  }

  /** 页面加载时查 Cache Storage，让用户一进来就知道模型是否已就绪 */
  async function detectCachedModels() {
    try {
      if (!('caches' in window)) return;
      const cache = await caches.open('transformers-cache');
      const urls = (await cache.keys()).map((k) => k.url);
      for (const dir of ['zh-en', 'en-zh']) {
        if (urls.some((u) => u.includes('/' + KEY_FILE[dir] + '/') && u.includes('.onnx'))) {
          cachedDirs.add(dir);
        }
      }
      applyCachedUi();
    } catch { /* Cache API 不可用时静默跳过 */ }
  }

  /** 切换下载源后重置 worker：worker 内的 env.remoteHost 在创建时确定，
   *  保留旧实例会让后续下载仍走旧源。缓存按 URL 键存储，换源会重新下载。 */
  function resetWorker() {
    if (worker) { worker.terminate(); worker = null; }
  }

  function currentHost() {
    return hostSel.value === 'modelscope' ? HOST_MODELSCOPE : 'https://huggingface.co';
  }

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./translate-worker.js', import.meta.url), { type: 'module' });    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'log') {
        setStatus(m.message);
      } else if (m.type === 'progress') {
        const key = (m.direction || '') + '|' + (m.file || '');
        if (busyKind === 'preload' && m.file && m.direction) {
          const rec = dlFiles.get(key) || { progress: 0 };
          rec.progress = m.done ? 100 : Math.round(m.progress || 0);
          dlFiles.set(key, rec);
          if (m.done && rec.progress === 100 && !rec.counted) { rec.counted = true; dlDoneCount++; }
          renderDlProgress(m.file, m.direction);
        } else {
          // 翻译时的单模型加载：保持原有单文件进度显示
          progressBox.hidden = false;
          const p = Math.round(m.progress || 0);
          progressFill.style.width = p + '%';
          const name = (m.file || '').split('/').pop();
          progressText.textContent = m.done ? '完成' : name ? `${p}% · ${name.slice(0, 14)}` : `${p}%`;
          setStatus(`正在下载模型文件：${name || '…'}`);
        }
      } else if (m.type === 'model-ready') {
        // 记入缓存集合即可。不要在翻译过程中调 applyCachedUi()：
        // 它会覆盖「正在翻译…」的进度文案（实测出现过中途闪出缓存提示）
        if (m.direction) cachedDirs.add(m.direction);
      } else if (m.type === 'token') {
        // 流式译文：只接受当前请求的片段
        if (m.seq === reqSeq) {
          output.value += m.text || '';
          scrollOutput();
        }
      } else if (m.type === 'seg') {
        if (m.seq === reqSeq && m.total > 1) {
          setStatus(`正在翻译第 ${m.index}/${m.total} 段…`);
        }
      } else if (m.type === 'result') {
        // 用户输入可能在推理期间变化，只接受最后一次请求的结果
        if (m.seq === reqSeq) {
          output.value = m.text || '';
          if (m.direction) updateLangLabels(m.direction);
          setStatus('翻译完成', 'ready');
        }
        mirrorFallbackUsed = false;
        releaseBusy();
      } else if (m.type === 'ready') {
        // preload 完成：两个方向都已进缓存
        cachedDirs.add('zh-en');
        cachedDirs.add('en-zh');
        setStatus('模型已全部缓存，之后可离线翻译', 'ready');
        progressBox.hidden = true;
        mirrorFallbackUsed = false;
        applyCachedUi();
        releaseBusy();
      } else if (m.type === 'error') {
        const wasPreload = busyKind === 'preload';
        const isMirror = hostSel.value === 'modelscope';
        releaseBusy();
        // 魔搭 CDN 在部分网络环境下 QUIC 不稳定（实测 ERR_QUIC_PROTOCOL_ERROR），
        // 失败时自动切回官方源重放本次动作，用户无感
        if (isMirror && !mirrorFallbackUsed && lastAction) {
          mirrorFallbackUsed = true;
          hostSel.value = 'official';
          setModelHost(HOST_KEY, 'https://huggingface.co');
          resetWorker();
          setStatus('魔搭下载失败，已自动改用官方源重试…', '');
          setTimeout(() => {
            if (lastAction.kind === 'translate') startTranslate(lastAction.text);
            else if (lastAction.kind === 'preload') startPreload();
          }, 300);
          return;
        }
        setStatus('错误：' + m.message, 'error');
        hintEl.textContent = isMirror
          ? '魔搭源下载失败，请检查网络或切回官方源重试；已下载过的模型可离线使用。'
          : '下载失败多为国际链路波动，可稍后重试，或在工具栏切换「魔搭（国内）」源。';
        // 预下载失败时恢复按钮，允许重试
        if (wasPreload) preloadBtn.disabled = false;
      }
    };
    worker.onerror = (e) => {
      setStatus('worker 错误：' + (e.message || '未知'), 'error');
      releaseBusy();
    };
    return worker;
  }

  const LANG = { 'zh-en': ['中文', '英文'], 'en-zh': ['英文', '中文'] };

  function updateLangLabels(dir) {
    const pair = LANG[dir];
    langFrom.textContent = pair ? pair[0] : '自动检测';
    langTo.textContent = pair ? pair[1] : '待检测';
  }

  function scrollOutput() {
    output.scrollTop = output.scrollHeight;
  }

  function updateCount() {
    $('tr-count').textContent = input.value.length.toLocaleString() + ' 字符';
  }

  input.addEventListener('input', updateCount);

  // Ctrl/Cmd+Enter 直接翻译
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runBtn.click();
    }
  });

  // 记住上次的方向选择
  const DIR_KEY = 'translate-direction';
  try {
    const saved = localStorage.getItem(DIR_KEY);
    if (saved && ['auto', 'zh-en', 'en-zh'].includes(saved)) directionSel.value = saved;
  } catch { /* 隐私模式不可用 */ }
  directionSel.addEventListener('change', () => {
    try { localStorage.setItem(DIR_KEY, directionSel.value); } catch { /* 忽略 */ }
    updateLangLabels(directionSel.value);
  });

  swapBtn.addEventListener('click', () => {
    if (busy) return;
    const cur = directionSel.value;
    const next = cur === 'zh-en' ? 'en-zh' : cur === 'en-zh' ? 'zh-en' : 'zh-en';
    directionSel.value = next;
    updateLangLabels(next);
    // 把当前译文放到原文，方便反向翻译
    if (output.value.trim()) {
      input.value = output.value;
      output.value = '';
      updateCount();
    }
  });

  function startTranslate(text) {
    busy = true;
    busyKind = 'translate';
    runBtn.disabled = true;
    output.value = '';   // 立刻清掉旧译文，避免误读成新结果
    const seq = ++reqSeq;
    lastAction = { kind: 'translate', text, seq };
    setStatus('正在初始化模型…');
    progressBox.hidden = false;
    progressFill.style.width = '0%';
    progressText.textContent = '';
    // 首次下载约 60MB，国际链路慢时可能几分钟。给明确提示并在超时后
    // 解除按钮锁定，避免用户以为卡死又无法重试。
    busyTimer = setTimeout(() => {
      if (busy) {
        setStatus('模型下载较慢，请稍候或重试（首次需下载约 60MB）', '');
        hintEl.textContent = '下载受国际链路影响可能较慢；下载完成后会自动缓存，之后可离线使用。';
        releaseBusy();
      }
    }, 180000);
    getWorker().postMessage({
      type: 'translate',
      text,
      direction: directionSel.value,
      seq,
      host: currentHost(),
    });
  }

  runBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) { flashHint(runBtn, '请先输入文本'); return; }
    if (busy) { flashHint(runBtn, busyKind === 'preload' ? '正在预下载模型，请稍候' : '正在翻译中'); return; }
    startTranslate(text);
  });

  function startPreload() {
    busy = true;
    busyKind = 'preload';
    preloadBtn.disabled = true;
    // 计数器重置：上一次的进度不应混进本次统计
    dlFiles.clear();
    dlDoneCount = 0;
    lastAction = { kind: 'preload' };
    setStatus('正在预下载两个方向的模型…');
    progressBox.hidden = false;
    progressFill.style.width = '0%';
    progressText.textContent = '';
    busyTimer = setTimeout(() => {
      if (busy) {
        setStatus('模型下载较慢，请稍候或重试', '');
        releaseBusy();
        preloadBtn.disabled = false;
      }
    }, 300000);
    getWorker().postMessage({ type: 'preload', host: currentHost() });
  }

  preloadBtn.addEventListener('click', () => {
    if (busy) return;
    startPreload();
  });

  $('btn-clear').addEventListener('click', () => {
    input.value = '';
    output.value = '';
    updateCount();
  });

  $('btn-copy').addEventListener('click', async (e) => {
    if (!output.value) { flashHint(e.currentTarget, '暂无译文'); return; }
    const ok = await copyText(output.value);
    flashHint(e.currentTarget, ok ? '已复制' : '复制失败');
  });

  updateLangLabels(directionSel.value);
  updateCount();
  detectCachedModels();
}
