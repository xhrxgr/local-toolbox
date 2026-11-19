/**
 * 模型下载源切换（官方 / 国内魔搭），供需要下载 HF 模型的工具使用。
 *
 * 实测（2026-11-19）：
 * - hf-mirror.net 把官方 CORS 头原样透传（ACAO 写死 https://huggingface.co），
 *   浏览器 fetch 直接被 CORS 拦截 —— 仅适用于 CLI，不能用在网页里，勿加回。
 * - 魔搭 modelscope.cn 会自动代理任意 HF 仓库（Xenova/onnx-community/
 *   HuggingFaceTB 均实测 200），下载路径 /models/{model}/resolve/master/{file}，
 *   大文件 302 到国内 LFS CDN，全程 ACAO: *，支持 Range 分段。
 * - 缓存键是完整 URL：切换源后同模型会按新 URL 重新下载，UI 需提示。
 *
 * 各工具用不同的 storageKey（translate-model-host / llm-model-host）；
 * ASR 已有的 asr-model-host 约定保持不变。
 */

export const HOST_OFFICIAL = 'https://huggingface.co';
export const HOST_MODELSCOPE = 'https://modelscope.cn';

/** @param {string} key localStorage 键（如 'translate-model-host'） */
export function getModelHost(key) {
  try {
    return localStorage.getItem(key) === HOST_MODELSCOPE ? HOST_MODELSCOPE : HOST_OFFICIAL;
  } catch {
    return HOST_OFFICIAL;
  }
}

export function setModelHost(key, host) {
  try {
    localStorage.setItem(key, host === HOST_MODELSCOPE ? HOST_MODELSCOPE : HOST_OFFICIAL);
  } catch { /* 隐私模式不可用 */ }
}
