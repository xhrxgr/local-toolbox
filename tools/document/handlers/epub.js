/**
 * EPUB 操作处理（jszip + DOMParser 自实现，避免引入 epubjs 200KB+）
 * 上下文 ctx: { files, setProgress, getBaseName }
 *
 * 解析链路：
 *   EPUB(zip) → META-INF/container.xml → 找到 OPF 路径
 *   → OPF 解析 manifest（id→href）+ spine（阅读顺序）
 *   → 按 spine 顺序读 XHTML，提取 body 内容
 *   → 拼接所有章节
 */
import JSZip from 'jszip';
import { getBaseName, escapeHtml } from './utils.js';

/* ========== 解析 OPF manifest + spine ========== */
function parseOpf(opfXml) {
  const doc = new DOMParser().parseFromString(opfXml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('OPF XML 解析失败');
  }

  // manifest: id → { href, mediaType }
  const manifest = new Map();
  const manifestEl = doc.getElementsByTagName('manifest')[0];
  if (manifestEl) {
    const items = manifestEl.getElementsByTagName('item');
    for (const item of items) {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      const mediaType = item.getAttribute('media-type') || '';
      if (id && href) manifest.set(id, { href, mediaType });
    }
  }

  // spine: 按 idref 顺序
  const spine = [];
  const spineEl = doc.getElementsByTagName('spine')[0];
  if (spineEl) {
    const itemrefs = spineEl.getElementsByTagName('itemref');
    for (const ir of itemrefs) {
      const idref = ir.getAttribute('idref');
      if (idref) spine.push(idref);
    }
  }

  // 检测 OPF 自身的 base 路径（用于 resolveManifestPath）
  return { manifest, spine };
}

/* ========== 解析 container.xml 找 OPF 路径 ========== */
function parseContainerXml(containerXml) {
  const doc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const rootfiles = doc.getElementsByTagName('rootfile');
  if (rootfiles.length === 0) throw new Error('container.xml 缺少 rootfile');
  return rootfiles[0].getAttribute('full-path');
}

/* ========== 提取 XHTML body 内容 ========== */
function extractBodyContent(xhtml, mode = 'html') {
  // XHTML 是 XML，用 DOMParser 解析
  const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
  if (doc.getElementsByTagName('parsererror').length) {
    // 降级为 HTML 解析
    const htmlDoc = new DOMParser().parseFromString(xhtml, 'text/html');
    const body = htmlDoc.body;
    if (!body) return '';
    return mode === 'text' ? body.textContent : body.innerHTML;
  }
  const body = doc.getElementsByTagName('body')[0];
  if (!body) return '';

  if (mode === 'text') {
    return body.textContent || '';
  }
  // html 模式：返回 innerHTML
  return body.innerHTML || '';
}

/* ========== 图片内嵌：相对路径 img → base64 data URI ========== */
function resolveZipPath(dir, href) {
  const clean = href.replace(/^\.\//, '');
  const parts = dir ? dir.split('/') : [];
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

function guessImageMime(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    svg: 'image/svg+xml', avif: 'image/avif', tiff: 'image/tiff',
  };
  return map[ext] || 'application/octet-stream';
}

async function inlineImages(html, zip, chapterDir) {
  const wrapper = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const imgs = wrapper.querySelectorAll('img');
  for (const img of imgs) {
    const src = img.getAttribute('src');
    if (!src || /^(data:|https?:|blob:|mailto:)/i.test(src)) continue;
    const clean = decodeURIComponent(src.split('#')[0].split('?')[0]);
    const zipPath = resolveZipPath(chapterDir, clean);
    const file = zip.file(zipPath) || zip.file(clean);
    if (!file) continue;
    try {
      const b64 = await file.async('base64');
      img.setAttribute('src', `data:${guessImageMime(zipPath)};base64,${b64}`);
    } catch {
      // 单张图片失败不阻塞整体转换
    }
  }
  return wrapper.body.firstElementChild?.innerHTML ?? html;
}

/* ========== 核心解析：返回 [chapterHtml, chapterText][] ========== */
async function parseEpub(file, setProgress) {
  setProgress('读取 EPUB 文件...', '', 10);
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // ZIP 炸弹防护：EPUB 是高压缩率容器，几十 KB 的文件解出几 GB 是常态攻击手法。
  // 逐个文件累加解压后体积，超过上限立即中止（JSZip 无法在 loadAsync 阶段判断）
  let uncompressed = 0;
  const ZIP_LIMIT = 512 * 1024 * 1024; // 512MB
  zip.forEach((_, file) => {
    if (file.dir) return;
    uncompressed += file._data ? file._data.uncompressedSize || 0 : 0;
  });
  if (uncompressed > ZIP_LIMIT) {
    throw new Error(
      `EPUB 解压后体积约 ${(uncompressed / 1024 / 1024).toFixed(0)}MB，超过 ${ZIP_LIMIT / 1024 / 1024}MB 安全上限，` +
      '可能是压缩包炸弹或异常文件'
    );
  }

  setProgress('解析目录结构...', '', 25);
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('不是有效的 EPUB：缺少 META-INF/container.xml');
  const containerXml = await containerFile.async('string');
  const opfPath = parseContainerXml(containerXml);

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error(`OPF 文件不存在: ${opfPath}`);
  const opfXml = await opfFile.async('string');
  const { manifest, spine } = parseOpf(opfXml);

  if (spine.length === 0) throw new Error('OPF spine 为空');

  const opfDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]*$/, '') : '';
  const chapters = [];

  setProgress('提取章节内容...', '', 40);
  for (let i = 0; i < spine.length; i++) {
    const item = manifest.get(spine[i]);
    if (!item) continue;
    // 只处理 application/xhtml+xml 或 .html/.xhtml 文件
    const href = decodeURIComponent(item.href);
    const hrefPath = opfDir ? `${opfDir}/${href}` : href;
    const chapterFile = zip.file(hrefPath) || zip.file(href);
    if (!chapterFile) continue;
    const xhtml = await chapterFile.async('string');
    const html = await inlineImages(extractBodyContent(xhtml, 'html'), zip, hrefPath.includes('/') ? hrefPath.replace(/\/[^/]*$/, '') : '');
    const text = extractBodyContent(xhtml, 'text');
    chapters.push({ html, text });
    setProgress(`提取章节 ${i + 1}/${spine.length}...`, '', 40 + Math.round((i + 1) / spine.length * 50));
  }

  if (chapters.length === 0) throw new Error('未提取到任何章节内容');
  return chapters;
}

/* ========== EPUB → 文本 ========== */
export async function epubToText(ctx) {
  const { files, setProgress, getBaseName } = ctx;
  const file = files[0];
  const chapters = await parseEpub(file, setProgress);
  setProgress('完成', '', 100);
  // 章节间用空行分隔
  return {
    text: chapters.map(c => c.text.trim()).filter(Boolean).join('\n\n---\n\n'),
    filename: `${getBaseName(file.name)}.txt`,
  };
}

/* ========== EPUB → HTML ========== */
export async function epubToHtml(ctx) {
  const { files, setProgress, getBaseName } = ctx;
  const file = files[0];
  const chapters = await parseEpub(file, setProgress);
  setProgress('生成 HTML...', '', 95);
  // 用 <hr> 分隔章节
  const body = chapters
    .map(c => c.html.trim())
    .filter(Boolean)
    .join('\n<hr>\n');
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(getBaseName(file.name))}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 2em auto; padding: 0 1em; }
hr { margin: 2em 0; border: none; border-top: 1px solid #ccc; }
img { max-width: 100%; }
h1, h2, h3 { color: #333; }
</style>
</head>
<body>
${body}
</body>
</html>`;
  setProgress('完成', '', 100);
  return { text: html, filename: `${getBaseName(file.name)}.html` };
}

export const HANDLERS = {
  'epub-to-text': epubToText,
  'epub-to-html': epubToHtml,
};
