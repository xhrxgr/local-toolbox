#!/usr/bin/env node
/**
 * 打包移动热点开机自启脚本
 *
 * 产物：scripts/hotspot-autostart.zip
 *   - MobileHotspotAutostart.bat    菜单式入口（双击运行，GBK 编码）
 *   - MobileHotspotAutostart.ps1    实际逻辑（WinRT 开关热点）
 *   - payload.b64                   PS1 的 base64，由 bat 释放
 *
 * 两种编码形态，各有原因：
 *
 *   仓库里的源 .bat → UTF-8 + CRLF
 *     便于编辑、diff、版本控制。GBK 文件在编辑器里容易显示成乱码，
 *     局部编辑也容易把编码改乱。
 *
 *   发布给用户的 .bat → GBK + CRLF，不要 BOM，不要 chcp 65001
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
 *   .ps1 → UTF-8 with BOM
 *     PowerShell 5.1 读无 BOM 的 UTF-8 会把中文当 ANSI 解析，直接语法报错。
 *
 * 用法：node tools/scripts/build-hotspot.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const srcDir = join(repoRoot, 'scripts');
const outDir = join(srcDir, 'hotspot-autostart');
const outZip = join(srcDir, 'hotspot-autostart.zip');

const ps1 = join(outDir, 'MobileHotspotAutostart.ps1');
const bat = join(outDir, 'MobileHotspotAutostart.bat');

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

// —— 源文件校验 ——
const batBytes = readFileSync(bat);
const ps1Bytes = readFileSync(ps1);
const problems = [];
if (!hasUtf8Cjk(batBytes) && hasGbkCjk(batBytes)) problems.push('源 bat 应为 UTF-8');
if (batBytes.includes(0x0a) && !batBytes.includes(0x0d0a)) problems.push('源 bat 是 LF 行尾，需 CRLF');
if (batBytes[0] === 0xef && batBytes[1] === 0xbb && batBytes[2] === 0xbf) problems.push('源 bat 不应带 BOM');
if (batBytes.includes(Buffer.from('chcp 65001'))) {
  problems.push('源 bat 不应有 chcp 65001（会切走代码页导致 cmd 解析错位）');
}
if (!(ps1Bytes[0] === 0xef && ps1Bytes[1] === 0xbb && ps1Bytes[2] === 0xbf)) {
  problems.push('ps1 必须带 UTF-8 BOM（PowerShell 5.1 读无 BOM 的 UTF-8 会乱码）');
}
if (problems.length) {
  console.error('源文件检查未通过：');
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}

// —— UTF-8 源 bat → GBK 产物 ——
// 用 PowerShell 做转换：Node 只认 utf-8/utf16/latin1 等，
// 不认 gbk；而 Windows 自带代码页 936 的支持就在 PowerShell 里。
// 顺便避免引入新依赖（装依赖会连带改 package.json）。
const batGbkPath = join(outDir, 'MobileHotspotAutostart.gbk.bat');
const psConvert = `
$ErrorActionPreference = 'Stop'
$src = '${bat.replace(/\\/g, '\\\\')}'
$dst = '${batGbkPath.replace(/\\/g, '\\\\')}'
$text = [System.IO.File]::ReadAllText($src, [System.Text.UTF8Encoding]::new($false))
$text = $text -replace "\`r\`n", "\`n" -replace "\`n", "\`r\`n"
$gbk = [System.Text.Encoding]::GetEncoding(936)
[System.IO.File]::WriteAllBytes($dst, $gbk.GetBytes($text))
Write-Host ('GBK bat: ' + (Get-Item $dst).Length + ' bytes')
`;
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psConvert], { stdio: 'inherit' });

// —— PS1 转 base64 ——
// base64 的是带 BOM 的版本（见上方说明）。
const ps1Text = readFileSync(ps1, 'utf8');
const ps1WithBom = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from(ps1Text.replace(/^﻿/, ''), 'utf8'),
]);
const b64 = ps1WithBom.toString('base64');
// certutil 的 -decode 每行最长 76 字符
const b64Lines = b64.match(/.{1,76}/g).join('\r\n') + '\r\n';

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'payload.b64'), b64Lines, 'ascii');

// —— 打 zip ——
// zip 里放 GBK 版的 bat
if (existsSync(outZip)) rmSync(outZip);
const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open('${outZip.replace(/\\/g, '\\\\')}', 'Create')
try {
  $items = @(
    @{ src = '${batGbkPath.replace(/\\/g, '\\\\')}'; name = 'MobileHotspotAutostart.bat' },
    @{ src = '${ps1.replace(/\\/g, '\\\\')}';            name = 'MobileHotspotAutostart.ps1' },
    @{ src = '${join(outDir, 'payload.b64').replace(/\\/g, '\\\\')}'; name = 'payload.b64' }
  )
  foreach ($it in $items) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $it.src, $it.name) | Out-Null
  }
} finally { $zip.Dispose() }
Write-Host ('ZIP size: ' + (Get-Item '${outZip.replace(/\\/g, '\\\\')}').Length + ' bytes')
`;
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'inherit' });

console.log('完成。');
console.log('  源 bat  :', bat, '(UTF-8 + CRLF)');
console.log('  产物 bat:', batGbkPath, '(GBK + CRLF)');
console.log('  ps1     :', ps1, '(UTF-8 BOM + CRLF)');
console.log('  zip     :', outZip);
