/**
 * SSR 入口
 * 与 React 版的 entry-server.tsx 职责对应
 *
 * Vue 3 SSR 注意：
 *   - 容器 id 用 #app（模板里也是 #app）
 *   - antd-vue 的 css-in-js 由客户端 hydrate 后自动注入，SSR 端不抽取
 *   - Pinia 在 SSR/CSR 间需要保持 hydration 一致
 *
 * 返回格式：{ html, styleText }
 */

import { createSSRApp } from 'vue';
import { setupPinia } from '@/stores/pinia';
import { renderToString } from 'vue/server-renderer';
import App from './App.vue';

export async function render() {
  const app = createSSRApp(App);
  app.use(setupPinia());
  const html = await renderToString(app);
  return { html, styleText: '' };
}
