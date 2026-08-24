/**
 * 客户端入口（mount）
 * - SSR 模式（容器有 SSR 内容）：用 hydrate 接管服务端预渲染的 DOM
 * - 纯客户端模式（Vite dev / 静态页）：用 createApp 直接挂载，避免 hydration 警告
 *
 * 与 React 版 main.tsx 的思路一致：检测容器是否有子节点决定走 hydrate 还是 mount
 */

import { createApp, createSSRApp } from 'vue';
import { setupPinia } from '@/stores/pinia';
import App from './App.vue';
import './style.css';

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app element not found');
}

// 检测 SSR 是否成功：
// - 有子节点：服务端已渲染（NestJS prod 路径走 entry-server.ts），用 SSR 模式 hydrate
// - 无子节点（仅含注释）：Vite dev 直接给 index.html，用 createApp 挂载
const hasSsrContent =
  container.hasChildNodes() &&
  ![...container.childNodes].every((n) => n.nodeType === Node.COMMENT_NODE);

if (hasSsrContent) {
  const app = createSSRApp(App);
  app.use(setupPinia());
  app.mount('#app');
  console.log('[vue] hydrate');
} else {
  const app = createApp(App);
  app.use(setupPinia());
  app.mount('#app');
  console.log('[vue] createApp');
}
