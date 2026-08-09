import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 前端 dev server：5173 端口；/api 与 /ws 代理到后端 3000。
// fs.allow 放宽到项目根：AvatarCanvas 直读 avatar/ 下的素材匹配器与 manifest.json。
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    fs: {
      allow: [fileURLToPath(new URL('../', import.meta.url))]
    },
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true }
    }
  }
});
