/**
 * Whisper 模型注册表（ASR 工具与资源面板共用）
 *
 * 模型文件不随站点发布（40MB 量级，GitHub Pages 放不下也不该放），
 * 首次使用时由 Transformers.js 从 CDN 下载并存入浏览器 Cache Storage。
 * 这里集中维护 URL / 体积，让「离线资源」面板能预下载并显示缓存状态。
 *
 * 关于下载源：
 * - 官方 huggingface.co 会 302 到 us.aws.cdn.hf.co
 * - hf-mirror.com 对 onnx-community/* 会 308 跳回官方（无实际加速）
 * - hf-mirror.net 有真实镜像，但速度仍受国际链路限制
 * 因此 UI 提供「官方 / 镜像」切换，但不承诺镜像一定更快。
 */

export const ASR_MODEL_ID = 'onnx-community/whisper-tiny';
export const ASR_MODEL_REVISION = 'main';

/** 官方源（Transformers.js 默认） */
export const ASR_HOST_OFFICIAL = 'https://huggingface.co';
/** 国内镜像候选（可用性因网络而异） */
export const ASR_HOST_MIRROR = 'https://hf-mirror.net';

/** 推理实际会下载的文件（q8 量化版） */
export const ASR_MODEL_FILES = [
  { name: 'config.json', size: 1200, label: '模型配置' },
  { name: 'preprocessor_config.json', size: 900, label: '音频预处理配置' },
  { name: 'generation_config.json', size: 400, label: '生成配置' },
  { name: 'tokenizer.json', size: 2_500_000, label: '分词器' },
  { name: 'onnx/encoder_model_quantized.onnx', size: 10_200_000, label: '音频编码器（INT8）' },
  { name: 'onnx/decoder_model_merged_quantized.onnx', size: 30_700_000, label: '文本解码器（INT8）' },
];

export const ASR_MODEL_TOTAL = ASR_MODEL_FILES.reduce((s, f) => s + f.size, 0);

/** 拼出某个下载源下某个文件的完整 URL */
export function asrModelUrl(host, name) {
  return `${host}/${ASR_MODEL_ID}/resolve/${ASR_MODEL_REVISION}/${name}`;
}

/** 默认文件列表（官方源） */
export function asrModelUrls(host = ASR_HOST_OFFICIAL) {
  return ASR_MODEL_FILES.map((f) => asrModelUrl(host, f.name));
}

/** 从 localStorage 读取用户选择的下载源 */
export function getAsrHost() {
  try {
    return localStorage.getItem('asr-model-host') === ASR_HOST_MIRROR
      ? ASR_HOST_MIRROR
      : ASR_HOST_OFFICIAL;
  } catch {
    return ASR_HOST_OFFICIAL;
  }
}

/** 保存下载源选择 */
export function setAsrHost(host) {
  try {
    localStorage.setItem('asr-model-host', host === ASR_HOST_MIRROR ? ASR_HOST_MIRROR : ASR_HOST_OFFICIAL);
  } catch {
    /* 隐私模式下不可用，忽略 */
  }
}
