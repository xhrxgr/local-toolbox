/**
 * MD5（纯 JS，RFC 1321）
 *
 * crypto.subtle 不支持 MD5，只能自己实现。这个函数同时被主线程与
 * md5-worker.js 使用，所以单独成模块 —— 两处各写一份会在改算法时漏掉一边。
 */
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = (() => {
  const k = new Array(64);
  for (let i = 0; i < 64; i++) {
    // T[i] = floor(2^32 * abs(sin(i+1)))
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  }
  return k;
})();

export function md5(input) {
  // input: Uint8Array → Uint8Array(16)
  const origLen = input.length;
  const bitLen = origLen * 8; // JS Number 精度足够（文件大小远小于 2^50 字节）

  // 填充：0x80 + 0x00 至长度 ≡ 56 (mod 64)，再加 8 字节小端长度
  const padLen = (56 - ((origLen + 1) % 64) + 64) % 64;
  const totalLen = origLen + 1 + padLen + 8;
  const msg = new Uint8Array(totalLen);
  msg.set(input);
  msg[origLen] = 0x80;
  // 64 位小端 bit 长度
  const low = bitLen >>> 0;
  const high = Math.floor(bitLen / 0x100000000) >>> 0;
  msg[totalLen - 8] = low & 0xff;
  msg[totalLen - 7] = (low >>> 8) & 0xff;
  msg[totalLen - 6] = (low >>> 16) & 0xff;
  msg[totalLen - 5] = (low >>> 24) & 0xff;
  msg[totalLen - 4] = high & 0xff;
  msg[totalLen - 3] = (high >>> 8) & 0xff;
  msg[totalLen - 2] = (high >>> 16) & 0xff;
  msg[totalLen - 1] = (high >>> 24) & 0xff;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let chunk = 0; chunk < totalLen; chunk += 64) {
    const M = new Array(16);
    for (let i = 0; i < 16; i++) {
      const off = chunk + i * 4;
      M[i] = (msg[off] | (msg[off + 1] << 8) | (msg[off + 2] << 16) | (msg[off + 3] << 24)) >>> 0;
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      const shift = MD5_S[i];
      // 32 位循环左移
      B = (B + (((F << shift) | (F >>> (32 - shift))) >>> 0)) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const words = [a0, b0, c0, d0];
  for (let i = 0; i < 4; i++) {
    const w = words[i];
    out[i * 4] = w & 0xff;
    out[i * 4 + 1] = (w >>> 8) & 0xff;
    out[i * 4 + 2] = (w >>> 16) & 0xff;
    out[i * 4 + 3] = (w >>> 24) & 0xff;
  }
  return out;
}
