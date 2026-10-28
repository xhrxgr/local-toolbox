#!/usr/bin/env node
/**
 * 校验 Windows 批处理与脚本的编码与行尾。
 *
 * 三种形态，各有要求：
 *
 *   1. 直接分发的 .bat（scripts/ 根目录下）
 *     → GBK + CRLF，不要 BOM，不要 chcp 65001
 *       这些文件用户从网页下载后直接双击运行，仓库形态 = 用户拿到的形态。
 *       cmd.exe 按「当前代码页」解码批处理，并按字节偏移续读。
 *       中文 Windows 的当前代码页是 936（GBK），同一个汉字在 GBK 里
 *       两字节、在 UTF-8 里三字节 —— 两边对不上时，偏移随汉字数量
 *       累积错位，命令被从中间切断：
 *
 *           set  →  '/p'
 *           echo →  'cho'
 *           for  →  'f'
 *
 *       cmd 于是报「'cho' 不是内部或外部命令，也不是可运行的程序或批处理文件」。
 *       `goto :label` 会触发全文件重扫，错位往往在那一刻暴露。
 *       所以 .bat 用 GBK（中文 Windows 原生代码页）、行尾用 CRLF，
 *       且不能有 chcp 65001（那会把代码页切走）。
 *
 *   2. 构建源（scripts/hotspot-autostart/ 子目录下的 .bat）
 *     → UTF-8 + CRLF，不要 BOM
 *       便于编辑、diff、版本控制。GBK 文件在编辑器里容易显示成乱码，
 *       局部编辑也容易把编码改乱。构建时才转成 GBK 产物。
 *
 *   3. .ps1 → UTF-8 with BOM
 *     PowerShell 5.1 读无 BOM 的 UTF-8 会把中文当 ANSI 解析，直接语法报错。
 *
 * 另外校验分发 bat 的内嵌载荷能还原成与源 .ps1 完全一致的字节 ——
 * 载荷写坏了用户拿到的是坏文件，而这种损坏在肉眼层面看不出来。
 *
 * 用法：node tools/scripts/check-script-encoding.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const scriptsDir = join(repoRoot, 'scripts');

/* 载荷分隔标记，与 build-hotspot.mjs 保持一致 */
const MARKER = '::PAYLOAD_B64::';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function hasUtf8Cjk(buf) {
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf[i] === 0xe4 && buf[i + 1] >= 0x80 && buf[i + 1] <= 0xbf && buf[i + 2] >= 0x80 && buf[i + 2] <= 0xbf) {
      return true;
    }
  }
  return false;
}

function hasGbkCjk(buf) {
  for (let i = 0; i < buf.length - 1; i++) {
    const lead = buf[i];
    const trail = buf[i + 1];
    if (lead >= 0x81 && lead <= 0xfe && trail >= 0x40 && trail <= 0xfe && trail !== 0x7f) return true;
  }
  return false;
}

/* 判据：能否被严格 UTF-8 解码。
   GBK 的中文是两字节序列（如 0xC9 0xCF），在 UTF-8 里 0xC9 是
   「双字节字符的起始字节」，其后必须跟一个 0x80-0xBF 的续字节。
   GBK 文本里大量汉字的第二字节落在 0x40-0x7F（ASCII 区），
   因此 GBK 文本几乎不可能同时是合法 UTF-8。
   反过来，UTF-8 中文含大量 0xE4-0xE9 起始的三字节序列，
   严格解码必然成功。
   所以「严格解码成功且含中文」= UTF-8，「解码失败」= GBK。
   比按字节模式猜测可靠 —— 0xE4 本身是 GBK 合法前导字节，
   用字节模式会把 GBK 误判成 UTF-8。 */
function isStrictUtf8(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function isPureCrlf(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a && (i === 0 || buf[i - 1] !== 0x0d)) return false;
  }
  return true;
}

function hasBom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

const problems = [];
const files = walk(scriptsDir);

for (const p of files) {
  const rel = relative(repoRoot, p).replace(/\\/g, '/');
  const buf = readFileSync(p);
  const lower = p.toLowerCase();

  // scripts/hotspot-autostart/ 子目录 = 构建源；scripts/ 根下 = 直接分发
  const isBuildSource = rel.startsWith('scripts/hotspot-autostart/');

  if (lower.endsWith('.bat') || lower.endsWith('.cmd')) {
    if (buf.includes(0x0a) && !isPureCrlf(buf)) problems.push(`${rel}: 行尾不是纯 CRLF，cmd 会算错字节偏移`);
    if (hasBom(buf)) problems.push(`${rel}: 带 BOM，cmd 会把 BOM 当命令的一部分`);
    if (buf.includes(Buffer.from('chcp 65001'))) {
      problems.push(`${rel}: 不要 chcp 65001（会切走代码页导致 cmd 解析错位）`);
    }
    if (isBuildSource) {
      if (!isStrictUtf8(buf)) {
        problems.push(`${rel}: 构建源应为 UTF-8（严格解码失败，可能被存成了 GBK）`);
      }
    } else if (isStrictUtf8(buf) && hasUtf8Cjk(buf)) {
      problems.push(`${rel}: 直接分发的 .bat 必须 GBK（cmd 按 936 解码，UTF-8 会偏移错位）`);
    }
  } else if (lower.endsWith('.ps1')) {
    if (!hasBom(buf)) problems.push(`${rel}: .ps1 缺 UTF-8 BOM，PowerShell 5.1 读无 BOM 的 UTF-8 会乱码`);
    if (buf.includes(0x0a) && !isPureCrlf(buf)) problems.push(`${rel}: .ps1 行尾应为纯 CRLF`);
  }
}

// —— 分发 bat 的内嵌载荷必须能还原成源 .ps1 ——
const distBat = join(scriptsDir, 'hotspot-autostart.bat');
const srcPs1 = join(scriptsDir, 'hotspot-autostart', 'MobileHotspotAutostart.ps1');
if (statSync(distBat).isFile() && statSync(srcPs1).isFile()) {
  const distBytes = readFileSync(distBat);
  const srcBytes = readFileSync(srcPs1);
  // 用 Latin-1 读：字节与字符一一对应，载荷段是纯 ASCII，不受代码页影响
  const text = distBytes.toString('latin1');
  const idx = text.lastIndexOf(MARKER);
  if (idx < 0) {
    problems.push('scripts/hotspot-autostart.bat: 找不到内嵌载荷标记');
  } else {
    const payload = text.slice(idx + MARKER.length).replace(/\s+/g, '');
    let decoded = null;
    try {
      decoded = Buffer.from(payload, 'base64');
    } catch (e) {
      problems.push('scripts/hotspot-autostart.bat: 载荷 base64 解码失败 — ' + e.message);
    }
    if (decoded && !decoded.equals(srcBytes)) {
      problems.push(
        `scripts/hotspot-autostart.bat: 内嵌载荷与源 .ps1 不一致（还原 ${decoded.length} 字节 / 源 ${srcBytes.length} 字节）`
      );
    }
  }
}

if (problems.length) {
  console.error('脚本编码检查未通过：');
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}
console.log(`脚本编码检查通过（${files.length} 个文件）`);
