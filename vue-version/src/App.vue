<script setup lang="ts">
/**
 * 根组件 - 配置全局 Provider
 * 与 React 版的 App.tsx 职责相同
 *
 * 关键修复：
 *   1. themeConfig 不用 algorithm 字段（仅传 token）。
 *      原因是 antd-vue 4.2.5 的某段 SSR + 客户端代码路径会在 algorithm 字段
 *      经过 vnode props 序列化/反序列化后丢失函数引用，触发运行时错误。
 *   2. themeConfig 提到 module 顶层（不放在 setup 中），
 *      保证 SSR / client 渲染引用一致，避免额外的 hydration mismatch。
 *   3. 用 ClientOnly 包裹 ConfigProvider + AntdApp + ChatWindow，
 *      让所有 antd-vue 内容完全在 client 端渲染，
 *      避免 store / antd 内部状态在 SSR/client 不一致导致的 hydration mismatch。
 *
 * 路由：
 *   - /         → 客户端 ChatWindow
 *   - /agent    → 客服工作台 AgentWorkbench
 *
 * 注意：本文件注释里**不要**再写任何疑似 V8 错误消息的子串（见 main.ts 注释说明），
 * 否则 Vite 5 dev 模式的错误监控会把这些字面字符串误当成运行时错误上报到浏览器控制台。
 */

import { ref, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { ConfigProvider, App as AntdApp } from 'ant-design-vue';
import ChatWindow from '@/components/ChatWindow/ChatWindow.vue';
import ClientOnly from '@/components/ClientOnly/ClientOnly.vue';
import RotateHint from '@/components/RotateHint/RotateHint.vue';

// module 顶层：稳定引用；只传 token，不传 algorithm 字段（原因见上方注释）
const themeConfig = {
  token: {
    colorPrimary: '#4D6BFE',
    borderRadius: 8,
  },
};

// 极简路由：直接读 pathname
const path = ref(typeof window !== 'undefined' ? window.location.pathname : '/');

const AgentWorkbench = defineAsyncComponent(
  () => import('@/pages/AgentWorkbench/AgentWorkbench.vue'),
);

function onPopState() {
  path.value = window.location.pathname;
}

onMounted(() => {
  window.addEventListener('popstate', onPopState);
});
onUnmounted(() => {
  window.removeEventListener('popstate', onPopState);
});
</script>

<template>
  <div class="app-root">
    <ClientOnly>
      <ConfigProvider :theme="themeConfig">
        <AntdApp>
          <AgentWorkbench v-if="path === '/agent'" />
          <ChatWindow v-else />
        </AntdApp>
      </ConfigProvider>
      <!--
        横屏旋转提示：放在 ClientOnly 之外，确保 hydrate 时立刻可用；
        组件内部已经判过移动端 + 横屏条件，桌面端不会触发。
        不放在 ChatWindow/AgentWorkbench 里——跨路由持续生效。
      -->
      <RotateHint />
      <template #placeholder>
        <div class="app-skeleton">豆包 AI 加载中…</div>
      </template>
    </ClientOnly>
  </div>
</template>

<style>
.app-root {
  width: 100%;
  height: 100vh;
}
.app-skeleton {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  font-size: 14px;
}
</style>
