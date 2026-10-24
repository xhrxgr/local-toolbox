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

## 工具列表（30 个）
- **媒体 (media)**：ffmpeg（多媒体转换）、image（图片处理）、svg（SVG 优化器）、ocr（OCR 图片识字）
- **时间 (time)**：countdown、stopwatch、timestamp、worldclock
- **网络 (network)**：network（5 Tab 网络工具）、cert（证书解析）
- **编码 (encoding)**：encoding（Base64/URL/ASCII/Unicode）、radix（进制转换）、qrcode（二维码生成/识别）
- **颜色 (color)**：color（颜色工具）
- **换算 (unit)**：unit（单位转换）
- **开发 (dev)**：json、regex、jwt、hash（UUID+哈希）、diff、markdown、text（文本工具）、chmod（权限计算器）、sqlcron（SQL/CRON）、unicode（Unicode 查看器）、crypto（加解密）
- **文档 (document)**：document（PDF/Word/Excel/MD/HTML/TXT/RTF/EPUB 本地互转，6 Tab）、scandoc（扫描文档：图片转文档，滤镜/曲面矫正/四角裁剪/去手写/合并 PDF）
- **安全 (security)**：password（密码生成）、otp-migration（TOTP 迁移）

> 2026-10-25：取消「实用 (util)」杂项分类。**分类名一律用具体主题名词，不用「转换」这类泛动作词**——
> qrcode 归「编码」（图形编解码），color 单开「颜色」，unit 单开「换算」，
> password/otp-migration 归「安全」。单工具分类不强行合并：直观优先于分类数量。
> 改动位置：tools.js 的 `category` 字段与 `CATEGORY_LABELS`、index.html 的筛选按钮、README 分类表。

## 静态资源缓存（Service Worker，2026-10-25 上线）

部署在 GitHub Pages，中国访问首屏慢。用 SW 把静态资源缓存到本地，
二次访问（含离线）直接读本地；**同时保证线上更新后用户拿到的永远是最新内容**。

- **注册位置**：`assets/js/common.js`（首页与 30 个工具页全都加载它）。
  仅 `import.meta.env.PROD` 注册——dev 模式模块 URL 带时间戳参数，缓存无意义
- **SW 本体**：`public/sw.js`（Vite 原样拷到站点根，**不能加 hash**，
  否则浏览器按新文件对待、旧 SW 永远不退场）
- **策略（按请求类型分流，改策略时升 `SW_VERSION` 全量刷新缓存）**：
  1. 页面导航（HTML）：**网络优先**，失败才回退缓存 → 部署后刷新即最新，
     离线可打开已访问过的页面；深层页面无缓存时回退缓存的首页
  2. 同源 hash 资源（`assets/main-xxx.js`、`migan-xxx.onnx`）：**缓存优先**，
     不发网络请求。hash 即内容寻址，永不过期
  3. 同源无 hash 资源（favicon.svg）：stale-while-revalidate，后台换新
  4. 跨域 CDN（ffmpeg core / tesseract worker·core·语言数据）：**缓存优先**，
     代码按版本号锁 URL，内容不可变
- **缓存上限**：`MAX_ENTRIES = 250`，按插入序淘汰最旧条目，
  防反复部署产生的新 hash 无限堆积
- **与 `public/tools/ffmpeg/coi-serviceworker.js` 的关系**：后者是清理脚本，
  给装着旧版 coi SW 的历史浏览器用（自删缓存 + 自我注销），
  新访客不会安装它，与全局缓存 SW 不冲突
- **实测结论**（preview + agent-browser）：二次访问 3 个资源 0 流量全走缓存；
  断网后工具页完整可用；改 HTML 后刷新立刻拿到新版本（网络优先验证）
- **部署**：`npm run build` 后 dist/ 根目录带 sw.js，
  随 gh-pages 分支发布即生效（无需额外配置）

## 安全与性能约束（2026-10-24 审查后立的）
- **用户正则必须跑在 Worker 里**（tools/regex/match-worker.js）：
  JS 正则无法从外部中断，灾难性回溯会永久冻结标签页，只能杀页。
  Worker + 3 秒超时 terminate 才能断。配合文本长度上限（50 万）与输入防抖
- **算法先别用 JS 数组做二维 DP**：换成扁平 `Uint32Array`（每格 4 字节，省 4 倍），
  并先剥掉公共前缀/后缀——大多数编辑是局部的，剥完只剩小块。tools/diff 已做（还加了硬上限）
- **跳跃搜索代替逐纲扫描**：稀疏条件（如 `0 0 29 2 *`）逐秒扫描会空转到上限。
  tools/sqlcron 已改为逐级进位（月→日→时→分→秒）
- **扫描文件要用 `indexOf` 而不是惰性正则**：`[\s\S]*?` 会在每个 BEGIN 起点扫到文件尾，O(n²)（cert 的 PEM 提取已改）
- **压缩包需要解压后体积上限**（epub）；**图片需要尺寸上限**（image/ocr），
  超限时给出明确原因，不能静默失败
- **剪贴板降级必须检查返回值**：`document.execCommand('copy')` 失败时返回 false 而不抛错，
  不检查就会恐向用户显示「已复制」但实际没复制到
- **复制一律用共享实现 `assets/js/clipboard.js`**，不要在工具里自己写 `copyText`。
  2026-10-24 统一前，15 个工具各写一份，行为分三档：11 份检查返回值、3 份不检查
  （otp-migration / document / timestamp，复制失败却提示「已复制」）、4 份完全没有降级路径
  （chmod / sqlcron / radix / text，非 HTTPS 环境点了毫无反应）。共享实现按
  `Clipboard API → execCommand 降级 → 返回 false` 三级处理，调用方据返回值给反馈
- **下载一律用共享实现 `assets/js/download.js`**，撤销 ObjectURL 统一延后 10 秒。
  统一前有立即 / 200ms / 1s / 10s 四种时机并存（立即撤销在部分浏览器会中断大文件下载）。
  注意：预览图片/视频的 URL 不走这个模块，用完立即释放是对的
- **失败状态要给文字反馈，不要用装饰符号**：用「通过 / 不通过」「已复制 / 复制失败」
  这类文字或内联 SVG，不用 ✓ ✗ ⊘ ● ○ ⚠ 等符号（见下方「界面符号规范」）
- **内容为空时不能静默 return**：复制/导出入口在无内容时直接 return，
  用户点了按钮界面毫无反应，无法判断是自己没输入还是按钮坏了。
  统一用 `flashHint()`（共享模块里）给按钮一个短暂文字提示。
  注意区分场景：「交换」按钮的输出为空时直接 return 是正确的，不要误改
- **异步流程要有序号守卫**：await 期间用户可能切 Tab/改选项，过期结果不得写回界面
  （document 的 convertSeq、scandoc 的 renderToken）

## 移动端 / 平板适配规范（2026-10-24 全面优化后确立）
- **断点**：`≤640px` 手机、`641~1024px` 平板。全局外壳规则在 `assets/css/global.css`（那里原先一个媒体查询都没有，31 处断点全散在各工具里，改一处漏一片——新增共享样式优先放全局）
- **触控目标**：`.btn` / `.btn-sm` 桌面基准 `min-height:34~36px`，窄屏媒体查询统一抬到 `40px`；
  纯图标按钮 ≥36px。复选框保持 16px 视觉尺寸，但**外层 label 必须加 `min-height:36px` + padding** 把点击区撑起来
- **禁止横向溢出**：`body { overflow-x: clip }`（用 clip 不用 hidden，否则会创建滚动容器、破坏 `position:sticky` 头部）。
  flex 容器默认就要写 `flex-wrap: wrap`；`flex:1` + `min-width:0` 的组合在窄屏会被压成接近 0 宽，改用 `flex: 1 1 220px`
- **字号下限 12px**（`--text-xs`）；`font-size:10px` 一律不允许
- 验证方法：iframe 审计页（媒体查询按 iframe 宽度生效），在 390/768/1024 三档测量
  横向溢出、触控目标 <40px、字号 <12px、内容被裁四项

**2026-10-25 真机审查结论（agent-browser 截图 + 脚本测量，60 张全页截图）**：
- 页面级横向溢出 0、字号 <12px 0、内容裁切 0（`overflow-x: clip` 生效）
- **触控目标是最大盲区**：global.css 的 40px 规则只覆盖 `.btn`/`.btn-sm` 与头部外壳，
  工具自己的控件类完全没抬升——390px 实测 mode-tab 25~36px（unicode 最矮，
  其 640px 查询还把 padding 改小了）、codec-select/scan-select/tz-select 28~36px、
  field-input/json-path-input 35px、preset-btn 38px、view-btn 28px、flag-chip 29px、
  qr-ecl__item 29px、segmented__btn 32px、btn-copy 32px、form-input--sm 27px；
  复选框外层 label 22~29px（.chk / .diff-checkbox / .ms-toggle / .checkbox /
  .hmac-toggle / .qr-ecl__item / .flag-chip），违反上面「label 必须 36px」的规矩；
  slider 轨道 6px。**新增控件类时必须在 640px 查询里同步抬升**
- color（6 tab）与 unit（7 tab）的 tab 行是 `overflow-x:auto` 可滑动的，
  可达但无渐变遮罩/箭头提示，用户不易发现还有隐藏 tab
- 测量脚本与截图在 `.workbuddy/audit-2026-10-25/`（audit.js + m390/m768 目录）

## 界面符号规范
用户明确要求**界面里不用 emoji，也不用装饰性状态符号**。范围包括聊天回复、文档与网页内容本身。

**禁止**：装饰性 emoji 与装饰性状态符号 —— ✓ ✗ ⊘ ● ○ ⚠ ✕ ✔ ✘ 等。
**改为**：文字标签（「通过」/「不通过」「已复制」/「复制失败」）或内联 SVG 图标。

**保留**（这些是数据本身，不是装饰）：
- 排版箭头（`编码 → 解码`，属于内容语义）
- 单位与字符类工具的符号（`m²`、`℉`、U+2003 空白符可视化）

2026-10-24 已清理的存量：color 的 WCAG 徽章（✓/✗ → 通过/不通过）、
ffmpeg 的队列状态（✓⊘✗●○ → 5 个内联 SVG，按状态着色）、
timestamp 的复制失败（✗ → 叉号 SVG + `btn-copy--fail` 样式）。

**2026-10-25 审查新发现的存量违规（待修，清单见「输入校验一致性」节）**：
json 的 `✓ JSON 有效` / `✗ ` 前缀、diff 与 network 与 otp-migration 的 `⚠` 前缀、
ffmpeg 文件列表的 27 个 emoji 图标（🎬📹🎵🖼📄，`getFileIcon`）——
document 工具早已改用文字标签（PDF/DOC/XLS），ffmpeg 是漏网。
同日已修：common.js 主题切换按钮的 ☀️/🌙 → 内联 SVG（太阳/月亮，lucide 风格）。
颜色徽章改用文字后，原先靠字符形状区分状态的地方要补颜色区分（ffmpeg 的 `.task-item__icon` 各状态配色）。

**状态色的兜底样式放在 `assets/css/global.css`**（`.meta-btn--success` / `.meta-btn--danger`）——
各工具原本各自定义 `--success`，失败态则完全没有定义，导致"失败"提示看不出差别。

## 跨工具一致性（2026-10-24 专项审查后确立）
同一类功能在多个工具里各写一份，是不一致的根源。审查后确立两条：

1. **同一功能必须共用共享模块**，不要在工具里复制粘贴实现。
   已在 `assets/js/` 下建立：`clipboard.js`（复制）、`download.js`（下载）。
   新增同类共享功能时照此办理。
2. **审查"所有工具的 X"时，要做穷举清单，不能凭印象抽查。**
   本次审查剪贴板时，先看到 11 个工具的实现完全一致，就差点认定没问题；
   实际穷举 15 个后发现分三档。清单化才暴露了后两类。

**测试方法论（本次踩过的坑，值得记住）**：
- 点真实页面按钮做端到端测试时，「内容没准备好」和「代码有 bug」会混在一起，
  分不清是哪个。逐个查源码确认复制源是什么（`aes-output.value`、`hash-hex`…），
  才能定位到是测试步骤缺了输入。
- 多个用例共享同一个剪贴板/全局状态时会互相污染，必须每个用例先写**唯一哨兵**、
  再轮询等待值变化。
- 改写 `navigator.clipboard` 时只替换 `writeText`，保留 `readText`，
  否则连读都读不到，全部判成"降级失败"。
- 源码级受控测试（把函数原样抽出来注入可控故障）最能排除干扰：
  注入 `execCommand` 返回 false，检查函数返回值是否诚实。
- **元素不可见时点击会静默超时，不会报错**。多 tab 面板的工具
  （crypto 的古典密码/编码面板、hash 的哈希计算面板）要先切 tab；
  还有些区域整个带 `hidden`（crypto 的 AES 结果区要加密后才显示）。
  判断可见性不能只看 `offsetParent`——祖先有 transform 时它也会是 null，
  要同时看 `getBoundingClientRect()` 的宽高。

## 输入校验一致性（2026-10-25 穷举审查后立）

30 个工具逐一核对后的现状：反馈机制分五档，同类问题文案分七种说法。
**新增校验或改错误提示时按下面的统一规矩办；存量差异见文末清单，随各工具维护时收敛。**

### 统一规矩
1. **禁止 `alert()`**：阻塞模态，移动端 iOS 是全屏对话框，与毛玻璃 UI 割裂，
   且错误详情不可复制。存量 6 个工具 13 处（network 3 / image 6 / chmod 1 /
   countdown 1 / worldclock 2 / stopwatch 1）待替换为 toast 或行内提示
2. **空输入与失败分开措辞**：空输入说「请输入 X」；失败说「X 失败：原因」。
   不要把空输入包成「解密失败：请输入密文」——未输入不是失败
3. **空输入文案统一为「请输入 X」**（sqlcron/timestamp 模式），
   与「请先选择文件」「请先执行」（复制前置）各司其职：前者要用户提供输入，
   后者要用户先产生结果
4. **第三方库错误必须过中英映射再显示**，不裸透传。document 的 `friendlyError()`
   是唯一正确的样板（加密 PDF / 文件损坏 / 内存不足 / 库加载失败）。
   json 的 JSON.parse 错误、radix 的「Base32 字符无效: x」中英混排都是反例
5. **错误色一律用 class**，不硬编码 `#ef4444`（radix ×2、sqlcron ×2 是反例）；
   行内错误态参考 timestamp 的 `.convert-result--error`（文案具体 + 错误态样式）
6. **错误码**：目前无统一体系，跨模块传递错误只用 `err.code === 'NO_INK'`
   （scandoc 去手写）。新增错误码进 `assets/js/` 下的共享常量，不要在工具里私造
7. **实时型工具（输入即算）的非法输入要给提示**，不能静默清空另一侧——
   unit 输入 `abc` 把结果侧清成空白且零提示，用户分不清是没算出来还是工具坏了

### 反馈机制选型（按场景）
- 一次性操作结果（转换/解析/导入导出）：toast 或行内区域文字
- 复制/下载前置检查：`flashHint()` 按钮文字（共享 clipboard.js，已统一）
- 实时计算的字段级错误：字段旁行内文字（timestamp/color 模式）
- toast 现有 4 套实现：document `showToast(msg,type,duration)`、scandoc 同名同接口、
  otp-migration `flashToast(msg,type)`（无 warning 级）、ffmpeg `showWarn(msg,ms)`
  （无类型分级）。**下一工具做 toast 时把这四套收敛成共享模块**

### 存量差异清单（2026-10-25 快照，随工具维护时收敛）
- alert：network / image / chmod / countdown / worldclock / stopwatch
- 空输入说法不统一：「请输入目标地址」「请先选择图片」「输入为空」
  「请先粘贴迁移链接或拖入二维码截图」等七种
- 英文透传：json（V8 JSON 错误）、radix（中英混排）
- 硬编码错误色：radix、sqlcron
- 无错误样式：text 的 meta、diff 的 warning 文字
- 静默无反馈：unit（非法输入）、text/radix（空输入）、hash（count 非法钳位）、
  markdown（导出空文档）
- 符号违规（同时违反界面符号规范）：json ✓/✗、diff/network/otp-migration ⚠

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
### Tab 结构（按顺序）
- **图片转换 (image-convert)**：简化图片格式互转（jpg/png/webp/bmp/tiff），默认激活 Tab
- **视频转换 (video-convert)**：简化视频格式互转 + 抽取指定时间点单帧为图片
- **音频转换 (audio-convert)**：简化音频格式互转
- **音频提取 (extract-audio)**：从视频中提取音频轨道
- **视频剪辑 (trim)**：按时间范围截取视频片段，快速模式（-c copy）/ 精准模式
- **高级转换 (convert)**：完整高级模式，视频/音频/图片互转，全选项（编码器/码率/分辨率/帧率/质量预设/去隔行）

> 三个简化 Tab（图片/视频/音频转换）覆盖常用场景，选项精简；「高级转换」提供完整编码器/码率/分辨率等控制，定位为进阶使用。视频/音频简化 Tab 的提示文案引导需要更多控制的用户使用「高级转换」。

### 格式→编码器自动映射
- WebM → VP9/VP8 视频 + Opus/Vorbis 音频
- OGV → libtheora + libvorbis
- WMA → wmav2 音频
- AIFF → pcm_s16be
- GIF → 强制 `-c:v gif`
- AMV → `amv` 视频 + `adpcm_ima_amv` 音频 + `yuvj420p` + mono + 22050Hz，`block_size = 22050/fps`（仅 10/14/15/18/21/25/30 fps）
- 提取音频时 `EXTRACT_FORMAT_TO_CODEC` 表把格式名映射到实际编码器名

### 高级选项（高级转换 tab）
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

## 文档转换工具功能（tools/document/，2026-07-21 新增，2026-07-22 扩展，2026-10-18 重构）
### 设计原则
- 全部本地处理，文件不上传云端
- 6 个 Tab：PDF / Word / Excel-CSV / MD-HTML-TXT / RTF / EPUB
- 复用首页毛玻璃风格
- 单一职责拆分：配置 / 加载表 / UI 行为 / 转换处理各自独立成模块，`app.js` 只做协调

### 模块化架构（2026-10-18 重构：UI 行为拆分为 ui/ 模块）
按 Tab 拆分 dynamic import，首屏只加载主入口约 24KB（gzip 7.5KB），用户点击哪个 Tab 才动态加载哪个重库：
- `app.js`：协调层。Tab / 操作切换、UI 显隐编排、转换流程控制（防重入）、结果分发、事件绑定
- `operations.js`：操作配置表（OPERATIONS + 文案表 + 阈值，纯配置无逻辑）
- `tab-loaders.js`：`TAB_MODULE_LOADERS` 各 Tab 处理模块动态加载表
- `handlers/utils.js`：共享纯函数（`getBaseName` / `escapeHtml` / `formatFileSize` / `getFileKind` / `htmlToPdfBlob`）
- `handlers/pdf.js`：pdfjs-dist + pdf-lib（940KB chunk）
- `handlers/word.js`：mammoth + docx + marked（846KB chunk）
- `handlers/excel.js`：xlsx（423KB chunk）
- `handlers/mdhtml.js`：marked + turndown + htmlToPdfBlob（12KB chunk）
- `handlers/rtf.js`：自实现 RTF 解析器（5KB chunk，零依赖）
- `handlers/epub.js`：jszip + DOMParser 手动解析 EPUB（99KB chunk）
- `ui/toast.js`：Toast 通知（success / warning / error / info，替代 alert）
- `ui/download.js`：单文件下载 + 多文件 JSZip 打包
- `ui/clipboard.js`：复制（Clipboard API + execCommand 降级）
- `ui/file-list.js`：文件集合状态 + 列表渲染 + 拖拽排序（多选操作）
- `ui/preview.js`：HTML 类结果的「源码 / 预览」切换（sandbox iframe 渲染）
- `ui/paste.js`：粘贴支持（文件类操作粘图片/文件，文本类操作粘纯文本）
- `ui/metadata.js`：Excel 工作表下拉刷新、PDF 页数提示刷新（依赖文件内容，异步读，失败静默）

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
- Excel(.xlsx/.xls) → CSV：SheetJS `sheet_to_csv`，可选工作表（下拉显示 sheet 名）+ 分隔符（逗号/分号/Tab）
- Excel → JSON：SheetJS `sheet_to_json`，工作表下拉选择
- CSV → JSON：SheetJS `XLSX.read(string)` 解析（支持引号转义）
- JSON → CSV：SheetJS `json_to_sheet` + `sheet_to_csv`，分隔符可选
- CSV → Excel：SheetJS `book_new` + 追加 sheet

### Markdown/HTML/TXT Tab（5 种操作）
- Markdown → HTML：marked（GFM），可选「封装完整 HTML 文档（含基础样式）」
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
- EPUB → HTML：拼接所有章节 body.innerHTML，用 `<hr>` 分隔，包装为完整 HTML 文档（含基础样式）；图片转 base64 data URI 内嵌，导出后不失效

EPUB 解析链路：
```
EPUB(zip) → META-INF/container.xml → 找到 OPF 路径
→ OPF 解析 manifest（id→href）+ spine（idref 顺序）
→ 按 spine 顺序读 XHTML，DOMParser 解析 application/xhtml+xml
→ 失败时降级为 text/html 解析
→ HTML 模式：img[src] 相对路径 → zip 内读取 → base64 data URI 替换（支持 ../ 与 %XX 解码）
```

### 通用工具函数
- `htmlToPdfBlob(html, filename)`：临时 div 内嵌样式 → html2canvas 截图 → jsPDF A4 分页嵌入（JPEG 0.95 质量）
- `parsePageRanges(input)`：解析 `1-3, 5, 7-9` → `[[0,2],[4,4],[6,8]]`（0-based）
- `parsePageList(input)`：解析 `1, 3, 5-8` → `[0,2,4,5,6,7]`（0-based 去重）
- `domNodeToDocxParagraph(el)` / `parseInlineRuns(el)`：DOM → docx Paragraph
- `htmlToDocxParagraphs(html)`：HTML → docx Paragraph[]（处理 ul/ol 展开为多段）

### 输入/输出模式
- `inputType: 'file'`：显示文件上传区，accept 由 OPERATIONS 表控制；支持拖放、多选（可拖拽排序）、Ctrl+V 粘贴文件
- `inputType: 'text'`：显示 textarea，标签按操作类型动态切换；支持直接粘贴、「从文件导入」上传文本文件
- `outputType: 'text'`：结果展示在 `<pre class="text-result">` + 复制按钮 + 可选下载；HTML 类结果额外提供「源码 / 预览」切换
- `outputType: 'file'`：结果列表 + 单个下载按钮，多文件显示「下载全部」（200ms 间隔）与「打包为 ZIP」

### UI 特点
- 6 个 Tab 切换时清空结果区
- 操作类型 select 切换时按 `inputType` 显隐文件区/文本区
- PDF 操作选项（图片格式/旋转角度/拆分区间/提取页码）按 opId 动态显隐；PDF 操作提示行显示源文件页数
- Excel 操作：选择文件后自动读取工作表名称填充下拉框
- Toast 通知系统（`ui/toast.js`）：成功 / 警告 / 错误 / 信息，替代原生 alert
- 转换防重入：`isConverting` 标志 + 按钮 disabled + loading 态，禁止并发提交
- 大文件（> 80MB）添加时弹出警告 Toast
- 文件类型标签（PDF/DOC/XLS/...）替代 emoji 图标
- Excel 操作显示工作表下拉（自动读取 sheet 名）
- 进度条显示当前阶段 + 百分比 + 状态文本
- 错误提示中文化：`friendlyError()` 将第三方库英文报错映射为中文（加密 PDF / 文件损坏 / 内存不足 / 库加载失败等），未命中则透传原文
- 解析结果兜底校验：Excel handler 拦截空表/乱码（SheetJS 会把损坏文件解析出 NUL 字符），文本结果为空或含大量控制字符时给出警告而非静默展示
- 预览 iframe 加 `sandbox=""`，阻断转换 HTML 中的脚本执行

## 扫描文档工具功能（tools/scandoc/，2026-10-19 新增）
### 定位
图片 → 文档的扫描编辑器（类扫描全能王）：批量导入图片，逐页滤镜/曲面矫正/四角裁剪，单图导出或按序合并 PDF。与 document 工具（格式互转）互补，独立入口。

### 为什么独立成工具
- 状态模型不同：document 是单次无状态转换；scandoc 是「页面集合 + 每页独立编辑状态（滤镜/旋转/四角）」的多页编辑器
- 交互形态不同：画布编辑 + 四角拖拽，而非「选操作→上传→转换」线性流

### 模块架构（单一职责拆分）
- `app.js`：协调层。页面选中、工具栏状态、导入导出流程、事件绑定
- `state.js`：页面集合状态（pages[] 增删/排序/更新 + 订阅通知）
- `render.js`：渲染管线（旋转 → 降采样 → 曲面矫正 → 滤镜），编辑器/缩略图/导出共用，保证所见即所得。
  工具栏顺序与此一致：旋转 → 四角 → 曲面矫正 → 效果 → 去手写 → 顺序
- `filters.js`：三种滤镜（原图 / 黑白（光照归一化 + Otsu）/ 增强（白平衡 + 光照均匀化 + 对比度 + 锐化，保留彩色））
- `warp.js`：透视变换（4 对点解 Homography → 网格 24×24 三角形 affine 纹理映射）
- `detect.js`：自动四角检测（灰度→高斯模糊→Sobel→Otsu 二值化→3×膨胀→最大连通域→凸包→最小外接矩形种子→沿四边带 PCA 直线拟合求精→相邻直线求交）
- `corners-ui.js`：SVG 四角覆盖层（4 手柄 pointer 拖拽，显示坐标与原图相对坐标互转）
- `exporter.js`：单页 PNG 导出 + pdf-lib 多页合并 PDF（页面尺寸跟随图片，最长边限 2200）
- `lib/imgutils.js`：灰度 / Otsu / 高斯模糊 / Sobel（detect 与 filters 共用）
- `lib/toast.js`、`lib/download.js`：自包含小模块（与 document 工具对应模块一致，遵循项目「每工具自包含」惯例）

### 关键实现说明
- 角点存储为**原图相对坐标**（0-1，TL/TR/BR/BL 序）；旋转时角点不变，渲染时经 `cornersToRotated` 映射到旋转后画布，`rotatedToCorners` 逆向转换拖拽输入
- SVG 元素无 `.hidden` IDL 属性（HTMLElement 才有），显隐必须用 `setAttribute/removeAttribute('hidden')`，否则被 global.css 的 `[hidden]{display:none!important}` 挡住
- SVG 表现属性不支持 `var(--accent)`，颜色一律走 CSS 类（`.corner-poly` / `.corner-handle`）
- **四角 = 矫正开关**：四角一旦存在（自动识别或手动拖动），预览与导出都会做透视矫正拉直，没有独立的「曲面矫正」开关；矫正失败（如四角退化）会退回未矫正图并打 console.warn，不要用空catch 吞掉
- 验证矫正是否生效要看**输出尺寸/宽高比**，不能只看预览框「有图」——未矫正的图看起来也有内容
- 层级：角点覆盖层 z-index 25 > 矫正预览 15（否则右下角手柄被浮动预览挡住），忙碌遮罩 30，Toast 300
- PDF 页面顺序 = 导入顺序（新页追加末尾），列表拖拽排序；导出按当前数组顺序
- 排序双通道：列表 HTML5 拖拽（桌面）+ 工具栏「上移/下移」按钮（移动端 DnD 不可用，同时键盘可达）
- 导入时自动检测四角，失败回退默认整图四角（内缩 2%），用户可手动拖拽调整
- **曲面矫正的采样方式必须是逐像素反查 + 双线性采样**（warp.js）。早前用
  「24×24 网格切三角形 + 每块仿射近似」，透视变换本身不是仿射的，
  相邻块在共享边上的反查坐标不一致，会留下发丝状缝隙，导出图上表现为规则网格线。
  接缝检测口径：某像素比左右邻居都亮/都暗 60 以上算异常，修复后为 0
- **矫正性能靠快速路径而非降采样**：四角几乎构成轴对齐矩形时（多数平拍照片）
  直接 `drawImage` 裁剪，走 GPU；只有真透视才逐像素。实测 3.5M 像素输出：
  轴对齐 10ms、强透视 113ms（纯逐像素未优化时为 826ms）
  - 逐像素内层务必共享倒数（`inv = 1/dd` 供 x/y 共用），不要分别做两次除法
- **自动识别结果必须过三道校验**（detect.js），任一不过就回退整图并提示用户：
  1. `validateQuad` 几何校验：凸性、面积占比（12%~98.5%）、边长比例（≥0.2）、内角 25°~155°。
     能拦住细长三角、内凹、角点重合这类畸形结果
  2. `snapToBorder`贴边外推：角点距画面边缘 <1.5% 时推到边缘，处理「纸张超出画面」
  3. `checkEdgeStrength` 边强度校验：沿每条边比较内外亮度，真纸边是稳定的大台阶（方向一致），
     误框穿过正文时台阶忽正忽负。**这是几何校验抓不到的关键 case**——
     实测能拦住「四边形几何合法但边切在正文上」的结果，同时不会误伤深色背景下的正确识别
- 检测坐标是 0-1 归一化值，几何校验前必须换算成像素（直接传归一化值会让面积算成 1e-7 量级）
- **「增强」滤镜保留彩色**（扫描类 App 的做法）：白平衡 → 光照均匀化 → 对比度 → 锐化。
  黑白效果由「黑白」滤镜负责，增强不能把红笔批注也抹成灰色
  - 白平衡用「白点法」：取亮度最高 8% 像素的均色，最亮通道视为真实白，
    其余通道按比例拉到同一水平（泛黄的纸 248,236,204 → 中性 248,248,248）；
    增益限制在 [0.75, 1.3]，纸面不够亮或通道差异过大时不做白平衡
  - 光照均匀化：缩到长边 96 后取 3×3 局部最大亮度（滤掉文字影响），
    canvas 双线性放大回原尺寸后逐像素相除。重活在小图做、放大交给 GPU
  - 对比度分位必须统计**校正后**的亮度，否则阴影会把分位点拉偏、亮区反被压暗
- **分块让出主线程必须用 MessageChannel，不能用 setTimeout(0)**：
  浏览器对嵌套 setTimeout 有 4ms 节流钳制，分块越细被钳得越久。
  实测同一段分块逻辑：setTimeout 版1266ms、MessageChannel 版 158ms（原始未分块 276ms）。
  实现见 filters.js 的 yieldToBrowser（复用一个 channel，不要每次新建）
- 增强滤镜各阶段都要上报进度（白平衡/光照估计/灰度构建/模糊/主循环），
  否则进度条会停在某个阶段不动，用户以为卡死。阶段权重见 applyEnhance 里的 W_* 常量
  - 锐化用 USM（与 3×3 模糊的差值），幅度按原亮度比例折算到各通道以保留色相
  - 实测（泛黄+左上阴影的翻拍图）：纸面饱和度 0.177→0.004、阴影区 172→255、
    文字 43→24、红笔保持红色；耗时 1.9MP 114ms、12MP 618ms
- **渲染顺序：曲面矫正必须在滤镜之前**：两个好处——白平衡/光照估计作用在已拉直的纸面上更准；
工具栏顺序与处理顺序一致。代价是矫正会在四角外填纯白，白平衡采样必须跳过通道差 <8 的中性像素，
否则纯白填充被当成纸面、增益算成 [1,1,1]，泛黄的纸再也去不掉黄（实测劣化：纸面饱和度 0.004 → 0.114）。

**黑白滤镜不能用全局 Otsu**：翻拍阴影会把暗部整片压黑（实测 41% 面积变黑块）。现为「大半径光照归一化 + 全局 Otsu + 小窗口平坦暗区抑制」：
  - 大半径（短边 4%）估计局部光照并换算增益，把阴影拉平，归一化后全局 Otsu 才可靠；
  - 小半径（短边 1%）判定平坦暗区置白——必须细粒度，否则页面边界过渡带（大窗口跨在暗背景与亮纸之间）会残留黑边；
  - 纯 Sauvola 在低对比/铅笔字场景会失效（窗口均值被笔画拉低，阈值塌到笔画亮度以下导致整段丢字），故不用
  - 阈值折回逐像素形式 `T / gain`，全分辨率热循环只需一次双线性采样
- 转换防重入 + 忙碌遮罩 + Toast 反馈，与 document 工具一致
- 导入失败（HEIC 等浏览器不支持格式、文件损坏）必须显式提示文件名与原因，不能静默跳过
- 清空为破坏性操作且不可撤销，按钮需二次确认（4 秒未确认自动还原）
- 导入串行队列：入队时必须同步拷贝 `FileList`（事件结束后即失效）

### 踩过的坑（2026-10-19 调试记录）
- 连通域坐标反推宽度用 `Math.sqrt(length)` 只对正方形图有效，必须显式传 w/h
- 3× 膨胀会把文档内部文字边缘连成「梳形」blob，四角极值点落在人工痕迹上；解法是最小外接矩形给种子 + 原始边缘图直线拟合求精
- `setBusy` 里调用 `syncToolbar(getSelected())` 时无选中页会 NPE（`page.filter`），需判空
- **iframe 在 `display:none` 时被设置 `srcdoc`，Chrome 会出现取消隐藏后永久空白绘制的缺陷**（克隆替换元素才能恢复）；预览 iframe 必须先显示再设 srcdoc，隐藏时绝不清空 srcdoc
- **事件的 `FileList` / `DataTransfer.files` 在事件结束后即失效**：把导入处理放进 Promise 队列（微任务）时必须先 `Array.from` 同步拷贝，否则队列执行时拿到空列表
- SVG 元素无 `.hidden` IDL 属性，显隐必须用 `setAttribute/removeAttribute('hidden')`，否则被 global.css 的 `[hidden]{display:none!important}` 挡住
- SVG 表现属性不支持 `var(--accent)`，颜色一律走 CSS 类

## 去手写功能（扫描文档的处理步骤，2026-10-19 新增）
### 定位
扫描流程中的一次页面处理：对当前页识别红笔/蓝笔批注并用本地 AI 修复背景，
擦除后的图替换原图，后续滤镜、旋转、曲面矫正、PDF 导出照常作用于新图。

### 能力边界（如实标注，不夸大）
- **已验证可用**：红笔批改、蓝笔批注（颜色检测出掩码 + MI-GAN 修复）
- **不提供**：黑笔与铅笔手写——与印刷体同为深色，按亮度识别会误删印刷文字和表格线
- 被笔迹完全遮住的印刷文字无法保证还原（GAN 修复模型的共性局限）

### 模块结构（tools/scandoc/handwriting/）
- `app.js`：流程编排（检测 → 膨胀 → 推理 → 替换页面图像）
- `model-manager.js`：模型懒加载、Cache Storage 缓存、SHA-256 校验
- `inpaint-worker.js`：ONNX Runtime Web 推理（Worker 隔离）
- `detect-ink.js`：红蓝笔颜色检测（零模型）、去噪、形态学膨胀
- `models/migan.onnx`：MI-GAN 流水线 ONNX（26.8 MB，MIT）

### 关键实现要点
- **输入签名以模型文件为准**：`image` uint8 [1,3,H,W]、`mask` uint8 [1,1,H,W]、输出 `result`；
  掩码 **0 = 待修复、255 = 保留**；输出是 CHW 三平面，需组装成 RGBA
- **postMessage 传的是 ArrayBuffer**，Worker 里必须 `new Uint8Array(buf)` 再按下标访问
- **只走 WASM 不启用 WebGPU**：调研发现同类模型在 WebGPU 上会静默输出错误结果
- **掩码必须膨胀 3px**：检测掩码边缘比笔迹可见边缘小，不膨胀会残留一圈原色（实测残留 54% → 0）
- **擦除后的页面图会被替换**：原图不再保留（这是擦除的语义），页面图分辨率降到工作分辨率
  （长边 2200 / 低端 1600）。实际无损——导出上限本就是 2200（EXPORT_MAX_SIZE），
  编辑画布上限 1400，所以肉眼不可见；需要真正保留原分辨率只能自建原图备份，代价是翻倍内存，不划算
- **滤镜不会被擦除重置**：滤镜属于视图层偏好，擦除只换底图，用户的黑白/增强设置应当保留
- **支持批量擦除**：工具栏「范围」选「全部页面」时逐页处理，处理中可取消。
  取消的实现要点：ORT 的 WASM 推理无法在运行中打断，终止 Worker 后主线程挂起的 promise
  **永远不会自行 settle**，必须主动 reject，否则界面会永久卡在忙碌遮罩里
- **内存纪律（写这个模块时踩过）**：
  - 结果图用 `toBlob` + objectURL，不要用 `toDataURL`：后者同步编码阻塞主线程
    （实测 1622×2200 真实照片约 136ms），且 base64 字符串无法主动释放（同一张约 5.3MB）
  - 工作画布必须 `try/finally` 释放（最大 2200×3000 ≈ 26MB），失败路径也要释放
  - 模型缓冲在建完 session 后立即置空（权重已复制进 ORT 会话）
- 推理在 Worker，空闲 30 秒销毁归还 WASM 堆；`numThreads = 1`（Safari 无嵌套 Worker）
- ORT 运行时由 vite.config.js 在配置加载时从 node_modules 同步到
  `tools/scandoc/handwriting/runtime/`，该目录不入 git

### 旋转与矫正的坐标约定（曾有 Bug，务必保留）
- 90°/270° 旋转的平移量必须用旋转后画布的对应边长：90° 用 `translate(rw,0)`、270° 用 `translate(0,rh)`。
  用错会让非正方形图片错位，且与角点映射不一致，矫正时采样到空白区，导出近乎空白的 PDF
- **角点顺序必须随旋转一起重排**：角点按原图 TL/TR/BR/BL 存储，旋转后原 TL 可能跑到右上角；
  不重排会让矫正把页面又转回去。顺序表：0° [0,1,2,3]、90° [3,0,1,2]、180° [2,3,0,1]、270° [1,2,3,0]

### 实测结果（合成测试图 600×800，红笔覆盖印刷文字）
| 指标 | 结果 |
| --- | --- |
| 页面加载 | 无模型下载（模型仅在点击擦除后拉取） |
| 红笔消除率 | 100% |
| 印刷字保留率 | 107% |
| 推理耗时 | 约 2.5 秒 |
| 擦除后导出 PDF | 正常（旋转 0/90/180/270 四向均已回归） |

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

## 文本工具功能（tools/text/）
### 26 种操作（4 类）
- **统计**：字符数 / 字符数（无空格）/ 单词数 / 行数 / 非空行 / 字节数（UTF-8）
- **大小写**：UPPER / lower / Title Case / Sentence / camelCase / snake_case / kebab-case
- **去重排序**：去重行 / 去重行+排序 / 升序 / 降序 / 按长度排序
- **翻转**：整行翻转 / 全文字符翻转 / 行序翻转
- **Tab/空格**：Tab→空格 / 空格→Tab
- **替换**：字符串替换 / 正则替换（支持 /pattern/flags 语法）
- **批量添加**：加前缀 / 加后缀 / 加行号

## 进制转换工具功能（tools/radix/）
- 2/8/10/16 进制互转：BigInt 大整数支持
- Base32（RFC 4648）/ Base58（Bitcoin）/ Base62 / Base64 互转（自实现字母表）
- UTF-8 文本 ↔ Hex 字符串互转
- 实时联动：input + source 选择触发 convert
- 双击输出框复制

## Unix 权限计算器功能（tools/chmod/）
- 数字（3/4 位）↔ 符号（10 位）双向转换
- 特殊位：setuid(4000) / setgid(2000) / sticky(1000)
- 特殊位与 x 位交互：setuid+x='s' / setuid 无 x='S' / sticky+x='t' / sticky 无 x='T'
- 反查：输入数字自动设置复选框
- 默认 755（owner rwx / group r-x / other r-x）
- 命令预览 `chmod NNN file` + 解释说明
- 常见权限参考表

## SQL/CRON 工具功能（tools/sqlcron/）
### SQL 格式化（dynamic import sql-formatter）
- 10 种方言：Standard SQL / MySQL / PostgreSQL / SQLite / Oracle / T-SQL / DB2 / MariaDB / Spark / BigQuery
- 美化 / 压缩（minify）
- Ctrl+Enter 执行

### CRON 解释（dynamic import cronstrue）
- 支持 5 段（分时日月周）或 6 段（含秒）表达式
- 解析 `* / - ,` 语法
- 输出可读描述（中文）
- 计算未来 10 次运行时间
- 8 个预设：每 5 分钟 / 每小时 / 每天 0 点 / 每周一 / 每月 1 号 / 每年 / 工作日 9 点 / 每 30 秒
- 自实现 computeNextRuns 状态机（parseField 解析字段）

## Unicode 查看器功能（tools/unicode/）
### 3 个 Tab
- **字符分析**：textarea 输入 → 防抖 120ms → 逐字符表格（字符 / 码点 / UTF-8 / UTF-16 / 分类 / 块），`for (const ch of str)` 按码点迭代正确处理代理对
- **码点查询**：支持 U+XXXX / 0xXXXX / 十进制 / 单字符 多种输入格式，显示 12 行详细信息（码点 / UTF-8/16/32 / HTML/CSS/JS/URL/JSON 转义 / 分类 / 块归属）
- **字符块浏览**：24 个常用 Unicode 块（Basic Latin / CJK / Hiragana / Katakana / Hangul / Arabic / Hebrew / Thai / Emoji / Emoticons / etc），16 列网格，点击字符复制，超 256 字符分页

### 实现要点
- 字符分类用 Unicode 属性转义：`\p{L}` `\p{N}` `\p{P}` `\p{S}` `\p{Z}` + u flag
- 不可见字符用占位符（`␣` `↵` `⇥` `⏎` `·`）
- 限制 2000 行避免渲染卡顿

## 加解密工具功能（tools/crypto/）
### Tab 1: AES 加解密（Web Crypto API）
- 算法：AES-GCM（含认证，IV 12 字节）/ AES-CBC（IV 16 字节）
- 密钥派生：PBKDF2（10 万次，SHA-256）密码派生 + 自动生成 salt / 直接 hex 密钥（32 字节）
- 输出格式：salt(16) + iv + ciphertext，Base64 或 Hex
- 输入：文本或文件（任意类型），下载结果文件

### Tab 2: 古典密码
- 凯撒密码（位移 1-25）/ ROT13 / ROT47 / 维吉尼亚（密钥）/ Atbash / XOR（UTF-8 字节级）/ 仿射（含模逆校验）
- 选项区按算法动态显隐

### Tab 3: 编码（非加密）
- Base64（UTF-8 安全）/ Base32（RFC 4648 自实现）/ Hex / 摩斯电码（ITU 标准字母表自实现）/ 二进制（每字符 8 位）/ URL / HTML 实体

## SVG 优化器功能（tools/svg/）
### 9 个优化选项（默认全勾）
- 去除 XML 声明 / DOCTYPE / 注释
- 去除编辑器命名空间属性（inkscape / sodipodi / illustrator / sketch）
- 去除 `<metadata>` 元素 / 空 `<title>` `<desc>` 元素
- 压缩空白（去换行、合并空格）
- 去除默认值属性（stroke="none" / fill="black" / stroke-width="1" 等）
- 移除空 `<g>` 元素（do-while 循环处理嵌套）

### UI
- 拖放区 + textarea 双输入联动
- 左右并排预览（棋盘格透明背景，深色模式自动调整颜色）
- 统计：原始大小 / 优化后大小 / 减少（字节 + 百分比）
- 复制结果 / 下载 .svg / 还原

### 实现要点
- 纯字符串/正则处理，不依赖 DOMParser，无第三方库
- 预览用 `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}` 处理 UTF-8

## OCR 图片识字功能（tools/ocr/）
### 核心链路
拖放/选择/粘贴图片 → dynamic import tesseract.js → createWorker(langs, oem, logger) → worker.recognize(file) → 显示文本 + 置信度

### 选项
- 语言：中英（chi_sim+eng，默认）/ 仅英文 / 仅中文 / 简繁+英文
- OEM：LSTM_ONLY / TESSERACT_ONLY / TESSERACT_LSTM_COMBINED

### 特点
- tesseract.js 用 dynamic import 减小首屏体积
- 训练数据从 CDN 自动下载（unpkg）
- 全局 paste 事件监听剪贴板图片
- 进度条显示阶段：加载内核 → 加载语言数据 → 识别中
- 取消：worker.terminate()
- 下载 .txt 带 UTF-8 BOM 防乱码

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
