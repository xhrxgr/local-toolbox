# Local Toolbox · 本地网页工具箱

> 纯前端网页工具箱 · 控制台 / 毛玻璃风格 · 数据不上传云端

一组开箱即用的浏览器端小工具，所有处理均在本地完成，不向服务器上传你的文件。基于 Vite 多页面构建，原生 CSS + CSS Variables，支持深色 / 浅色主题切换。

## 工具列表

| 分类 | 工具 | 说明 |
| --- | --- | --- |
| 媒体 | FFmpeg 音视频处理 | 浏览器端 FFmpeg.wasm，格式转换 / 提取音频 / 视频裁剪，多文件队列，5 阶段进度 |
| 媒体 | 图片处理 | 图片压缩 / 格式转换 / 尺寸调整 / 裁剪旋转 |
| 媒体 | SVG 优化器 | SVG 代码压缩、清理冗余属性 |
| 媒体 | OCR 图片识字 | Tesseract.js 本地识别图中文字，支持多语言 |
| 时间 | 倒计时 | SVG 圆环进度，毫秒精度，Web Audio 蜂鸣，超时计数，刷新恢复 |
| 时间 | 秒表 | 毫秒精度，计次记录，最快 / 最慢高亮，CSV 导出 |
| 时间 | 时间戳 | Unix 秒 / 毫秒互转，单位自适应，一键复制 |
| 时间 | 世界时间 | 多时区实时显示，动态偏移（兼容夏令时），点击全屏查看 |
| 网络 | 网络工具 | HTTP ping / 连接诊断 / 网速测试 / DoH 查询 / 公网 IP 与出口对比 |
| 网络 | 证书解析 | 纯前端 ASN.1 DER 解析器，支持 PEM / Hex / Base64，Web Crypto 指纹 |
| 编码 | 编码转换 | Base64 / URL / ASCII / Unicode，UTF-8 安全，全部本地运行 |
| 编码 | 进制转换 | 2/8/10/16 进制及自定义进制互转，实时校验 |
| 开发 | JSON 工具 | 格式化 / 压缩 / 校验 / 转义 / 树形视图 |
| 开发 | 正则测试器 | 实时匹配高亮，分组捕获，常用正则库 |
| 开发 | JWT 解析 | Header / Payload / Signature 拆解，签名校验 |
| 开发 | 哈希计算 | MD5 / SHA-1 / SHA-256 / SHA-512，UUID 生成 |
| 开发 | 文本对比 | 双栏 diff，行级 / 字符级高亮 |
| 开发 | Markdown 编辑器 | 实时预览，GFM，导出 HTML / PDF |
| 开发 | 文本工具集 | 字数统计、大小写转换、去重、排序、替换等 |
| 开发 | 权限计算器 | chmod 符号 / 八进制互转，可视化权限位 |
| 开发 | SQL / CRON | SQL 格式化，CRON 表达式解析与下次执行时间 |
| 开发 | Unicode 查看器 | 字符码点 / 编码 / 名称查询，字符可视化 |
| 开发 | 加解密 | AES / DES / RC4 / Rabbit，哈希，编码转换 |
| 文档 | 文档转换 | PDF/Word/Excel/CSV/Markdown/HTML/TXT/RTF/EPUB 本地互转，6 Tab |
| 文档 | 扫描文档 | 图片转文档：批量导入、黑白/增强滤镜、曲面矫正、四角裁剪、按序合并 PDF |
| 实用 | 二维码 | 生成 / 识别（jsqr），自定义颜色与容错级别 |
| 实用 | 颜色转换 | HEX / RGB / HSL / HSV 互转，调色板，对比度检测 |
| 实用 | 密码生成 | 随机密码 / 密码短语，强度评估 |
| 实用 | 单位换算 | 长度 / 重量 / 温度 / 面积 / 体积 / 速度等 |
| 实用 | OTP 迁移 | Google Authenticator 二维码导出解析，生成 otpauth 链接 |

## 特性

- **隐私优先**：文件处理全程在浏览器完成，不上传云端
- **毛玻璃 UI**：深色 slate 底色 + 玻璃拟态卡片，支持浅色 / 深色切换
- **无框架**：原生 JavaScript + CSS Variables，仅 Vite 作为构建工具
- **高精度计时**：`performance.now()` + `requestAnimationFrame`，后台不丢时
- **响应式**：移动端友好，关键页面跨视口自适应

## 技术栈

- 构建：Vite（多页面 `rollupOptions.input`）
- 样式：原生 CSS + CSS Variables（无 UI 框架）
- 图标：内联 SVG
- 音视频：`@ffmpeg/ffmpeg` + `@ffmpeg/util`（FFmpeg.wasm，浏览器端处理）
- 部署：Nginx 静态托管 `dist/`

## 本地开发

```bash
npm install
npm run dev      # 启动开发服务器
npm run build    # 构建到 dist/
npm run preview  # 预览构建产物
```

## 部署

`npm run build` 产出 `dist/`，托管到任意静态服务器即可。Nginx 示例：

```nginx
# 当前使用单线程 FFmpeg 内核（@ffmpeg/core 不依赖 SharedArrayBuffer），无需 COOP/COEP。
# 若改用多线程内核(@ffmpeg/core-mt)，则必须为 /tools/ffmpeg/ 开启 COOP/COEP。
location /tools/ffmpeg/ {
  add_header Cross-Origin-Opener-Policy "same-origin";
  add_header Cross-Origin-Embedder-Policy "require-corp";
  try_files $uri $uri/ /index.html;
}

location / {
  try_files $uri $uri/ /index.html;
}
```

> 注意：COEP `require-corp` 仅对 `/tools/ffmpeg` 路径设置。网络工具需要跨域 fetch（DoH / IP 查询 / 测速目标），全局设置 COEP 会导致这些请求被阻塞。

### GitHub Pages（静态托管）

当前依赖单线程内核，无需任何特殊处理，构建产物直接推送到 `gh-pages` 分支即可使用。COOP/COEP 不可配置也不会导致报错（单线程内核不使用 SharedArrayBuffer）。若将来改为多线程内核（`@ffmpeg/core-mt`），才需要考虑配置跨源隔离。`tools/ffmpeg/coi-serviceworker.js` 现为兼容性清理脚本：历史上的访客浏览器可能残留旧版隔离 SW，放在相同路径可让浏览器自动替换并注销旧 SW、清理其缓存（构建产物仍会包含此文件）。

## 项目结构

```
├── index.html              # 导航首页（卡片网格 + 分类筛选）
├── assets/
│   ├── css/                # variables / theme / global
│   └── js/                 # common（主题/头部） + tools（工具注册表）
├── tools/
│   ├── ffmpeg/             # 音视频处理
│   ├── image/              # 图片处理
│   ├── svg/                # SVG 优化器
│   ├── ocr/                # OCR 图片识字
│   ├── countdown/          # 倒计时
│   ├── stopwatch/          # 秒表
│   ├── timestamp/          # 时间戳
│   ├── worldclock/         # 世界时间
│   ├── network/            # 网络工具
│   ├── cert/               # 证书解析
│   ├── encoding/           # 编码转换
│   ├── radix/              # 进制转换
│   ├── json/               # JSON 工具
│   ├── regex/              # 正则测试器
│   ├── jwt/                # JWT 解析
│   ├── hash/               # 哈希计算 / UUID
│   ├── diff/               # 文本对比
│   ├── markdown/           # Markdown 编辑器
│   ├── text/               # 文本工具集
│   ├── chmod/              # 权限计算器
│   ├── sqlcron/            # SQL / CRON
│   ├── unicode/            # Unicode 查看器
│   ├── crypto/             # 加解密
│   ├── document/           # 文档转换（app.js + operations.js + tab-loaders.js + handlers/ + ui/）
│   ├── scandoc/            # 扫描文档（app.js + state.js + render.js + filters.js + warp.js + detect.js + corners-ui.js + exporter.js + lib/）
│   ├── qrcode/             # 二维码
│   ├── color/              # 颜色转换
│   ├── password/           # 密码生成
│   ├── unit/               # 单位换算
│   └── otp-migration/      # OTP 迁移
├── vite.config.js          # 多入口 + conditional COEP 插件
└── package.json
```

## License

[MIT](./LICENSE)
