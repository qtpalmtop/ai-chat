/**
 * 消息与 SSE 协议类型定义
 * - 大厂级 AI 对话前端的核心数据结构
 * - 一个 Message 由多个 Part 组成，支持文本/富文本/图片/文件/Markdown
 */

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageStatus =
  | 'pending' // 排队中
  | 'streaming' // SSE 流式写入中
  | 'done' // 正常结束
  | 'interrupted' // 用户主动停止
  | 'error'; // 出错

/** 单条消息片段（一个 Message 可包含多个 Part，按顺序渲染） */
export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'markdown'; content: string }
  | { type: 'rich'; html: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'file'; name: string; size: number; url: string; mime?: string };

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
}

/** 会话 */
export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** SSE 服务端事件 payload */
export type SSEPayload =
  | { type: 'text'; content: string }
  | { type: 'markdown'; content: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'file'; name: string; size: number; url: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };
