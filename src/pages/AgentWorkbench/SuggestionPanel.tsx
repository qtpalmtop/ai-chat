/**
 * 客服工作台 - 右侧智能推荐工具栏
 *
 * 核心能力：
 *   1. 顶部：当前会话元信息（用户、消息数、连接状态）
 *   2. 中部：智能识别到的话术卡片列表
 *      - 服务端 streaming 推送（suggestion_chunk）会逐条 append
 *      - 每张卡片可预览 part 类型（text/image/file/card/rich）
 *      - 鼠标悬停展示完整 parts 预览
 *      - 点击 → 调 useSuggestion → 直接作为客服消息发送
 *   3. 底部：手动刷新推荐 + 离线 fallback 模板
 *
 * 流式状态：
 *   - 收到 suggestion_start → 显示 loading skeleton
 *   - 收到 suggestion_chunk → 增量更新
 *   - done=true → 关闭 loading
 *
 * 性能：
 *   - 每条 suggestion 是独立卡片组件，使用 React.memo 避免无关项重渲染
 *   - 服务端 chunk 频繁推送只触发对应项的局部更新
 */
import React, { useMemo, useCallback, useState } from 'react';
import { App, Button, Empty, Skeleton, Space, Tag, Tooltip, Switch } from 'antd';
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
} from '@ant-design/icons';
import type { MessagePart } from '@/types/message';
import type { AgentSuggestion } from '@/types/agent';
import { getClientFallbackSuggestions } from '@/utils/agentSuggestions';
import { useAgentWorkbench } from '@/hooks/useAgentWorkbench';

export interface SuggestionPanelProps {
  sessionId: string;
  /** 当前会话消息（用于客户端 fallback 模板） */
  messages: ReadonlyArray<{ id: string; role: 'user' | 'agent' | 'assistant' | 'system'; parts: MessagePart[] }>;
  /** 是否正在接收服务端流式推荐 */
  isStreaming: boolean;
  /** 当前流式 intent 的类别（用于显示 loading 标签） */
  streamingCategory?: string | null;
  /** 手动刷新推荐 */
  onRefresh: () => void;
  /** 点击某条推荐话术 */
  onUseSuggestion: (suggestion: AgentSuggestion) => void;
  /** 自动触发推荐开关（默认 true：用户发新消息时自动请求） */
  autoTrigger: boolean;
  onAutoTriggerChange: (v: boolean) => void;
}

/** 从 parts 列表提取"组合预览"（带类型标签） */
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

type PartKind = 'text' | 'image' | 'file' | 'card' | 'rich';

function extractHtmlText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PART_ICON: Record<PartKind, React.ReactNode> = {
  text: <MessageOutlined />,
  image: <PictureOutlined />,
  file: <FileTextOutlined />,
  card: <AppstoreOutlined />,
  rich: <CodeOutlined />,
};

const PART_COLOR: Record<PartKind, string> = {
  text: '#4d6bfe',
  image: '#52c41a',
  file: '#fa8c16',
  card: '#722ed1',
  rich: '#13c2c2',
};

/** 单条推荐卡片（React.memo 隔离无关更新） */
const SuggestionCardItem: React.FC<{
  suggestion: AgentSuggestion;
  onUse: (s: AgentSuggestion) => void;
  onCopy: (s: AgentSuggestion) => void;
}> = React.memo(
  ({ suggestion, onUse, onCopy }) => {
    const summary = useMemo(() => buildPartSummary(suggestion.parts), [suggestion.parts]);
    const isApplied = !!suggestion.applied;
    return (
      <div className={`agent-suggestion ${isApplied ? 'is-applied' : ''}`}>
        <div className="agent-suggestion__head">
          <Space size={6}>
            <ThunderboltOutlined style={{ color: '#4d6bfe' }} />
            <span className="agent-suggestion__cat">{suggestion.category}</span>
            {suggestion.confidence !== undefined && (
              <Tag color="blue">{Math.round(suggestion.confidence * 100)}%</Tag>
            )}
          </Space>
          {isApplied && (
            <Tag color="success" icon={<CheckCircleFilled />}>
              已发送
            </Tag>
          )}
        </div>
        <div className="agent-suggestion__reason">{suggestion.reason}</div>
        <div className="agent-suggestion__parts">
          {summary.map((s, i) => (
            <Tooltip
              key={i}
              title={s.preview}
              placement="top"
              mouseEnterDelay={0.3}
            >
              <span
                className="agent-suggestion__part-chip"
                style={{
                  color: PART_COLOR[s.kind],
                  borderColor: PART_COLOR[s.kind] + '40',
                  background: PART_COLOR[s.kind] + '10',
                }}
              >
                {PART_ICON[s.kind]}
                <span className="agent-suggestion__part-label">{s.label}</span>
              </span>
            </Tooltip>
          ))}
        </div>
        <div className="agent-suggestion__preview" title={suggestion.preview}>
          {suggestion.preview}
        </div>
        <div className="agent-suggestion__actions">
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            disabled={isApplied}
            onClick={() => onUse(suggestion)}
            className="agent-suggestion__send"
          >
            {isApplied ? '已发送' : '一键发送'}
          </Button>
          <Tooltip title="复制话术到剪贴板（在输入框手动粘贴）">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => onCopy(suggestion)}
              className="agent-suggestion__copy"
            >
              复制
            </Button>
          </Tooltip>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.suggestion === next.suggestion &&
    prev.onUse === next.onUse &&
    prev.onCopy === next.onCopy,
);

export const SuggestionPanel: React.FC<SuggestionPanelProps> = ({
  sessionId,
  messages,
  isStreaming,
  streamingCategory,
  onRefresh,
  onUseSuggestion,
  autoTrigger,
  onAutoTriggerChange,
}) => {
  const { suggestions } = useAgentWorkbench();
  const list: AgentSuggestion[] = suggestions[sessionId] || [];
  const { message: antdMessage } = App.useApp();

  const onUse = useCallback(
    (s: AgentSuggestion) => {
      if (s.applied) return;
      onUseSuggestion(s);
      antdMessage.success('已发送推荐话术');
    },
    [onUseSuggestion, antdMessage],
  );

  /**
   * 一键复制话术到剪贴板（不直接发送）。
   * 客服可以在输入框里 Ctrl/Cmd+V 粘贴，再微调后发送。
   * 仅复制 text/markdown 两种 part，富文本/卡片/图片等无法纯文本表达，提示用户改用「一键发送」。
   */
  const onCopy = useCallback(
    async (s: AgentSuggestion) => {
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
    },
    [antdMessage],
  );

  // 客户端 fallback：服务端还没推时本地算一组（按最近用户消息识别意图）
  const fallback = useMemo(
    () => getClientFallbackSuggestions(messages as any),
    // 依赖 messages 引用变化触发重算
    [messages],
  );
  // 折叠/展开 fallback 区
  const [fallbackOpen, setFallbackOpen] = useState(true);

  return (
    <aside className="agent-tools">
      <header className="agent-tools__head">
        <div className="agent-tools__title">
          <ThunderboltOutlined /> 智能推荐
        </div>
        <div className="agent-tools__sub">
          基于最近用户消息实时识别意图
        </div>
      </header>

      <div className="agent-tools__actions">
        <Space>
          <Switch
            size="small"
            checked={autoTrigger}
            onChange={onAutoTriggerChange}
            checkedChildren="自动"
            unCheckedChildren="手动"
          />
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>新消息时自动推荐</span>
        </Space>
        <Tooltip title="立即请求一次推荐">
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined spin={isStreaming} />}
            onClick={onRefresh}
            disabled={isStreaming}
          >
            刷新
          </Button>
        </Tooltip>
      </div>

      <div className="agent-tools__body">
        {isStreaming && (
          <div className="agent-tools__loading">
            <Space>
              <LoadingOutlined />
              <span>正在识别意图{streamingCategory ? `（${streamingCategory}）` : ''}…</span>
            </Space>
            <Skeleton active paragraph={{ rows: 2 }} title={false} style={{ marginTop: 8 }} />
          </div>
        )}

        {list.length === 0 && !isStreaming ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span style={{ color: '#8c8c8c', fontSize: 13 }}>
                暂无推荐，等待用户消息…
                <div style={{ fontSize: 12, marginTop: 4 }}>也可点"刷新"手动触发</div>
              </span>
            }
            style={{ marginTop: 24 }}
          />
        ) : (
          list.map((s) => (
            <SuggestionCardItem key={s.id} suggestion={s} onUse={onUse} onCopy={onCopy} />
          ))
        )}

        {fallback.length > 0 && list.length === 0 && !isStreaming && (
          <div className="agent-tools__fallback">
            <div
              className="agent-tools__fallback-head"
              onClick={() => setFallbackOpen((v) => !v)}
            >
              {fallbackOpen ? '▼' : '▶'} 本地模板（{fallback[0].category}）
            </div>
            {fallbackOpen && (
              <div className="agent-tools__fallback-list">
                {fallback[0].templates.map((tpl, i) => {
                  const fakeS: AgentSuggestion = {
                    id: `fallback_${i}`,
                    category: fallback[0].category,
                    reason: '本地模板（离线兜底）',
                    preview: tpl.preview,
                    parts: tpl.parts,
                    createdAt: Date.now(),
                  };
                  return <SuggestionCardItem key={i} suggestion={fakeS} onUse={onUse} onCopy={onCopy} />;
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
