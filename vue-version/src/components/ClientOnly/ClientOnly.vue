<script setup lang="ts">
/**
 * ClientOnly 组件
 * - SSR 端：只渲染 placeholder div（mounted=false → content v-if 不命中 → 不输出）
 * - Client 端首次 setup：mounted=false → content v-if 不命中 → 结构与 SSR 一致
 * - Client 端 onMounted 后：mounted=true → content v-if 命中 → 渲染真实内容
 *
 * 为什么 SSR 不渲染 content：
 *   antd-vue 的 <AApp> 内部包含 <HookNotification>（message portal），
 *   该组件在 SSR 端会尝试 createPortal 到 document.body，
 *   但服务端无 document，导致 portal 退化为内联渲染，
 *   与 client 端 createPortal 后的 DOM 结构完全不一致 → hydration mismatch。
 *   把整个 AApp 放到 ClientOnly.content 中，SSR 端完全不渲染，即可绕开。
 *
 * 为什么用 v-if 不用 v-show：
 *   v-show 在 SSR 中仍然输出 DOM 节点（仅样式 display:none），
 *   无法避免 AApp / message portal 在服务端被求值。
 *   v-if 在条件不满足时不输出任何节点，是真正的"client only"。
 *
 * 为什么 SSR / client 首次渲染不会 mismatch：
 *   SSR 端 mounted=false → content v-if 不命中 → 整个 client-only 树只含 placeholder
 *   Client 端 setup 时 mounted=false → 同样只渲染 placeholder
 *   两边 DOM 树形状完全一致，hydration 通过
 *   onMounted 之后 mounted=true → v-if 命中 → 走正常 reactive 更新路径，不会触发 mismatch
 */

import { ref, onMounted } from 'vue';

const mounted = ref(false);
onMounted(() => {
  mounted.value = true;
});
</script>

<template>
  <div class="client-only">
    <div class="client-only__placeholder">
      <slot name="placeholder" />
    </div>
    <div v-if="mounted" class="client-only__content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.client-only {
  width: 100%;
  height: 100%;
}
</style>
