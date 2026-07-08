# Local Toolbox · 本地网页工具箱

> 纯前端网页工具箱 · 控制台 / 毛玻璃风格 · 数据不上传云端

一组开箱即用的浏览器端小工具，所有处理均在本地完成，不向服务器上传你的文件。基于 Vite 多页面构建，原生 CSS + CSS Variables，支持深色 / 浅色主题切换。

## 工具列表

| 工具 | 说明 |
| --- | --- |
| FFmpeg 音视频处理 | 浏览器端 FFmpeg.wasm，支持格式转换 / 提取音频 / 视频裁剪，多文件队列，5 阶段进度 |
| 倒计时 | SVG 圆环进度，毫秒精度，Web Audio 蜂鸣，超时计数，刷新恢复 |
| 秒表 | 毫秒精度，计次记录，最快 / 最慢高亮，CSV 导出 |
| 时间戳 | Unix 秒 / 毫秒互转，单位自适应，一键复制 |
| 世界时间 | 多时区实时显示，动态偏移（兼容夏令时），点击全屏查看 |
| 网络工具 | HTTP ping / 连接诊断 / 网速测试 / DoH 查询 / 公网 IP 与出口对比 |
| 编码转换 | Base64 / URL / ASCII / Unicode，UTF-8 安全，全部本地运行 |
| 证书解析 | 纯前端 ASN.1 DER 解析器，支持 PEM / Hex / Base64，Web Crypto 指纹 |

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
# FFmpeg.wasm 多线程需要 SharedArrayBuffer，必须启用 COOP/COEP
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

## 项目结构

```
├── index.html              # 导航首页（卡片网格 + 分类筛选）
├── assets/
│   ├── css/                # variables / theme / global
│   └── js/                 # common（主题/头部） + tools（工具注册表）
├── tools/
│   ├── ffmpeg/             # 音视频处理
│   ├── countdown/          # 倒计时
│   ├── stopwatch/          # 秒表
│   ├── timestamp/          # 时间戳
│   ├── worldclock/         # 世界时间
│   ├── network/            # 网络工具
│   ├── encoding/           # 编码转换
│   └── cert/               # 证书解析
├── vite.config.js          # 多入口 + conditional COEP 插件
└── package.json
```

## License

[MIT](./LICENSE)
