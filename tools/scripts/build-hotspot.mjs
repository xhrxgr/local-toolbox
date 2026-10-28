#!/usr/bin/env node
/**
 * 构建移动热点开机自启脚本
 *
 * 产物：scripts/hotspot-autostart.bat（单文件，直接下载给用户）
 *
 * 为什么是单文件：
 *   逻辑主体在 PowerShell 脚本里，批处理只是菜单壳。
 *   之前分发的是 zip（bat + ps1 + payload.b64 三个文件），
 *   用户要解压、要保证三个文件放同一目录，缺一个就报错。
 *   现在把 ps1 以 base64 内嵌进 bat 末尾，运行时自己释放出来 ——
 *   用户只拿到一个文件，双击就能用。
 *
 * 两种编码形态，各有原因：
 *
 *   构建源（scripts/hotspot-autostart/ 下的 .bat）→ UTF-8 + CRLF
 *     便于编辑、diff、版本控制。GBK 文件在编辑器里容易显示成乱码，
 *     局部编辑也容易把编码改乱。
 *
 *   发布产物（scripts/hotspot-autostart.bat）→ GBK + CRLF，不要 BOM，
 *     不要 chcp 65001
 *     cmd.exe 按「当前代码页」解码批处理，并按字节偏移续读。
 *     中文 Windows 的当前代码页是 936（GBK），同一个汉字在 GBK 里
 *     两字节、在 UTF-8 里三字节 —— 两边对不上时，偏移随汉字数量
 *     累积错位，命令被从中间切断：
 *
 *         set  →  '/p'
 *         echo →  'cho'
 *         for  →  'f'
 *
 *     cmd 于是报「'cho' 不是内部或外部命令，也不是可运行的程序或批处理文件」。
 *     `goto :label` 会触发全文件重扫，错位往往在那一刻暴露。
 *     所以 .bat 用 GBK（中文 Windows 原生代码页）、行尾用 CRLF，
 *     且不能有 chcp 65001（那会把代码页切走）。
 *
 *   内嵌载荷为什么用 base64 而不是明文：
 *     ps1 必须是 UTF-8 with BOM（PowerShell 5.1 读无 BOM 的 UTF-8
 *     会把中文当 ANSI 解析，直接语法报错）。明文塞进 GBK 的 bat
 *     会经过一次有损的编码往返 —— 中文变乱码。
 *     base64 是纯 ASCII，往返无损，且不依赖系统代码页
 *     （释放时用 Latin-1 读回，字节与字符一一对应）。
 *
 * 用法：node tools/scripts/build-hotspot.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const srcDir = join(repoRoot, 'scripts', 'hotspot-autostart');
const outFile = join(repoRoot, 'scripts', 'hotspot-autostart.bat');

const ps1 = join(srcDir, 'MobileHotspotAutostart.ps1');
const bat = join(srcDir, 'MobileHotspotAutostart.bat');

/* 载荷分隔标记。bat 里的释放命令也含这个串，
   所以释放时用 LastIndexOf 取最后一次出现。 */
const MARKER = '::PAYLOAD_B64::';

for (const f of [ps1, bat]) {
  if (!existsSync(f)) {
    console.error('缺少源文件:', f);
    process.exit(1);
  }
}

function hasUtf8Cjk(buf) {
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf[i] === 0xe4 && buf[i + 1] >= 0x80 && buf[i + 1] <= 0xbf && buf[i + 2] >= 0x80 && buf[i + 2] <= 0xbf) return true;
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
    if (buf[i] === 0x0a) {
      if (i === 0 || buf[i - 1] !== 0x0d) return false;
    }
  }
  return true;
}
function hasBom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

// —— 源文件校验 ——
const batBytes = readFileSync(bat);
const ps1Bytes = readFileSync(ps1);
const problems = [];
if (!isStrictUtf8(batBytes)) problems.push('源 bat 应为 UTF-8（严格解码失败，可能被存成了 GBK）');
if (!hasUtf8Cjk(batBytes)) problems.push('源 bat 里找不到中文，疑似编码异常');
if (batBytes.includes(0x0a) && !isPureCrlf(batBytes)) problems.push('源 bat 行尾必须是纯 CRLF');
if (hasBom(batBytes)) problems.push('源 bat 不应带 BOM');
if (batBytes.includes(Buffer.from('chcp 65001'))) {
  problems.push('源 bat 不应有 chcp 65001（会切走代码页导致 cmd 解析错位）');
}
if (!hasBom(ps1Bytes)) {
  problems.push('ps1 必须带 UTF-8 BOM（PowerShell 5.1 读无 BOM 的 UTF-8 会乱码）');
}
if (ps1Bytes.includes(0x0a) && !isPureCrlf(ps1Bytes)) problems.push('ps1 行尾必须是纯 CRLF');
if (problems.length) {
  console.error('源文件检查未通过：');
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}

// —— 注入载荷 ——
// ps1 原始字节（含 UTF-8 BOM）→ base64 → 按 76 字符换行（与 certutil 习惯一致）
const b64 = ps1Bytes.toString('base64');
const b64Lines = b64.match(/.{1,76}/g);

const batText = readFileSync(bat, 'utf8');
const markerIdx = batText.lastIndexOf(MARKER);
if (markerIdx < 0) {
  console.error('源 bat 里找不到载荷标记:', MARKER);
  process.exit(1);
}
// 标记所在行之后（含该行）替换成标记 + 载荷
const markerLineEnd = batText.indexOf('\n', markerIdx);
if (markerLineEnd < 0) {
  console.error('载荷标记行不完整');
  process.exit(1);
}
const head = batText.slice(0, markerLineEnd + 1);
const merged = head + b64Lines.join('\r\n') + '\r\n';

// —— UTF-8 源 bat → GBK 产物 ——
// 用 PowerShell 做转换：Node 只认 utf-8/utf16/latin1 等，
// 不认 gbk；而 Windows 自带代码页 936 的支持就在 PowerShell 里。
// 顺便避免引入新依赖（装依赖会连带改 package.json）。
mkdirSync(dirname(outFile), { recursive: true });
const psConvert = `
$ErrorActionPreference = 'Stop'
$src = '${join(srcDir, '.payload-tmp.txt').replace(/\\/g, '\\\\')}'
$dst = '${outFile.replace(/\\/g, '\\\\')}'
$text = [System.IO.File]::ReadAllText($src, [System.Text.UTF8Encoding]::new($false))
$text = $text -replace "\`r\`n", "\`n" -replace "\`n", "\`r\`n"
$gbk = [System.Text.Encoding]::GetEncoding(936)
[System.IO.File]::WriteAllBytes($dst, $gbk.GetBytes($text))
`;
const tmpSrc = join(srcDir, '.payload-tmp.txt');
writeFileSync(tmpSrc, merged, 'utf8');
try {
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psConvert], { stdio: 'inherit' });
} finally {
  rmSync(tmpSrc, { force: true });
}

// —— 产物自检 ——
// 1) 编码形态：GBK、有中文、无 BOM、纯 CRLF
// 2) 载荷能还原成与 ps1 完全一致的字节（否则用户拿到的是坏文件）
const outBytes = readFileSync(outFile);
const outProblems = [];
if (hasBom(outBytes)) outProblems.push('产物带 BOM');
if (isStrictUtf8(outBytes)) outProblems.push('产物能被严格 UTF-8 解码，说明它是 UTF-8 而非 GBK');
if (!hasGbkCjk(outBytes)) outProblems.push('产物找不到 GBK 中文序列');
if (outBytes.includes(0x0a) && !isPureCrlf(outBytes)) outProblems.push('产物行尾不是纯 CRLF');
if (outBytes.includes(Buffer.from('chcp 65001'))) outProblems.push('产物含 chcp 65001');

const latin1 = outBytes.toString('latin1');
const lastMarker = latin1.lastIndexOf(MARKER);
if (lastMarker < 0) {
  outProblems.push('产物里找不到载荷标记');
} else {
  const payload = latin1.slice(lastMarker + MARKER.length).replace(/\s+/g, '');
  let decoded;
  try {
    decoded = Buffer.from(payload, 'base64');
  } catch (e) {
    outProblems.push('载荷 base64 解码失败: ' + e.message);
  }
  if (decoded && !decoded.equals(ps1Bytes)) {
    outProblems.push(`载荷还原结果与源 ps1 不一致（还原 ${decoded.length} 字节 / 源 ${ps1Bytes.length} 字节）`);
  }
}

if (outProblems.length) {
  console.error('产物检查未通过：');
  for (const p of outProblems) console.error('  -', p);
  process.exit(1);
}

console.log('完成。');
console.log('  源 bat  :', bat, '(UTF-8 + CRLF)');
console.log('  源 ps1  :', ps1, '(UTF-8 BOM + CRLF)');
console.log('  产物    :', outFile, `(GBK + CRLF, ${outBytes.length} 字节)`);
