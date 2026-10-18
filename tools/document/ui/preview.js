/**
 * 结果预览：HTML 类文本结果的「源码 / 预览」切换
 * 预览结果状态由本模块持有
 */

let currentPreviewResult = null; // 当前可预览的文本结果 { text, filename }

export function setPreviewResult(result) {
  currentPreviewResult = result;
}

export function resetPreview() {
  currentPreviewResult = null;
  const iframe = document.getElementById('result-preview');
  if (iframe) {
    // 只隐藏、不清 srcdoc：iframe 在 display:none 时被赋值 srcdoc 会触发
    // Chrome 绘制缺陷（取消隐藏后永久空白，克隆元素才能恢复）
    iframe.hidden = true;
  }
}

/** HTML 片段 → 可直接预览的完整文档（已是完整文档则原样返回） */
export function buildPreviewDoc(html) {
  if (/^\s*(<!DOCTYPE|<html[\s>])/i.test(html)) return html;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif; line-height: 1.6; padding: 16px; color: #1f2937; background: #ffffff; font-size: 14px; }
    h1 { font-size: 1.8em; margin: 0.6em 0 0.3em; }
    h2 { font-size: 1.5em; margin: 0.6em 0 0.3em; }
    h3 { font-size: 1.2em; margin: 0.6em 0 0.3em; }
    p { margin: 0.6em 0; }
    code { font-family: Consolas, monospace; background: #f1f5f9; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; color: inherit; padding: 0; }
    blockquote { border-left: 3px solid #6366f1; padding-left: 12px; color: #6b7280; margin: 0.6em 0; }
    table { border-collapse: collapse; width: 100%; margin: 0.6em 0; }
    th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; }
    th { background: #f1f5f9; }
    ul, ol { padding-left: 24px; }
    img { max-width: 100%; }
    a { color: #6366f1; }
  </style></head><body>${html}</body></html>`;
}

/** 切换预览模式：'source' 显示源码，'preview' 渲染 HTML */
export function setPreviewMode(mode) {
  const pre = document.getElementById('text-result');
  const iframe = document.getElementById('result-preview');
  const btnSource = document.getElementById('btn-view-source');
  const btnPreview = document.getElementById('btn-view-preview');
  if (!pre || !iframe) return;

  btnSource?.classList.toggle('result-view-btn--active', mode === 'source');
  btnPreview?.classList.toggle('result-view-btn--active', mode === 'preview');

  if (mode === 'preview' && currentPreviewResult) {
    // 必须先显示再设置 srcdoc；隐藏状态下绝不赋值 srcdoc——
    // iframe 在 display:none 时被设置 srcdoc 会触发 Chrome 绘制缺陷
    // （取消隐藏后永久空白，只能替换元素恢复）
    iframe.hidden = false;
    iframe.srcdoc = buildPreviewDoc(currentPreviewResult.text);
    pre.hidden = true;
  } else {
    iframe.hidden = true;
    pre.hidden = false;
  }
}
