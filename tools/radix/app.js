/**
 * 进制/编码转换器
 * 全部本地处理，无依赖
 *
 * 设计：所有目标格式一次性输出
 * - 数值模式：把输入当作大整数，支持 2/8/10/16 进制
 * - 字节模式：把输入当作字节序列，支持 text/hex/base32/58/62/64 编码
 */

/* ========== Base32 实现（RFC 4648，无 padding） ========== */
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const cleaned = str.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const c of cleaned) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx < 0) throw new Error('Base32 字符无效: ' + c);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/* ========== Base58 实现（Bitcoin 字母表） ========== */
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes) {
  // 前导零
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  // 转 BigInt
  let num = 0n;
  for (const b of bytes) num = (num << 8n) | BigInt(b);
  let str = '';
  while (num > 0n) {
    const rem = num % 58n;
    num = num / 58n;
    str = B58_ALPHABET[Number(rem)] + str;
  }
  return '1'.repeat(zeros) + str;
}
function base58Decode(str) {
  const cleaned = str.replace(/\s/g, '');
  let num = 0n;
  for (const c of cleaned) {
    const idx = B58_ALPHABET.indexOf(c);
    if (idx < 0) throw new Error('Base58 字符无效: ' + c);
    num = num * 58n + BigInt(idx);
  }
  // 转字节
  const bytes = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num = num >> 8n;
  }
  // 前导 1 → 前导零字节
  let zeros = 0;
  while (zeros < cleaned.length && cleaned[zeros] === '1') zeros++;
  return new Uint8Array([...new Array(zeros).fill(0), ...bytes]);
}

/* ========== Base62 实现 ========== */
const B62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function base62Encode(bytes) {
  let num = 0n;
  for (const b of bytes) num = (num << 8n) | BigInt(b);
  if (num === 0n) return '0';
  let str = '';
  while (num > 0n) {
    const rem = num % 62n;
    num = num / 62n;
    str = B62_ALPHABET[Number(rem)] + str;
  }
  return str;
}
function base62Decode(str) {
  const cleaned = str.replace(/\s/g, '');
  let num = 0n;
  for (const c of cleaned) {
    const idx = B62_ALPHABET.indexOf(c);
    if (idx < 0) throw new Error('Base62 字符无效: ' + c);
    num = num * 62n + BigInt(idx);
  }
  const bytes = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num = num >> 8n;
  }
  return new Uint8Array(bytes);
}

/* ========== Base64 / Hex 工具 ========== */
function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToBytes(str) {
  const cleaned = str.replace(/\s/g, '');
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const cleaned = hex.replace(/\s/g, '').replace(/^0x/i, '');
  if (cleaned.length % 2 !== 0) throw new Error('Hex 字符串长度必须为偶数');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.substr(i, 2), 16);
  }
  return bytes;
}
function bytesToText(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
function textToBytes(text) {
  return new TextEncoder().encode(text);
}

/* ========== 大整数进制转换 ========== */
function bigIntToBase(num, base) {
  if (num === 0n) return '0';
  const negative = num < 0n;
  if (negative) num = -num;
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  let str = '';
  while (num > 0n) {
    const rem = num % BigInt(base);
    num = num / BigInt(base);
    str = digits[Number(rem)] + str;
  }
  return (negative ? '-' : '') + str;
}
function baseToBigInt(str, base) {
  const negative = str.startsWith('-');
  if (negative) str = str.slice(1);
  const cleaned = str.replace(/\s/g, '').toLowerCase();
  let num = 0n;
  for (const c of cleaned) {
    const v = parseInt(c, base);
    if (isNaN(v) || v >= base) throw new Error(`字符 '${c}' 不是有效的 ${base} 进制数字`);
    num = num * BigInt(base) + BigInt(v);
  }
  return negative ? -num : num;
}

/* ========== 主逻辑 ========== */
function initRadix() {
  const $ = (id) => document.getElementById(id);
  const inputEl = $('radix-input');
  const sourceSel = $('radix-source');
  const treatAsNum = $('radix-treat-as-num');
  const metaEl = $('radix-meta');

  function convert() {
    const input = inputEl.value.trim();
    if (!input) {
      clearOutputs();
      return;
    }
    try {
      const source = sourceSel.value;
      let bytes = null;
      let bigNum = null;

      // 解析输入
      if (source === 'text') {
        bytes = textToBytes(input);
      } else if (source === 'base32') {
        bytes = base32Decode(input);
      } else if (source === 'base58') {
        bytes = base58Decode(input);
      } else if (source === 'base62') {
        bytes = base62Decode(input);
      } else if (source === 'base64') {
        bytes = base64ToBytes(input);
      } else if (source === 'hex-str') {
        bytes = hexToBytes(input);
      } else if (['2', '8', '10', '16'].includes(source)) {
        // 进制输入：数值模式 vs 字节模式
        const base = parseInt(source, 10);
        if (treatAsNum.checked) {
          bigNum = baseToBigInt(input, base);
        } else {
          // 默认按字节序列处理：把输入当作 hex 字符串（如果合法）或文本
          // 对 16 进制直接按 hex 字节解析
          if (base === 16) {
            try { bytes = hexToBytes(input); }
            catch { bytes = textToBytes(input); }
          } else {
            // 其他进制（2/8/10）：尝试作为大整数，再转字节
            try {
              const n = baseToBigInt(input, base);
              if (n >= 0n && n <= 0xffffffffn) {
                // 适合用 4 字节以内的整数
                bigNum = n;
              } else {
                bigNum = n;
              }
            } catch {
              bytes = textToBytes(input);
            }
          }
        }
      }

      // 输出所有目标
      if (bigNum !== null) {
        // 数值模式：输出各种进制
        $('out-base2').value = bigIntToBase(bigNum, 2);
        $('out-base8').value = bigIntToBase(bigNum, 8);
        $('out-base10').value = bigIntToBase(bigNum, 10);
        $('out-base16').value = bigIntToBase(bigNum, 16);
        // 字节序列：把大整数转字节
        const tmpBytes = bigIntToBytes(bigNum);
        fillByteOutputs(tmpBytes);
      } else if (bytes !== null) {
        // 字节模式：尝试输出数值（仅当数据是有效整数）
        $('out-base2').value = bytesToBase(bytes, 2);
        $('out-base8').value = bytesToBase(bytes, 8);
        $('out-base10').value = bytesToBase(bytes, 10);
        $('out-base16').value = bytesToBase(bytes, 16);
        fillByteOutputs(bytes);
      }
      metaEl.textContent = '转换成功';
      metaEl.style.color = '';
    } catch (e) {
      metaEl.textContent = '错误：' + e.message;
      metaEl.style.color = '#ef4444';
    }
  }

  function fillByteOutputs(bytes) {
    $('out-text').value = bytesToText(bytes);
    $('out-hexstr').value = bytesToHex(bytes);
    $('out-base32').value = base32Encode(bytes);
    $('out-base58').value = base58Encode(bytes);
    $('out-base62').value = base62Encode(bytes);
    $('out-base64').value = bytesToBase64(bytes);
  }

  function bytesToBase(bytes, base) {
    if (bytes.length === 0) return '0';
    let num = 0n;
    for (const b of bytes) num = (num << 8n) | BigInt(b);
    return bigIntToBase(num, base);
  }

  function bigIntToBytes(num) {
    if (num === 0n) return new Uint8Array([0]);
    const negative = num < 0n;
    if (negative) num = -num;
    const bytes = [];
    while (num > 0n) {
      bytes.unshift(Number(num & 0xffn));
      num = num >> 8n;
    }
    // 避免最高位被解释为负数（添加前导零）
    if (bytes[0] & 0x80) bytes.unshift(0);
    return new Uint8Array(bytes);
  }

  function clearOutputs() {
    document.querySelectorAll('.radix-output').forEach(el => el.value = '');
    metaEl.textContent = '';
  }

  $('btn-convert').addEventListener('click', convert);
  $('btn-clear').addEventListener('click', () => {
    inputEl.value = '';
    clearOutputs();
  });

  // 实时转换（输入或源类型变化时）
  inputEl.addEventListener('input', convert);
  sourceSel.addEventListener('change', convert);
  treatAsNum.addEventListener('change', convert);

  // 复制按钮（每个输出框双击复制）
  document.querySelectorAll('.radix-output').forEach(el => {
    el.addEventListener('dblclick', () => {
      if (!el.value) return;
      navigator.clipboard.writeText(el.value).then(() => {
        const orig = el.style.background;
        el.style.background = 'rgba(34, 197, 94, 0.15)';
        setTimeout(() => { el.style.background = orig; }, 600);
      });
    });
  });
}

export { initRadix };
