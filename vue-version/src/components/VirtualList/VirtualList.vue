<script setup lang="ts" generic="T">
/**
 * 轻量虚拟列表（固定行高，适合 Sidebar 会话项）
 * - 只渲染视口内 + overscan 的项
 * - 视口外的项不入 DOM → 离屏 DOM 释放
 *
 * Vue 3 与 React 关键差异：
 *   - Vue 用 v-memo 控制单 item 重渲染
 *   - computed 自动追踪依赖
 *   - ref 比 useRef 更直接
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';

interface Props {
  items: T[];
  itemHeight: number;
  height: number;
  overscan?: number;
  className?: string;
  /** 强制重新测量 item 高度的 key（编辑态变化时让列表 re-render） */
  remeasureKey?: string | number;
}

const props = withDefaults(defineProps<Props>(), { overscan: 3 });

const emit = defineEmits<{
  (e: 'itemResize', key: string, h: number): void;
}>();

const scrollerRef = ref<HTMLDivElement | null>(null);
const scrollTop = ref(0);

const totalHeight = computed(() => props.items.length * props.itemHeight);
const startIndex = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / props.itemHeight) - props.overscan),
);
const endIndex = computed(() =>
  Math.min(
    props.items.length,
    Math.ceil((scrollTop.value + props.height) / props.itemHeight) + props.overscan,
  ),
);
const paddingTop = computed(() => startIndex.value * props.itemHeight);
const paddingBottom = computed(() =>
  Math.max(0, totalHeight.value - endIndex.value * props.itemHeight),
);

const onScroll = (e: Event) => {
  scrollTop.value = (e.target as HTMLDivElement).scrollTop;
};

const onItemResize = (key: string, h: number) => {
  emit('itemResize', key, h);
};
</script>

<template>
  <div
    ref="scrollerRef"
    :class="className"
    @scroll="onScroll"
    :style="{ height: `${height}px`, overflowY: 'auto' }"
    data-vlist="scroller"
    :data-remeasure-key="remeasureKey"
  >
    <div :style="{ height: `${totalHeight}px`, position: 'relative' }">
      <div
        :style="{
          position: 'absolute',
          top: `${paddingTop}px`,
          left: 0,
          right: 0,
        }"
      >
        <div
          v-for="(item, i) in items.slice(startIndex, endIndex)"
          :key="((item as any).id ?? (startIndex + i))"
          v-memo="[item, startIndex + i, remeasureKey]"
          :style="{ height: `${itemHeight}px` }"
        >
          <slot name="item" :item="item" :index="startIndex + i" />
        </div>
      </div>
      <div
        v-if="paddingBottom > 0"
        :style="{
          height: `${paddingBottom}px`,
          position: 'absolute',
          top: `${endIndex * itemHeight}px`,
          left: 0,
          right: 0,
        }"
      ></div>
    </div>
  </div>
</template>
