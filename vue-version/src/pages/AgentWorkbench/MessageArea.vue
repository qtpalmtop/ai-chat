/**
 * 客服工作台 - 中间聊天区（Vue 版 - 对齐 React 端 MessageArea.tsx）
 *
 * 使用 render function 风格实现，避开 <template> + h() 混用的语法歧义
 */

<script lang="ts">
import {
  defineComponent,
  h,
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
  type PropType,
} from 'vue';
import { App, Avatar, Button, Empty, Space, Tag } from 'ant-design-vue';
import {
  UserOutlined,
  ClockCircleOutlined,
  PoweroffOutlined,
  CustomerServiceOutlined,
  CheckCircleFilled,
} from '@ant-design/icons-vue';
import MessageItem from '@/components/MessageItem/MessageItem.vue';
import MessageVirtualList from '@/components/MessageVirtualList/MessageVirtualList.vue';
import type { Message } from '@/types/message';
import type { AgentSession } from '@/types/agent';

/** 简化版客服输入面板（独立组件，避免和客户端 InputPanel 状态分支纠缠） */
const AgentInputPanel = defineComponent({
  name: 'AgentInputPanel',
  props: {
    session: { type: Object as PropType<AgentSession>, required: true },
  },
  setup(props) {
    const text = ref('');
    const attachments = ref<
      Array<{ kind: 'image' | 'file'; url: string; name: string; size: number; mime?: string }>
    >([]);

    function fileToDataURL(file: File): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function onUpload(file: File, kind: 'image' | 'file') {
      const url = await fileToDataURL(file);
      attachments.value = [
        ...attachments.value,
        { kind, url, name: file.name, size: file.size, mime: file.type },
      ];
    }

    function removeAttachment(idx: number) {
      attachments.value = attachments.value.filter((_, i) => i !== idx);
    }

    function onSend() {
      const trimmed = text.value.trim();
      if (!trimmed && attachments.value.length === 0) return;
      window.dispatchEvent(
        new CustomEvent('agent:send-message', {
          detail: {
            sessionId: props.session.sessionId,
            trimmed,
            attachments: attachments.value,
          },
        }),
      );
      text.value = '';
      attachments.value = [];
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    }

    const UploadBtn = defineComponent({
      name: 'UploadBtn',
      props: {
        accept: { type: String, default: undefined },
        icon: { type: String, required: true },
        label: { type: String, required: true },
        onPick: { type: Function, required: true },
      },
      setup(p) {
        const inputRef = ref<HTMLInputElement | null>(null);
        return () => {
          const inputProps: Record<string, unknown> = {
            ref: inputRef,
            type: 'file',
            style: { display: 'none' },
            onChange: async (e: Event) => {
              const t = e.target as HTMLInputElement;
              const f = t.files?.[0];
              if (f) await p.onPick(f);
              t.value = '';
            },
          };
          if (p.accept) inputProps.accept = p.accept;
          return [
            h(
              'button',
              {
                type: 'button',
                class: 'agent-input__tool',
                onClick: () => inputRef.value?.click(),
              },
              [h('span', { style: { marginRight: '4px' } }, p.icon), p.label],
            ),
            h('input', inputProps),
          ];
        };
      },
    });

    return () =>
      h('div', { class: 'agent-input' }, [
        h(
          'div',
          { class: 'agent-input__head' },
          `正在为用户 ${props.session.clientId?.slice(-6) || '未知'} 服务`,
        ),
        attachments.value.length > 0
          ? h(
              'div',
              { class: 'agent-input__attachments' },
              attachments.value.map((a, i) =>
                h(
                  'div',
                  { class: `attachment-chip ${a.kind === 'image' ? 'is-image' : ''}`, key: i },
                  a.kind === 'image'
                    ? h('img', { src: a.url, alt: a.name, class: 'attachment-chip__thumb' })
                    : h('span', { class: 'attachment-chip__icon' }, '📎'),
                  h('span', { class: 'attachment-chip__name' }, a.name),
                  h(
                    'span',
                    {
                      class: 'attachment-chip__close',
                      onClick: () => removeAttachment(i),
                    },
                    '×',
                  ),
                ),
              ),
            )
          : null,
        h('div', { class: 'agent-input__toolbar' }, [
          h(UploadBtn, {
            accept: 'image/*',
            icon: '🖼️',
            label: '图片',
            onPick: (f: File) => onUpload(f, 'image'),
          }),
          h(UploadBtn, {
            icon: '📎',
            label: '文件',
            onPick: (f: File) => onUpload(f, 'file'),
          }),
          h('div', { style: { flex: '1' } }),
          h(
            'span',
            { style: { fontSize: '12px', color: '#8c8c8c' } },
            'Enter 发送 · Shift+Enter 换行',
          ),
        ]),
        h('textarea', {
          value: text.value,
          onInput: (e: Event) => (text.value = (e.target as HTMLTextAreaElement).value),
          onKeydown: onKeyDown,
          placeholder: '输入回复…',
          rows: 3,
          class: 'agent-input__textarea',
        }),
        h(
          'div',
          { class: 'agent-input__bottom' },
          h(
            Button,
            {
              type: 'primary',
              class: 'agent-input__send',
              disabled: !text.value.trim() && attachments.value.length === 0,
              onClick: onSend,
            },
            () => '发送',
          ),
        ),
      ]);
  },
});

/** 主组件 - MessageArea */
export default defineComponent({
  name: 'MessageArea',
  props: {
    session: { type: Object as PropType<AgentSession>, required: true },
    onEndSession: { type: Function as PropType<(s: string) => void>, required: true },
  },
  setup(props) {
    const { message: antdMessage } = App.useApp();
    const listRef = ref<HTMLDivElement | null>(null);
    const listHeight = ref(0);
    let ro: ResizeObserver | null = null;
    const tick = ref(0);
    let tickTimer: number | null = null;

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

    const messages = computed<readonly Message[]>(() => props.session.messages);

    function formatDuration(startedAt: number | null | undefined): string {
      if (!startedAt) return '00:00';
      void tick.value;
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

    return () => {
      const renderMsg = (m: Message) =>
        h(MessageItem, { message: m, onCopy, onSuggestionPick: noop, onRegenerate: noop });

      return h('section', { class: 'agent-chat' }, [
        h('header', { class: 'agent-chat__head' }, [
          h('div', { class: 'agent-chat__head-left' }, [
            h(
              Avatar,
              { size: 40, class: 'agent-chat__user-avatar' },
              { icon: () => h(UserOutlined) },
            ),
            h('div', null, [
              h('div', { class: 'agent-chat__user-name' }, [
                `用户 ${props.session.clientId?.slice(-6) || '未知'}`,
                h(Tag, { color: 'cyan', style: { marginLeft: '8px' } }, () => '进行中'),
              ]),
              h('div', { class: 'agent-chat__user-meta' }, [
                h(
                  Space,
                  { size: 12 },
                  {
                    default: () => [
                      h('span', null, [
                        h(ClockCircleOutlined),
                        ' ',
                        formatDuration(props.session.startedAt),
                      ]),
                      h('span', null, `${messages.value.length} 条消息`),
                      lastUserMsg.value
                        ? h(
                            'span',
                            {
                              title: lastUserMsg.value.parts
                                .map((p) => ('content' in p ? p.content : ''))
                                .join(' '),
                            },
                            `最近：${lastUserMsg.value.parts
                              .filter((p) => p.type === 'text' || p.type === 'markdown')
                              .map((p) => p.content)
                              .join(' ')
                              .slice(0, 20)}`,
                          )
                        : null,
                    ],
                  },
                ),
              ]),
            ]),
          ]),
          h('div', { class: 'agent-chat__head-right' }, [
            h(
              Button,
              {
                type: 'primary',
                danger: true,
                icon: PoweroffOutlined,
                disabled: !props.session.sessionId,
                onClick: onEnd,
              },
              () => '结束会话',
            ),
          ]),
        ]),

        h('div', { ref: listRef, class: 'agent-chat__body' }, [
          messages.value.length === 0
            ? h(
                'div',
                { class: 'agent-chat__empty' },
                h(Empty, {
                  description: h('span', { style: { color: '#8c8c8c' } }, [
                    '等待用户发送消息…',
                    h('div', { style: { fontSize: '12px', marginTop: '8px' } }, [
                      h(CheckCircleFilled, { style: { color: '#52c41a' } }),
                      ' 已建立端到端加密连接',
                    ]),
                  ]),
                }),
              )
            : h(MessageVirtualList, {
                items: messages.value as Message[],
                streamingItem: null,
                getKey: (m: Message) => m.id,
                height: listHeight.value,
                overscan: 3,
                scrollToBottomKey: scrollToBottomKey.value,
                followStreaming: false,
                renderItem: renderMsg,
                renderStreaming: renderMsg,
              }),
        ]),

        h('div', { class: 'agent-chat__footer' }, [
          h(AgentInputPanel, { session: props.session }),
        ]),
      ]);
    };
  },
});
</script>
