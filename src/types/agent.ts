/**
 * 客服工作台（Agent Workbench）类型定义
 *
 * 设计要点：
 *   1. 客户端/客服端共用一套消息数据结构，复用 MessagePart 表达
 *   2. WS 协议按"方向 + 主题"组织：client.*（用户发） / agent.*（客服发） / system.*（服务端推）
 *   3. 状态机清晰：idle → queued → inSession → ended，任何环节都能 cancel/timeout
 *   4. 推荐话术独立数据结构，支持图片/文件/卡片/富文本多种形式
 *   5. 客户端通过 MessageRole='agent' 复用现有 MessageItem / MessageVirtualList 渲染
 */

// ============== 角色 & 状态 ==============

/** Agent 会话状态机：覆盖转人工全流程 */
export type AgentSessionStatus =
  | 'idle' // 未发起转人工
  | 'queued' // 排队中，等待分配客服
  | 'inSession' // 已分配，正在和客服对话
  | 'ended' // 会话已结束
  | 'error'; // 异常（如 ws 断线/分配失败）

/** 排队中的等待原因（用于排队卡片文案） */
export type QueueReason = 'normal' | 'vip' | 'after_hours' | 'all_busy';

// ============== WS 协议 ==============

/** 服务端推送给客户端/客服端的 system 事件 */
export type SystemEvent =
  | { type: 'queue_accepted'; position: number; estimatedWaitSec: number; reason?: QueueReason }
  | { type: 'queue_position'; position: number; estimatedWaitSec: number }
  | {
      type: 'queue_assigned';
      /** 客服 id / 名称 / 头像（接收方是 agent 时是它自己，接收方是 client 时是分配给它的客服） */
      agentId: string;
      agentName: string;
      agentAvatar?: string;
      /** 客户端 id（接收方是 agent 时必填，让客服端 UI 能立即显示用户信息） */
      clientId?: string;
      /** 用户名 / 头像（同上，让客服端 UI 不显示"未知"） */
      userName?: string;
      userAvatar?: string;
      sessionId: string;
    }
  | { type: 'queue_cancelled' }
  | { type: 'queue_timeout'; reason: string }
  | { type: 'message'; message: import('./message').Message; serverTs: number }
  | { type: 'message_ack'; messageId: string; timestamp: number }
  | { type: 'typing'; from: 'user' | 'agent'; isTyping: boolean }
  | { type: 'session_ended'; reason: 'user' | 'agent' | 'timeout' | 'error'; sessionId?: string }
  | {
      type: 'session_restored';
      /** 会话 id（客服端重连时可能有多个活跃会话，必须带；客户端通常只有一个活跃会话，可省略） */
      sessionId?: string;
      messages: import('./message').Message[];
      /** 服务端时间戳：本次拉取范围内最大的消息 createdAt，可作为下次 since 的起点 */
      serverTs?: number;
    }
  | { type: 'presence'; onlineAgents: number; queueLength: number }
  // ===== 历史会话（仅 ended 状态的会话） =====
  // 服务端在客服端 / 客户端连接时立即推一次，后续 endSession 时增量追加
  | {
      type: 'history_list';
      /** 历史会话摘要列表（按 endedAt 倒序） */
      items: Array<HistorySessionItem>;
    }
  | {
      type: 'history_session';
      session: HistorySessionDetail;
    }
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
  | { type: 'error'; code: string; message: string }
  // 智能推荐话术（仅推送给客服端）：流式推送一组候选话术
  | { type: 'suggestion_start'; intentId: string; category: string }
  | { type: 'suggestion_chunk'; intentId: string; chunk: import('./message').MessagePart[]; done: boolean };

/** 客户端发往服务端的消息（用户身份） */
export type ClientMessage =
  | { type: 'client.hello'; clientId: string; userId: string; userName?: string; userAvatar?: string }
  | { type: 'client.transfer_human'; reason?: string; category?: string }
  | { type: 'client.cancel_queue' }
  | { type: 'client.end_session' }
  | { type: 'client.send'; messageId: string; parts: import('./message').MessagePart[] }
  | { type: 'client.typing'; isTyping: boolean }
  | { type: 'client.fetch_history' }
  | { type: 'client.pong' };

/** 客服端发往服务端的消息（客服身份） */
export type AgentMessage =
  | { type: 'agent.hello'; agentId: string; agentName: string; agentAvatar?: string }
  | { type: 'agent.accept_queue'; clientId: string }
  | { type: 'agent.list_pending' }
  | { type: 'agent.send'; sessionId: string; messageId: string; parts: import('./message').MessagePart[] }
  | { type: 'agent.typing'; sessionId: string; isTyping: boolean }
  | { type: 'agent.end_session'; sessionId: string; reason?: string }
  | { type: 'agent.request_suggestions'; sessionId: string; context: import('./message').Message[] }
  | { type: 'agent.fetch_history' }
  | { type: 'agent.fetch_history_session'; sessionId: string }
  | { type: 'agent.pong' };

/** 服务端下行的统一信封（payload 必须是 SystemEvent） */
export interface ServerEnvelope {
  /** 单调递增序号，用于客户端去重 / 排序 */
  seq: number;
  /** 该消息对应的时间戳（服务端时钟） */
  ts: number;
  payload: SystemEvent;
}

// ============== 智能推荐话术（客户端工具栏数据） ==============

/** 历史会话摘要（用于左侧列表展示） */
export interface HistorySessionItem {
  sessionId: string;
  clientId: string;
  userName?: string;
  agentId: string;
  agentName?: string;
  /** 会话开始时间戳 */
  startedAt: number;
  /** 会话结束时间戳 */
  endedAt: number;
  /** 结束原因：user / agent / timeout / error */
  endReason: 'user' | 'agent' | 'timeout' | 'error';
  /** 消息数量 */
  messageCount: number;
  /** 最近一条用户消息（用于列表预览） */
  lastUserMessage?: string;
  /** 最近一条客服消息（用于列表预览） */
  lastAgentMessage?: string;
}

/** 历史会话详情（点击列表项后查看完整消息） */
export interface HistorySessionDetail {
  sessionId: string;
  clientId: string;
  userName?: string;
  agentId: string;
  agentName?: string;
  startedAt: number;
  endedAt: number;
  endReason: 'user' | 'agent' | 'timeout' | 'error';
  messages: import('./message').Message[];
}

/** 一条推荐话术（点击后即作为客服消息发送） */
export interface AgentSuggestion {
  /** 唯一 id（本地生成即可） */
  id: string;
  /** 意图类别标签：退款/投诉/物流/优惠/咨询 ... */
  category: string;
  /** 推荐理由（识别到的用户意图简短描述） */
  reason: string;
  /** 话术正文（用于 hover 预览） */
  preview: string;
  /** 点击发送时的 parts 列表（支持多种卡片组合） */
  parts: import('./message').MessagePart[];
  /** 服务端 streaming 推送完成后给的信心度 0-1（可选） */
  confidence?: number;
  /** 服务端推送时间戳 */
  createdAt: number;
  /** 是否已被客服点击使用过（用于去重 / UI 灰显） */
  applied?: boolean;
}

// ============== 客户端 store 数据 ==============

/** Agent 会话快照（store 中的一个会话的全部状态） */
export interface AgentSession {
  /** 服务端分配的会话 id（排队分配后才有） */
  sessionId: string | null;
  /** 客户端本地用户 id（用于客服端反向路由） */
  clientId: string;
  /** 当前状态 */
  status: AgentSessionStatus;
  /** 排队位置（仅 queued 状态有意义，1 表示队首） */
  queuePosition: number | null;
  /** 预计等待秒数 */
  estimatedWaitSec: number | null;
  /** 排队原因（普通/会员/非工作时间/客服全忙） */
  queueReason: QueueReason | null;
  /** 已分配客服的信息 */
  agent: {
    agentId: string;
    agentName: string;
    agentAvatar?: string;
  } | null;
  /** 当前会话的消息列表（与 AI 消息共用 Message 结构，role='agent' 标识客服） */
  messages: import('./message').Message[];
  /** 会话开始时间戳 */
  startedAt: number | null;
  /** 会话结束时间戳 */
  endedAt: number | null;
  /** 会话结束原因（仅 ended 状态） */
  endReason: 'user' | 'agent' | 'timeout' | 'error' | null;
}

/** 客服端工作台快照 */
export interface AgentWorkbench {
  /** 客服身份 */
  agent: {
    agentId: string;
    agentName: string;
    agentAvatar?: string;
    online: boolean;
  } | null;
  /** 当前正在接待的会话列表（同时可接待多个） */
  activeSessions: Record<string, AgentSession>;
  /** 等待分配的排队用户列表（key = clientId） */
  pendingQueue: Array<{
    clientId: string;
    userName?: string;
    userAvatar?: string;
    queuedAt: number;
    reason: QueueReason;
    /** 用户最近一条消息（用于客服快速判断优先级） */
    lastUserMessage?: string;
  }>;
  /** 当前活跃会话的推荐话术（key = sessionId） */
  suggestions: Record<string, AgentSuggestion[]>;
  /** 当前正在 streaming 的意图（用于右侧工具栏显示加载态） */
  streamingIntent: Record<string, { intentId: string; category: string } | null>;
  /**
   * 用户信息缓存：key = clientId（fallback sessionId）
   * 解决 queue_assigned 事件投递过慢时 UI 显示"用户 ？/未知"的问题。
   * 在 onSystemEvent('queue_assigned') 收到 userName/userAvatar 时填充，
   * SessionList / MessageArea 等展示组件可优先从这里读。
   */
  userInfoByClient: Record<
    string,
    { userName?: string; userAvatar?: string }
  >;
  /** 服务端在线客服数 / 排队总数（用于顶部状态条） */
  presence: {
    onlineAgents: number;
    queueLength: number;
  };
  /** WS 连接状态 */
  connection: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';
}
