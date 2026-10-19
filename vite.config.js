import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

// ONNX Runtime Web 的 wasm 运行时体积较大且由 npm 管理，
// 构建时同步到工具目录并交给 Vite 作为静态资源处理（不入 git）
const ORT_DIST = resolve(__dirname, 'node_modules/onnxruntime-web/dist');
const ORT_RUNTIME = resolve(__dirname, 'tools/document/inkerase/runtime');
const ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];

function syncOrtRuntime() {
  if (!existsSync(ORT_DIST)) return;
  mkdirSync(ORT_RUNTIME, { recursive: true });
  for (const f of ORT_FILES) {
    copyFileSync(resolve(ORT_DIST, f), resolve(ORT_RUNTIME, f));
  }
}

// 配置加载时同步：必须早于模块解析，否则工具目录里的 wasm 还不存在
syncOrtRuntime();

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/local-toolbox/' : '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ffmpeg: resolve(__dirname, 'tools/ffmpeg/index.html'),
        countdown: resolve(__dirname, 'tools/countdown/index.html'),
        stopwatch: resolve(__dirname, 'tools/stopwatch/index.html'),
        timestamp: resolve(__dirname, 'tools/timestamp/index.html'),
        worldclock: resolve(__dirname, 'tools/worldclock/index.html'),
        network: resolve(__dirname, 'tools/network/index.html'),
        encoding: resolve(__dirname, 'tools/encoding/index.html'),
        cert: resolve(__dirname, 'tools/cert/index.html'),
        json: resolve(__dirname, 'tools/json/index.html'),
        regex: resolve(__dirname, 'tools/regex/index.html'),
        qrcode: resolve(__dirname, 'tools/qrcode/index.html'),
        jwt: resolve(__dirname, 'tools/jwt/index.html'),
        color: resolve(__dirname, 'tools/color/index.html'),
        hash: resolve(__dirname, 'tools/hash/index.html'),
        image: resolve(__dirname, 'tools/image/index.html'),
        diff: resolve(__dirname, 'tools/diff/index.html'),
        password: resolve(__dirname, 'tools/password/index.html'),
        unit: resolve(__dirname, 'tools/unit/index.html'),
        markdown: resolve(__dirname, 'tools/markdown/index.html'),
        otpMigration: resolve(__dirname, 'tools/otp-migration/index.html'),
        document: resolve(__dirname, 'tools/document/index.html'),
        scandoc: resolve(__dirname, 'tools/scandoc/index.html'),
        text: resolve(__dirname, 'tools/text/index.html'),
        radix: resolve(__dirname, 'tools/radix/index.html'),
        chmod: resolve(__dirname, 'tools/chmod/index.html'),
        sqlcron: resolve(__dirname, 'tools/sqlcron/index.html'),
        unicode: resolve(__dirname, 'tools/unicode/index.html'),
        crypto: resolve(__dirname, 'tools/crypto/index.html'),
        svg: resolve(__dirname, 'tools/svg/index.html'),
        ocr: resolve(__dirname, 'tools/ocr/index.html'),
      },
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  plugins: [
    {
      name: 'conditional-coep',
      configureServer(server) {
        // 只对 FFmpeg 工具页设置 COOP/COEP（SharedArrayBuffer 多线程必需）
        // 其他页面（如网络工具）需要跨域 fetch，不能设置 COEP
        server.middlewares.use((req, res, next) => {
          const path = (req.url || '').split('?')[0];
          if (path.startsWith('/tools/ffmpeg')) {
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          }
          next();
        });
      },
    },
  ],
}));