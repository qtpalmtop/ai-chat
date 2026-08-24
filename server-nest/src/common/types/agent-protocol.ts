/**
 * 公共类型：与前端 src/types/agent.ts 保持一一对应
 * 用 namespace 隔离命名空间，避免与模块的 Service/Entity 撞名
 */

// ============== 角色 & 状态 ==============

export type AgentSessionStatus =
  | 'idle'
  | 'queued'
  | 'inSession'
  | 'ended'
  | 'error';

export type QueueReason = 'normal' | 'vip' | 'after_hours' | 'all_busy';

export type SessionStatus = 'inSession' | 'ended';
export type HistoryEndReason = 'user' | 'agent' | 'timeout' | 'error';
export type MessageRole = 'user' | 'agent';

// ============== WS 协议 ==============

/** 服务端下行事件 */
export type SystemEvent =
  | {
      type: 'queue_accepted';
      position: number;
      estimatedWaitSec: number;
      reason?: QueueReason;
    }
  | { type: 'queue_position'; position: number; estimatedWaitSec: number }
  | {
      type: 'queue_assigned';
      agentId: string;
      agentName: string;
      agentAvatar?: string;
      /** 客户端 id（接收方是 agent 时必填，让客服端 UI 能立即显示用户信息） */
      clientId?: string;
      /** 用户名 / 头像（接收方是 agent 时填入，让 UI 不显示"未知"） */
      userName?: string;
      userAvatar?: string;
      sessionId: string;
    }
  | { type: 'queue_cancelled' }
  | { type: 'queue_timeout'; reason: string }
  | { type: 'message'; message: AgentMessageRecord; /** 服务端权威时间戳，客户端用作排序/去重 key */ serverTs: number }
  | { type: 'message_ack'; messageId: string; timestamp: number }
  | { type: 'typing'; from: 'user' | 'agent'; isTyping: boolean }
  | {
      type: 'session_ended';
      reason: HistoryEndReason;
      sessionId?: string;
    }
  | {
      type: 'session_restored';
      /**
       * 会话 id（客服端重连时可能有多个活跃会话，必须带；客户端通常只有一个活跃会话，可省略）
       * 不带时：表示"接收方唯一的活跃会话"，由接收方自行识别（兼容老版本）
       */
      sessionId?: string;
      messages: AgentMessageRecord[];
      /**
       * 服务端时间戳：本次拉取范围内最大的消息 createdAt
       * 客户端可用作下次 since 的起点（断网重连时不会重复也不会漏）
       * 不带时：客户端用 messages[messages.length-1].createdAt 作为下次 since
       */
      serverTs?: number;
    }
  | { type: 'presence'; onlineAgents: number; queueLength: number }
  | { type: 'history_list'; items: HistorySessionItem[] }
  | { type: 'history_session'; session: HistorySessionDetail }
  | {
      type: 'queue_update';
      items: QueueItem[];
    }
  | { type: 'error'; code: string; message: string }
  | { type: 'suggestion_start'; intentId: string; category: string }
  | {
      type: 'suggestion_chunk';
      intentId: string;
      chunk: unknown[];
      done: boolean;
    };

/** 客户端上行消息 */
export type ClientMessage =
  | {
      type: 'client.hello';
      clientId: string;
      userId: string;
      userName?: string;
      userAvatar?: string;
    }
  | { type: 'client.transfer_human'; reason?: string; category?: string }
  | { type: 'client.cancel_queue' }
  | { type: 'client.end_session' }
  | {
      type: 'client.send';
      messageId: string;
      parts: unknown[];
    }
  | { type: 'client.typing'; isTyping: boolean }
  | { type: 'client.fetch_history' }
  | { type: 'client.pong' };

/** 客服端上行消息 */
export type AgentMessage =
  | {
      type: 'agent.hello';
      agentId: string;
      agentName: string;
      agentAvatar?: string;
    }
  | { type: 'agent.accept_queue'; clientId: string }
  | { type: 'agent.list_pending' }
  | {
      type: 'agent.send';
      sessionId: string;
      messageId: string;
      parts: unknown[];
    }
  | { type: 'agent.typing'; sessionId: string; isTyping: boolean }
  | { type: 'agent.end_session'; sessionId: string; reason?: string }
  | {
      type: 'agent.request_suggestions';
      sessionId: string;
      context?: AgentMessageRecord[];
    }
  | {
      type: 'agent.fetch_suggestions';
      sessionId: string;
      context?: AgentMessageRecord[];
    }
  | {
      type: 'agent.use_suggestion';
      sessionId: string;
      suggestionId: string;
    }
  | { type: 'agent.fetch_history' }
  | { type: 'agent.fetch_history_session'; sessionId: string }
  | { type: 'agent.pong' };

/** 服务端下行的统一信封 */
export interface ServerEnvelope {
  seq: number;
  ts: number;
  payload: SystemEvent;
}

// ============== 业务数据结构 ==============

/** 排队项（推给客服端） */
export interface QueueItem {
  clientId: string;
  userName?: string;
  userAvatar?: string;
  queuedAt: number;
  reason: QueueReason;
  lastUserMessage?: string;
}

/** 会话内的一条消息（与前端 Message 一致） */
export interface AgentMessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  parts: unknown[];
  status: string;
  createdAt: number;
}

/** 历史会话摘要 */
export interface HistorySessionItem {
  sessionId: string;
  clientId: string;
  userName?: string;
  agentId: string;
  agentName?: string;
  startedAt: number;
  endedAt: number;
  endReason: HistoryEndReason;
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
  endReason: HistoryEndReason;
  messages: AgentMessageRecord[];
}
