import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 前端 dev server：5173 端口；/api 与 /ws 代理到后端 3000。
// 数字人素材（manifest.json 里 src 形如 /avatars/clips/xxx.mp4）放在根 assets/avatars/，
// 通过 publicDir 直接指过去，dev 阶段不依赖后端 3000 就能播放（生产仍由后端 express.static 服务）。
// fs.allow 放宽到项目根：AvatarCanvas 直读 avatar/ 下的素材匹配器与 manifest.json。
export default defineConfig({
  plugins: [react()],
  publicDir: resolve(__dirname, '../assets'),
  server: {
    host: '0.0.0.0',
    port: 5173,
    // 端口恒定：被占用时报错而不是自动顺延到 5174/5175…
    // （配合 package.json 的 dev 脚本启动前自动释放 5173，预览地址永远 http://localhost:5173/）
    strictPort: true,
    fs: {
      allow: [fileURLToPath(new URL('../', import.meta.url))]
    },
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true }
      // 去掉 /avatars 代理：现在由 publicDir 直接服务，避免 dev 阶段依赖后端
    }
  }
});
