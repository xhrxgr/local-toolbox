/**
 * MD5 计算 Worker
 *
 * 为什么需要它：MD5 没有原生实现，纯 JS 计算是同步的 —— 实测 20MB 文件
 * 会在主线程阻塞 329ms，100MB 约 1.6 秒，期间界面完全无响应。
 * 放到 Worker 后主线程只等一个 Promise，滚动、输入都不受影响。
 *
 * 协议：
 *   入参 { id, buf }（buf 为 ArrayBuffer，由主线程转移过来，不复制）
 *   出参 { id, out }（out 为 Uint8Array 的 buffer，同样转移回去）
 */
import { md5 } from './md5.js';

self.onmessage = (e) => {
  const { id, buf } = e.data;
  try {
    const out = md5(new Uint8Array(buf));
    self.postMessage({ id, out: out.buffer }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
