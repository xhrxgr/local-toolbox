/**
 * RTF 操作处理（自实现 RTF Parser，零依赖）
 * 上下文 ctx: { files, text, setProgress, getBaseName }
 *
 * 支持 RTF 控制字：
 *   \rtf1 \ansi \ansicpg936 - 文档头/编码（跳过）
 *   \fonttbl \colortbl \info \stylesheet \*\xxx - 目标组（跳过整组）
 *   \par \line - 段落/换行
 *   \tab - 制表符
 *   \b \b0 \i \b0 \ul \ulnone - 粗体/斜体/下划线
 *   \\ \{ \} - 转义字符
 *   \'XX - 十六进制字节（按 cp1252/cp936 解码）
 *   \uN - Unicode 字符（可能跟随 ? 替代字节）
 *   \fN \fsN - 字体/字号（跳过）
 *
 * 解析策略：状态机 + 栈跟踪组嵌套
 */
import { getBaseName } from './utils.js';

/* ========== RTF 解析器 ========== */
class RtfParser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.output = [];          // 段落数组：[{ runs: [{ text, bold, italic, underline }] }]
    this.currentRun = { text: '', bold: false, italic: false, underline: false };
    this.currentParagraph = { runs: [] };
    this.skipGroupDepth = 0;   // 当前在跳过的组内（fonttbl 等）
    this.groupStack = [];      // 跟踪 bold/italic/underline 状态
  }

  /* ========== 主入口 ========== */
  parse() {
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === '\\') {
        this.parseControl();
      } else if (ch === '{') {
        this.openGroup();
        this.pos++;
      } else if (ch === '}') {
        this.closeGroup();
        this.pos++;
      } else if (ch === '\r' || ch === '\n') {
        // RTF 换行符忽略（用 \par 控制段落）
        this.pos++;
      } else {
        if (this.skipGroupDepth === 0) {
          this.currentRun.text += ch;
        }
        this.pos++;
      }
    }
    // 收尾
    this.endParagraph();
    return this.output;
  }

  /* ========== 解析控制字/控制符号 ========== */
  parseControl() {
    this.pos++; // skip '\\'
    if (this.pos >= this.text.length) return;

    const next = this.text[this.pos];

    // \\\\ \\{ \\} 转义字符
    if (next === '\\' || next === '{' || next === '}') {
      if (this.skipGroupDepth === 0) this.currentRun.text += next;
      this.pos++;
      return;
    }

    // \\'XX 十六进制字节
    if (next === "'") {
      this.pos++;
      const hex = this.text.substr(this.pos, 2);
      this.pos += 2;
      if (this.skipGroupDepth === 0) {
        const code = parseInt(hex, 16);
        // cp1252 / latin1 简单映射
        const ch = this.decodeAnsiChar(code);
        this.currentRun.text += ch;
      }
      return;
    }

    // \uN Unicode 字符
    if (next === 'u') {
      this.pos++;
      let numStr = '';
      // 可选负号
      if (this.text[this.pos] === '-') {
        numStr += '-';
        this.pos++;
      }
      while (this.pos < this.text.length && /\d/.test(this.text[this.pos])) {
        numStr += this.text[this.pos];
        this.pos++;
      }
      // \uN 后通常跟随一个替代字符（? 或字节），需要跳过
      // 跳过可选空格
      if (this.text[this.pos] === ' ') this.pos++;
      // 跳过替代字符（如果是 ? 或单字节字符）
      if (this.text[this.pos] === '?' || /[^\\{}]/.test(this.text[this.pos] || '')) {
        // 不一定有替代字符；保守起见只跳过 ?
        if (this.text[this.pos] === '?') this.pos++;
      }
      if (numStr && this.skipGroupDepth === 0) {
        const code = parseInt(numStr, 10);
        // 处理负数（16位有符号整数）
        const realCode = code < 0 ? code + 65536 : code;
        this.currentRun.text += String.fromCodePoint(realCode);
      }
      return;
    }

    // 普通控制字：\word[N][delim]
    let word = '';
    while (this.pos < this.text.length && /[a-zA-Z]/.test(this.text[this.pos])) {
      word += this.text[this.pos];
      this.pos++;
    }
    // 可选数字参数
    let numStr = '';
    if (this.text[this.pos] === '-') {
      numStr += '-';
      this.pos++;
    }
    while (this.pos < this.text.length && /\d/.test(this.text[this.pos])) {
      numStr += this.text[this.pos];
      this.pos++;
    }
    // 分隔符：空格被消费，其他字符不消费
    if (this.text[this.pos] === ' ') this.pos++;

    this.handleControlWord(word, numStr ? parseInt(numStr, 10) : null);
  }

  /* ========== 处理控制字 ========== */
  handleControlWord(word, num) {
    if (this.skipGroupDepth > 0) return;

    switch (word) {
      case 'par':
      case 'line':
        this.endParagraph();
        break;
      case 'tab':
        this.currentRun.text += '\t';
        break;
      case 'page':
        this.endParagraph();
        this.currentParagraph.pageBreak = true;
        break;
      case 'b':
        this.currentRun.bold = num !== 0;
        break;
      case 'i':
        this.currentRun.italic = num !== 0;
        break;
      case 'ul':
      case 'ulw':
      case 'uld':
      case 'uldb':
        this.currentRun.underline = num !== 0;
        break;
      case 'ulnone':
        this.currentRun.underline = false;
        break;
      // 以下控制字仅消费，不影响输出
      case 'rtf':
      case 'ansi':
      case 'ansicpg':
      case 'deff':
      case 'f':
      case 'fs':
      case 'cf':
      case 'cb':
      case 'qc':
      case 'ql':
      case 'qr':
      case 'qj':
      case 'ltrpar':
      case 'rtlpar':
      case 'plain':
        // \plain 重置格式
        if (word === 'plain') {
          this.currentRun.bold = false;
          this.currentRun.italic = false;
          this.currentRun.underline = false;
        }
        break;
      default:
        // 未知控制字：忽略
        break;
    }
  }

  /* ========== 打开组（{ ... }） ========== */
  openGroup() {
    // 保存当前格式状态
    this.groupStack.push({
      bold: this.currentRun.bold,
      italic: this.currentRun.italic,
      underline: this.currentRun.underline,
    });

    // 检测特殊目标组：\fonttbl \colortbl \info \stylesheet \*\xxx
    // 通过预读紧跟的控制字
    const afterBrace = this.text.substr(this.pos + 1, 30);
    const m = afterBrace.match(/^\\([a-zA-Z]+)/);
    if (m) {
      const w = m[1];
      if (
        w === 'fonttbl' || w === 'colortbl' || w === 'info' ||
        w === 'stylesheet' || w === 'pictdata' || w === 'generator' ||
        w === 'nonshppict' || w === 'shppict' || w === 'background' ||
        w === 'header' || w === 'footer' || w === 'footerf' || w === 'headerf'
      ) {
        this.skipGroupDepth++;
      }
    }
    // 检测 \* 控制符号（_destination_control）
    if (this.text[this.pos + 1] === '*' && this.text[this.pos + 2] === '\\') {
      this.skipGroupDepth++;
    }
  }

  /* ========== 关闭组 ========== */
  closeGroup() {
    if (this.skipGroupDepth > 0) {
      this.skipGroupDepth--;
    }
    if (this.groupStack.length > 0) {
      // 恢复外层格式状态
      const state = this.groupStack.pop();
      // 当前 run 收尾，新 run 用外层状态
      if (this.currentRun.text) {
        this.currentParagraph.runs.push({ ...this.currentRun });
        this.currentRun = { text: '', bold: state.bold, italic: state.italic, underline: state.underline };
      } else {
        // 即使没有文本，也同步格式状态
        this.currentRun.bold = state.bold;
        this.currentRun.italic = state.italic;
        this.currentRun.underline = state.underline;
      }
    }
  }

  /* ========== 结束当前段落 ========== */
  endParagraph() {
    if (this.currentRun.text) {
      this.currentParagraph.runs.push({ ...this.currentRun });
      this.currentRun.text = '';
    }
    if (this.currentParagraph.runs.length > 0) {
      this.output.push(this.currentParagraph);
      this.currentParagraph = { runs: [] };
    }
  }

  /* ========== ANSI 字节解码（cp1252 简化版） ========== */
  decodeAnsiChar(code) {
    if (code < 0x80) return String.fromCharCode(code);
    // cp1252 在 0x80-0x9F 区域有特殊映射
    const cp1252Map = {
      0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
      0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š',
      0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž', 0x91: '‘', 0x92: '’',
      0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
      0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ',
      0x9E: 'ž', 0x9F: 'Ÿ',
    };
    if (cp1252Map[code]) return cp1252Map[code];
    // 默认按 Latin-1
    return String.fromCharCode(code);
  }
}

/* ========== RTF → 文本 ========== */
export async function rtfToText(ctx) {
  const { files, setProgress, getBaseName } = ctx;
  const file = files[0];
  setProgress('读取 RTF 文件...', '', 20);
  const text = await file.text();
  setProgress('解析 RTF 结构...', '', 50);
  const parser = new RtfParser(text);
  const paragraphs = parser.parse();
  const plainText = paragraphs
    .map(p => p.runs.map(r => r.text).join(''))
    .join('\n\n');
  setProgress('完成', '', 100);
  return { text: plainText, filename: `${getBaseName(file.name)}.txt` };
}

/* ========== RTF → HTML ========== */
export async function rtfToHtml(ctx) {
  const { files, setProgress, getBaseName } = ctx;
  const file = files[0];
  setProgress('读取 RTF 文件...', '', 20);
  const text = await file.text();
  setProgress('解析 RTF 结构...', '', 50);
  const parser = new RtfParser(text);
  const paragraphs = parser.parse();

  setProgress('生成 HTML...', '', 80);
  const body = paragraphs
    .map(p => {
      const runs = p.runs.map(r => {
        let t = escapeHtml(r.text);
        if (r.bold) t = `<strong>${t}</strong>`;
        if (r.italic) t = `<em>${t}</em>`;
        if (r.underline) t = `<u>${t}</u>`;
        return t;
      }).join('');
      return `  <p>${runs}</p>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(getBaseName(file.name))}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 2em auto; padding: 0 1em; }
p { margin: 0 0 1em; }
</style>
</head>
<body>
${body}
</body>
</html>`;

  setProgress('完成', '', 100);
  return { text: html, filename: `${getBaseName(file.name)}.html` };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const HANDLERS = {
  'rtf-to-text': rtfToText,
  'rtf-to-html': rtfToHtml,
};
