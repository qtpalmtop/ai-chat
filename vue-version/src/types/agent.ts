/**
 * 客服系统类型定义（Vue 版 - 对齐 React 端 src/types/agent.ts）
 */

import type { Message, MessagePart } from './message';

// 转人工原因
export type QueueReason = 'normal' | 'vip' | 'after_hours' | 'all_busy';

// 客服会话状态机
export type AgentSessionStatus = 'idle' | 'queued' | 'inSession' | 'ended';

export interface AgentSession {
  /** 服务端会话 id；assigned 后才有 */
  sessionId?: string;
  /** 用户端 clientId */
  clientId?: string;
  /** 用户昵称 */
  userName?: string;
  /** 用户头像 */
  userAvatar?: string;
  /** 状态 */
  status: AgentSessionStatus;
  /** 队列位置（queued 时有效） */
  queuePosition?: number;
  /** 预估等待秒数 */
  estimatedWaitSec?: number;
  /** 排队原因（与 QueueReason 同义，存到 session 上便于重连恢复） */
  reason?: QueueReason;
  /** 接入时间（assigned 后） */
  startedAt?: number | null;
  /** 结束时间 */
  endedAt?: number | null;
  /** 客服 id */
  agentId?: string;
  /** 客服名 */
  agentName?: string;
  /** 客服头像 */
  agentAvatar?: string;
  /** 当前会话消息 */
  messages: Message[];
  /** 最近一次用户消息文本（用于侧栏预览） */
  lastUserMessage?: string;
}

// 排队中的用户
export interface PendingQueueItem {
  clientId: string;
  userName?: string;
  userAvatar?: string;
  queuedAt: number;
  reason: QueueReason;
  lastUserMessage?: string;
}

// 推荐话术
export interface AgentSuggestion {
  id: string;
  category: string;
  reason: string;
  preview: string;
  parts: MessagePart[];
  confidence?: number;
  createdAt: number;
  applied?: boolean;
}

export type StreamingIntentMeta = {
  intentId: string;
  category: string;
  startedAt: number;
};

export type AgentConnection = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

// ============== WebSocket 协议 ==============

/** 服务端下行 envelope：{ seq, ts, payload } */
export interface ServerEnvelope {
  seq: number;
  ts: number;
  payload: SystemEvent;
}

export type ClientToServer =
  | { type: 'client.hello'; clientId: string; userId?: string; userName?: string; userAvatar?: string }
  | { type: 'client.transfer_human'; reason: QueueReason; lastUserMessage?: string; category?: string }
  | { type: 'client.cancel_queue' }
  | { type: 'client.send'; sessionId: string; parts: MessagePart[]; clientMsgId?: string }
  | { type: 'client.typing'; sessionId: string; isTyping: boolean }
  | { type: 'client.end_session'; sessionId: string }
  | { type: 'client.fetch_suggestions'; sessionId: string }
  | { type: 'client.fetch_history' }
  | { type: 'agent.hello'; agentId: string; agentName: string }
  | { type: 'agent.accept_queue'; clientId: string }
  | { type: 'agent.send'; sessionId: string; parts: MessagePart[]; clientMsgId?: string }
  | { type: 'agent.typing'; sessionId: string; isTyping: boolean }
  | { type: 'agent.end_session'; sessionId: string }
  | { type: 'agent.fetch_suggestions'; sessionId: string }
  | { type: 'agent.use_suggestion'; sessionId: string; suggestionId: string }
  | { type: 'agent.fetch_history' }
  | { type: 'agent.fetch_history_session'; sessionId: string }
  | { type: 'ping' };

export type SystemEvent =
  | { type: 'queue_accepted'; position: number; estimatedWaitSec: number; reason?: QueueReason }
  | { type: 'queue_position'; position: number; estimatedWaitSec: number }
  | {
      type: 'queue_assigned';
      agentId: string;
      agentName: string;
      agentAvatar?: string;
      /** 客户端 id（接收方是 agent 时必填，让客服端 UI 能立即显示用户信息） */
      clientId?: string;
      /** 用户名 / 头像（同上，避免 UI 显示"未知"） */
      userName?: string;
      userAvatar?: string;
      sessionId: string;
    }
  | { type: 'queue_cancelled' }
  | { type: 'queue_timeout'; reason: string }
  | { type: 'message'; message: Message; serverTs: number }
  | { type: 'message_ack'; messageId: string; timestamp: number }
  | { type: 'typing'; from: 'user' | 'agent'; isTyping: boolean }
  | { type: 'session_ended'; reason: 'user' | 'agent' | 'timeout' | 'error'; sessionId?: string }
  | {
      type: 'session_restored';
      /** 会话 id（客服端重连时可能有多个活跃会话，必须带；客户端通常只有一个活跃会话，可省略） */
      sessionId?: string;
      messages: Message[];
      /** 服务端时间戳：本次拉取范围内最大的消息 createdAt，可作为下次 since 的起点 */
      serverTs?: number;
    }
  | { type: 'presence'; onlineAgents: number; queueLength: number }
  | {
      type: 'queue_update';
      items: Array<{
        clientId: string;
        userName?: string;
        userAvatar?: string;
        queuedAt: number;
        reason: QueueReason;
        lastUserMessage?: string;
      }>;
    }
  | { type: 'history_list'; items: HistorySessionItem[] }
  | { type: 'history_session'; session: HistorySessionDetail }
  | { type: 'error'; code: string; message: string }
  | { type: 'suggestion_start'; intentId: string; category: string }
  | { type: 'suggestion_chunk'; intentId: string; chunk: MessagePart[]; done: boolean };

// 客户端 / 客服端 角色
export type AgentMode = 'client' | 'agent';

// ============== 历史会话 ==============

/** 历史会话摘要 */
export interface HistorySessionItem {
  sessionId: string;
  clientId: string;
  userName?: string;
  agentId: string;
  agentName?: string;
  startedAt: number;
  endedAt: number;
  endReason: 'user' | 'agent' | 'timeout' | 'error';
  messageCount: number;
  lastUserMessage?: string;
  lastAgentMessage?: string;
}

/** 历史会话详情 */
export interface HistorySessionDetail {
  sessionId: string;
  clientId: string;
  userName?: string;
  agentId: string;
  agentName?: string;
  startedAt: number;
  endedAt: number;
  endReason: 'user' | 'agent' | 'timeout' | 'error';
  messages: Message[];
}
