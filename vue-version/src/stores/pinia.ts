/**
 * 创建 Pinia 实例（SSR / 客户端统一入口）
 *
 * 关键：
 *   pinia-plugin-persistedstate 在 SSR 端访问 window.localStorage 会抛错
 *   SSR 端不挂载插件；客户端挂载
 *
 * 插件的 import 在 Node 端是安全的（仅在 useChatStore() 调用时才会读 window）
 */

import { createPinia } from 'pinia';
import type { Pinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';

const isClient = typeof window !== 'undefined';

export function setupPinia(): Pinia {
  const pinia = createPinia();
  if (isClient) {
    pinia.use(piniaPluginPersistedstate);
  }
  return pinia;
}
