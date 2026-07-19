import { defineConfig } from 'vite';
import { resolve } from 'path';

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