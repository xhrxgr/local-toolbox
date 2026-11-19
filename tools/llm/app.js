/**
 * 本地大模型工具主线程
 * 模型加载与推理都在 Worker 内，这里只负责界面与消息。
 */
import { copyText } from '/assets/js/clipboard.js';
import { getModelHost, setModelHost, HOST_MODELSCOPE } from '/assets/js/model-host.js';

export function initLlm() {
  const $ = (id) => document.getElementById(id);
  const chat = $('llm-chat');
  const empty = $('llm-empty');
  const input = $('llm-input');
  const modelSel = $('llm-model');
  const statusEl = $('llm-status');
  const progressBox = $('llm-progress');
  const progressFill = $('llm-progress-fill');
  const progressText = $('llm-progress-text');
  const hintEl = $('llm-hint');
  const sendBtn = $('btn-send');
  const loadBtn = $('btn-load');
  const importBtn = $('btn-import');
  const fileInput = $('llm-files');

  let worker = null;
  let ready = false;
  let busy = false;
  let currentAI = null;
  let currentText = '';
  let loadTimer = null;

  function setStatus(text, kind = '') {
    statusEl.textContent = text;
    statusEl.className = 'llm-status' + (kind ? ' is-' + kind : '');
  }

  function scrollBottom() {
    chat.scrollTop = chat.scrollHeight;
  }

  function addMsg(role, text) {
    empty.hidden = true;
    const box = document.createElement('div');
    box.className = 'llm-msg llm-msg--' + (role === 'user' ? 'user' : 'ai');
    const roleEl = document.createElement('div');
    roleEl.className = 'llm-msg__role';
    roleEl.textContent = role === 'user' ? '你' : '模型';
    const body = document.createElement('div');
    body.className = 'llm-msg__body';
    body.textContent = text;
    box.append(roleEl, body);
    chat.appendChild(box);
    scrollBottom();
    return body;
  }

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data || {};
      switch (m.type) {
        case 'log':
          setStatus(m.message);
          break;
        case 'progress': {
          progressBox.hidden = false;
          const p = Math.round(m.progress || 0);
          progressFill.style.width = p + '%';
          const name = (m.file || '').split('/').pop();
          progressText.textContent = m.done ? '完成' : name ? `${p}% · ${name.slice(0, 12)}` : `${p}%`;
          setStatus(`正在下载：${name || '…'}`);
          break;
        }
        case 'model-ready':
          ready = true;
          busy = false;
          sendBtn.disabled = false;
          loadBtn.disabled = false;
          importBtn.disabled = false;
          if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
          progressBox.hidden = true;
          setStatus(`已就绪 · ${m.label} · 本地推理`, 'ready');
          hintEl.textContent = '对话内容只在本机处理。模型能力有限，回答仅供参考。';
          break;
        case 'local-ready':
          setStatus(`已导入 ${m.count} 个本地模型文件，点击「加载模型」开始`, 'ready');
          loadBtn.disabled = false;
          break;
        case 'token':
          if (currentAI) {
            currentText += m.text || '';
            currentAI.textContent = currentText;
            scrollBottom();
          }
          break;
        case 'done':
          if (currentAI) { currentAI.textContent = m.text || currentText; }
          currentAI = null;
          busy = false;
          sendBtn.disabled = false;
          setStatus('生成完成', 'ready');
          break;
        case 'error':
          // 魔搭 CDN 在部分网络下 QUIC 不稳定，失败自动切回官方源重放加载
          if (hostSel.value === 'modelscope' && !mirrorFallbackUsed && lastAction) {
            mirrorFallbackUsed = true;
            hostSel.value = 'official';
            setModelHost(HOST_KEY, 'https://huggingface.co');
            resetWorker();
            // 必须先解锁 busy、清掉旧的超时定时器，否则下面的重放会被
            // startLoad() 开头的 `if (busy) return` 直接拦掉
            busy = false;
            if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
            setStatus('魔搭下载失败，已自动改用官方源重试…', '');
            setTimeout(() => startLoad(), 300);
            return;
          }
          setStatus('错误：' + m.message, 'error');
          hintEl.textContent = hostSel.value === 'modelscope'
            ? '魔搭源下载失败，可切回官方源重试；已下载的模型可离线使用。'
            : '首次下载可能失败（多为国际链路波动），可把下载源切换为「魔搭（国内）」后重试。';
          busy = false;
          sendBtn.disabled = !ready;
          loadBtn.disabled = false;
          importBtn.disabled = false;
          if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
          break;
      }
    };
    worker.onerror = (e) => {
      setStatus('worker 错误：' + (e.message || '未知'), 'error');
      busy = false;
      sendBtn.disabled = !ready;
      loadBtn.disabled = false;
      importBtn.disabled = false;
    };
    return worker;
  }

  // 下载源：缓存键是完整 URL，切换源后同模型会按新 URL 重新下载
  const HOST_KEY = 'llm-model-host';
  const hostSel = $('llm-host');
  hostSel.value = getModelHost(HOST_KEY) === HOST_MODELSCOPE ? 'modelscope' : 'official';
  hostSel.addEventListener('change', () => {
    if (busy) { setStatus('加载中，稍后再切换', 'error'); return; }
    setModelHost(HOST_KEY, hostSel.value === 'modelscope' ? HOST_MODELSCOPE : 'https://huggingface.co');
    // 用户主动重新选源，允许再次尝试回退
    mirrorFallbackUsed = false;
    setStatus('已切换到' + (hostSel.value === 'modelscope' ? '魔搭（国内）' : '官方源') + '，下次加载生效', 'ready');
    resetWorker();
    ready = false;
    sendBtn.disabled = true;
  });

  function currentHost() {
    return hostSel.value === 'modelscope' ? HOST_MODELSCOPE : 'https://huggingface.co';
  }

  function resetWorker() {
    if (worker) { worker.terminate(); worker = null; }
  }

  // 魔搭失败自动回退官方源的状态
  let lastAction = null;
  let mirrorFallbackUsed = false;

  function startLoad() {
    if (busy) return;
    busy = true;
    lastAction = { kind: 'load', model: modelSel.value };
    loadBtn.disabled = true;
    sendBtn.disabled = true;
    progressBox.hidden = false;
    progressFill.style.width = '0%';
    setStatus('正在加载模型…');
    loadTimer = setTimeout(() => {
      if (busy) {
        setStatus('模型下载较慢，请稍候（首次需下载 112~460MB）');
        loadBtn.disabled = false;
      }
    }, 180000);
    getWorker().postMessage({ type: 'load', model: modelSel.value, host: currentHost() });
  }

  loadBtn.addEventListener('click', startLoad);

  importBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    if (!files.length) return;
    ready = false;
    sendBtn.disabled = true;
    importBtn.disabled = true;
    setStatus(`正在读取 ${files.length} 个本地文件…`);
    try {
      const payload = files.map((f) => ({
        // webkitRelativePath 形如 "模型文件夹/onnx/model_q4f16.onnx"
        name: (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name,
        file: f,
      }));
      getWorker().postMessage({ type: 'local-files', files: payload });
      // 本地文件夹自带 config.json，模型 ID 不再由下拉决定。
      // 用一个不可见的哨兵值标记，避免用户误以为在用下拉里那个模型。
      let sentinel = modelSel.querySelector('option[value="local"]');
      if (!sentinel) {
        sentinel = document.createElement('option');
        sentinel.value = 'local';
        sentinel.textContent = '本地导入的模型';
        modelSel.insertBefore(sentinel, modelSel.firstChild);
      }
      modelSel.value = 'local';
      setStatus(`已导入 ${files.length} 个文件，点击「加载模型」开始`, 'ready');
    } catch (e) {
      setStatus('读取本地文件失败：' + e.message, 'error');
    } finally {
      importBtn.disabled = false;
      fileInput.value = '';
    }
  });

  modelSel.addEventListener('change', () => {
    ready = false;
    sendBtn.disabled = true;
    setStatus(`已切换到 ${modelSel.options[modelSel.selectedIndex].text}，需重新加载`);
  });

  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    if (!ready) { setStatus('请先加载模型', 'error'); return; }
    if (busy) return;
    addMsg('user', text);
    input.value = '';
    updateCount();
    currentText = '';
    currentAI = addMsg('ai', '…');
    busy = true;
    sendBtn.disabled = true;
    setStatus('正在生成…');
    getWorker().postMessage({
      type: 'generate',
      model: modelSel.value,
      prompt: text,
      maxTokens: 256,
      host: currentHost(),
    });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  $('btn-reset').addEventListener('click', () => {
    if (worker) worker.postMessage({ type: 'reset' });
    chat.querySelectorAll('.llm-msg').forEach((el) => el.remove());
    empty.hidden = false;
    currentAI = null;
    input.value = '';
    updateCount();
    setStatus(ready ? '已就绪' : '模型未加载', ready ? 'ready' : '');
  });

  function updateCount() {
    $('llm-count').textContent = input.value.length.toLocaleString() + ' 字符';
  }

  updateCount();
}
