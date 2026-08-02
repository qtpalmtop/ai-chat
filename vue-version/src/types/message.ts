/**
 * 消息与 SSE 协议类型定义（与 React 版同源）
 * - 对齐豆包：思维链 / 引用 / 代码块 / 图表 / 追问 / 工具调用 / 对比卡
 * - 新增：图片理解 / 文件解析 / 时间线 / 任务清单
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
  /** 已重试次数（用于展示，最多 3 次） */
  retries?: number;
  /** 工具描述（鼠标悬停展示） */
  description?: string;
}

/** 图片理解：豆包"拍照问答"场景 */
export interface ImageUnderstanding {
  imageUrl: string;
  description: string;
  tags?: string[];
  followUpQuestions?: string[];
}

/** 文件解析：豆包"PDF/Word 总结"场景 */
export interface FileParsed {
  name: string;
  pages?: number;
  summary: string;
  keyPoints: string[];
  durationMs?: number;
}

/** 时间线：事件发展顺序 */
export interface TimelineEvent {
  time: string;
  title: string;
  description?: string;
  status?: 'done' | 'current' | 'planned';
}

/** 任务清单 */
export interface TaskItem {
  label: string;
  done: boolean;
}

/** 图片组：多张图轮播 */
export interface ImageGroup {
  images: { url: string; alt?: string; caption?: string }[];
}

// ============== Part 联合类型 ==============

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'markdown'; content: string }
  | { type: 'rich'; html: string }
  | { type: 'image'; url: string; alt?: string; caption?: string }
  | { type: 'image_group'; data: ImageGroup }
  | { type: 'file'; name: string; size: number; url: string; mime?: string }
  | { type: 'thinking'; content: string; durationMs?: number }
  | { type: 'citation'; sources: CitationSource[] }
  | { type: 'code'; language: string; content: string; filename?: string }
  | { type: 'chart'; chartType: 'bar' | 'line' | 'pie' | 'radar'; title?: string; data: ChartData }
  | { type: 'suggestion'; items: string[] }
  | { type: 'function_call'; call: FunctionCallPart }
  | { type: 'comparison'; title?: string; items: ComparisonItem[] }
  | { type: 'image_understanding'; data: ImageUnderstanding }
  | { type: 'file_parsed'; data: FileParsed }
  | { type: 'timeline'; title?: string; events: TimelineEvent[] }
  | { type: 'task_list'; title?: string; tasks: TaskItem[] };

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
  | { type: 'image_group'; data: ImageGroup }
  | { type: 'file'; name: string; size: number; url: string; mime?: string }
  | { type: 'thinking'; content: string; durationMs?: number }
  | { type: 'citation'; sources: CitationSource[] }
  | { type: 'code'; language: string; content: string; filename?: string }
  | { type: 'chart'; chartType: 'bar' | 'line' | 'pie' | 'radar'; title?: string; data: ChartData }
  | { type: 'suggestion'; items: string[] }
  | { type: 'function_call'; call: FunctionCallPart }
  | { type: 'comparison'; title?: string; items: ComparisonItem[] }
  | { type: 'image_understanding'; data: ImageUnderstanding }
  | { type: 'file_parsed'; data: FileParsed }
  | { type: 'timeline'; title?: string; events: TimelineEvent[] }
  | { type: 'task_list'; title?: string; tasks: TaskItem[] }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };
