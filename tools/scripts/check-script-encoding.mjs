#!/usr/bin/env node
/**
 * 校验 Windows 批处理与脚本的编码与行尾。
 *
 * 两种形态，各有要求：
 *
 *   仓库里的源文件（scripts/ 下的 .bat / .cmd / .ps1）
 *     → UTF-8 + CRLF，不要 BOM
 *       便于编辑、diff、版本控制；GBK 文件在编辑器里容易显示成乱码，
 *       局部编辑也容易把编码改乱。
 *
 *   发布给用户的产物（zip 里的 .bat）
 *     → GBK + CRLF，不要 BOM，不要 chcp 65001
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
 *   .ps1 → UTF-8 with BOM
 *     PowerShell 5.1 读无 BOM 的 UTF-8 会把中文当 ANSI 解析，直接语法报错。
 *
 * 用法：node tools/scripts/check-script-encoding.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const scriptsDir = join(repoRoot, 'scripts');

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

const problems = [];
const files = walk(scriptsDir);

// —— 源文件 ——
for (const p of files) {
  const rel = relative(repoRoot, p);
  const buf = readFileSync(p);
  const lower = p.toLowerCase();
  const lf = buf.includes(0x0a);
  const crlf = buf.includes(0x0d0a);
  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;

  // .gbk.bat 是构建中间产物（GBK 版的发布用 bat），规则与源文件相反
  if (lower.endsWith('.gbk.bat')) {
    if (hasBom) problems.push(`${rel}: 带 BOM，cmd 会把 BOM 当命令的一部分`);
    if (lf && !crlf) problems.push(`${rel}: LF 行尾，需 CRLF`);
    if (hasUtf8Cjk(buf)) problems.push(`${rel}: 含 UTF-8 中文字节，应为 GBK`);
    if (!hasGbkCjk(buf)) problems.push(`${rel}: 找不到 GBK 中文序列`);
    continue;
  }

  if (lower.endsWith('.bat') || lower.endsWith('.cmd')) {
    if (lf && !crlf) problems.push(`${rel}: LF 行尾，cmd 会算错字节偏移（需 CRLF）`);
    if (hasBom) problems.push(`${rel}: 带 BOM，cmd 会把 BOM 当命令的一部分`);
    if (buf.includes(Buffer.from('chcp 65001'))) {
      problems.push(`${rel}: 不要 chcp 65001（会切走代码页导致 cmd 解析错位）`);
    }
    // scripts/ 根下的 .bat 通过 ?url 直接下载给用户，
    // 仓库形态 = 用户拿到的形态 → 必须 GBK；
    // hotspot-autostart/ 子目录的是构建源（打包时转 GBK 进 zip）→ UTF-8
    const isBuildSource = rel.includes('hotspot-autostart');
    if (isBuildSource) {
      if (hasGbkCjk(buf) && !hasUtf8Cjk(buf)) {
        problems.push(`${rel}: 构建源应为 UTF-8（打包时才转 GBK）`);
      }
    } else if (hasUtf8Cjk(buf)) {
      problems.push(`${rel}: 直接分发的 .bat 必须 GBK（cmd 按 936 解码，UTF-8 会偏移错位）`);
    }
  } else if (lower.endsWith('.ps1')) {
    if (!hasBom) problems.push(`${rel}: .ps1 缺 UTF-8 BOM，PowerShell 5.1 读无 BOM 的 UTF-8 会乱码`);
    if (lf && !crlf) problems.push(`${rel}: LF 行尾，建议 CRLF`);
  }
}

// —— 发布产物（zip 里的 .bat 必须是 GBK）——
const zipPath = join(scriptsDir, 'hotspot-autostart.zip');
if (statSync(zipPath).isFile()) {
  const ps = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/\\/g, '\\\\')}')
try {
  foreach ($e in $zip.Entries) {
    if (-not $e.Name.EndsWith('.bat')) { continue }
    $s = $e.Open(); $ms = New-Object System.IO.MemoryStream; $s.CopyTo($ms); $s.Close()
    $b = $ms.ToArray()
    $hasBom = ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
    $utf8 = $false
    for ($i=0; $i -lt $b.Length-2; $i++) {
      if ($b[$i] -eq 0xE4 -and $b[$i+1] -ge 0x80 -and $b[$i+1] -le 0xBF -and $b[$i+2] -ge 0x80 -and $b[$i+2] -le 0xBF) { $utf8 = $true; break }
    }
    $crlf = $false; $bareLf = $false
    for ($i=0; $i -lt $b.Length; $i++) {
      if ($b[$i] -eq 0x0A) {
        if ($i -gt 0 -and $b[$i-1] -eq 0x0D) { $crlf = $true } else { $bareLf = $true }
      }
    }
    Write-Host ("$($e.Name)|$hasBom|$utf8|$crlf|$bareLf")
  }
} finally { $zip.Dispose() }
`;
  let out = '';
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8' });
  } catch (e) {
    problems.push(`无法检查 zip 产物: ${e.message}`);
  }
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, hasBom, utf8, crlf, bareLf] = line.split('|');
    if (hasBom === 'True') problems.push(`zip 内 ${name}: 带 BOM，cmd 会把 BOM 当命令的一部分`);
    if (utf8 === 'True') problems.push(`zip 内 ${name}: 含 UTF-8 中文字节，应为 GBK`);
    if (crlf !== 'True' || bareLf === 'True') problems.push(`zip 内 ${name}: 行尾不是纯 CRLF`);
  }
}

if (problems.length) {
  console.error('脚本编码检查未通过：');
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}
console.log(`脚本编码检查通过（源文件 ${files.length} 个 + 发布产物）`);
