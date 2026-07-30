/**
 * PartRenderer - 渲染单条 part
 * - 基础类型：text / markdown / rich / image / file
 * - 高阶卡片（对齐豆包）：thinking / citation / code / chart / suggestion / function_call / comparison
 *
 * 复杂卡片单独拆为子组件，PartRenderer 仅做"按 type 分发"，保持简洁。
 */

import React, { useState } from 'react';
import { Tag, Image as AntdImage } from 'antd';
import {
  FileOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  CaretRightOutlined,
  LinkOutlined,
  GlobalOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  ThunderboltOutlined,
  CodeOutlined,
  PlayCircleOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import type {
  MessagePart,
  CitationSource,
  ChartData,
  FunctionCallPart,
  ComparisonItem,
} from '@/types/message';
import { MarkdownStream } from '@/components/MarkdownStream/MarkdownStream';

interface Props {
  part: MessagePart;
}

function formatSize(size: number) {
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / 1024 / 1024).toFixed(2) + ' MB';
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return <FileImageOutlined />;
  if (ext === 'pdf') return <FilePdfOutlined />;
  if (['txt', 'md', 'doc', 'docx'].includes(ext)) return <FileTextOutlined />;
  return <FileOutlined />;
}

// ============== 思维链卡片 ==============

const ThinkingCard: React.FC<{ content: string; durationMs?: number }> = ({ content, durationMs }) => {
  const [open, setOpen] = useState(false);
  const sec = durationMs ? (durationMs / 1000).toFixed(1) + 's' : '';
  return (
    <div className={`part-thinking ${open ? 'is-open' : ''}`}>
      <button className="part-thinking__head" onClick={() => setOpen((v) => !v)}>
        <span className="part-thinking__icon">
          <ThunderboltOutlined />
        </span>
        <span className="part-thinking__label">{open ? '已展开思考过程' : '已思考'}</span>
        {sec && <span className="part-thinking__meta">用时 {sec}</span>}
        <CaretRightOutlined className="part-thinking__caret" />
      </button>
      {open && <div className="part-thinking__body">{content}</div>}
    </div>
  );
};

// ============== 引用来源卡片 ==============

const CitationCard: React.FC<{ sources: CitationSource[] }> = ({ sources }) => {
  if (!sources?.length) return null;
  return (
    <div className="part-citation">
      <div className="part-citation__head">
        <GlobalOutlined /> <span>{sources.length} 个来源</span>
      </div>
      <div className="part-citation__list">
        {sources.map((s) => (
          <a
            key={s.index}
            className="part-citation__item"
            href={s.url || '#'}
            target="_blank"
            rel="noreferrer"
          >
            <span className="part-citation__num">[{s.index}]</span>
            <span className="part-citation__title">{s.title}</span>
            {s.source && <span className="part-citation__src">{s.source}</span>}
            {s.url && <LinkOutlined className="part-citation__link" />}
          </a>
        ))}
      </div>
    </div>
  );
};

// ============== 独立代码块卡片 ==============

const CodeCard: React.FC<{ language: string; content: string; filename?: string }> = ({
  language,
  content,
  filename,
}) => {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="part-code">
      <div className="part-code__head">
        <span className="part-code__lang">
          <CodeOutlined /> {filename || language || 'code'}
        </span>
        <div className="part-code__actions">
          <button className="part-code__btn" onClick={onCopy} title="运行（演示）">
            <PlayCircleOutlined /> 运行
          </button>
          <button className="part-code__btn" onClick={onCopy} title="复制">
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
      <pre className="part-code__pre">
        <code>{content}</code>
      </pre>
    </div>
  );
};

// ============== 图表卡片（纯 SVG 实现，零依赖） ==============

const ChartCard: React.FC<{ chartType: 'bar' | 'line' | 'pie'; title?: string; data: ChartData }> = ({
  chartType,
  title,
  data,
}) => {
  const W = 480;
  const H = 220;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const max = Math.max(...data.values, 1);

  return (
    <div className="part-chart">
      {title && <div className="part-chart__title">{title}</div>}
      <svg className="part-chart__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {/* 坐标轴 */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#e6e8ee" />
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#e6e8ee" />

        {chartType === 'bar' &&
          data.labels.map((label, i) => {
            const v = data.values[i] || 0;
            const x = PAD_L + ((i + 0.5) * innerW) / data.labels.length - 14;
            const y = PAD_T + innerH * (1 - v / max);
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y}
                  width={28}
                  height={H - PAD_B - y}
                  rx={4}
                  fill="url(#barGrad)"
                />
                <text
                  x={x + 14}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#1d2129"
                >
                  {v}
                  {data.unit || ''}
                </text>
                <text
                  x={x + 14}
                  y={H - PAD_B + 16}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#6b7280"
                >
                  {label}
                </text>
              </g>
            );
          })}

        {chartType === 'line' &&
          (() => {
            const points = data.values.map((v, i) => {
              const x = PAD_L + (i * innerW) / Math.max(data.values.length - 1, 1);
              const y = PAD_T + innerH * (1 - v / max);
              return [x, y] as const;
            });
            const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
            return (
              <>
                <path d={path} fill="none" stroke="url(#lineGrad)" strokeWidth="2.5" />
                {points.map(([x, y], i) => (
                  <g key={i}>
                    <circle cx={x} cy={y} r="4" fill="#4d6bfe" />
                    <text x={x} y={H - PAD_B + 16} textAnchor="middle" fontSize="11" fill="#6b7280">
                      {data.labels[i]}
                    </text>
                    <text x={x} y={y - 8} textAnchor="middle" fontSize="11" fill="#1d2129">
                      {data.values[i]}
                      {data.unit || ''}
                    </text>
                  </g>
                ))}
              </>
            );
          })()}

        {chartType === 'pie' &&
          (() => {
            const total = data.values.reduce((a, b) => a + b, 0) || 1;
            const cx = PAD_L + innerW / 2;
            const cy = PAD_T + innerH / 2;
            const r = Math.min(innerW, innerH) / 2 - 10;
            let acc = 0;
            const colors = ['#4d6bfe', '#7b5cff', '#34d399', '#f59e0b', '#ef4444', '#06b6d4'];
            return (
              <>
                {data.values.map((v, i) => {
                  const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
                  acc += v;
                  const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
                  const large = end - start > Math.PI ? 1 : 0;
                  const x1 = cx + r * Math.cos(start);
                  const y1 = cy + r * Math.sin(start);
                  const x2 = cx + r * Math.cos(end);
                  const y2 = cy + r * Math.sin(end);
                  return (
                    <path
                      key={i}
                      d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`}
                      fill={colors[i % colors.length]}
                      stroke="#fff"
                      strokeWidth="1.5"
                    />
                  );
                })}
              </>
            );
          })()}

        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7b5cff" />
            <stop offset="100%" stopColor="#4d6bfe" />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#4d6bfe" />
            <stop offset="100%" stopColor="#7b5cff" />
          </linearGradient>
        </defs>
      </svg>
      {chartType === 'pie' && (
        <div className="part-chart__legend">
          {data.labels.map((label, i) => {
            const colors = ['#4d6bfe', '#7b5cff', '#34d399', '#f59e0b', '#ef4444', '#06b6d4'];
            return (
              <span key={i} className="part-chart__legend-item">
                <i style={{ background: colors[i % colors.length] }} />
                {label} {data.values[i]}
                {data.unit || ''}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============== 推荐追问 chip 列表 ==============

const SuggestionCard: React.FC<{ items: string[]; onPick?: (s: string) => void }> = ({
  items,
  onPick,
}) => {
  if (!items?.length) return null;
  return (
    <div className="part-suggestion">
      <div className="part-suggestion__head">推荐追问</div>
      <div className="part-suggestion__list">
        {items.map((s, i) => (
          <button key={i} className="part-suggestion__chip" onClick={() => onPick?.(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
};

// ============== 工具调用卡片（Function Call） ==============

const FunctionCallCard: React.FC<{ call: FunctionCallPart }> = ({ call }) => {
  const [open, setOpen] = useState(true);
  const statusIcon = (() => {
    switch (call.status) {
      case 'pending':
        return <span className="part-fc__dot" />;
      case 'running':
        return <LoadingOutlined spin style={{ color: '#4d6bfe' }} />;
      case 'done':
        return <CheckCircleFilled style={{ color: '#22c55e' }} />;
      case 'error':
        return <CloseCircleFilled style={{ color: '#ef4444' }} />;
    }
  })();
  const statusText = {
    pending: '等待执行',
    running: '执行中',
    done: '已完成',
    error: '执行失败',
  }[call.status];

  return (
    <div className={`part-fc part-fc--${call.status}`}>
      <button className="part-fc__head" onClick={() => setOpen((v) => !v)}>
        <span className="part-fc__status">{statusIcon}</span>
        <span className="part-fc__name">
          <ExperimentOutlined /> 调用工具 <code>{call.name}</code>
        </span>
        <span className="part-fc__state">{statusText}</span>
        <CaretRightOutlined className="part-fc__caret" />
      </button>
      {open && (
        <div className="part-fc__body">
          <div className="part-fc__section">
            <div className="part-fc__label">参数</div>
            <pre className="part-fc__pre">
              <code>{JSON.stringify(call.args, null, 2)}</code>
            </pre>
          </div>
          {call.result !== undefined && (
            <div className="part-fc__section">
              <div className="part-fc__label">结果</div>
              <pre className="part-fc__pre">
                <code>{typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}</code>
              </pre>
            </div>
          )}
          {call.errorMessage && (
            <div className="part-fc__err">{call.errorMessage}</div>
          )}
        </div>
      )}
    </div>
  );
};

// ============== 对比卡片 ==============

const ComparisonCard: React.FC<{ title?: string; items: ComparisonItem[] }> = ({ title, items }) => {
  if (!items?.length) return null;
  return (
    <div className="part-comparison">
      {title && <div className="part-comparison__title">{title}</div>}
      <div className={`part-comparison__grid part-comparison__grid--${items.length}`}>
        {items.map((it, i) => (
          <div
            key={i}
            className={`part-comparison__item ${it.highlight ? 'is-highlight' : ''}`}
          >
            {it.icon && <div className="part-comparison__icon">{it.icon}</div>}
            <div className="part-comparison__name">{it.name}</div>
            {it.value && <div className="part-comparison__value">{it.value}</div>}
            {it.description && <div className="part-comparison__desc">{it.description}</div>}
          </div>
        ))}
      </div>
    </div>
  );
};

// ============== 分发器 ==============

export interface PartRendererProps extends Props {
  /** suggestion chip 点击回调：把推荐追问注入到输入区或直接发送 */
  onSuggestionPick?: (s: string) => void;
}

export const PartRenderer: React.FC<PartRendererProps> = ({ part, onSuggestionPick }) => {
  switch (part.type) {
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

    // ===== 对齐豆包扩展 =====
    case 'thinking':
      return <ThinkingCard content={part.content} durationMs={part.durationMs} />;
    case 'citation':
      return <CitationCard sources={part.sources} />;
    case 'code':
      return <CodeCard language={part.language} content={part.content} filename={part.filename} />;
    case 'chart':
      return <ChartCard chartType={part.chartType} title={part.title} data={part.data} />;
    case 'suggestion':
      return <SuggestionCard items={part.items} onPick={onSuggestionPick} />;
    case 'function_call':
      return <FunctionCallCard call={part.call} />;
    case 'comparison':
      return <ComparisonCard title={part.title} items={part.items} />;

    default:
      return null;
  }
};
