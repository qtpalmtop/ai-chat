<script setup lang="ts">
/**
 * 侧边栏 - 会话管理
 * - 新建 / 删除 / 重命名 / 切换
 * - 当前会话高亮
 * - 虚拟列表：只渲染视口内的项
 *
 * Vue 3 与 React 差异：
 *   - Pinia 用 storeToRefs 保持引用稳定
 *   - computed 自动缓存
 *   - 列表项用 v-memo 减少重渲染
 */

import { ref, computed, onMounted, onUnmounted, watch, h } from 'vue';
import { Button, Input, Popconfirm, Tooltip, message as antdMsg } from 'ant-design-vue';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  ThunderboltFilled,
} from '@ant-design/icons-vue';
import { storeToRefs } from 'pinia';
import type { Session } from '@/types/message';
import { useChatStore } from '@/stores/chatStore';
import VirtualList from '@/components/VirtualList/VirtualList.vue';

const ITEM_HEIGHT = 48;

const store = useChatStore();
const { sessionIds, sessions, currentSessionId, hasHydrated } = storeToRefs(store);

// 派生 sessions 数组
const sessionList = computed(() =>
  sessionIds.value.map((id) => sessions.value[id]).filter((s): s is Session => Boolean(s)),
);

const editingId = ref<string | null>(null);
const editingTitle = ref('');

const listContainerRef = ref<HTMLDivElement | null>(null);
const listHeight = ref(0);
let ro: ResizeObserver | null = null;

onMounted(() => {
  const el = listContainerRef.value;
  if (!el) return;
  listHeight.value = el.clientHeight;
  ro = new ResizeObserver(() => {
    listHeight.value = el.clientHeight;
  });
  ro.observe(el);
});

onUnmounted(() => {
  ro?.disconnect();
});

const remeasureKey = computed(() => editingId.value ?? 'normal');

const onStartEdit = (id: string, title: string) => {
  editingId.value = id;
  editingTitle.value = title;
};

const onFinishEdit = (id: string) => {
  const t = editingTitle.value.trim();
  if (t) store.renameSession(id, t);
  editingId.value = null;
};

const onSelect = (id: string) => {
  store.setCurrentSession(id);
};

const onDelete = (id: string) => {
  store.deleteSession(id);
  antdMsg.success('已删除');
};

// 当前会话变化时，自动滚到可见区
watch(
  [currentSessionId, sessionList, hasHydrated],
  ([curId]) => {
    if (!curId) return;
    const idx = sessionList.value.findIndex((s) => s.id === curId);
    if (idx === -1) return;
    const el = listContainerRef.value?.querySelector('[data-vlist]') as HTMLDivElement | null;
    if (!el) return;
    const itemTop = idx * ITEM_HEIGHT;
    const itemBottom = itemTop + ITEM_HEIGHT;
    if (itemTop < el.scrollTop || itemBottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: Math.max(0, itemTop - 32), behavior: 'smooth' });
    }
  },
  { flush: 'post' },
);
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__brand">
      <div class="sidebar__logo">
        <ThunderboltFilled />
      </div>
      <div class="sidebar__title">豆包 AI</div>
    </div>

    <Button
      type="primary"
      block
      class="sidebar__new"
      @click="store.createSession('新对话')"
    >
      <template #icon><PlusOutlined /></template>
      新建对话
    </Button>

    <div class="sidebar__list" ref="listContainerRef">
      <div v-if="sessionList.length === 0" class="sidebar__empty">
        暂无会话，点击上方按钮创建
      </div>
      <VirtualList
        v-else
        :items="sessionList"
        :item-height="ITEM_HEIGHT"
        :height="listHeight"
        :overscan="4"
        :remeasure-key="remeasureKey"
      >
        <template #item="{ item }">
          <div
            class="sidebar__item"
            :class="{ 'is-active': item.id === currentSessionId }"
            @click="editingId !== item.id && onSelect(item.id)"
          >
            <MessageOutlined class="sidebar__item-icon" />
            <Input
              v-if="editingId === item.id"
              v-model:value="editingTitle"
              size="small"
              autofocus
              @blur="onFinishEdit(item.id)"
              @pressenter="onFinishEdit(item.id)"
              @click.stop
            />
            <span v-else class="sidebar__item-title">{{ item.title }}</span>
            <div class="sidebar__item-actions" @click.stop>
              <Tooltip title="重命名">
                <Button
                  type="text"
                  size="small"
                  @click="onStartEdit(item.id, item.title)"
                >
                  <template #icon><EditOutlined /></template>
                </Button>
              </Tooltip>
              <Popconfirm
                title="删除该会话？"
                ok-text="删除"
                cancel-text="取消"
                :ok-button-props="{ danger: true }"
                @confirm="onDelete(item.id)"
              >
                <Tooltip title="删除">
                  <Button type="text" size="small" danger>
                    <template #icon><DeleteOutlined /></template>
                  </Button>
                </Tooltip>
              </Popconfirm>
            </div>
          </div>
        </template>
      </VirtualList>
    </div>

    <div class="sidebar__footer">
      <div class="sidebar__hint">Vue 版演示 · 数据存于 localStorage</div>
    </div>
  </aside>
</template>
