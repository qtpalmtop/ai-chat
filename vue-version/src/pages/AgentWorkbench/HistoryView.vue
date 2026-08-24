/**
 * 客服工作台 - 历史会话详情查看（Vue 版 - 对齐 React 端 HistoryView）
 *
 * 顶部：用户信息 + 结束原因 + 时长 + 返回按钮
 * 主体：消息列表（复用 MessageVirtualList 渲染）
 * 底部：无输入框（已结束会话不能再发消息）
 */

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { App, Avatar, Button, Empty, Space, Tag } from 'ant-design-vue';
import { UserOutlined } from '@ant-design/icons-vue';
import MessageItem from '@/components/MessageItem/MessageItem.vue';
import MessageVirtualList from '@/components/MessageVirtualList/MessageVirtualList.vue';
import type { Message } from '@/types/message';
import type { HistorySessionItem, HistorySessionDetail } from '@/types/agent';

const END_REASON_LABEL: Record<string, { color: string; text: string }> = {
  user: { color: 'default', text: '用户结束' },
  agent: { color: 'default', text: '客服结束' },
  timeout: { color: 'orange', text: '30s 超时自动结束' },
  error: { color: 'red', text: '异常结束' },
};

function formatDuration(durationSec: number): string {
  if (durationSec < 60) return `${durationSec} 秒`;
  if (durationSec < 3600)
    return `${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`;
  return `${Math.floor(durationSec / 3600)} 小时 ${Math.floor((durationSec % 3600) / 60)} 分`;
}

const props = defineProps<{
  item: HistorySessionItem | null;
  detail: HistorySessionDetail | null;
  loading: boolean;
  onBack: () => void;
}>();

const { message: antdMessage } = App.useApp();
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

const messages = computed<readonly Message[]>(() => props.detail?.messages || []);

const duration = computed(() => {
  const d = props.detail;
  if (!d?.startedAt || !d?.endedAt) return 0;
  return Math.max(0, Math.floor((d.endedAt - d.startedAt) / 1000));
});

const scrollToBottomKey = computed(() => `h-${messages.value.length}`);

function scrollToBottom() {
  const el = listRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

const noop = () => {};
function onCopy(text: string) {
  navigator.clipboard.writeText(text).then(() => antdMessage.success('已复制'));
}

// 消息数量变化 → 滚到底（等下一帧 DOM 渲染完）
watch(scrollToBottomKey, () => {
  nextTick(scrollToBottom);
});

const endReason = computed(() => {
  const r = props.item?.endReason;
  return (r && END_REASON_LABEL[r]) || { color: 'default', text: '已结束' };
});
</script>

<template>
  <section class="agent-chat">
    <!-- 顶部 header -->
    <header class="agent-chat__head">
      <div class="agent-chat__head-left">
        <Avatar :size="40" class="agent-chat__user-avatar">
          <template #icon><UserOutlined /></template>
        </Avatar>
        <div>
          <div class="agent-chat__user-name">
            {{ item?.userName || `用户 ${item?.clientId?.slice(-6) || '未知'}` }}
            <Tag :color="endReason.color" style="margin-left: 8px">
              {{ endReason.text }}
            </Tag>
          </div>
          <div class="agent-chat__user-meta">
            <Space :size="12">
              <span>共 {{ detail?.messages.length ?? item?.messageCount ?? 0 }} 条消息</span>
              <span>会话时长：{{ formatDuration(duration) }}</span>
              <span v-if="item?.startedAt" style="color: #8c8c8c">
                {{ new Date(item.startedAt).toLocaleString('zh-CN') }}
              </span>
            </Space>
          </div>
        </div>
      </div>
      <div class="agent-chat__head-right">
        <Button @click="onBack()">返回活跃会话</Button>
      </div>
    </header>

    <!-- 主体消息列表 -->
    <div ref="listRef" class="agent-chat__body">
      <div v-if="loading && !detail" class="agent-chat__empty">
        <Empty description="加载历史消息中…" />
      </div>
      <div v-else-if="messages.length === 0" class="agent-chat__empty">
        <Empty description="该会话暂无消息" />
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

    <!-- 底部提示（无输入框） -->
    <div class="agent-chat__footer">
      <div
        style="
          padding: 16px;
          text-align: center;
          color: #8c8c8c;
          background: #fafafa;
          border-radius: 8px;
          font-size: 13px;
        "
      >
        🔒 该会话已结束（仅供查看，不能发送新消息）
      </div>
    </div>
  </section>
</template>
