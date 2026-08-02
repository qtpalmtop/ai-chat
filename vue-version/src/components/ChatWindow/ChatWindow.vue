<script setup lang="ts">
/**
 * 主对话区（Vue 版）
 * - 顶部 Header（标题 / 清空）
 * - 消息列表（**虚拟列表**：离屏 DOM 释放）
 * - 输入区
 * - 历史会话进入：watch + nextTick 同步 scrollTo
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Button, Dropdown, message as antdMsg } from 'ant-design-vue';
import { DeleteOutlined, MoreOutlined, CodeOutlined, CopyOutlined } from '@ant-design/icons-vue';
import { storeToRefs } from 'pinia';
import { useChatStore } from '@/stores/chatStore';
import { useChat } from '@/composables/useChat';
import MessageItem from '@/components/MessageItem/MessageItem.vue';
import InputPanel from '@/components/InputPanel/InputPanel.vue';
import Sidebar from '@/components/Sidebar/Sidebar.vue';
import MessageVirtualList from '@/components/MessageVirtualList/MessageVirtualList.vue';
import SkillBar from '@/components/SkillBar/SkillBar.vue';
import type { MenuProps } from 'ant-design-vue';
import type { Message } from '@/types/message';

const WELCOME = '你好，我是豆包 👋 试试问我：写一个 React Hook 例子 / 用 Markdown 做个表格 / 上传一张图片';
const SUGGESTIONS = [
  '写一个 React Hook 例子',
  '用 Markdown 表格对比 Vue 与 React',
  '解释一下 SSE 流式原理',
  '上传一张图片描述它',
];

const store = useChatStore();
const { currentMessages, currentSession, hasHydrated } = storeToRefs(store);
const { regenerate } = useChat();

const handleRegenerate = (m: Message) => regenerate(m);

/** 推荐追问 chip 点击：触发全局事件，由 InputPanel 监听后真正发送 */
const handleSuggestionPick = (s: string) => {
  window.dispatchEvent(new CustomEvent('doubao:send-suggestion', { detail: s }));
};

// 拆分消息：已完成 + 流式中
const splitMessages = computed(() => {
  let streaming: Message | null = null;
  const done: Message[] = [];
  for (const m of currentMessages.value) {
    if (m.status === 'streaming') {
      streaming = m;
    } else {
      done.push(m);
    }
  }
  return { doneMessages: done, streamingMessage: streaming };
});

const doneMessages = computed(() => splitMessages.value.doneMessages);
const streamingMessage = computed(() => splitMessages.value.streamingMessage);

// 列表容器高度
const listRef = ref<HTMLDivElement | null>(null);
const listHeight = ref(0);
let ro: ResizeObserver | null = null;

onMounted(() => {
  const el = listRef.value;
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

// 滚到底触发器
const scrollToBottomKey = computed(
  () => `${hasHydrated.value}-${currentSession.value?.id}-${currentMessages.value.length}`,
);

const onCopy = (text: string) => {
  navigator.clipboard.writeText(text).then(() => antdMsg.success('已复制到剪贴板'));
};

// 复制下拉菜单（用窄类型 ItemType[] 避免 divider 与 menu item 类型冲突）
const dropdownItems = computed<NonNullable<MenuProps['items']>>(() => [
  {
    key: 'export',
    icon: CodeOutlined,
    label: '复制会话 JSON',
    onClick: () => {
      navigator.clipboard.writeText(JSON.stringify(currentMessages.value, null, 2));
      antdMsg.success('已复制');
    },
  },
  {
    key: 'copy-md',
    icon: CopyOutlined,
    label: '复制为 Markdown',
    onClick: () => {
      const md = currentMessages.value
        .map((m) => {
          const text = m.parts
            .map((p) => (p.type === 'markdown' || p.type === 'text' ? p.content : ''))
            .join('\n');
          return `### ${m.role}\n\n${text}`;
        })
        .join('\n\n---\n\n');
      navigator.clipboard.writeText(md);
      antdMsg.success('已复制');
    },
  },
  { type: 'divider' } as any,
  {
    key: 'clear',
    icon: DeleteOutlined,
    danger: true,
    label: '清空所有会话',
    onClick: () => {
      store.clearAll();
      antdMsg.success('已清空');
    },
  } as any,
]);
</script>

<template>
  <div class="layout">
    <Sidebar />
    <main class="main">
      <header class="main__header">
        <div class="main__title">{{ currentSession?.title || '豆包 AI' }}</div>
        <div class="main__actions">
          <Dropdown :menu="{ items: dropdownItems }">
            <Button type="text">
              <template #icon><MoreOutlined /></template>
            </Button>
          </Dropdown>
        </div>
      </header>

      <SkillBar />

      <div class="main__body" ref="listRef">
        <div
          v-if="!currentSession || (currentMessages.length === 0 && !streamingMessage)"
          class="main__inner"
        >
          <div class="welcome">
            <div class="welcome__hero">
              <div class="welcome__logo">豆</div>
              <h1>你好，我是豆包</h1>
              <p>{{ WELCOME }}</p>
            </div>
            <div class="welcome__suggestions">
              <Button
                v-for="s in SUGGESTIONS"
                :key="s"
                class="welcome__chip"
                @click="store.createSession(s)"
              >
                {{ s }}
              </Button>
            </div>
          </div>
        </div>

        <MessageVirtualList
          v-else
          :items="doneMessages"
          :streaming-item="streamingMessage"
          :get-key="(m: any) => m.id"
          :height="listHeight"
          :overscan="2"
          :scroll-to-bottom-key="scrollToBottomKey"
          follow-streaming
        >
          <template #item="{ item }">
            <MessageItem
              :message="item"
              :on-suggestion-pick="handleSuggestionPick"
              @copy="onCopy"
              @regenerate="handleRegenerate"
            />
          </template>
          <template #streaming="{ item }">
            <MessageItem
              :message="item"
              :on-suggestion-pick="handleSuggestionPick"
              @copy="onCopy"
              @regenerate="handleRegenerate"
            />
          </template>
        </MessageVirtualList>
      </div>

      <div class="main__footer">
        <InputPanel
          v-if="currentSession?.id"
          :key="currentSession.id"
        />
        <InputPanel v-else key="no-session" />
      </div>
    </main>
  </div>
</template>
