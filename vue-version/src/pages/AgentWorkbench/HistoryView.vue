/**
 * 客服工作台 - 历史会话详情查看（Vue 版 - 对齐 React 端 HistoryView）
 *
 * 顶部：用户信息 + 结束原因 + 时长 + 返回按钮
 * 主体：消息列表（复用 MessageVirtualList 渲染）
 * 底部：无输入框（已结束会话不能再发消息）
 */

<script lang="ts">
import {
  defineComponent,
  h,
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  type PropType,
} from 'vue';
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

export default defineComponent({
  name: 'HistoryView',
  props: {
    item: { type: Object as PropType<HistorySessionItem | null>, default: null },
    detail: { type: Object as PropType<HistorySessionDetail | null>, default: null },
    loading: { type: Boolean, default: false },
    onBack: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
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

    // 消息数量变化 → 滚到底
    const noop = () => {};
    const onCopy = (text: string) => {
      navigator.clipboard.writeText(text).then(() => antdMessage.success('已复制'));
    };

    const renderItem = (m: Message) =>
      h(MessageItem, {
        message: m,
        onCopy,
        onSuggestionPick: noop,
        onRegenerate: noop,
      });

    // 用 watch 来同步滚动（不依赖 onMounted 的副作用）
    // 注意：scrollToBottomKey 是 computed，每次 messages.length 变化都会触发新 key
    watch(scrollToBottomKey, () => {
      // 等下一帧再滚（等 DOM 渲染完）
      requestAnimationFrame(scrollToBottom);
    });

    return () => {
      const it = props.item;
      const d = props.detail;
      const endTag = it
        ? h(
            Tag,
            {
              color: END_REASON_LABEL[it.endReason]?.color || 'default',
              style: { marginLeft: '8px' },
            },
            () => END_REASON_LABEL[it.endReason]?.text || '已结束',
          )
        : null;

      return h('section', { class: 'agent-chat' }, [
        // 顶部 header
        h('header', { class: 'agent-chat__head' }, [
          h('div', { class: 'agent-chat__head-left' }, [
            h(
              Avatar,
              { size: 40, class: 'agent-chat__user-avatar' },
              { icon: () => h(UserOutlined) },
            ),
            h('div', null, [
              h('div', { class: 'agent-chat__user-name' }, [
                it?.userName || `用户 ${it?.clientId?.slice(-6) || '未知'}`,
                endTag,
              ]),
              h('div', { class: 'agent-chat__user-meta' }, [
                h(
                  Space,
                  { size: 12 },
                  {
                    default: () => [
                      h('span', null, `共 ${d?.messages.length ?? it?.messageCount ?? 0} 条消息`),
                      h('span', null, `会话时长：${formatDuration(duration.value)}`),
                      it?.startedAt
                        ? h(
                            'span',
                            { style: { color: '#8c8c8c' } },
                            new Date(it.startedAt).toLocaleString('zh-CN'),
                          )
                        : null,
                    ],
                  },
                ),
              ]),
            ]),
          ]),
          h('div', { class: 'agent-chat__head-right' }, [
            h(Button, { onClick: () => props.onBack() }, () => '返回活跃会话'),
          ]),
        ]),

        // 主体消息列表
        h('div', { ref: listRef, class: 'agent-chat__body' }, [
          props.loading && !d
            ? h(
                'div',
                { class: 'agent-chat__empty' },
                h(Empty, { description: '加载历史消息中…' }),
              )
            : messages.value.length === 0
              ? h(
                  'div',
                  { class: 'agent-chat__empty' },
                  h(Empty, { description: '该会话暂无消息' }),
                )
              : h(MessageVirtualList as any, {
                  items: messages.value as Message[],
                  streamingItem: null,
                  getKey: (m: Message) => m.id,
                  height: listHeight.value,
                  overscan: 3,
                  scrollToBottomKey: scrollToBottomKey.value,
                  followStreaming: false,
                  renderItem,
                  renderStreaming: renderItem,
                }),
        ]),

        // 底部提示（无输入框）
        h('div', { class: 'agent-chat__footer' }, [
          h(
            'div',
            {
              style: {
                padding: '16px',
                textAlign: 'center',
                color: '#8c8c8c',
                background: '#fafafa',
                borderRadius: '8px',
                fontSize: '13px',
              },
            },
            '🔒 该会话已结束（仅供查看，不能发送新消息）',
          ),
        ]),
      ]);
    };
  },
});
</script>
