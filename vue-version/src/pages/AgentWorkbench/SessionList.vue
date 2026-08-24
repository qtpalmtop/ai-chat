/**
 * 客服工作台 - 左侧会话列表（Vue 版 - 对齐 React 端 SessionList.tsx）
 *
 * 三个区：
 *   1. 待接单（pendingQueue）
 *   2. 进行中（activeSessions）
 *   3. 历史会话（historySessions，session_ended 后转存）
 */

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Avatar, Badge, Button, Empty, Space, Tag, Tooltip } from 'ant-design-vue';
import {
  UserOutlined,
  HourglassOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  HistoryOutlined,
  MessageOutlined,
  WarningFilled,
} from '@ant-design/icons-vue';
import type { AgentSession, HistorySessionItem, PendingQueueItem } from '@/types/agent';

const REASON_LABEL: Record<string, { color: string; text: string }> = {
  normal: { color: 'blue', text: '普通' },
  vip: { color: 'gold', text: 'VIP' },
  after_hours: { color: 'orange', text: '非工作时段' },
  all_busy: { color: 'red', text: '繁忙' },
};

const END_REASON_LABEL: Record<string, { color: string; text: string }> = {
  user: { color: 'default', text: '用户结束' },
  agent: { color: 'default', text: '客服结束' },
  timeout: { color: 'orange', text: '超时结束' },
  error: { color: 'red', text: '异常结束' },
};

function timeAgo(ts: number, now: number): string {
  const s = Math.floor((now - ts) / 1000);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
}

/**
 * 排队超过 30s 进入"警告"状态：橙红边框 + 警告图标
 * 提示客服这位用户等得较久，建议优先接单
 */
const QUEUE_WARN_MS = 30_000;
function isOverdue(queuedAt: number, now: number): boolean {
  return now - queuedAt > QUEUE_WARN_MS;
}

const props = defineProps<{
  activeSessionId: string | null;
  onAcceptQueue: (id: string) => void;
  onSelectSession: (id: string) => void;
  activeSessions: Record<string, AgentSession>;
  /**
   * 用户信息缓存：key = clientId。在 queue_assigned 时已写入 userName/userAvatar，
   * 用它替换"用户 xxxx/?"显示为真实用户名/头像。
   */
  userInfoByClient?: Record<string, { userName?: string; userAvatar?: string }>;
  pendingQueue: PendingQueueItem[];
  /** 历史会话列表（按 endedAt 倒序） */
  historySessions?: HistorySessionItem[];
  /** 当前选中的历史会话 id */
  selectedHistorySessionId?: string | null;
  /** 点击历史会话项 */
  onSelectHistory?: (id: string) => void;
  /** 刷新历史列表 */
  onRefreshHistory?: () => void;
  presence: { onlineAgents: number; queueLength: number };
  isConnected: boolean;
}>();

// 每秒刷一次"现在"，让"X 秒前"按秒跳；卸载时清 timer
const now = ref(Date.now());
let timer: number | null = null;
onMounted(() => {
  timer = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
});

const activeList = computed(() =>
  Object.values(props.activeSessions).filter((s) => s.status === 'inSession'),
);

function lastPreviewOf(sess: AgentSession): string {
  const lastMsg = sess.messages[sess.messages.length - 1];
  if (!lastMsg) return '（暂无消息）';
  return lastMsg.parts
    .filter((p) => p.type === 'text' || p.type === 'markdown')
    .map((p) => p.content)
    .join(' ')
    .slice(0, 40);
}
</script>

<template>
  <aside class="agent-sidebar">
    <div class="agent-sidebar__head">
      <div class="agent-sidebar__title">客服工作台</div>
      <div class="agent-sidebar__presence">
        <Badge :status="isConnected ? 'success' : 'default'">
          <span class="agent-sidebar__presence-text">
            {{ presence.onlineAgents }} 客服在线 · {{ presence.queueLength }} 人排队
          </span>
        </Badge>
      </div>
    </div>

    <!-- 待接单区 -->
    <div class="agent-sidebar__section">
      <div class="agent-sidebar__section-title">
        <HourglassOutlined /> 待接单
        <span class="agent-sidebar__count">{{ pendingQueue.length }}</span>
      </div>
      <Empty
        v-if="pendingQueue.length === 0"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
        description="暂无排队"
        class="agent-sidebar__empty"
      />
      <div v-else class="agent-sidebar__list">
        <div
          v-for="item in pendingQueue"
          :key="item.clientId"
          :class="['agent-sidebar__item', { 'is-overdue': isOverdue(item.queuedAt, now) }]"
        >
          <div class="agent-sidebar__item-row">
            <Avatar size="small">
              <template #icon><UserOutlined /></template>
            </Avatar>
            <span class="agent-sidebar__item-name">
              {{ item.userName || `用户${item.clientId.slice(-4)}` }}
            </span>
            <Tag
              :color="(REASON_LABEL[item.reason] || REASON_LABEL.normal).color"
              class="agent-sidebar__item-tag"
            >
              {{ (REASON_LABEL[item.reason] || REASON_LABEL.normal).text }}
            </Tag>
            <Tag
              v-if="isOverdue(item.queuedAt, now)"
              color="error"
              class="agent-sidebar__item-tag"
            >
              <template #icon><WarningFilled /></template>
              超时
            </Tag>
          </div>
          <div
            v-if="item.lastUserMessage"
            class="agent-sidebar__item-msg"
            :title="item.lastUserMessage"
          >
            {{ item.lastUserMessage }}
          </div>
          <div class="agent-sidebar__item-row agent-sidebar__item-meta">
            <WarningFilled
              v-if="isOverdue(item.queuedAt, now)"
              style="color: #ff4d4f"
            />
            <ClockCircleOutlined v-else />
            <span :style="isOverdue(item.queuedAt, now) ? { color: '#ff4d4f', fontWeight: 500 } : undefined">
              {{ timeAgo(item.queuedAt, now) }}
            </span>
            <div style="flex: 1"></div>
            <Button
              type="primary"
              size="small"
              :disabled="!isConnected"
              @click="onAcceptQueue(item.clientId)"
            >
              接单
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- 进行中区 -->
    <div class="agent-sidebar__section">
      <div class="agent-sidebar__section-title">
        <CheckCircleOutlined /> 进行中
        <span class="agent-sidebar__count">{{ activeList.length }}</span>
      </div>
      <Empty
        v-if="activeList.length === 0"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
        description="暂无会话"
        class="agent-sidebar__empty"
      />
      <div v-else class="agent-sidebar__list">
        <Tooltip
          v-for="sess in activeList"
          :key="sess.sessionId"
          :title="lastPreviewOf(sess)"
          placement="right"
        >
          <div
            :class="[
              'agent-sidebar__item',
              'agent-sidebar__item--active',
              { 'is-active': sess.sessionId === activeSessionId },
            ]"
            @click="sess.sessionId && onSelectSession(sess.sessionId)"
          >
            <div class="agent-sidebar__item-row">
              <Avatar size="small" :src="userInfoByClient?.[sess.clientId || '']?.userAvatar">
                <template #icon>
                  <UserOutlined v-if="!userInfoByClient?.[sess.clientId || '']?.userAvatar" />
                </template>
              </Avatar>
              <span class="agent-sidebar__item-name">
                {{ userInfoByClient?.[sess.clientId || '']?.userName || `用户 ${sess.clientId?.slice(-4) || '?'}` }}
              </span>
            </div>
            <div class="agent-sidebar__item-msg">{{ lastPreviewOf(sess) }}</div>
            <div class="agent-sidebar__item-row agent-sidebar__item-meta">
              <Space :size="4">
                <Tag color="cyan" style="margin: 0">{{ sess.messages.length }} 条</Tag>
                <span v-if="sess.startedAt" style="color: #8c8c8c">
                  {{ timeAgo(sess.startedAt, now) }}
                </span>
              </Space>
            </div>
          </div>
        </Tooltip>
      </div>
    </div>

    <!-- 历史会话区 -->
    <div class="agent-sidebar__section">
      <div class="agent-sidebar__section-title">
        <HistoryOutlined /> 历史会话
        <span class="agent-sidebar__count">{{ historySessions?.length || 0 }}</span>
        <div style="flex: 1"></div>
        <Button
          type="text"
          size="small"
          title="刷新历史会话"
          :disabled="!isConnected"
          @click="onRefreshHistory?.()"
        >
          <HistoryOutlined />
        </Button>
      </div>
      <Empty
        v-if="!historySessions || historySessions.length === 0"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
        description="暂无历史会话"
        class="agent-sidebar__empty"
      />
      <div v-else class="agent-sidebar__list">
        <Tooltip
          v-for="item in historySessions"
          :key="item.sessionId"
          :title="item.lastUserMessage || item.lastAgentMessage || '（无消息）'"
          placement="right"
        >
          <div
            :class="[
              'agent-sidebar__item',
              'agent-sidebar__item--history',
              { 'is-active': item.sessionId === selectedHistorySessionId },
            ]"
            @click="onSelectHistory?.(item.sessionId)"
          >
            <div class="agent-sidebar__item-row">
              <Avatar size="small">
                <template #icon><UserOutlined /></template>
              </Avatar>
              <span class="agent-sidebar__item-name">
                {{ item.userName || `用户 ${item.clientId?.slice(-4) || '?'}` }}
              </span>
              <Tag
                :color="(END_REASON_LABEL[item.endReason] || END_REASON_LABEL.user).color"
                class="agent-sidebar__item-tag"
              >
                {{ (END_REASON_LABEL[item.endReason] || END_REASON_LABEL.user).text }}
              </Tag>
            </div>
            <div class="agent-sidebar__item-msg">
              {{ item.lastUserMessage || item.lastAgentMessage || '（无消息）' }}
            </div>
            <div class="agent-sidebar__item-row agent-sidebar__item-meta">
              <Space :size="4">
                <Tag color="default" style="margin: 0">
                  <MessageOutlined /> {{ item.messageCount }}
                </Tag>
                <span style="color: #8c8c8c">{{ timeAgo(item.endedAt, now) }}</span>
              </Space>
            </div>
          </div>
        </Tooltip>
      </div>
    </div>
  </aside>
</template>
