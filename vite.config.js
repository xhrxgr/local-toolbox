import { defineConfig } from 'vite';
import { resolve, extname } from 'path';
import { copyFileSync, mkdirSync, existsSync, createReadStream } from 'fs';

// 需要跨源隔离的页面路径前缀。必须与 public/sw.js 的 COI_PATHS
// 和 assets/js/common.js 的 COI_PAGES 保持一致（三处无共享模块，
// 因为分别运行在 Node / SW / 页面三种环境）。
// ASR 页启用：为将来接入 sherpa-onnx 流式识别铺路。
// 关键：必须给白名单页的所有响应（含 Worker 脚本）注入 COEP，
// 只给导航注入会导致隔离页无法创建 Worker。详见 public/sw.js 注释。
const COI_PATHS = ['/tools/asr/'];
// 生产 SW 除白名单页外，还要给 ASR 的运行时资源注入 COEP
// （ORT 的 em-pthread 子 Worker 会自引用加载 asr-runtime/*.mjs）。
// dev 没有 SW，必须由服务器直接给这些路径加头，才能与生产行为一致。
const COI_ASSET_RE = /\/(?:asr-runtime\/|asr-worker-[\w-]+\.js$)/;

// ONNX Runtime Web 的 wasm 运行时体积较大且由 npm 管理，
// 构建时同步到工具目录并交给 Vite 作为静态资源处理（不入 git）
const ORT_DIST = resolve(__dirname, 'node_modules/onnxruntime-web/dist');
const ORT_RUNTIME = resolve(__dirname, 'tools/scandoc/handwriting/runtime');
const ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];

// 语音转文字用的 Transformers.js 自带另一份 ORT（版本不同，不能混用）。
// 同步它的 WASM 运行时到站点同源，避免依赖 jsdelivr CDN。
// 两套都带：
// - threaded：跨源隔离页用 SharedArrayBuffer 多线程（ASR 页已启用隔离）
// - asyncify：隔离不可用时的单线程回退（老浏览器 / Nginx 未配头等）
const ASR_ORT_DIST = resolve(__dirname, 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist');
const ASR_ORT_RUNTIME = resolve(__dirname, 'public/asr-runtime');
const ASR_ORT_FILES = [
  'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs',
];

function syncOrtRuntime() {
  if (existsSync(ORT_DIST)) {
    mkdirSync(ORT_RUNTIME, { recursive: true });
    for (const f of ORT_FILES) {
      copyFileSync(resolve(ORT_DIST, f), resolve(ORT_RUNTIME, f));
    }
  }
  if (existsSync(ASR_ORT_DIST)) {
    mkdirSync(ASR_ORT_RUNTIME, { recursive: true });
    for (const f of ASR_ORT_FILES) {
      copyFileSync(resolve(ASR_ORT_DIST, f), resolve(ASR_ORT_RUNTIME, f));
    }
  }
}

// 配置加载时同步：必须早于模块解析，否则工具目录里的 wasm 还不存在
syncOrtRuntime();

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/local-toolbox/' : '/',
  build: {
    // 实用脚本以独立文件输出：小于内联阈值的脚本默认会被转成 data URL，
    // 下载行为与文件下载不一致（个别浏览器对 data URL 下载处理不同）
    assetsInlineLimit: (filePath) => (filePath.endsWith('.bat') ? false : undefined),
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
        dewatermark: resolve(__dirname, 'tools/dewatermark/index.html'),
        scandoc: resolve(__dirname, 'tools/scandoc/index.html'),
        text: resolve(__dirname, 'tools/text/index.html'),
        radix: resolve(__dirname, 'tools/radix/index.html'),
        chmod: resolve(__dirname, 'tools/chmod/index.html'),
        sqlcron: resolve(__dirname, 'tools/sqlcron/index.html'),
        unicode: resolve(__dirname, 'tools/unicode/index.html'),
        crypto: resolve(__dirname, 'tools/crypto/index.html'),
        svg: resolve(__dirname, 'tools/svg/index.html'),
        ocr: resolve(__dirname, 'tools/ocr/index.html'),
        asr: resolve(__dirname, 'tools/asr/index.html'),
        scripts: resolve(__dirname, 'tools/scripts/index.html'),
        resources: resolve(__dirname, 'tools/resources/index.html'),
      },
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'zxing-wasm'],
  },
  plugins: [
    {
      // 性能基准用的本地模型放在仓库根的 .probe-model/（不入 git、不进产物）。
      // 不能放 public/：Vite 会把 public 里的文件原样拷进 dist，
      // 42MB 测试模型会跟着部署上线。dev 时才由这个中间件按 HF 的 URL 结构提供。
      name: 'serve-local-asr-model',
      configureServer(server) {
        const root = resolve(__dirname, '.probe-model');
        server.middlewares.use((req, res, next) => {
          const path = (req.url || '').split('?')[0];
          const prefix = '/.probe-model/';
          if (!path.startsWith(prefix)) return next();
          const file = resolve(root, path.slice(prefix.length));
          if (!file.startsWith(root) || !existsSync(file)) {
            res.statusCode = 404;
            return res.end('not found');
          }
          res.setHeader('Content-Type', extname(file) === '.onnx'
            ? 'application/octet-stream' : 'application/json');
          createReadStream(file).pipe(res);
        });
      },
    },
    {
      name: 'conditional-coep',
      configureServer(server) {
        // 开发环境模拟生产 SW 的跨源隔离行为（见 public/sw.js 的 COI_PATHS）。
        // dev 模式不注册 SW，只能由服务器直接给头；生产环境则由 SW 注入。
        // 只对白名单页生效：COEP 会拦掉无 CORP/CORS 声明的跨域子资源，
        // ffmpeg core / tesseract 语言包等页面绝不能开。
        // credentialless：HF 模型的 ACAO 是 https://huggingface.co 而非 *，
        // require-corp 下会被拦（实测，见 .workbuddy/memory/2026-11-12.md）。
        server.middlewares.use((req, res, next) => {
          const path = (req.url || '').split('?')[0];
          if (COI_PATHS.some((p) => path === p || path.startsWith(p)) || COI_ASSET_RE.test(path)) {
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
          }
          next();
        });
      },
    },
  ],
}));