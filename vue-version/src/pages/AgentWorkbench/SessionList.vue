/**
 * 客服工作台 - 左侧会话列表（Vue 版 - 对齐 React 端 SessionList.tsx）
 *
 * 三个区：
 *   1. 待接单（pendingQueue）
 *   2. 进行中（activeSessions）
 *   3. 历史会话（historySessions，session_ended 后转存）
 */

<script lang="ts">
import { defineComponent, h, onBeforeUnmount, onMounted, ref, type PropType } from 'vue';
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

export default defineComponent({
  name: 'SessionList',
  props: {
    activeSessionId: { type: String as PropType<string | null>, default: null },
    onAcceptQueue: { type: Function as PropType<(id: string) => void>, required: true },
    onSelectSession: { type: Function as PropType<(id: string) => void>, required: true },
    activeSessions: { type: Object as PropType<Record<string, AgentSession>>, required: true },
    pendingQueue: { type: Array as PropType<PendingQueueItem[]>, required: true },
    /** 历史会话列表（按 endedAt 倒序） */
    historySessions: {
      type: Array as PropType<HistorySessionItem[]>,
      default: () => [],
    },
    /** 当前选中的历史会话 id */
    selectedHistorySessionId: { type: String as PropType<string | null>, default: null },
    /** 点击历史会话项 */
    onSelectHistory: { type: Function as PropType<(id: string) => void>, default: null },
    /** 刷新历史列表 */
    onRefreshHistory: { type: Function as PropType<() => void>, default: null },
    presence: {
      type: Object as PropType<{ onlineAgents: number; queueLength: number }>,
      required: true,
    },
    isConnected: { type: Boolean, required: true },
  },
  setup(props) {
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
    return () => {
      const activeList = Object.values(props.activeSessions).filter(
        (s) => s.status === 'inSession',
      );

      return h('aside', { class: 'agent-sidebar' }, [
        h('div', { class: 'agent-sidebar__head' }, [
          h('div', { class: 'agent-sidebar__title' }, '客服工作台'),
          h('div', { class: 'agent-sidebar__presence' }, [
            h(
              Badge,
              {
                status: props.isConnected ? 'success' : 'default',
              },
              {
                default: () =>
                  h(
                    'span',
                    { class: 'agent-sidebar__presence-text' },
                    `${props.presence.onlineAgents} 客服在线 · ${props.presence.queueLength} 人排队`,
                  ),
              },
            ),
          ]),
        ]),

        // 待接单区
        h('div', { class: 'agent-sidebar__section' }, [
          h('div', { class: 'agent-sidebar__section-title' }, [
            h(HourglassOutlined),
            ' 待接单',
            h('span', { class: 'agent-sidebar__count' }, String(props.pendingQueue.length)),
          ]),
          props.pendingQueue.length === 0
            ? h(Empty, {
                image: Empty.PRESENTED_IMAGE_SIMPLE,
                description: '暂无排队',
                class: 'agent-sidebar__empty',
              })
            : h(
                'div',
                { class: 'agent-sidebar__list' },
                props.pendingQueue.map((item) => {
                  const reason = REASON_LABEL[item.reason] || REASON_LABEL.normal;
                  const overdue = isOverdue(item.queuedAt, now.value);
                  return h(
                    'div',
                    {
                      class: `agent-sidebar__item ${overdue ? 'is-overdue' : ''}`,
                      key: item.clientId,
                    },
                    [
                      h('div', { class: 'agent-sidebar__item-row' }, [
                        h(
                          Avatar,
                          { size: 'small' },
                          { icon: () => h(UserOutlined) },
                        ),
                        h(
                          'span',
                          { class: 'agent-sidebar__item-name' },
                          item.userName || `用户${item.clientId.slice(-4)}`,
                        ),
                        h(
                          Tag,
                          { color: reason.color, class: 'agent-sidebar__item-tag' },
                          () => reason.text,
                        ),
                        overdue
                          ? h(
                              Tag,
                              { color: 'error', class: 'agent-sidebar__item-tag' },
                              {
                                icon: () => h(WarningFilled),
                                default: () => '超时',
                              },
                            )
                          : null,
                      ]),
                      item.lastUserMessage
                        ? h(
                            'div',
                            {
                              class: 'agent-sidebar__item-msg',
                              title: item.lastUserMessage,
                            },
                            item.lastUserMessage,
                          )
                        : null,
                      h('div', { class: 'agent-sidebar__item-row agent-sidebar__item-meta' }, [
                        overdue
                          ? h(WarningFilled, { style: { color: '#ff4d4f' } })
                          : h(ClockCircleOutlined),
                        ' ',
                        h(
                          'span',
                          {
                            style: overdue
                              ? { color: '#ff4d4f', fontWeight: 500 }
                              : undefined,
                          },
                          timeAgo(item.queuedAt, now.value),
                        ),
                        h('div', { style: { flex: '1' } }),
                        h(
                          Button,
                          {
                            type: 'primary',
                            size: 'small',
                            disabled: !props.isConnected,
                            onClick: () => props.onAcceptQueue(item.clientId),
                          },
                          () => '接单',
                        ),
                      ]),
                    ],
                  );
                }),
              ),
        ]),

        // 进行中区
        h('div', { class: 'agent-sidebar__section' }, [
          h('div', { class: 'agent-sidebar__section-title' }, [
            h(CheckCircleOutlined),
            ' 进行中',
            h('span', { class: 'agent-sidebar__count' }, String(activeList.length)),
          ]),
          activeList.length === 0
            ? h(Empty, {
                image: Empty.PRESENTED_IMAGE_SIMPLE,
                description: '暂无会话',
                class: 'agent-sidebar__empty',
              })
            : h(
                'div',
                { class: 'agent-sidebar__list' },
                activeList.map((sess) => {
                  const lastMsg = sess.messages[sess.messages.length - 1];
                  const lastPreview = lastMsg
                    ? lastMsg.parts
                        .filter((p) => p.type === 'text' || p.type === 'markdown')
                        .map((p) => p.content)
                        .join(' ')
                        .slice(0, 40)
                    : '（暂无消息）';
                  const isActive = sess.sessionId === props.activeSessionId;
                  return h(
                    Tooltip,
                    {
                      key: sess.sessionId,
                      title: lastPreview,
                      placement: 'right',
                    },
                    {
                      default: () =>
                        h(
                          'div',
                          {
                            class: `agent-sidebar__item agent-sidebar__item--active ${
                              isActive ? 'is-active' : ''
                            }`,
                            onClick: () =>
                              sess.sessionId && props.onSelectSession(sess.sessionId),
                          },
                          [
                            h('div', { class: 'agent-sidebar__item-row' }, [
                              h(
                                Avatar,
                                { size: 'small' },
                                { icon: () => h(UserOutlined) },
                              ),
                              h(
                                'span',
                                { class: 'agent-sidebar__item-name' },
                                `用户 ${sess.clientId?.slice(-4) || '?'}`,
                              ),
                            ]),
                            h('div', { class: 'agent-sidebar__item-msg' }, lastPreview),
                            h('div', { class: 'agent-sidebar__item-row agent-sidebar__item-meta' }, [
                              h(
                                Space,
                                { size: 4 },
                                {
                                  default: () => [
                                    h(
                                      Tag,
                                      { color: 'cyan', style: { margin: 0 } },
                                      () => `${sess.messages.length} 条`,
                                    ),
                                    sess.startedAt
                                      ? h(
                                          'span',
                                          { style: { color: '#8c8c8c' } },
                                          timeAgo(sess.startedAt, now.value),
                                        )
                                      : null,
                                  ],
                                },
                              ),
                            ]),
                          ],
                        ),
                    },
                  );
                }),
              ),
        ]),

        // 历史会话区
        h('div', { class: 'agent-sidebar__section' }, [
          h('div', { class: 'agent-sidebar__section-title' }, [
            h(HistoryOutlined),
            ' 历史会话',
            h('span', { class: 'agent-sidebar__count' }, String(props.historySessions.length)),
            h('div', { style: { flex: '1' } }),
            h(
              Button,
              {
                type: 'text',
                size: 'small',
                title: '刷新历史会话',
                disabled: !props.isConnected,
                onClick: () => props.onRefreshHistory?.(),
              },
              () => h(HistoryOutlined),
            ),
          ]),
          props.historySessions.length === 0
            ? h(Empty, {
                image: Empty.PRESENTED_IMAGE_SIMPLE,
                description: '暂无历史会话',
                class: 'agent-sidebar__empty',
              })
            : h(
                'div',
                { class: 'agent-sidebar__list' },
                props.historySessions.map((item) => {
                  const reason = END_REASON_LABEL[item.endReason] || END_REASON_LABEL.user;
                  const preview = item.lastUserMessage || item.lastAgentMessage || '（无消息）';
                  const isSelected = item.sessionId === props.selectedHistorySessionId;
                  return h(
                    Tooltip,
                    {
                      key: item.sessionId,
                      title: preview,
                      placement: 'right',
                    },
                    {
                      default: () =>
                        h(
                          'div',
                          {
                            class: `agent-sidebar__item agent-sidebar__item--history ${
                              isSelected ? 'is-active' : ''
                            }`,
                            onClick: () => props.onSelectHistory?.(item.sessionId),
                          },
                          [
                            h('div', { class: 'agent-sidebar__item-row' }, [
                              h(
                                Avatar,
                                { size: 'small' },
                                { icon: () => h(UserOutlined) },
                              ),
                              h(
                                'span',
                                { class: 'agent-sidebar__item-name' },
                                item.userName || `用户 ${item.clientId?.slice(-4) || '?'}`,
                              ),
                              h(
                                Tag,
                                { color: reason.color, class: 'agent-sidebar__item-tag' },
                                () => reason.text,
                              ),
                            ]),
                            h('div', { class: 'agent-sidebar__item-msg' }, preview),
                            h('div', { class: 'agent-sidebar__item-row agent-sidebar__item-meta' }, [
                              h(
                                Space,
                                { size: 4 },
                                {
                                  default: () => [
                                    h(
                                      Tag,
                                      { color: 'default', style: { margin: 0 } },
                                      () => [h(MessageOutlined), ` ${item.messageCount}`],
                                    ),
                                    h(
                                      'span',
                                      { style: { color: '#8c8c8c' } },
                                      timeAgo(item.endedAt, now.value),
                                    ),
                                  ],
                                },
                              ),
                            ]),
                          ],
                        ),
                    },
                  );
                }),
              ),
        ]),
      ]);
    };
  },
});
</script>
