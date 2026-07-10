/**
 * 密码生成器核心逻辑
 * 两个模式：随机密码 / 记忆口令（diceware）
 * 全部本地运行，使用 crypto.getRandomValues 安全随机数
 */

/* ========== 字符集定义 ========== */
const CHARSETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digit: '0123456789',
  symbol: '!@#$%^&*()_+-=[]{}|;:,.<>?/',
};

const SIMILAR_CHARS = '0O1lI';
const AMBIGUOUS_CHARS = '{}[]()/\\';

/* ========== diceware 词表（约 200 个常见 4-6 字母英文单词）========== */
const WORDLIST = [
  'apple', 'bread', 'cloud', 'dance', 'eagle', 'flame', 'globe', 'honey',
  'ivory', 'jelly', 'knife', 'lemon', 'mango', 'noble', 'ocean', 'piano',
  'queen', 'river', 'stone', 'tiger', 'umbra', 'vivid', 'whale', 'xenon',
  'yacht', 'zebra', 'amber', 'beach', 'candy', 'dream', 'ember', 'frost',
  'grape', 'heart', 'image', 'joker', 'karma', 'light', 'music', 'night',
  'olive', 'pearl', 'quake', 'robot', 'solar', 'train', 'unity', 'voice',
  'water', 'youth', 'brick', 'clock', 'daily', 'earth', 'field', 'glass',
  'house', 'input', 'judge', 'knock', 'large', 'money', 'never', 'order',
  'place', 'quiet', 'reach', 'smile', 'trust', 'upper', 'value', 'wheat',
  'yield', 'zone', 'alarm', 'bloom', 'coral', 'delay', 'elite', 'fancy',
  'giant', 'happy', 'ideal', 'jolly', 'known', 'lucky', 'magic', 'novel',
  'proud', 'quick', 'royal', 'sharp', 'tough', 'urban', 'vague',
  'witty', 'young', 'zeal', 'angle', 'blame', 'crisp', 'draft', 'equal',
  'fault', 'given', 'humor', 'irony', 'jewel', 'kneel', 'liver', 'mound',
  'ninth', 'onion', 'paint', 'query', 'ridge', 'stack', 'tense', 'usage',
  'vault', 'wrist', 'yummy', 'zesty', 'arrow', 'badge', 'chess', 'dough',
  'extra', 'fudge', 'gravy', 'hover', 'inbox', 'joust', 'kayak', 'lance',
  'mural', 'nudge', 'orbit', 'plumb', 'quart', 'raven', 'swamp', 'toast',
  'unzip', 'vapor', 'waltz', 'yaw', 'abode', 'blaze', 'creek', 'dwell',
  'forge', 'gleam', 'haunt', 'jumbo', 'krill', 'loom',
  'marsh', 'nifty', 'oasis', 'plaza', 'quill', 'spark', 'trunk',
  'ultra', 'vigor', 'wander', 'yodel', 'aroma', 'broom', 'cliff', 'daisy',
  'epoch', 'flint', 'grace', 'hedge', 'ionic', 'kiosk', 'latch',
  'mercy', 'niche', 'opera', 'pupil', 'quirk', 'rusty', 'satin', 'thorn',
  'usher', 'vodka', 'wings', 'yarn', 'apex', 'birch', 'crest', 'dusk',
  'fern', 'glide', 'haste', 'isle', 'jolt', 'knot', 'lush', 'mint',
  'noon', 'oval', 'pact', 'quay', 'reed', 'sage', 'tide', 'urn',
  'vase', 'wick', 'yew', 'zinc',
];

/* ========== 安全随机数（拒绝采样避免模偏差）========== */
function secureRandomIndex(max) {
  // max 为字符集长度，必须 >= 1
  if (max <= 0) return 0;
  // 计算可均匀映射的最大阈值（去掉尾部不均匀部分）
  const limit = Math.floor(0xFFFFFFFF / max) * max;
  const buf = new Uint32Array(1);
  let r;
  do {
    r = crypto.getRandomValues(buf)[0];
  } while (r >= limit);
  return r % max;
}

/* ========== 构建字符集（应用排除选项）========== */
function buildCharset() {
  let charset = '';
  if (document.getElementById('cs-upper').checked) charset += CHARSETS.upper;
  if (document.getElementById('cs-lower').checked) charset += CHARSETS.lower;
  if (document.getElementById('cs-digit').checked) charset += CHARSETS.digit;
  if (document.getElementById('cs-symbol').checked) charset += CHARSETS.symbol;

  if (document.getElementById('ex-similar').checked) {
    charset = [...charset].filter((c) => !SIMILAR_CHARS.includes(c)).join('');
  }
  if (document.getElementById('ex-ambiguous').checked) {
    charset = [...charset].filter((c) => !AMBIGUOUS_CHARS.includes(c)).join('');
  }
  // 去重，避免重复字符影响熵估算
  return [...new Set(charset)].join('');
}

/* ========== 生成随机密码 ========== */
function generatePassword(length, charset) {
  let pwd = '';
  for (let i = 0; i < length; i++) {
    pwd += charset[secureRandomIndex(charset.length)];
  }
  return pwd;
}

/* ========== 强度评估 ========== */
function evaluateStrength(length, charsetSize) {
  if (charsetSize <= 0 || length <= 0) return { entropy: 0, level: 'none', label: '—', percent: 0 };
  const entropy = length * Math.log2(charsetSize);
  let level, label, percent;
  if (entropy < 28) {
    level = 'weak';
    label = '弱';
    // 0-28 映射到 0-25%
    percent = Math.min(25, (entropy / 28) * 25);
  } else if (entropy < 60) {
    level = 'medium';
    label = '中';
    // 28-60 映射到 25-55%
    percent = 25 + ((entropy - 28) / (60 - 28)) * 30;
  } else if (entropy < 128) {
    level = 'strong';
    label = '强';
    // 60-128 映射到 55-85%
    percent = 55 + ((entropy - 60) / (128 - 60)) * 30;
  } else {
    level = 'very-strong';
    label = '极强';
    percent = Math.min(100, 85 + (entropy - 128) / 10);
  }
  return { entropy, level, label, percent: Math.max(0, Math.min(100, percent)) };
}

/* ========== 复制到剪贴板 ========== */
async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      document.body.removeChild(ta);
      return false;
    }
  }
}

/* ========== 选中结果文本（便于复制）========== */
function selectResult(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ========== Tab 切换 ========== */
function switchTab(mode) {
  document.querySelectorAll('.mode-tab').forEach((t) => {
    t.classList.toggle('mode-tab--active', t.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-panel').forEach((p) => {
    p.classList.toggle('mode-panel--active', p.id === `panel-${mode}`);
  });
}

/* ========== 随机密码：生成 + 渲染 ========== */
function handleGenerate() {
  const hint = document.getElementById('random-hint');
  const length = parseInt(document.getElementById('pw-length').value, 10);
  const charset = buildCharset();

  if (!charset) {
    hint.textContent = '请至少选择一个字符集';
    hint.classList.add('hint--error');
    document.getElementById('random-result').textContent = '';
    updateStrengthDisplay({ entropy: 0, level: 'none', label: '—', percent: 0 });
    return;
  }
  hint.textContent = '';
  hint.classList.remove('hint--error');

  const pwd = generatePassword(length, charset);
  renderRandomResult(pwd);
  const strength = evaluateStrength(length, charset.length);
  updateStrengthDisplay(strength, length, charset.length);
}

function renderRandomResult(pwd) {
  const el = document.getElementById('random-result');
  el.textContent = pwd;
  el.classList.add('result-box--filled');
  selectResult(el);
}

function updateStrengthDisplay(strength, length, charsetSize) {
  const fill = document.getElementById('strength-fill');
  const text = document.getElementById('strength-text');
  const meta = document.getElementById('strength-meta');
  fill.style.width = strength.percent + '%';
  fill.className = 'strength-bar__fill strength-bar__fill--' + strength.level;
  text.textContent = strength.label;
  text.className = 'strength-text strength-text--' + strength.level;
  if (strength.entropy > 0 && length && charsetSize) {
    meta.textContent = `熵约 ${strength.entropy.toFixed(1)} bits（${length} 位 × log₂(${charsetSize})）`;
  } else {
    meta.textContent = '';
  }
}

/* ========== 批量生成 ========== */
function handleBatchGenerate() {
  const hint = document.getElementById('random-hint');
  const length = parseInt(document.getElementById('pw-length').value, 10);
  const charset = buildCharset();
  const countRaw = parseInt(document.getElementById('batch-count').value, 10);

  if (!charset) {
    hint.textContent = '请至少选择一个字符集';
    hint.classList.add('hint--error');
    return;
  }
  hint.textContent = '';
  hint.classList.remove('hint--error');

  const count = Math.max(1, Math.min(50, isNaN(countRaw) ? 10 : countRaw));
  document.getElementById('batch-count').value = count;

  const list = document.getElementById('batch-list');
  list.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const pwd = generatePassword(length, charset);
    const row = document.createElement('div');
    row.className = 'batch-item';
    row.innerHTML = `
      <span class="batch-item__index">${i + 1}</span>
      <span class="batch-item__pwd"></span>
      <button class="batch-item__copy btn btn-secondary" title="复制">复制</button>
    `;
    row.querySelector('.batch-item__pwd').textContent = pwd;
    row.querySelector('.batch-item__copy').addEventListener('click', async (e) => {
      const ok = await copyText(pwd);
      if (ok) flashButton(e.target, '已复制');
    });
    list.appendChild(row);
  }
}

function flashButton(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  btn.classList.add('btn--success');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('btn--success');
  }, 1200);
}

function handleBatchClear() {
  document.getElementById('batch-list').innerHTML = '';
}

/* ========== 记忆口令：生成 + 渲染 ========== */
function generateDiceware(wordCount, separator) {
  const words = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(WORDLIST[secureRandomIndex(WORDLIST.length)]);
  }
  return words.join(separator);
}

function handleDicewareGenerate() {
  const wordCount = parseInt(document.getElementById('dw-count').value, 10);
  let sep = document.getElementById('dw-sep').value;
  // 分隔符最多 2 字符，空值默认无分隔
  if (sep.length > 2) sep = sep.slice(0, 2);

  const passphrase = generateDiceware(wordCount, sep);
  const el = document.getElementById('diceware-result');
  el.textContent = passphrase;
  el.classList.add('result-box--filled');
  selectResult(el);

  const bitsPerWord = Math.log2(WORDLIST.length);
  const entropy = bitsPerWord * wordCount;
  document.getElementById('dw-entropy').textContent = `${entropy.toFixed(1)} bits（${wordCount} 词 × ${bitsPerWord.toFixed(2)} bits）`;
}

/* ========== 复制按钮 ========== */
function bindCopyButton(btnId, resultId) {
  document.getElementById(btnId).addEventListener('click', async () => {
    const text = document.getElementById(resultId).textContent;
    if (!text) return;
    const ok = await copyText(text);
    if (ok) flashButton(document.getElementById(btnId), '已复制');
  });
}

/* ========== 初始化 ========== */
function initPassword() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // 滑块值同步显示
  const pwLength = document.getElementById('pw-length');
  const pwLengthValue = document.getElementById('pw-length-value');
  pwLength.addEventListener('input', () => {
    pwLengthValue.textContent = pwLength.value;
  });

  const dwCount = document.getElementById('dw-count');
  const dwCountValue = document.getElementById('dw-count-value');
  dwCount.addEventListener('input', () => {
    dwCountValue.textContent = dwCount.value;
  });

  // 随机密码生成
  document.getElementById('btn-generate').addEventListener('click', handleGenerate);
  document.getElementById('btn-regenerate').addEventListener('click', handleGenerate);
  document.getElementById('btn-batch-generate').addEventListener('click', handleBatchGenerate);
  document.getElementById('btn-batch-clear').addEventListener('click', handleBatchClear);

  // 记忆口令生成
  document.getElementById('btn-dw-generate').addEventListener('click', handleDicewareGenerate);
  document.getElementById('btn-dw-regenerate').addEventListener('click', handleDicewareGenerate);

  // 复制按钮
  bindCopyButton('btn-copy-random', 'random-result');
  bindCopyButton('btn-copy-diceware', 'diceware-result');

  // 结果区点击选中文本
  document.getElementById('random-result').addEventListener('click', function () {
    if (this.textContent) selectResult(this);
  });
  document.getElementById('diceware-result').addEventListener('click', function () {
    if (this.textContent) selectResult(this);
  });

  // 页面加载后自动生成一个示例密码
  handleGenerate();
  handleDicewareGenerate();
}

export { initPassword };
