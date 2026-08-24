<script setup lang="ts">
/**
 * 主对话区（Vue 版）
 * - 顶部 Header（标题 / Skill 切换器 / 操作菜单）
 * - 消息列表（**虚拟列表**：离屏 DOM 释放）
 * - 输入区
 * - 历史会话进入：watch + nextTick 同步 scrollTo
 *
 * 客服会话集成（与 React 端 ChatWindow.tsx 对齐）：
 *   - 客服会话中（clientSession.status === 'inSession'）→ 用 clientSession.messages（来自 WS）
 *   - 其他状态 → 用 chatStore 的 aiMessages（来自 SSE / localStorage）
 *   - 顶部 header 切到"客服对话中" + 客服名
 *   - WelcomePanel 只在没有会话 + 客服未连接时显示
 */

import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { Button, Dropdown, message as antdMsg } from 'ant-design-vue';
import {
  DeleteOutlined,
  MoreOutlined,
  CodeOutlined,
  CopyOutlined,
  CustomerServiceOutlined,
} from '@ant-design/icons-vue';
import { storeToRefs } from 'pinia';
import { useChatStore } from '@/stores/chatStore';
import { useChat } from '@/composables/useChat';
import { useAgentStore } from '@/stores/agentStore';
import MessageItem from '@/components/MessageItem/MessageItem.vue';
import InputPanel from '@/components/InputPanel/InputPanel.vue';
import Sidebar from '@/components/Sidebar/Sidebar.vue';
import MessageVirtualList from '@/components/MessageVirtualList/MessageVirtualList.vue';
import SkillBar from '@/components/SkillBar/SkillBar.vue';
import type { MenuProps } from 'ant-design-vue';
import type { Message } from '@/types/message';
import { sortMessagesByServerTime } from '@/utils/messageSort';

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

// ===== 客服会话状态（与 React 端 ChatWindow 对齐）=====
const agentStore = useAgentStore();
const { clientSession } = storeToRefs(agentStore);

/**
 * 消息数据源统一：
 *   - 客服会话中（inSession）→ 用 clientSession.messages（来自 WS）
 *   - 排队中（queued）也用 clientSession.messages（保持 UI 稳定）
 *   - 其他状态 → 用 chatStore 的 currentMessages（来自 SSE / localStorage）
 *
 * 这样切换不丢消息，且客服消息（含 role='agent'）能复用 MessageItem 渲染
 */
const isAgentMode = computed(
  () => clientSession.value.status === 'inSession' || clientSession.value.status === 'queued',
);
const messages = computed<readonly Message[]>(() =>
  isAgentMode.value ? (clientSession.value.messages) : currentMessages.value,
);

/**
 * 排序：按 createdAt 升序（同 createdAt 时按 id 字典序）
 * 为什么需要：
 *   - 客户端时区变更 / 时钟漂移会让本地 createdAt 顺序错位
 *   - WS 批量转发多条消息时 createdAt 可能乱序
 *   - 断网重连增量同步边界处的消息需稳定排序
 * 不修改入参数组 / 不修改 message 引用，下游 computed 能复用
 */
const sortedMessages = computed<readonly Message[]>(() =>
  sortMessagesByServerTime(messages.value),
);

const handleRegenerate = (m: Message) => regenerate(m);

/** 推荐追问 chip 点击：触发全局事件，由 InputPanel 监听后真正发送 */
const handleSuggestionPick = (s: string) => {
  window.dispatchEvent(new CustomEvent('doubao:send-suggestion', { detail: s }));
};

// 拆分消息：已完成 + 流式中
// 流式中消息（status === 'streaming'）固定在虚拟列表外，避免影响 offset 累加
// 入参用 sortedMessages（已按 createdAt 排序）保证 doneMessages 渲染顺序稳定
const splitMessages = computed(() => {
  let streaming: Message | null = null;
  const done: Message[] = [];
  for (const m of sortedMessages.value) {
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

/**
 * 拿 MessageVirtualList 实例
 * 内部 useVirtualList 维护了 `userScrolledUpRef`（基于 50px threshold 判定），
 * 我们通过 defineExpose 拿到这个 ref，让 ChatWindow 也能感知滚动状态。
 *
 * 用 ref 而不是监听 main__body 的 scroll——因为 main__body 是 overflow:hidden，
 * 真正的滚动元素是 MessageVirtualList 内部的 scroller（overflowY:auto）。
 *
 * 不能用 `InstanceType<typeof MessageVirtualList>`——MessageVirtualList 是
 * `<script setup generic="T">`，generic 组件没有具体实例类型（TS 编译时 T 还没绑定）。
 * 用 `any` 配合 defineExpose 注释的字段名。
 *
 * 【重要】跨组件边界时 Vue 3 会自动 unwrap 一次 ref——`messageListRef.value.userScrolledUp`
 * 已经是 boolean，不是 Ref<boolean>。不要在 .userScrolledUp 后面再写 .value，
 * 否则 `true.value === undefined` → ?? false → 永远 false。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const messageListRef = ref<any>(null);
const userScrolledUp = computed<boolean>(
  () => messageListRef.value?.userScrolledUp ?? false,
);

// 滚到底触发器
// 跟踪 messages（含客服模式）+ session 切换 + hydration 完成
const scrollToBottomKey = computed(
  () => `${hasHydrated.value}-${currentSession.value?.id}-${messages.value.length}-${isAgentMode.value}`,
);

const onCopy = (text: string) => {
  navigator.clipboard.writeText(text).then(() => antdMsg.success('已复制到剪贴板'));
};

/**
 * 移动端：检测用户是否向上滚动了消息列表（最后一条不在视口里）
 *
 * 由 MessageVirtualList 内部 useVirtualList 维护 userScrolledUpRef（基于 50px 阈值）。
 * 这里不再自己实现——main__body 是 overflow:hidden 不滚动，真正的滚动在
 * MessageVirtualList 内部的 scroller 上（overflowY:auto）。
 */
// （删除旧的 ref + onListScroll + watch；改用 messageListRef.value.userScrolledUp）

/**
 * 移动端：检测虚拟键盘是否弹起
 *
 * 用 focusin / focusout 而不是 visualViewport.resize——后者在 Android 上
 * 也会因地址栏显隐触发，产生误判。focusin 只在 input 真正获焦时触发，
 * 与 iOS/Android 弹键盘的时序强相关。
 */
const keyboardActive = ref(false);
function onFocusIn(e: FocusEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) {
    keyboardActive.value = true;
  }
}
function onFocusOut(e: FocusEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) {
    // 延时清：Android 切换 input 时，focusout 紧接着 focusin 触发，避免中间闪烁
    setTimeout(() => {
      // 二次校验：当前活动元素仍然是 input 才置 false
      const ae = document.activeElement as HTMLElement | null;
      if (
        !ae ||
        !(ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' || ae.isContentEditable)
      ) {
        keyboardActive.value = false;
      }
    }, 0);
  }
}

onMounted(() => {
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
});
onUnmounted(() => {
  document.removeEventListener('focusin', onFocusIn);
  document.removeEventListener('focusout', onFocusOut);
});

/**
 * 移动端 + 最后一条不在底部 + 键盘弹起 = 让键盘"覆盖"输入框，不挤压聊天区
 *
 * iOS Safari 默认行为：input 获焦时会把 input 滚到视口内，
 * 表现为 main__body 被压缩、用户当前看到的消息位置被推上去。
 * 用户向上滚的目的本来就是看历史消息，应该让键盘直接覆盖在 input 上方，
 * 不动 main__body 的 scrollTop。
 */
const keepChatOnKeyboard = computed(
  () => userScrolledUp.value && keyboardActive.value,
);

// 复制下拉菜单（用窄类型 ItemType[] 避免 divider 与 menu item 类型冲突）
const dropdownItems = computed<NonNullable<MenuProps['items']>>(() => [
  {
    key: 'export',
    icon: CodeOutlined,
    label: '复制会话 JSON',
    onClick: () => {
      navigator.clipboard.writeText(JSON.stringify(messages.value, null, 2));
      antdMsg.success('已复制');
    },
  },
  {
    key: 'copy-md',
    icon: CopyOutlined,
    label: '复制为 Markdown',
    onClick: () => {
      const md = messages.value
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
      // 客服会话进行中不允许清空
      if (isAgentMode.value) {
        antdMsg.warning('客服对话进行中，无法清空');
        return;
      }
      store.clearAll();
      antdMsg.success('已清空');
    },
  } as any,
]);

/**
 * 顶部 title 文案（与 React 端 ChatWindow 对齐）：
 *   - 客服会话中 → 客服对话中 + 客服名
 *   - 排队中 → 正在为您接入客服…
 *   - 其他 → 当前会话标题或豆包 AI
 */
const headerTitle = computed(() => {
  if (clientSession.value?.status === 'inSession') {
    return {
      main: '客服对话中',
      sub: clientSession.value.agentName || '',
    };
  }
  if (clientSession.value?.status === 'queued') {
    return { main: '正在为您接入客服…', sub: '' };
  }
  return { main: currentSession.value?.title || '豆包 AI', sub: '' };
});
</script>

<template>
  <div class="layout" :class="{ 'layout--keyboard-keep': keepChatOnKeyboard }">
    <Sidebar />
    <main class="main">
      <header class="main__header">
        <div class="main__title">
          <CustomerServiceOutlined
            v-if="clientSession?.status === 'inSession'"
            style="margin-right: 8px; color: #00b894"
          />
          {{ headerTitle.main }}
          <span v-if="headerTitle.sub" class="main__title-sub">{{ headerTitle.sub }}</span>
        </div>
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
        <!--
          客服会话 / 排队中：不显示 WelcomePanel（即使 clientSession.messages 为空）。
          排队中时让用户看到排队卡片输入区而不是空状态欢迎页。
        -->
        <div
          v-if="(!currentSession && !isAgentMode) || (messages.length === 0 && !streamingMessage && !isAgentMode)"
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
          ref="messageListRef"
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
        <!--
          关键：客服会话中（inSession/queued/ended）也必须渲染 InputPanel，
          它的内部 v-if 分支会按 clientSession.status 切换到排队卡片 / 客服对话输入 / 已结束提示。
          InputPanel 内会自己连接 WS（mount 时），不需要 ChatWindow 介入。
        -->
        <InputPanel />
      </div>
    </main>
  </div>
</template>
