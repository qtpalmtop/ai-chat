/**
 * 客服工作台 - 右侧智能推荐工具栏（Vue 版 - 对齐 React 端 SuggestionPanel.tsx）
 */

<script lang="ts">
import {
  defineComponent,
  h,
  ref,
  computed,
  type PropType,
} from 'vue';
import {
  App,
  Button,
  Empty,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Switch,
} from 'ant-design-vue';
import {
  ThunderboltOutlined,
  ReloadOutlined,
  CheckCircleFilled,
  LoadingOutlined,
  PictureOutlined,
  FileTextOutlined,
  AppstoreOutlined,
  CodeOutlined,
  SendOutlined,
  MessageOutlined,
  CopyOutlined,
} from '@ant-design/icons-vue';
import type { MessagePart } from '@/types/message';
import type { AgentSuggestion } from '@/types/agent';
import { getClientFallbackSuggestions } from '@/utils/agentSuggestions';

type PartKind = 'text' | 'image' | 'file' | 'card' | 'rich';

const PART_ICON: Record<PartKind, any> = {
  text: MessageOutlined,
  image: PictureOutlined,
  file: FileTextOutlined,
  card: AppstoreOutlined,
  rich: CodeOutlined,
};

const PART_COLOR: Record<PartKind, string> = {
  text: '#4d6bfe',
  image: '#52c41a',
  file: '#fa8c16',
  card: '#722ed1',
  rich: '#13c2c2',
};

function extractHtmlText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPartSummary(parts: MessagePart[]): Array<{ kind: PartKind; label: string; preview: string }> {
  const out: Array<{ kind: PartKind; label: string; preview: string }> = [];
  for (const p of parts) {
    switch (p.type) {
      case 'text':
        out.push({ kind: 'text', label: '文本', preview: p.content.slice(0, 60) });
        break;
      case 'markdown':
        out.push({ kind: 'text', label: '富文本', preview: p.content.slice(0, 60) });
        break;
      case 'rich':
        out.push({ kind: 'rich', label: '富文本卡片', preview: extractHtmlText(p.html).slice(0, 60) });
        break;
      case 'image':
        out.push({ kind: 'image', label: '图片', preview: p.caption || p.alt || '图片' });
        break;
      case 'image_group':
        out.push({ kind: 'image', label: '图片组', preview: `${p.data.images.length} 张图片` });
        break;
      case 'file':
        out.push({ kind: 'file', label: '文件', preview: p.name });
        break;
      case 'comparison':
        out.push({ kind: 'card', label: '对比卡', preview: p.title || `${p.items.length} 个选项` });
        break;
      case 'suggestion':
        out.push({ kind: 'card', label: '推荐', preview: `${p.items.length} 个追问` });
        break;
      case 'chart':
        out.push({ kind: 'card', label: '图表', preview: p.title || `${p.chartType} chart` });
        break;
      case 'timeline':
        out.push({ kind: 'card', label: '时间线', preview: p.title || `${p.events.length} 个事件` });
        break;
      case 'task_list':
        out.push({ kind: 'card', label: '任务', preview: p.title || `${p.tasks.length} 个任务` });
        break;
      case 'code':
        out.push({ kind: 'card', label: '代码', preview: p.filename || p.language });
        break;
      case 'thinking':
        out.push({ kind: 'card', label: '思维链', preview: p.content.slice(0, 40) });
        break;
      case 'citation':
        out.push({ kind: 'card', label: '引用', preview: `${p.sources.length} 条来源` });
        break;
      case 'function_call':
        out.push({ kind: 'card', label: '工具调用', preview: p.call.name });
        break;
      case 'image_understanding':
        out.push({ kind: 'card', label: '图片理解', preview: p.data.description.slice(0, 40) });
        break;
      case 'file_parsed':
        out.push({ kind: 'card', label: '文件解析', preview: p.data.name });
        break;
    }
  }
  return out;
}

const SuggestionCardItem = defineComponent({
  name: 'SuggestionCardItem',
  props: {
    suggestion: { type: Object as PropType<AgentSuggestion>, required: true },
    onUse: { type: Function as PropType<(s: AgentSuggestion) => void>, required: true },
    onCopy: { type: Function as PropType<(s: AgentSuggestion) => void>, required: true },
  },
  setup(props) {
    return () => {
      const summary = buildPartSummary(props.suggestion.parts);
      const isApplied = !!props.suggestion.applied;
      return h(
        'div',
        { class: `agent-suggestion ${isApplied ? 'is-applied' : ''}` },
        [
          h('div', { class: 'agent-suggestion__head' }, [
            h(Space, { size: 6 }, () => [
              h(ThunderboltOutlined, { style: { color: '#4d6bfe' } }),
              h('span', { class: 'agent-suggestion__cat' }, props.suggestion.category),
              props.suggestion.confidence !== undefined
                ? h(
                    Tag,
                    { color: 'blue' },
                    () => `${Math.round(props.suggestion.confidence! * 100)}%`,
                  )
                : null,
            ]),
            isApplied
              ? h(
                  Tag,
                  { color: 'success', icon: CheckCircleFilled },
                  () => '已发送',
                )
              : null,
          ]),
          h('div', { class: 'agent-suggestion__reason' }, props.suggestion.reason),
          h(
            'div',
            { class: 'agent-suggestion__parts' },
            summary.map((s, i) =>
              h(
                Tooltip,
                { key: i, title: s.preview, placement: 'top', mouseEnterDelay: 0.3 },
                {
                  default: () =>
                    h(
                      'span',
                      {
                        class: 'agent-suggestion__part-chip',
                        style: {
                          color: PART_COLOR[s.kind],
                          borderColor: PART_COLOR[s.kind] + '40',
                          background: PART_COLOR[s.kind] + '10',
                        },
                      },
                      [
                        h(PART_ICON[s.kind]),
                        h('span', { class: 'agent-suggestion__part-label' }, s.label),
                      ],
                    ),
                },
              ),
            ),
          ),
          h(
            'div',
            { class: 'agent-suggestion__preview', title: props.suggestion.preview },
            props.suggestion.preview,
          ),
          h('div', { class: 'agent-suggestion__actions' }, [
            h(
              Button,
              {
                type: 'primary',
                size: 'small',
                icon: SendOutlined,
                disabled: isApplied,
                onClick: () => props.onUse(props.suggestion),
                class: 'agent-suggestion__send',
              },
              () => (isApplied ? '已发送' : '一键发送'),
            ),
            h(
              Tooltip,
              { title: '复制话术到剪贴板（在输入框手动粘贴）' },
              {
                default: () =>
                  h(
                    Button,
                    {
                      size: 'small',
                      icon: CopyOutlined,
                      onClick: () => props.onCopy(props.suggestion),
                      class: 'agent-suggestion__copy',
                    },
                    () => '复制',
                  ),
              },
            ),
          ]),
        ],
      );
    };
  },
});

export default defineComponent({
  name: 'SuggestionPanel',
  props: {
    sessionId: { type: String, required: true },
    messages: {
      type: Array as PropType<
        Array<{ id: string; role: 'user' | 'agent' | 'assistant'; parts: MessagePart[] }>
      >,
      required: true,
    },
    isStreaming: { type: Boolean, required: true },
    streamingCategory: { type: String as PropType<string | null>, default: null },
    onRefresh: { type: Function as PropType<() => void>, required: true },
    onUseSuggestion: {
      type: Function as PropType<(s: AgentSuggestion) => void>,
      required: true,
    },
    autoTrigger: { type: Boolean, required: true },
    onAutoTriggerChange: { type: Function as PropType<(v: boolean) => void>, required: true },
  },
  setup(props) {
    const { message: antdMessage } = App.useApp();

    // 简化版：组件内本地 list（实际项目可放到 store）
    const list = ref<AgentSuggestion[]>([]);

    function onUse(s: AgentSuggestion) {
      if (s.applied) return;
      props.onUseSuggestion(s);
      antdMessage.success('已发送推荐话术');
    }

    /**
     * 一键复制话术到剪贴板（不直接发送）。客服可在输入框 Ctrl/Cmd+V 粘贴后微调。
     * 仅复制 text/markdown 两种 part，富文本/卡片/图片用「一键发送」。
     */
    async function onCopy(s: AgentSuggestion) {
      const text = s.parts
        .map((p) => (p.type === 'text' || p.type === 'markdown' ? p.content : ''))
        .filter(Boolean)
        .join('\n\n');
      if (!text) {
        antdMessage.warning('该话术含富文本/卡片，建议直接「一键发送」');
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        antdMessage.success('已复制，去输入框粘贴吧');
      } catch {
        antdMessage.error('复制失败，请检查浏览器剪贴板权限');
      }
    }

    const fallback = computed(() =>
      getClientFallbackSuggestions(props.messages as any),
    );

    const fallbackOpen = ref(true);

    return () =>
      h('aside', { class: 'agent-tools' }, [
        h('header', { class: 'agent-tools__head' }, [
          h('div', { class: 'agent-tools__title' }, [
            h(ThunderboltOutlined),
            ' 智能推荐',
          ]),
          h('div', { class: 'agent-tools__sub' }, '基于最近用户消息实时识别意图'),
        ]),

        h('div', { class: 'agent-tools__actions' }, [
          h(Space, null, () => [
            h(Switch, {
              size: 'small',
              checked: props.autoTrigger,
              onChange: props.onAutoTriggerChange,
              checkedChildren: '自动',
              unCheckedChildren: '手动',
            }),
            h('span', { style: { fontSize: '12px', color: '#8c8c8c' } }, '新消息时自动推荐'),
          ]),
          h(
            Tooltip,
            { title: '立即请求一次推荐' },
            {
              default: () =>
                h(
                  Button,
                  {
                    size: 'small',
                    type: 'text',
                    onClick: props.onRefresh,
                    disabled: props.isStreaming,
                  },
                  { icon: () => h(ReloadOutlined, { spin: props.isStreaming }) },
                  () => '刷新',
                ),
            },
          ),
        ]),

        h('div', { class: 'agent-tools__body' }, [
          props.isStreaming
            ? h('div', { class: 'agent-tools__loading' }, [
                h(Space, null, () => [
                  h(LoadingOutlined),
                  h(
                    'span',
                    null,
                    `正在识别意图${props.streamingCategory ? `（${props.streamingCategory}）` : ''}…`,
                  ),
                ]),
                h(Skeleton, { active: true, paragraph: { rows: 2 }, title: false, style: { marginTop: '8px' } }),
              ])
            : null,

          list.value.length === 0 && !props.isStreaming
            ? h(Empty, {
                image: Empty.PRESENTED_IMAGE_SIMPLE,
                description: h('span', { style: { color: '#8c8c8c', fontSize: '13px' } }, [
                  '暂无推荐，等待用户消息…',
                  h('div', { style: { fontSize: '12px', marginTop: '4px' } }, '也可点"刷新"手动触发'),
                ]),
                style: { marginTop: '24px' },
              })
            : list.value.map((s) =>
                h(SuggestionCardItem, { key: s.id, suggestion: s, onUse, onCopy }),
              ),

          fallback.value.length > 0 && list.value.length === 0 && !props.isStreaming
            ? h('div', { class: 'agent-tools__fallback' }, [
                h(
                  'div',
                  {
                    class: 'agent-tools__fallback-head',
                    onClick: () => (fallbackOpen.value = !fallbackOpen.value),
                  },
                  `${fallbackOpen.value ? '▼' : '▶'} 本地模板（${fallback.value[0].category}）`,
                ),
                fallbackOpen.value
                  ? h(
                      'div',
                      { class: 'agent-tools__fallback-list' },
                      fallback.value[0].templates.map((tpl, i) => {
                        const fakeS: AgentSuggestion = {
                          id: `fallback_${i}`,
                          category: fallback.value[0].category,
                          reason: '本地模板（离线兜底）',
                          preview: tpl.preview,
                          parts: tpl.parts,
                          createdAt: Date.now(),
                        };
                        return h(SuggestionCardItem, { key: i, suggestion: fakeS, onUse, onCopy });
                      }),
                    )
                  : null,
              ])
            : null,
        ]),
      ]);
  },
});
</script>
