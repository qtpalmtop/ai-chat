/**
 * 消息与 SSE 协议类型定义
 * - 大厂级 AI 对话前端的核心数据结构
 * - 一个 Message 由多个 Part 组成，支持文本/富文本/图片/文件/Markdown
 *   以及对齐豆包的高阶卡片：思维链 / 引用来源 / 代码块 / 图表 / 追问 / 工具调用 / 对比卡
 */

export type MessageRole = 'user' | 'assistant' | 'agent' | 'system';

export type MessageStatus =
  | 'pending' // 排队中
  | 'streaming' // SSE 流式写入中
  | 'done' // 正常结束
  | 'interrupted' // 用户主动停止
  | 'error'; // 出错

/** 用户对一条 AI 消息的反馈 */
export type MessageFeedback = 'like' | 'dislike' | null;

// ============== 复合 Part 内部数据结构 ==============

/** 引用来源：豆包风格的"出处"信息 */
export interface CitationSource {
  /** 引用序号（1, 2, 3...），与回答正文中的 [n] 标记对应 */
  index: number;
  title: string;
  url?: string;
  /** 来源域名（display 用，例如 "blog.example.com"） */
  source?: string;
  /** 抓取片段（可作为预览/折叠展示） */
  snippet?: string;
  /** 缩略图/图标 */
  favicon?: string;
}

/** 图表数据：豆包风格的"数据可视化"卡片 */
export interface ChartData {
  labels: string[];
  values: number[];
  /** 数值单位（"%" / "万" / "℃"） */
  unit?: string;
}

/** 对比卡片：豆包风格的"选项对比" */
export interface ComparisonItem {
  name: string;
  description?: string;
  /** 主指标 / 数值 */
  value?: string;
  /** 是否高亮（推荐项 / 优势项） */
  highlight?: boolean;
  /** emoji 或 icon 字符 */
  icon?: string;
}

/** 工具调用：豆包风格的"Function Call"卡片（对齐 Function Calling 协议） */
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

/** 图片理解：豆包"拍照问答"场景的回复卡片 */
export interface ImageUnderstanding {
  /** 用户上传的图片 url */
  imageUrl: string;
  /** AI 对图片的整体描述（OCR / 主体识别） */
  description: string;
  /** 抽取出的关键信息/标签 */
  tags?: string[];
  /** 进一步可问的问题（推荐追问子集） */
  followUpQuestions?: string[];
}

/** 文件解析：豆包"PDF/Word 总结"场景的回复卡片 */
export interface FileParsed {
  /** 原始文件名 */
  name: string;
  /** 文件总页数（PDF / Word 等） */
  pages?: number;
  /** 提取出的关键摘要 */
  summary: string;
  /** 关键要点列表 */
  keyPoints: string[];
  /** 解析耗时（毫秒） */
  durationMs?: number;
}

/** 时间线卡片：豆包风格的"事件发展顺序"展示 */
export interface TimelineEvent {
  /** 时间/阶段标签，如 "2024-Q1" / "Phase 1" */
  time: string;
  title: string;
  description?: string;
  /** 状态：完成 / 进行中 / 计划中 */
  status?: 'done' | 'current' | 'planned';
}

/** 任务清单：豆包"代办计划"风格的进度卡片 */
export interface TaskItem {
  label: string;
  done: boolean;
}

/** 图片组：多张图轮播 */
export interface ImageGroup {
  images: { url: string; alt?: string; caption?: string }[];
}

// ============== Part 联合类型 ==============

/** 单条消息片段（一个 Message 可包含多个 Part，按顺序渲染） */
export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'markdown'; content: string }
  | { type: 'rich'; html: string }
  | { type: 'image'; url: string; alt?: string; caption?: string }
  | { type: 'image_group'; data: ImageGroup }
  | { type: 'file'; name: string; size: number; url: string; mime?: string }
  // -------- 以下为对齐豆包扩展的高阶卡片 --------
  | { type: 'thinking'; content: string; durationMs?: number } // 思维链：可折叠的"深度思考"
  | { type: 'citation'; sources: CitationSource[] } // 引用来源：搜索结果出处
  | { type: 'code'; language: string; content: string; filename?: string } // 独立代码块卡片
  | { type: 'chart'; chartType: 'bar' | 'line' | 'pie' | 'radar'; title?: string; data: ChartData } // 数据图表
  | { type: 'suggestion'; items: string[] } // 推荐追问 chip 列表
  | { type: 'function_call'; call: FunctionCallPart } // 工具调用（Function Calling）
  | { type: 'comparison'; title?: string; items: ComparisonItem[] } // 对比卡（多列对照）
  | { type: 'image_understanding'; data: ImageUnderstanding } // 图片理解（拍照问答）
  | { type: 'file_parsed'; data: FileParsed } // 文件解析摘要（PDF/Word 总结）
  | { type: 'timeline'; title?: string; events: TimelineEvent[] } // 时间线（事件发展）
  | { type: 'task_list'; title?: string; tasks: TaskItem[] }; // 任务清单（含进度）

/** 一条完整消息 */
export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  parts: MessagePart[];
  status: MessageStatus;
  createdAt: number;
  /** 内部使用的流式 buffer，避免每 token 触发整体重渲染 */
  pendingText?: string;
  /** 用户反馈（点赞/点踩），仅 AI 消息使用 */
  feedback?: MessageFeedback;
  /** 当前使用的 SKILL（深度思考/联网/翻译/...），可空 */
  skill?: string;
}

// ============== Skill / 工具调用相关元数据 ==============

/** Skill 元数据：豆包顶部"人设/技能"切换器 */
export interface SkillMeta {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  /** 在提示词前注入的 system 片段（可空） */
  promptHint?: string;
}

/** 服务端声明的可用工具清单（对齐豆包 Function Calling） */
export interface ToolMeta {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ============== SSE 服务端事件 payload ==============

/** SSE payload：流式事件协议。type 与 MessagePart 保持一一对应（除控制事件外） */
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

// ============== Session（会话） ==============

/** 会话 */
export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}
