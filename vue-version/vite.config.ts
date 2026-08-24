import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // SSR 配置：CJS 包要 noExternal / optimizeDeps.include
  // 否则 ssrLoadModule 会报 `module is not defined`
  ssr: {
    noExternal: [
      /^ant-design-vue/,
      /^@ant-design\//,
      /^@ant-design-vue\//,
      /^@vue\//,
      'marked',
      'highlight.js',
      'pinia',
      'pinia-plugin-persistedstate',
      'nanoid',
    ],
    optimizeDeps: {
      include: [
        'marked',
        'highlight.js',
        'pinia',
        'pinia-plugin-persistedstate',
        'nanoid',
      ],
    },
  },
  build: {
    rollupOptions: {},
  },
  server: {
    // 同时监听 IPv4 + IPv6（macOS 上 localhost 默认只解析到 [::1]，
    // 不开 IPv4 会导致 NestJS SSR 服务的 302 跳转目标连不上）
    host: true,
    // 关键：把 /api + /socket.io 代理到 NestJS 3001。
    // dev 模式直接用 `vite` 跑（不启 Koa）时，Vite 自身没有 /api/chat/sse 路由，
    // EventSource 拿不到 SSE 流就显示"生成失败"。
    // WebSocket 必须显式开 ws: true，否则 socket.io 的长连接握手 404。
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
