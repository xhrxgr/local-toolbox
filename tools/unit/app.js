/**
 * 单位转换器核心逻辑
 * 7 个类别：长度 / 质量 / 温度 / 数据量 / 时间 / 角度 / 速度
 * 全部本地运行，无任何网络请求
 * 双向实时转换 + 交换单位
 */

/* ========== 单位定义表（factor = 到基准单位的倍数） ========== */
const UNITS = {
  length: {
    base: '米 (m)',
    units: [
      { name: 'nm', label: '纳米 (nm)', factor: 1e-9 },
      { name: 'um', label: '微米 (μm)', factor: 1e-6 },
      { name: 'mm', label: '毫米 (mm)', factor: 0.001 },
      { name: 'cm', label: '厘米 (cm)', factor: 0.01 },
      { name: 'm', label: '米 (m)', factor: 1 },
      { name: 'km', label: '千米 (km)', factor: 1000 },
      { name: 'in', label: '英寸 (in)', factor: 0.0254 },
      { name: 'ft', label: '英尺 (ft)', factor: 0.3048 },
      { name: 'yd', label: '码 (yd)', factor: 0.9144 },
      { name: 'mi', label: '英里 (mi)', factor: 1609.344 },
      { name: 'nmi', label: '海里 (nmi)', factor: 1852 },
    ],
  },
  mass: {
    base: '克 (g)',
    units: [
      { name: 'mg', label: '毫克 (mg)', factor: 0.001 },
      { name: 'g', label: '克 (g)', factor: 1 },
      { name: 'kg', label: '千克 (kg)', factor: 1000 },
      { name: 't', label: '吨 (t)', factor: 1000000 },
      { name: 'oz', label: '盎司 (oz)', factor: 28.3495 },
      { name: 'lb', label: '磅 (lb)', factor: 453.592 },
      { name: 'jin', label: '斤 (市斤)', factor: 500 },
    ],
  },
  temperature: {
    base: '摄氏度 (℃)',
    units: [
      { name: 'C', label: '摄氏度 (℃)' },
      { name: 'F', label: '华氏度 (℉)' },
      { name: 'K', label: '开尔文 (K)' },
    ],
  },
  data: {
    base: '字节 (B)',
    units: [
      { name: 'bit', label: '比特 (bit)', factor: 0.125 },
      { name: 'B', label: '字节 (B)', factor: 1 },
      { name: 'KB', label: '千字节 KB (10³)', factor: 1000 },
      { name: 'KiB', label: '千字节 KiB (2¹⁰)', factor: 1024 },
      { name: 'MB', label: '兆字节 MB (10⁶)', factor: 1e6 },
      { name: 'MiB', label: '兆字节 MiB (2²⁰)', factor: 1048576 },
      { name: 'GB', label: '吉字节 GB (10⁹)', factor: 1e9 },
      { name: 'GiB', label: '吉字节 GiB (2³⁰)', factor: 1073741824 },
      { name: 'TB', label: '太字节 TB (10¹²)', factor: 1e12 },
      { name: 'TiB', label: '太字节 TiB (2⁴⁰)', factor: 1099511627776 },
      { name: 'PB', label: '拍字节 PB (10¹⁵)', factor: 1e15 },
      { name: 'PiB', label: '拍字节 PiB (2⁵⁰)', factor: 1125899906842624 },
    ],
  },
  time: {
    base: '秒 (s)',
    units: [
      { name: 'ns', label: '纳秒 (ns)', factor: 1e-9 },
      { name: 'us', label: '微秒 (μs)', factor: 1e-6 },
      { name: 'ms', label: '毫秒 (ms)', factor: 1e-3 },
      { name: 's', label: '秒 (s)', factor: 1 },
      { name: 'min', label: '分 (min)', factor: 60 },
      { name: 'h', label: '时 (h)', factor: 3600 },
      { name: 'day', label: '天 (day)', factor: 86400 },
      { name: 'week', label: '周 (week)', factor: 604800 },
    ],
  },
  angle: {
    base: '度 (°)',
    units: [
      { name: 'deg', label: '度 (°)', factor: 1 },
      { name: 'rad', label: '弧度 (rad)', factor: 57.29577951308232 },
      { name: 'grad', label: '梯度 (grad)', factor: 0.9 },
      { name: 'turn', label: '圈 (turn)', factor: 360 },
    ],
  },
  speed: {
    base: '米/秒 (m/s)',
    units: [
      { name: 'mps', label: '米/秒 (m/s)', factor: 1 },
      { name: 'kmh', label: '千米/时 (km/h)', factor: 0.277778 },
      { name: 'mph', label: '英里/时 (mph)', factor: 0.44704 },
      { name: 'kn', label: '节 (kn)', factor: 0.514444 },
    ],
  },
};

/* ========== Tab 切换 ========== */
function switchTab(mode) {
  document.querySelectorAll('.mode-tab').forEach((t) => {
    t.classList.toggle('mode-tab--active', t.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-panel').forEach((p) => {
    p.classList.toggle('mode-panel--active', p.id === `panel-${mode}`);
  });
}

/* ========== 元素获取 ========== */
function getEls(category) {
  const panel = document.getElementById(`panel-${category}`);
  return {
    panel,
    fromInput: panel.querySelector('.unit-input[data-direction="from"]'),
    toInput: panel.querySelector('.unit-input[data-direction="to"]'),
    fromSelect: panel.querySelector('.unit-select[data-direction="from"]'),
    toSelect: panel.querySelector('.unit-select[data-direction="to"]'),
    swapBtn: panel.querySelector('.unit-swap'),
  };
}

/* ========== 转换核心 ========== */
// 温度特殊处理（不能用因子）
function convertTemp(value, from, to) {
  if (from === to) return value;
  // 先统一转为摄氏度
  let c;
  if (from === 'C') c = value;
  else if (from === 'F') c = ((value - 32) * 5) / 9;
  else c = value - 273.15; // K
  // 再由摄氏度转为目标
  if (to === 'C') return c;
  if (to === 'F') return (c * 9) / 5 + 32;
  return c + 273.15; // K
}

// 通用转换：result = value * fromFactor / toFactor
function convert(value, category, fromName, toName) {
  if (category === 'temperature') {
    return convertTemp(value, fromName, toName);
  }
  const cat = UNITS[category];
  const fromUnit = cat.units.find((u) => u.name === fromName);
  const toUnit = cat.units.find((u) => u.name === toName);
  return (value * fromUnit.factor) / toUnit.factor;
}

// 精度处理：保留 6 位有效数字，消除浮点尾差
function formatResult(value) {
  if (value === null || value === undefined || !isFinite(value)) return '';
  return String(parseFloat(value.toPrecision(6)));
}

// 解析输入：空串/非法 → null
function parseValue(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const n = Number(s);
  if (!isFinite(n) || isNaN(n)) return null;
  return n;
}

/* ========== 实时重算 ========== */
// sourceDirection 表示当前编辑的一侧，另一侧被重算
function recompute(category, sourceDirection) {
  const els = getEls(category);
  const sourceInput = sourceDirection === 'from' ? els.fromInput : els.toInput;
  const targetInput = sourceDirection === 'from' ? els.toInput : els.fromInput;
  const sourceSelect = sourceDirection === 'from' ? els.fromSelect : els.toSelect;
  const targetSelect = sourceDirection === 'from' ? els.toSelect : els.fromSelect;

  const value = parseValue(sourceInput.value);
  if (value === null) {
    targetInput.value = '';
    return;
  }
  const result = convert(value, category, sourceSelect.value, targetSelect.value);
  targetInput.value = formatResult(result);
}

/* ========== 交换两侧单位 + 数值 ========== */
function swap(category) {
  const els = getEls(category);
  const fromUnit = els.fromSelect.value;
  const toUnit = els.toSelect.value;
  const fromVal = els.fromInput.value;
  const toVal = els.toInput.value;
  els.fromSelect.value = toUnit;
  els.toSelect.value = fromUnit;
  els.fromInput.value = toVal;
  els.toInput.value = fromVal;
}

/* ========== 初始化某个类别 ========== */
function initCategory(category) {
  const cat = UNITS[category];
  const els = getEls(category);
  // 填充下拉框
  const options = cat.units.map((u) => `<option value="${u.name}">${u.label}</option>`).join('');
  els.fromSelect.innerHTML = options;
  els.toSelect.innerHTML = options;
  // 默认：第一个 + 第二个单位
  els.fromSelect.value = cat.units[0].name;
  els.toSelect.value = cat.units[1].name;
  // 默认值 1，并计算另一侧
  els.fromInput.value = '1';
  els.toInput.value = '';
  recompute(category, 'from');
}

/* ========== 初始化 ========== */
function initUnit() {
  // Tab 切换
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // 初始化所有类别（默认第一/第二个单位 + 值 1）
  Object.keys(UNITS).forEach((category) => {
    initCategory(category);
    const els = getEls(category);
    // 任一侧输入实时转换
    els.fromInput.addEventListener('input', () => recompute(category, 'from'));
    els.toInput.addEventListener('input', () => recompute(category, 'to'));
    // 任一侧单位切换：以该侧为源重算另一侧
    els.fromSelect.addEventListener('change', () => recompute(category, 'from'));
    els.toSelect.addEventListener('change', () => recompute(category, 'to'));
    // 交换按钮
    els.swapBtn.addEventListener('click', () => swap(category));
  });
}

export { initUnit };
