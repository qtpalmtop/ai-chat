<script setup lang="ts">
/**
 * 测量子项高度的容器（用于 MessageVirtualList）
 * - 用 ResizeObserver 测量实际高度
 * - 高度变化时回调 measure(height)
 */

import { onMounted, onUnmounted, ref, watch } from 'vue';

interface Props {
  measure: (h: number) => void;
}

const props = defineProps<Props>();

const rootRef = ref<HTMLDivElement | null>(null);
let ro: ResizeObserver | null = null;

onMounted(() => {
  const el = rootRef.value;
  if (!el) return;
  // 立即测量一次：避免首屏空白
  props.measure(el.offsetHeight);
  ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      props.measure(entry.contentRect.height);
    }
  });
  ro.observe(el);
});

onUnmounted(() => {
  ro?.disconnect();
  ro = null;
});
</script>

<template>
  <div ref="rootRef">
    <slot></slot>
  </div>
</template>
