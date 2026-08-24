/**
 * 客服工作台 - 顶层页面（Vue 版 - 对齐 React 端 AgentWorkbench.tsx）
 *
 * 三栏布局：左侧会话列表 + 中间聊天区 + 右侧推荐工具栏
 *
 * 状态来源：
 *   - workbench.activeSessions：来自 server.queue_assigned + 后续 message 事件
 *   - workbench.pendingQueue：来自 server.queue_update
 *   - workbench.suggestions[sessionId]：来自 server.suggestion_chunk 流式推送
 *   - historySessions：来自 server.history_list（连接时全量推 + endSession 时增量推）
 *
 * 切换逻辑：
 *   - 选中活跃会话 → 显示 MessageArea
 *   - 选中历史会话 → 显示 HistoryView（只读）
 */

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { App, Button, Space, Tag, Tooltip, Modal } from 'ant-design-vue';
import {
  ReloadOutlined,
  LogoutOutlined,
  BellOutlined,
  UserOutlined,
} from '@ant-design/icons-vue';
import { storeToRefs } from 'pinia';
import { useAgentStore } from '@/stores/agentStore';
import { useAgentSocket } from '@/composables/useAgentSocket';
import SessionList from './SessionList.vue';
import MessageArea from './MessageArea.vue';
import HistoryView from './HistoryView.vue';
import SuggestionPanel from './SuggestionPanel.vue';
import type { AgentSuggestion } from '@/types/agent';
import type { MessagePart } from '@/types/message';

const { message: antdMessage } = App.useApp();
const store = useAgentStore();
const {
  activeList,
  presence,
  workbench,
  isOpen,
  connection,
  historySessions,
  historySessionDetails,
  loadingHistorySessionId,
  selectedHistorySessionId,
} = storeToRefs(store);

const { connect, send } = useAgentSocket({ mode: 'agent' });

const activeSessionId = ref<string | null>(null);

// 默认选最新活跃会话（如果当前在看历史会话，不抢焦点）
watch(
  [activeList, selectedHistorySessionId],
  ([list, historyId]) => {
    if (historyId) return; // 当前在看历史，让历史区保持选中
    if (activeSessionId.value && list.some((s) => s.sessionId === activeSessionId.value)) return;
    activeSessionId.value = list[0]?.sessionId || null;
  },
  { immediate: true },
);

const activeSession = computed(() => {
  const id = activeSessionId.value;
  return id ? workbench.value.activeSessions[id] || null : null;
});

// 当前选中的历史会话：优先用缓存的详情（如果已 fetch 完），否则回退到摘要
const selectedHistoryDetail = computed(() =>
  selectedHistorySessionId.value
    ? historySessionDetails.value[selectedHistorySessionId.value] || null
    : null,
);
const selectedHistoryItem = computed(() =>
  selectedHistorySessionId.value
    ? historySessions.value.find((h) => h.sessionId === selectedHistorySessionId.value) || null
    : null,
);

const autoTrigger = ref(true);
const lastTriggeredMsgId = ref<string | null>(null);

// 智能推荐自动触发：用户新消息时
watch(
  () => activeSession.value?.messages,
  (msgs) => {
    if (!autoTrigger.value || !activeSession.value || !isOpen.value || !msgs) return;
    const lastUserMsg = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;
    if (lastUserMsg.id === lastTriggeredMsgId.value) return;
    lastTriggeredMsgId.value = lastUserMsg.id;
    fetchSuggestions();
  },
  { deep: true },
);

function fetchSuggestions() {
  if (!activeSession.value?.sessionId) return;
  send({ type: 'agent.fetch_suggestions', sessionId: activeSession.value.sessionId });
}

function fetchHistory() {
  if (!isOpen.value) return;
  send({ type: 'agent.fetch_history' });
}

function loadHistorySession(sessionId: string) {
  store.setLoadingHistory(sessionId);
  send({ type: 'agent.fetch_history_session', sessionId });
}

function onAcceptQueue(clientId: string) {
  send({ type: 'agent.accept_queue', clientId });
  antdMessage.info('正在接单…');
}

function onEndSession(sessionId: string) {
  Modal.confirm({
    title: '结束当前会话？',
    content: '结束后用户端会收到结束通知，且无法再发送消息。',
    okText: '结束',
    okButtonProps: { danger: true },
    cancelText: '取消',
    onOk: () => {
      send({ type: 'agent.end_session', sessionId });
      store.endSession(sessionId);
      antdMessage.success('已结束会话');
    },
  });
}

function onUseSuggestion(s: AgentSuggestion) {
  if (!activeSessionId.value) return;
  if (s.applied) return;
  send({ type: 'agent.use_suggestion', sessionId: activeSessionId.value, suggestionId: s.id });
  // 关键：服务端不会回 message 事件给客服端自己，必须在 store 乐观追加
  // 让 UI 立刻显示这条客服消息（handleSystemEvent 已加按 id 去重）
  store.sendAgentMessage(activeSessionId.value, s.parts);
  store.markSuggestionApplied(activeSessionId.value, s.id);
  antdMessage.success('已发送推荐话术');
}

// 接收 InputPanel 的发送事件（agent 端独立输入面板）
function onSendMessage(e: Event) {
  const detail = (e as CustomEvent).detail as {
    sessionId: string | null;
    trimmed: string;
    attachments: Array<{ kind: 'image' | 'file'; url: string; name: string; size: number; mime?: string }>;
  };
  if (!detail.sessionId) return;
  const parts: MessagePart[] = [];
  if (detail.trimmed) {
    parts.push({
      type: detail.trimmed.includes('\n') ? 'markdown' : 'text',
      content: detail.trimmed,
    });
  }
  for (const a of detail.attachments) {
    if (a.kind === 'image') {
      parts.push({ type: 'image', url: a.url, alt: a.name });
    } else {
      parts.push({ type: 'file', name: a.name, size: a.size, url: a.url, mime: a.mime });
    }
  }
  // 关键：服务端不会回 message 事件给客服端自己（只回 message_ack），
  // 必须在 store 乐观追加，让 UI 立刻显示这条客服消息
  store.sendAgentMessage(detail.sessionId, parts);
  send({ type: 'agent.send', sessionId: detail.sessionId, parts });
}

function onSelectSession(sid: string) {
  activeSessionId.value = sid;
  store.selectHistorySession(null);
}

function onSelectHistory(sessionId: string) {
  activeSessionId.value = null;
  store.selectHistorySession(sessionId);
  loadHistorySession(sessionId);
}

function onBackToActive() {
  store.selectHistorySession(null);
  if (activeList.value.length > 0) {
    activeSessionId.value = activeList.value[0]?.sessionId || null;
  }
}

const currentStreamingIntent = computed(() =>
  activeSessionId.value ? workbench.value.streamingIntent[activeSessionId.value] : null,
);
const isStreaming = computed(() => !!currentStreamingIntent.value);
const streamingCategory = computed(() => currentStreamingIntent.value?.category || null);

onMounted(() => {
  connect();
  window.addEventListener('agent:send-message', onSendMessage as EventListener);
});

onUnmounted(() => {
  window.removeEventListener('agent:send-message', onSendMessage as EventListener);
});

function onExit() {
  Modal.confirm({
    title: '退出客服工作台？',
    content: '退出后会断开 WebSocket 连接，正在进行的会话会保持在服务端。',
    okText: '退出',
    cancelText: '取消',
    onOk: () => {
      window.location.href = '/';
    },
  });
}
</script>

<template>
  <div class="agent-workbench">
    <header class="agent-workbench__topbar">
      <div class="agent-workbench__brand">
        <span class="agent-workbench__logo">客</span>
        <span class="agent-workbench__brand-text">智能客服工作台</span>
        <Tag :color="isOpen ? 'success' : 'default'" style="margin-left: 8px">
          {{ isOpen ? '已连接' : connection === 'reconnecting' ? '重连中…' : '未连接' }}
        </Tag>
      </div>
      <div class="agent-workbench__stats">
        <Space :size="20">
          <Tooltip title="在线客服数">
            <span><UserOutlined /> {{ presence.onlineAgents }} 在线</span>
          </Tooltip>
          <Tooltip title="排队总人数">
            <span><BellOutlined /> {{ presence.queueLength }} 排队</span>
          </Tooltip>
          <Tooltip title="当前接待中">
            <span>
              <span style="color: #4d6bfe; font-weight: 600">{{ activeList.length }}</span> 进行中
            </span>
          </Tooltip>
        </Space>
      </div>
      <div class="agent-workbench__actions">
        <Button :disabled="!activeSession" @click="fetchSuggestions">
          <template #icon><ReloadOutlined /></template>
          刷新推荐
        </Button>
        <Button @click="onExit">
          <template #icon><LogoutOutlined /></template>
          退出
        </Button>
      </div>
    </header>

    <div class="agent-workbench__layout">
      <SessionList
        :active-session-id="activeSessionId"
        :on-accept-queue="onAcceptQueue"
        :on-select-session="onSelectSession"
        :active-sessions="workbench.activeSessions"
        :user-info-by-client="workbench.userInfoByClient"
        :pending-queue="workbench.pendingQueue"
        :history-sessions="historySessions"
        :selected-history-session-id="selectedHistorySessionId"
        :on-select-history="onSelectHistory"
        :on-refresh-history="fetchHistory"
        :presence="presence"
        :is-connected="isOpen"
      />

      <HistoryView
        v-if="selectedHistorySessionId"
        :item="selectedHistoryItem"
        :detail="selectedHistoryDetail"
        :loading="loadingHistorySessionId === selectedHistorySessionId"
        :on-back="onBackToActive"
      />
      <MessageArea
        v-else-if="activeSession"
        :session="activeSession"
        :on-end-session="onEndSession"
      />
      <div v-else class="agent-chat agent-chat--empty">
        <div class="agent-chat__empty-pick">
          <h2>请选择或接单一个会话</h2>
          <p style="color: #8c8c8c">
            {{
              workbench.pendingQueue.length > 0
                ? `左侧有 ${workbench.pendingQueue.length} 位用户等待接单`
                : '当前没有待接单用户，可以等待或刷新'
            }}
          </p>
          <Button
            type="primary"
            size="large"
            :disabled="activeList.length === 0"
            @click="onBackToActive"
          >
            切换到最近会话
          </Button>
        </div>
      </div>

      <SuggestionPanel
        v-if="activeSession && !selectedHistorySessionId"
        :session-id="activeSession.sessionId!"
        :messages="(activeSession.messages as any)"
        :is-streaming="isStreaming"
        :streaming-category="streamingCategory"
        :on-refresh="fetchSuggestions"
        :on-use-suggestion="onUseSuggestion"
        :auto-trigger="autoTrigger"
        :on-auto-trigger-change="(v: any) => (autoTrigger = !!v)"
      />
      <aside v-else class="agent-tools agent-tools--empty">
        <div class="agent-tools__empty">
          <h3>{{ selectedHistorySessionId ? '历史会话只读' : '暂无会话' }}</h3>
          <p style="color: #8c8c8c">
            {{
              selectedHistorySessionId
                ? '已结束会话仅供查看'
                : '选择会话后将显示智能推荐'
            }}
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>
