/**
 * 离线翻译工具
 * 模型下载与推理都在 Worker 内，主线程只管界面与消息。
 */
import { copyText, flashHint } from '/assets/js/clipboard.js';

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

  let worker = null;
  let busy = false;
  let reqSeq = 0;
  let busyTimer = null;

  function setStatus(text, kind = '') {
    statusEl.textContent = text;
    statusEl.className = 'translate-status' + (kind ? ' is-' + kind : '');
  }

  function releaseBusy() {
    busy = false;
    runBtn.disabled = false;
    preloadBtn.disabled = false;
    if (busyTimer) { clearTimeout(busyTimer); busyTimer = null; }
  }

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./translate-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'log') {
        setStatus(m.message);
      } else if (m.type === 'progress') {
        progressBox.hidden = false;
        const p = Math.round(m.progress || 0);
        progressFill.style.width = p + '%';
        // 显示当前下载的文件，避免长下载期间用户以为卡死
        const name = (m.file || '').split('/').pop();
        progressText.textContent = m.done ? '完成' : name ? `${p}% · ${name.slice(0, 14)}` : `${p}%`;
        setStatus(`正在下载模型文件：${name || '…'}`);
      } else if (m.type === 'model-ready') {
        setStatus('模型就绪（可离线使用）', 'ready');
      } else if (m.type === 'result') {
        // 用户输入可能在推理期间变化，只接受最后一次请求的结果
        if (m.seq === reqSeq) {
          output.value = m.text || '';
          if (m.direction) updateLangLabels(m.direction);
          setStatus('翻译完成', 'ready');
        }
        releaseBusy();
      } else if (m.type === 'ready') {
        setStatus('模型已预下载，可离线使用', 'ready');
        progressBox.hidden = true;
        releaseBusy();
      } else if (m.type === 'error') {
        setStatus('错误：' + m.message, 'error');
        hintEl.textContent = '若首次下载失败，请检查网络；已下载过的模型可离线使用。';
        releaseBusy();
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

  function updateCount() {
    $('tr-count').textContent = input.value.length.toLocaleString() + ' 字符';
  }

  input.addEventListener('input', updateCount);
  directionSel.addEventListener('change', () => updateLangLabels(directionSel.value));

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

  runBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) { flashHint(runBtn, '请先输入文本'); return; }
    if (busy) { flashHint(runBtn, '正在翻译中'); return; }
    busy = true;
    runBtn.disabled = true;
    output.value = '';   // 立刻清掉旧译文，避免误读成新结果
    const seq = ++reqSeq;
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
    });
  });

  preloadBtn.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    preloadBtn.disabled = true;
    setStatus('正在预下载两个方向的模型…');
    progressBox.hidden = false;
    busyTimer = setTimeout(() => {
      if (busy) {
        setStatus('模型下载较慢，请稍候或重试', '');
        releaseBusy();
      }
    }, 300000);
    getWorker().postMessage({ type: 'preload' });
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
}
