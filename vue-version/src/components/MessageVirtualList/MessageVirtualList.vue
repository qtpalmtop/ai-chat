<script setup lang="ts" generic="T">
/**
 * 消息虚拟列表（变高 + 流式安全）
 * 与 React 版同源算法：
 *   1. 拆分流式中 / 已完成消息
 *   2. 已完成进入虚拟列表
 *   3. 流式中根据滚动状态切换 sticky / static
 *   4. SSE 增长 pendingText 时不影响虚拟列表 offset
 */

import { ref, computed, watch, watchEffect, nextTick } from 'vue';
import MeasuredItem from '@/components/VirtualList/MeasuredItem.vue';

interface Props {
  items: T[];
  streamingItem?: T | null;
  getKey: (item: T) => string;
  height: number;
  overscan?: number;
  scrollToBottomKey?: string | number;
  followStreaming?: boolean;
  className?: string;
}

const props = withDefaults(defineProps<Props>(), {
  overscan: 3,
  followStreaming: true,
});

const DEFAULT_ESTIMATED_HEIGHT = 120;
const STREAMING_GAP = 8;
const AT_BOTTOM_THRESHOLD = 50;

const scrollerRef = ref<HTMLDivElement | null>(null);
const scrollTop = ref(0);
const heightsRef = ref<Map<string, number>>(new Map());
const totalHeight = ref(props.items.length * DEFAULT_ESTIMATED_HEIGHT);
const streamingHeightRef = ref(0);

const isAtBottomRef = ref(true);
const isAtBottom = ref(true);
const userScrolledUpRef = ref(false);

const computeTotalHeight = (includeStreaming: boolean) => {
  let total = 0;
  heightsRef.value.forEach((v) => (total += v));
  const measured = heightsRef.value.size;
  if (measured < props.items.length) {
    total += (props.items.length - measured) * DEFAULT_ESTIMATED_HEIGHT;
  }
  if (includeStreaming && streamingHeightRef.value > 0) {
    total += streamingHeightRef.value;
  }
  return total;
};

const measureItem = (key: string, h: number) => {
  if (heightsRef.value.get(key) === h) return;
  const next = new Map(heightsRef.value);
  next.set(key, h);
  heightsRef.value = next;
  totalHeight.value = computeTotalHeight(!isAtBottomRef.value);
};

const measureStreaming = (h: number) => {
  if (streamingHeightRef.value === h) return;
  streamingHeightRef.value = h;
  if (!isAtBottomRef.value) {
    totalHeight.value = computeTotalHeight(true);
  }
};

const visRange = computed(() => {
  const cumulative: number[] = [];
  let sum = 0;
  for (let i = 0; i < props.items.length; i++) {
    const h = heightsRef.value.get(props.getKey(props.items[i])) || DEFAULT_ESTIMATED_HEIGHT;
    sum += h;
    cumulative.push(sum);
  }
  let start = 0;
  for (let i = 0; i < cumulative.length; i++) {
    if (cumulative[i] > scrollTop.value) {
      start = Math.max(0, i - props.overscan);
      break;
    }
  }
  let end = props.items.length;
  for (let i = start; i < cumulative.length; i++) {
    if (cumulative[i] > scrollTop.value + props.height) {
      end = Math.min(props.items.length, i + props.overscan + 1);
      break;
    }
  }
  return {
    start,
    end,
    paddingTop: start === 0 ? 0 : cumulative[start - 1],
    paddingBottom:
      props.items.length === 0
        ? 0
        : Math.max(0, cumulative[cumulative.length - 1] - cumulative[end - 1]),
    visible: props.items.slice(start, end),
  };
});

const onScroll = (e: Event) => {
  const el = e.target as HTMLDivElement;
  scrollTop.value = el.scrollTop;

  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  const nowAtBottom = distanceToBottom < AT_BOTTOM_THRESHOLD;

  userScrolledUpRef.value = !nowAtBottom;

  if (nowAtBottom === isAtBottomRef.value) return;

  isAtBottomRef.value = nowAtBottom;
  isAtBottom.value = nowAtBottom;

  if (streamingHeightRef.value > 0) {
    totalHeight.value = computeTotalHeight(!nowAtBottom);
  }
};

// 首次 / 切会话 / scrollToBottomKey 变化 → 滚到底
watch(
  () => props.scrollToBottomKey,
  () => {
    nextTick(() => {
      const el = scrollerRef.value;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      const clamped = el.scrollTop;
      scrollTop.value = clamped;
      isAtBottomRef.value = true;
      isAtBottom.value = true;
      userScrolledUpRef.value = false;
    });
  },
);

// 流式更新自动跟随：仅在用户贴近底部 + 未上滑时
watchEffect(() => {
  // 收集依赖
  const sid = (props.streamingItem as any)?.id;
  const pending = (props.streamingItem as any)?.pendingText;
  const partsLen = (props.streamingItem as any)?.parts?.length;
  void sid;
  void pending;
  void partsLen;

  if (!props.followStreaming || !props.streamingItem) return;
  if (!isAtBottomRef.value) return;
  if (userScrolledUpRef.value) return;

  nextTick(() => {
    const el = scrollerRef.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    scrollTop.value = el.scrollTop;
  });
});

/**
 * 暴露滚动状态给父组件（ChatWindow）用于：
 *   - userScrolledUp: 移动端"最后一条不在底部"判断
 *   - isAtBottom: 兼容旧消费方（已废弃，但保留避免破坏外部用法）
 *
 * 注意：父组件拿到的 ref 在 `<script setup>` 里读 `.value` 才是 boolean；
 * 模板里直接 `list.userScrolledUp`（解包后的 boolean）即可。
 */
defineExpose({
  userScrolledUp: userScrolledUpRef,
  isAtBottom: isAtBottomRef,
});
</script>

<template>
  <div
    ref="scrollerRef"
    :class="className"
    @scroll="onScroll"
    :style="{ height: `${height}px`, overflowY: 'auto', position: 'relative' }"
  >
    <div :style="{ height: `${visRange.paddingTop}px` }"></div>

    <MeasuredItem
      v-for="item in visRange.visible"
      :key="getKey(item)"
      :measure="(h) => measureItem(getKey(item), h)"
    >
      <slot name="item" :item="item"></slot>
    </MeasuredItem>

    <div :style="{ height: `${visRange.paddingBottom}px` }"></div>

    <div
      v-if="streamingItem"
      :data-streaming-mode="isAtBottom ? 'sticky' : 'static'"
      :style="
        isAtBottom
          ? {
              position: 'sticky',
              bottom: 0,
              background: 'inherit',
              marginTop: `${STREAMING_GAP}px`,
            }
          : { position: 'static', marginTop: `${STREAMING_GAP}px` }
      "
    >
      <MeasuredItem :measure="measureStreaming">
        <slot name="streaming" :item="streamingItem"></slot>
      </MeasuredItem>
    </div>
  </div>
</template>
