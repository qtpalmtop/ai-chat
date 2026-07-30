/**
 * 消息与 SSE 协议类型定义（与 React 版同源）
 */

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageStatus = 'pending' | 'streaming' | 'done' | 'interrupted' | 'error';

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'markdown'; content: string }
  | { type: 'rich'; html: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'file'; name: string; size: number; url: string; mime?: string };

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  parts: MessagePart[];
  status: MessageStatus;
  createdAt: number;
  pendingText?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type SSEPayload =
  | { type: 'text'; content: string }
  | { type: 'markdown'; content: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'file'; name: string; size: number; url: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };
