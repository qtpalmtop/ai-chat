/**
 * 客服工作台 - 中间聊天区（Vue 版 - 对齐 React 端 MessageArea.tsx）
 */

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { App, Avatar, Button, Empty, Space, Tag } from 'ant-design-vue';
import {
  UserOutlined,
  ClockCircleOutlined,
  PoweroffOutlined,
  CheckCircleFilled,
} from '@ant-design/icons-vue';
import MessageItem from '@/components/MessageItem/MessageItem.vue';
import MessageVirtualList from '@/components/MessageVirtualList/MessageVirtualList.vue';
import AgentInputPanel from './AgentInputPanel.vue';
import { useAgentStore } from '@/stores/agentStore';
import type { Message } from '@/types/message';
import type { AgentSession } from '@/types/agent';

const props = defineProps<{
  session: AgentSession;
  onEndSession: (s: string) => void;
}>();

const { message: antdMessage } = App.useApp();
const store = useAgentStore();

const listRef = ref<HTMLDivElement | null>(null);
const listHeight = ref(0);
let ro: ResizeObserver | null = null;
const tick = ref(0);
let tickTimer: number | null = null;

// 从 store 读 userInfoByClient 缓存（queue_assigned 时已写入 userName/userAvatar）
const cached = computed(() => {
  const cid = props.session.clientId;
  return cid ? store.workbench.userInfoByClient[cid] : undefined;
});
const displayName = computed(
  () => cached.value?.userName || `用户 ${props.session.clientId?.slice(-6) || '未知'}`,
);
const displayAvatar = computed(() => cached.value?.userAvatar);

onMounted(() => {
  const el = listRef.value;
  if (!el) return;
  listHeight.value = el.clientHeight;
  ro = new ResizeObserver(() => {
    listHeight.value = el.clientHeight;
  });
  ro.observe(el);
  tickTimer = window.setInterval(() => (tick.value = tick.value + 1), 30000);
});

onUnmounted(() => {
  ro?.disconnect();
  if (tickTimer) clearInterval(tickTimer);
});

// 关键：从 store 直接读 messages（响应式会追踪到 reactive 数组的 push），
// 不能从 props.session.messages 读——因为父组件 activeSession computed 只追踪
// 到 activeSessions[id] 这个对象引用，push 新消息时对象引用不变，子组件 computed 不重算，
// 表现为"客服端用户发了消息后，会话框没有展示聊天内容"。
const messages = computed<readonly Message[]>(() => {
  const sid = props.session.sessionId;
  if (!sid) return [];
  // 同时兜底：优先用 store 的最新引用，否则回退到 props（兼容初次渲染）
  return store.workbench.activeSessions[sid]?.messages ?? props.session.messages ?? [];
});

function formatDuration(startedAt: number | null | undefined): string {
  if (!startedAt) return '00:00';
  void tick.value; // 让 tick 变化触发重算（依赖"现在"）
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function onCopy(text: string) {
  navigator.clipboard.writeText(text).then(() => antdMessage.success('已复制'));
}

function onEnd() {
  if (!props.session.sessionId) return;
  props.onEndSession(props.session.sessionId);
}

const noop = () => {};

const lastUserMsg = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'user') return messages.value[i];
  }
  return null;
});

const lastUserMsgPreview = computed(() => {
  const m = lastUserMsg.value;
  if (!m) return '';
  return m.parts
    .filter((p) => p.type === 'text' || p.type === 'markdown')
    .map((p) => p.content)
    .join(' ')
    .slice(0, 20);
});

const lastUserMsgTitle = computed(() => {
  const m = lastUserMsg.value;
  if (!m) return '';
  return m.parts.map((p) => ('content' in p ? p.content : '')).join(' ');
});

const scrollToBottomKey = computed(
  () => `${props.session.sessionId}-${messages.value.length}`,
);

function scrollToBottom() {
  nextTick(() => {
    const el = listRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch(scrollToBottomKey, scrollToBottom);
watch(() => messages.value.length, scrollToBottom);
</script>

<template>
  <section class="agent-chat">
    <header class="agent-chat__head">
      <div class="agent-chat__head-left">
        <Avatar :size="40" :src="displayAvatar" class="agent-chat__user-avatar">
          <template #icon>
            <UserOutlined v-if="!displayAvatar" />
          </template>
        </Avatar>
        <div>
          <div class="agent-chat__user-name">
            {{ displayName }}
            <Tag color="cyan" style="margin-left: 8px">进行中</Tag>
          </div>
          <div class="agent-chat__user-meta">
            <Space :size="12">
              <span>
                <ClockCircleOutlined />
                {{ formatDuration(session.startedAt) }}
              </span>
              <span>{{ messages.length }} 条消息</span>
              <span
                v-if="lastUserMsg"
                :title="lastUserMsgTitle"
              >
                最近：{{ lastUserMsgPreview }}
              </span>
            </Space>
          </div>
        </div>
      </div>
      <div class="agent-chat__head-right">
        <Button
          type="primary"
          danger
          :disabled="!session.sessionId"
          @click="onEnd"
        >
          <!--
            ant-design-vue@7 图标是函数式组件，必须用 #icon slot 语法
            否则函数体会被直接渲染到页面上（出现 "function PoweroffOutlined3(props, context) { va..."）
          -->
          <template #icon><PoweroffOutlined /></template>
          结束会话
        </Button>
      </div>
    </header>

    <div ref="listRef" class="agent-chat__body">
      <div v-if="messages.length === 0" class="agent-chat__empty">
        <Empty>
          <template #description>
            <span style="color: #8c8c8c">
              等待用户发送消息…
              <div style="font-size: 12px; margin-top: 8px">
                <CheckCircleFilled style="color: #52c41a" />
                已建立端到端加密连接
              </div>
            </span>
          </template>
        </Empty>
      </div>
      <MessageVirtualList
        v-else
        :items="messages as Message[]"
        :streaming-item="null"
        :get-key="(m: Message) => m.id"
        :height="listHeight"
        :overscan="3"
        :scroll-to-bottom-key="scrollToBottomKey"
        :follow-streaming="false"
      >
        <template #item="{ item }">
          <MessageItem
            :message="item"
            :on-copy="onCopy"
            :on-suggestion-pick="noop"
            :on-regenerate="noop"
          />
        </template>
      </MessageVirtualList>
    </div>

    <div class="agent-chat__footer">
      <AgentInputPanel :session="session" :user-name="displayName" />
    </div>
  </section>
</template>
