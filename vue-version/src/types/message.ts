/**
 * 消息与 SSE 协议类型定义（与 React 版同源）
 * - 对齐豆包：思维链 / 引用 / 代码块 / 图表 / 追问 / 工具调用 / 对比卡
 */

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageStatus = 'pending' | 'streaming' | 'done' | 'interrupted' | 'error';

/** 用户对一条 AI 消息的反馈 */
export type MessageFeedback = 'like' | 'dislike' | null;

// ============== 复合 Part 内部数据结构 ==============

export interface CitationSource {
  index: number;
  title: string;
  url?: string;
  source?: string;
  snippet?: string;
  favicon?: string;
}

export interface ChartData {
  labels: string[];
  values: number[];
  unit?: string;
}

export interface ComparisonItem {
  name: string;
  description?: string;
  value?: string;
  highlight?: boolean;
  icon?: string;
}

export interface FunctionCallPart {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'running' | 'done' | 'error';
  errorMessage?: string;
}

// ============== Part 联合类型 ==============

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'markdown'; content: string }
  | { type: 'rich'; html: string }
  | { type: 'image'; url: string; alt?: string; caption?: string }
  | { type: 'file'; name: string; size: number; url: string; mime?: string }
  | { type: 'thinking'; content: string; durationMs?: number }
  | { type: 'citation'; sources: CitationSource[] }
  | { type: 'code'; language: string; content: string; filename?: string }
  | { type: 'chart'; chartType: 'bar' | 'line' | 'pie'; title?: string; data: ChartData }
  | { type: 'suggestion'; items: string[] }
  | { type: 'function_call'; call: FunctionCallPart }
  | { type: 'comparison'; title?: string; items: ComparisonItem[] };

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  parts: MessagePart[];
  status: MessageStatus;
  createdAt: number;
  pendingText?: string;
  feedback?: MessageFeedback;
  skill?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface SkillMeta {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  promptHint?: string;
}

export interface ToolMeta {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ============== SSE payload ==============

export type SSEPayload =
  | { type: 'text'; content: string }
  | { type: 'markdown'; content: string }
  | { type: 'image'; url: string; alt?: string; caption?: string }
  | { type: 'file'; name: string; size: number; url: string; mime?: string }
  | { type: 'thinking'; content: string; durationMs?: number }
  | { type: 'citation'; sources: CitationSource[] }
  | { type: 'code'; language: string; content: string; filename?: string }
  | { type: 'chart'; chartType: 'bar' | 'line' | 'pie'; title?: string; data: ChartData }
  | { type: 'suggestion'; items: string[] }
  | { type: 'function_call'; call: FunctionCallPart }
  | { type: 'comparison'; title?: string; items: ComparisonItem[] }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };
