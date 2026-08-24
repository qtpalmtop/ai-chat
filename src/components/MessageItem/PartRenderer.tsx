/**
 * PartRenderer - 渲染单条 part
 *
 * 按需加载策略:
 * - 轻量(始终内联):text / markdown / rich / image / file
 *   这 5 类覆盖 90%+ 的渲染,首屏必用,内联以避免任何额外请求
 * - 重量级(React.lazy 异步加载):thinking / citation / code / chart /
 *   suggestion / function_call / comparison / image_understanding /
 *   file_parsed / timeline / task_list / image_group
 *   这些只在特定 Skill / 场景下出现,按 chunk 拆分,首次渲染触发自动加载
 *
 * Suspense 边界:
 * - 每个 lazy 卡片单独包 <Suspense fallback={CardSkeleton}>
 * - 单卡片加载不会影响同消息其他卡片,也不会让整条消息空白
 *
 * 性能:
 * - React.lazy + Vite 自动 code-split,每个 chunk 独立请求
 * - 已加载过的 chunk 会被浏览器缓存,二次渲染零成本
 */

import React, { Suspense } from 'react';
import { Image as AntdImage } from 'antd';
import type { MessagePart } from '@/types/message';
import { getFileIcon, formatSize } from './cards/shared';
import { CardSkeleton } from './cards/CardSkeleton';

// ============== React.lazy 重量级卡片 ==============
const ThinkingCard = React.lazy(() => import('./cards/ThinkingCard'));
const CitationCard = React.lazy(() => import('./cards/CitationCard'));
const CodeCard = React.lazy(() => import('./cards/CodeCard'));
const ChartCard = React.lazy(() => import('./cards/ChartCard'));
const SuggestionCard = React.lazy(() => import('./cards/SuggestionCard'));
const FunctionCallCard = React.lazy(() => import('./cards/FunctionCallCard'));
const ComparisonCard = React.lazy(() => import('./cards/ComparisonCard'));
const ImageUnderstandingCard = React.lazy(() => import('./cards/ImageUnderstandingCard'));
const FileParsedCard = React.lazy(() => import('./cards/FileParsedCard'));
const TimelineCard = React.lazy(() => import('./cards/TimelineCard'));
const TaskListCard = React.lazy(() => import('./cards/TaskListCard'));
const ImageGroupCard = React.lazy(() => import('./cards/ImageGroupCard'));

interface Props {
  part: MessagePart;
}

export interface PartRendererProps extends Props {
  /** suggestion chip 点击回调:把推荐追问注入到输入区或直接发送 */
  onSuggestionPick?: (s: string) => void;
  /** 工具调用失败时的重试回调 */
  onFunctionCallRetry?: (id: string) => void;
}

/** 统一 Suspense 包裹,确保每个 lazy 卡片都有加载占位 */
const wrap = (children: React.ReactNode, height?: number) => (
  <Suspense fallback={<CardSkeleton height={height} />}>{children}</Suspense>
);

export const PartRenderer: React.FC<PartRendererProps> = ({
  part,
  onSuggestionPick,
  onFunctionCallRetry,
}) => {
  switch (part.type) {
    // ===== 内联:轻量基础类型 =====
    case 'text':
      return <div className="part-text">{part.content}</div>;
    case 'markdown':
      // Markdown 由 MarkdownStream 在外层处理
      return null;
    case 'rich':
      return <div className="part-rich" dangerouslySetInnerHTML={{ __html: part.html }} />;
    case 'image':
      return (
        <div className="part-image">
          <AntdImage src={part.url} alt={part.alt} width={180} style={{ borderRadius: 8 }} />
          {part.caption && <div className="part-image__caption">{part.caption}</div>}
        </div>
      );
    case 'file':
      return (
        <a className="part-file" href={part.url} target="_blank" rel="noreferrer">
          <span className="part-file__icon">{getFileIcon(part.name)}</span>
          <div className="part-file__meta">
            <div className="part-file__name">{part.name}</div>
            <div className="part-file__size">{formatSize(part.size)}</div>
          </div>
        </a>
      );

    // ===== 异步加载:扩展卡片 =====
    case 'thinking':
      return wrap(<ThinkingCard content={part.content} durationMs={part.durationMs} />, 60);
    case 'citation':
      return wrap(<CitationCard sources={part.sources} />, 100);
    case 'code':
      return wrap(
        <CodeCard language={part.language} content={part.content} filename={part.filename} />,
        140,
      );
    case 'chart':
      return wrap(
        <ChartCard chartType={part.chartType} title={part.title} data={part.data} />,
        280,
      );
    case 'suggestion':
      return wrap(<SuggestionCard items={part.items} onPick={onSuggestionPick} />, 60);
    case 'function_call':
      return wrap(
        <FunctionCallCard call={part.call} onRetry={onFunctionCallRetry} />,
        80,
      );
    case 'comparison':
      return wrap(<ComparisonCard title={part.title} items={part.items} />, 120);
    case 'image_group':
      return wrap(<ImageGroupCard data={part.data} />, 140);
    case 'image_understanding':
      return wrap(
        <ImageUnderstandingCard data={part.data} onPick={onSuggestionPick} />,
        180,
      );
    case 'file_parsed':
      return wrap(<FileParsedCard data={part.data} />, 160);
    case 'timeline':
      return wrap(<TimelineCard title={part.title} events={part.events} />, 100);
    case 'task_list':
      return wrap(<TaskListCard title={part.title} tasks={part.tasks} />, 120);

    default:
      return null;
  }
};
