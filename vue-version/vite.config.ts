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
});
