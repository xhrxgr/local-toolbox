# 网页工具箱 — 项目上下文
每次都要更新本文档避免过时被误导，用 git 版本管理
## 项目概述
「控制台/毛玻璃」风格的工具箱网站，Vite 多页面静态站点，部署到 Nginx / GitHub Pages。

## 开源信息
- **GitHub 仓库**：https://github.com/xhrxgr/local-toolbox （公开，MIT License）
- **本地仓库名**：local-toolbox（package.json name 同步）
- **远程历史已重置**为单一 `Initial commit`
- **AGENTS.md 已纳入 git 版本管理**（用户 2026-07-21 起改为跟踪），用于跨对话保留上下文
- **GitHub Pages 部署**：`dist/` 目录是 `gh-pages` 分支的 git worktree，构建后 `git -C dist add -A && git -C dist commit && git -C dist push origin gh-pages` 即可发布

## 技术栈
- 构建：Vite（多页面 `rollupOptions.input`）
- 样式：原生 CSS + CSS Variables（无框架）
- 主题：深色 slate 底色 + 毛玻璃卡片，支持浅色/深色切换，`[data-theme="dark"]` 控制
- 图标：内联 SVG（`tools.js` 中 `ICONS` 对象）
- FFmpeg：`@ffmpeg/ffmpeg` + `@ffmpeg/util`，浏览器端处理
- 二维码：`qrcode`（生成）+ `jsqr`（识别）
- Markdown：`marked`（GFM 解析）
- 部署：GitHub Pages（gh-pages 分支）/ Nginx（dist/ 目录）

## 目录结构
```
网页工具箱/
├── index.html                 ← 导航首页（标题 + 搜索栏 + 分类筛选 + 卡片网格）
├── assets/
│   ├── css/{variables,theme,global}.css
│   └── js/
│       ├── common.js          ← initTheme/toggleTheme/injectToolHeader
│       └── tools.js           ← TOOLS[] + ICONS{} + renderTools/initFilter + 搜索算法/initSearch
├── tools/<tool-name>/         ← 每个工具：index.html + main.js + app.js + style.css
├── public/favicon.svg
├── vite.config.js             ← 多入口 + conditional COEP（仅 /tools/ffmpeg）
└── package.json
```

## 工具列表（22 个）
- **媒体 (media)**：ffmpeg（多媒体转换）、image（图片处理）
- **时间 (time)**：countdown、stopwatch、timestamp、worldclock
- **网络 (network)**：network（5 Tab 网络工具）、cert（证书解析）
- **编码 (encoding)**：encoding（Base64/URL/ASCII/Unicode）
- **开发 (dev)**：json、regex、jwt、hash（UUID+哈希）、diff、markdown
- **文档 (document)**：document（PDF/Word/Excel/MD/HTML/TXT/RTF/EPUB 本地互转，6 Tab）
- **实用 (util)**：qrcode、color、password、unit、otp-migration

## 首页搜索栏（核心功能）
**位置**：标题下方，分类筛选上方，最大宽度 720px 居中。

### 加权评分算法（0-100，得分 > 0 才显示）
| 匹配类型 | 分数 |
|---|---|
| name 完全匹配（不区分大小写） | 100 |
| name 前缀匹配（按字符比例加权） | ~60-80 |
| alias 精确命中 | 50 |
| name 词边界包含 | ~40 |
| alias 部分包含 | ~30 |
| tags 命中 | 25 |
| desc 包含 | ~20 |
| name 拼音首字母命中（如 "ysjzh" → "音视频转换"） | 15（×0.6 降权） |

- 多词查询（按空白拆分去重）：每词取最高分累加，封顶 100
- "所有词都命中"加成 +15 分
- 排序：分数降序，相同分按 name 字母序
- 显示百分比：`Math.round(50 + score * 0.5)`，映射到 50-100 区间让用户感知差异

### 关键词扩展表（aliases）
每个工具有 `aliases` 数组，包含中英文别名、技术名、相关动作词。
搜索时同时匹配 name / aliases / tags / desc / name 拼音首字母。

### UI 交互
- **输入防抖 120ms**，最少 1 字符触发
- 下拉建议最多 8 条，每项：图标 + 高亮名称 + 分类标签 + 匹配度百分比 + 描述 + tags
- 匹配文本用 `<mark>` 高亮
- **键盘导航**：↑↓ 选择、Enter 跳转、Esc 清空+关闭、`/` 全局快捷键聚焦搜索框
- **失焦延迟 180ms 关闭**下拉
- 无结果显示空状态卡片
- 移动端简化（隐藏 desc / tags / 快捷键提示）

### 视觉设计
- 毛玻璃背景 `var(--card)` + `backdrop-filter: blur(12px) saturate(180%)`
- 聚焦时 `border-color: var(--accent)` + 柔和发光
- 搜索图标在聚焦时变 accent 色
- 右侧 `/` 快捷键提示，聚焦时淡出
- 下拉面板毛玻璃 + 阴影，出现动画 0.15s
- 选中项左侧 3px accent 色边条 + 背景高亮

## FFmpeg 工具功能（工具名：多媒体转换）
### Tab 结构
- **格式转换 (convert)**：完整高级模式，视频/音频/图片互转，全选项（编码器/码率/分辨率/帧率/质量预设/去隔行）
- **图片转换 (image-convert)**：简化图片格式互转（jpg/png/webp/bmp/tiff）
- **视频转换 (video-convert)**：简化视频格式互转 + 抽取指定时间点单帧为图片
- **音频转换 (audio-convert)**：简化音频格式互转
- **音频提取 (extract-audio)**：从视频中提取音频轨道
- **视频剪辑 (trim)**：按时间范围截取视频片段，快速模式（-c copy）/ 精准模式

### 格式→编码器自动映射
- WebM → VP9/VP8 视频 + Opus/Vorbis 音频
- OGV → libtheora + libvorbis
- WMA → wmav2 音频
- AIFF → pcm_s16be
- GIF → 强制 `-c:v gif`
- AMV → `amv` 视频 + `adpcm_ima_amv` 音频 + `yuvj420p` + mono + 22050Hz，`block_size = 22050/fps`（仅 10/14/15/18/21/25/30 fps）
- 提取音频时 `EXTRACT_FORMAT_TO_CODEC` 表把格式名映射到实际编码器名

### 高级选项（格式转换 tab）
- 视频编码器：H.264, H.265/HEVC, VP9, VP8, AV1, MPEG-4, Xvid, 流复制
- 音频编码器：AAC, MP3, Opus, Vorbis, FLAC, PCM, AC3, 流复制
- 分辨率/帧率/视频码率/音频码率/质量预设（CRF）/编码速度/去隔行扫描
- 音频/图片输出时隐藏视频设置：`updateVideoSettingsVisibility()` 控制显隐
- 运行时能力检测：`loadFFmpeg` 后探测 `-encoders` + `-muxers`，不支持选项 disabled

### 任务控制（5 阶段量化进度 + 中断）
- 5 阶段：加载内核 → 读取文件 → 转码 → 读取结果 → 完成
- 中断：`ffmpeg.terminate()` + `ffmpeg = null`，下次 `loadFFmpeg` 重建
- "放弃当前" / "放弃全部"
- 状态图标：✓ 完成 / ⊘ 已放弃 / ✗ 失败 / ● 运行中 / ○ 等待
- 输出大小校验：所有模式完成后检查 `blob.size > 0`

### 视频预览
- 浏览器原生支持格式直接播放
- MTS/TS/M2BS：FFmpeg 解封装 + MSE 强制播放
- 去隔行预览：bwdif → yadif → 重编码回退链
- 裁剪时间轴：拖动入点/出点/播放头，方向键微调
- 音频电平表：Web Audio + Canvas 滚动条形图

### 多文件管理
- 拖放/多选 + 文件列表，单个删除/清空，大文件警告
- 队列处理 + 中断 + 单个下载/放弃，"下载全部"200ms 间隔

## 文档转换工具功能（tools/document/，2026-07-21 新增，2026-07-22 扩展）
### 设计原则
- 全部本地处理，文件不上传云端
- 6 个 Tab：PDF / Word / Excel-CSV / MD-HTML-TXT / RTF / EPUB
- 复用首页毛玻璃风格

### 模块化架构（2026-07-22 重构）
按 Tab 拆分 dynamic import，首屏只加载主入口 12-13KB，用户点击哪个 Tab 才动态加载哪个库：
- `app.js`：主入口，UI 协调 + `TAB_MODULE_LOADERS` 表 + `buildContext()` 传递 ctx
- `handlers/utils.js`：共享工具（`getBaseName` + `htmlToPdfBlob`，后者动态导入 jspdf + html2canvas）
- `handlers/pdf.js`：pdfjs-dist + pdf-lib（940KB chunk）
- `handlers/word.js`：mammoth + docx + marked（846KB chunk）
- `handlers/excel.js`：xlsx（423KB chunk）
- `handlers/mdhtml.js`：marked + turndown + htmlToPdfBlob（12KB chunk）
- `handlers/rtf.js`：自实现 RTF 解析器（5KB chunk，零依赖）
- `handlers/epub.js`：jszip + DOMParser 手动解析 EPUB（99KB chunk）

### 依赖库
- `pdf-lib`：PDF 操作（合并/拆分/旋转/图片→PDF）
- `pdfjs-dist`：PDF 渲染（PDF→图片/文本），worker 通过 `?url` 导入
- `mammoth`：Word→HTML/文本
- `docx`：生成 Word（Markdown/HTML/TXT → Word）
- `xlsx` (SheetJS)：Excel 读写（→CSV/JSON）
- `jspdf` + `html2canvas`：HTML→PDF（截图分页嵌入）
- `marked` + `turndown`：MD/HTML 互转
- `jszip`：EPUB 解压（手动解析 OPF + spine + XHTML，避免引入 epubjs 200KB+）

### PDF Tab（7 种操作）
- PDF → 图片：pdfjs 2x 渲染每页到 canvas → PNG/JPG blob
- 图片 → PDF：pdf-lib 嵌入 PNG/JPG（其他格式经 canvas 转 PNG）
- PDF → 文本：pdfjs `getTextContent()` 拼接
- PDF 合并：pdf-lib `copyPages`
- PDF 拆分：按页码区间（如 `1-3, 4-6, 7-9`），每区间输出一个 PDF
- PDF 旋转：pdf-lib `setRotation(degrees)`
- PDF 提取：按页码列表（如 `1, 3, 5-8`）抽取合并

### Word Tab（6 种操作）
- Word(.docx) → HTML：mammoth.convertToHtml
- Word → 纯文本：mammoth.extractRawText
- Word → PDF：mammoth → HTML → htmlToPdfBlob
- Markdown → Word：marked → HTML → domNodeToDocxParagraph 转换器
- HTML → Word：DOMParser 解析 → htmlToDocxParagraphs 通用工具（自动包裹完整 HTML）
- TXT → Word：按空行分段，单行内换行用 TextRun `{ break: 1 }`

### Excel/CSV Tab（5 种操作）
- Excel(.xlsx/.xls) → CSV：SheetJS `sheet_to_csv`，可选工作表索引
- Excel → JSON：SheetJS `sheet_to_json`
- CSV → JSON：自实现解析（支持引号转义）
- JSON → CSV：提取所有键做表头 + 逐行输出
- CSV → Excel：SheetJS `book_new` + `aoa_to_sheet`

### Markdown/HTML/TXT Tab（5 种操作）
- Markdown → HTML：marked（GFM）
- HTML → Markdown：turndown（atx 标题 / fenced 代码块）
- Markdown → PDF：marked → htmlToPdfBlob
- HTML → PDF：htmlToPdfBlob
- TXT → PDF：包成 `<pre>` 风格 HTML → htmlToPdfBlob（保留换行空格）

### RTF Tab（2 种操作，自实现解析器）
- RTF → 文本：状态机解析 RTF 控制字，提取段落 + 文本
- RTF → HTML：解析后输出 `<p>` 段落 + `<strong>/<em>/<u>` 内联格式

RTF Parser 支持的控制字：
- `\par \line \tab \page`：段落/换行/制表/分页
- `\b \i \ul \ulnone`：粗体/斜体/下划线
- `\\ \{ \} \'XX \uN`：转义字符 + 十六进制字节 + Unicode
- `\fonttbl \colortbl \info \stylesheet \*\xxx \pict`：跳过目标组
- `\plain`：重置格式

### EPUB Tab（2 种操作，jszip + DOMParser 手动解析）
- EPUB → 文本：解压 → 解析 OPF manifest/spine → 按阅读顺序提取每章 body.textContent → 用 `---` 分隔
- EPUB → HTML：拼接所有章节 body.innerHTML，用 `<hr>` 分隔，包装为完整 HTML 文档（含基础样式）

EPUB 解析链路：
```
EPUB(zip) → META-INF/container.xml → 找到 OPF 路径
→ OPF 解析 manifest（id→href）+ spine（idref 顺序）
→ 按 spine 顺序读 XHTML，DOMParser 解析 application/xhtml+xml
→ 失败时降级为 text/html 解析
```

### 通用工具函数
- `htmlToPdfBlob(html, filename)`：临时 div 内嵌样式 → html2canvas 截图 → jsPDF A4 分页嵌入（JPEG 0.95 质量）
- `parsePageRanges(input)`：解析 `1-3, 5, 7-9` → `[[0,2],[4,4],[6,8]]`（0-based）
- `parsePageList(input)`：解析 `1, 3, 5-8` → `[0,2,4,5,6,7]`（0-based 去重）
- `domNodeToDocxParagraph(el)` / `parseInlineRuns(el)`：DOM → docx Paragraph
- `htmlToDocxParagraphs(html)`：HTML → docx Paragraph[]（处理 ul/ol 展开为多段）

### 输入/输出模式
- `inputType: 'file'`：显示文件上传区，accept 由 OPERATIONS 表控制
- `inputType: 'text'`：显示 textarea，标签按操作类型动态切换
- `outputType: 'text'`：结果展示在 `<pre class="text-result">` + 复制按钮 + 可选下载
- `outputType: 'file'`：结果列表 + 单个下载按钮，多文件显示"下载全部"（200ms 间隔）

### UI 特点
- 6 个 Tab 切换时清空结果区
- 操作类型 select 切换时按 `inputType` 显隐文件区/文本区
- PDF 操作选项（图片格式/旋转角度/拆分区间/提取页码）按 opId 动态显隐
- Excel 操作显示工作表索引输入
- 进度条显示当前阶段 + 百分比 + 状态文本

## TOTP 迁移工具功能
### 核心
解析 Google Authenticator 导出二维码数据，提取 TOTP/HOTP 密钥，生成 `otpauth://` 链接。**完全离线，密钥不写本地存储，刷新即清空。**

### 输入方式
- 粘贴 `otpauth-migration://offline?data=...` 链接（支持多行合并）
- 截图拖放/选择/Ctrl+V 粘贴 → jsQR 解码 → 自动填入链接

### 解析链路
`otpauth-migration://` → 提取 `data` → Base64 解码 → 手写 Protobuf varint 解析器 → `MigrationPayload.otp_parameters[]` → Base32 编码 secret → 拼 `otpauth://` URL

### Protobuf Schema
- `MigrationPayload`：1=OtpParameters[] / 2=version / 3=batch_size / 4=batch_index
- `OtpParameters`：1=secret / 2=name / 3=issuer / 4=algorithm / 5=digits / 6=type / 7=counter
- Algorithm：0/1=SHA1 / 2=SHA256 / 3=SHA512 / 4=MD5（Web Crypto 不支持，报错）
- Digits：0/1=6位 / 2=8位
- Type：1=HOTP / 2=TOTP

### 实时验证码
- TOTP 每 30 秒刷新，6 位 → 前3后3 / 8 位 → 前4后4 分组显示
- SVG 环形倒计时，最后 5 秒变红
- `requestAnimationFrame` 驱动 tick，`lastEpoch` 比对避免重复计算
- HOTP 不自动刷新

### 二维码弹窗
- 点击「显示二维码」弹出全屏 overlay
- `QRCode.toCanvas()` 生成
- **主题感知颜色**：浅色用 `#0f172a`/`#ffffff`，深色用 `#f8fafc`/`#0f172a`
- ESC / 点击空白 / 关闭按钮退出

### 错误处理与边界
- **MD5 算法（algorithm=4）**：抛错，卡片显示"不支持"+错误信息
- **空 secret**：抛错"密钥为空"
- **HOTP counter 大数**：用 BigInt 拆高低 32 位写入 DataView
- **algorithm 默认 SHA1**：URL 中不输出 `algorithm=SHA1`
- **counter 参数**：用 BigInt `.toString()` 避免 `n` 后缀
- **escapeHtml**：处理 `& < > " '` 五种字符
- **tick 异常防护**：try/catch 包裹

### 导出
- 下载 txt：每行一条 `otpauth://` URL，UTF-8 BOM 防乱码
- **过滤无效账号**：MD5 / 空 secret 跳过
- 格式兼容 ente Auth「纯文本导入」

## 其他工具简述
- **倒计时/秒表**：performance.now + RAF，wallStart 锚点跨刷新同步，到期不停止进入超时计数（倒计时）
- **时间戳**：setTimeout 对齐秒边界，1e12 区分秒/毫秒
- **世界时间**：多时区 + 毫秒开关 + 全屏拆两行显示，Intl.DateTimeFormat.formatToParts
- **网络工具**：HTTP ping / Resource Timing 拆解 / 流式测速 / DoH / 多源出口 IP 对比
- **编码转换**：UTF-8 安全的 Base64，Unicode 处理代理对
- **证书解析**：纯前端 ASN.1 DER 解析器
- **图片处理**：canvas 压缩 + 裁剪 + EXIF
- **JSON**：格式化/校验/树形/JSONPath 安全执行
- **正则**：7 标志位 + 8 预设 + 实时高亮
- **JWT**：三段解码 + 过期检查
- **UUID/哈希**：v1/v4/v7 + MD5 纯 JS + SHA/HMAC Web Crypto
- **文本对比**：LCS 算法 + 逐字 diff + 导出 patch
- **Markdown**：marked + 正则代码高亮 + 目录；视图按钮：仅编辑 / 分栏 / 仅预览
- **二维码**：qrcode 生成 + jsqr 识别 + 摄像头扫描
- **颜色**：HEX/RGB/HSL/HSV + WCAG 对比度 + EyeDropper + 中位切分调色板
- **密码**：crypto.getRandomValues + 拒绝采样 + diceware
- **单位转换**：7 类单位 + 温度特殊处理 + 双向实时

## 关键设计决策
- 新增工具流程：`tools/` 下建目录 → 写 4 文件 → `TOOLS[]` 注册（含 aliases）→ `vite.config.js` 加入口
- 主题切换优先级：localStorage > prefers-color-scheme > 默认浅色
- FFmpeg 核心文件 ~31MB 从 CDN 加载 + 多源回退 + Cache API 持久化缓存
- COEP 条件化：仅 `/tools/ffmpeg` 设置 COOP/COEP（SharedArrayBuffer 必需），其他路径不设置
- HTTP ping 替代 ICMP ping：浏览器沙箱禁止 ICMP
- Resource Timing 拆解替代 tcping
- 流式读取测速替代一次性 arrayBuffer
- DoH 替代系统 DNS
- Base64 用 TextEncoder/TextDecoder 支持 UTF-8
- ASN.1 DER 内置解析器替代 X509Certificate API
- MD5 纯 JS 实现（crypto.subtle 不支持）
- HMAC 通用实现 `H(K'⊕opad ∥ H(K'⊕ipad ∥ data))` 兼容 MD5
- UUID v1 用 BigInt 计算 Gregorian 时间戳
- LCS 动态规划 + 回溯生成 diff
- 密码用拒绝采样法避免模偏差
- 二维码用 qrcode + jsqr 库
- Markdown 代码高亮不引入 highlight.js，正则匹配
- WCAG 对比度用 gamma 校正后相对亮度
- 调色板用中位切分法
- EXIF 解析纯前端
- JSONPath 白名单校验后用 `new Function` 安全执行
- 图片压缩目标大小用二分法

## 部署
### GitHub Pages（主要）
1. `npm run build` → `dist/`（dist 是 gh-pages worktree）
2. `git -C dist add -A`
3. `git -C dist commit -m "deploy: ..."`
4. `git -C dist push origin gh-pages`
5. 几分钟后 https://xhrxgr.github.io/local-toolbox/ 自动更新

### Nginx（备选）
- 仅 `/tools/ffmpeg/` 设置 COOP/COEP
- 其他路径不设置
- `try_files $uri $uri/ /index.html`

## 开发命令
- `npm run dev` — 开发服务器（5173，conditional COEP 插件自动只对 /tools/ffmpeg 设置头）
- `npm run build` — 构建
- `npm run preview` — 预览构建产物

## Git 工作流
- 每个独立改动单独 commit，commit message 用中文简洁描述"做了什么"
- AGENTS.md 纳入 git 跟踪，每次代码改动后必须更新本文件
- 部署用 `git -C dist` 操作 gh-pages worktree 分支

## ⚠️ AGENTS.md 维护规范（强制）
- **每次代码改动后必须更新本文件**
- 删除已废弃/回滚的功能描述
- 新增功能/格式/参数同步追加到对应章节
- **本文件过时会导致后续 AI 助手基于错误上下文工作，必须保持准确性**
