/**
 * 客服系统状态（Pinia，对齐 React 端 store/agentStore.ts）
 *
 * 职责：
 *   - WebSocket 连接状态
 *   - 客户端：当前排队状态 / 已分配的 AgentSession
 *   - 客服端：activeSessions / pendingQueue / 智能推荐流
 *
 * 与 React 版的差异：
 *   - state 都是 ref；actions 是普通函数
 *   - 不再使用 Zustand 的 selector 模式，直接通过 storeToRefs 派生
 */

import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import type { Message, MessagePart } from '@/types/message';
import type {
  AgentSession,
  AgentConnection,
  AgentMode,
  PendingQueueItem,
  AgentSuggestion,
  StreamingIntentMeta,
  SystemEvent,
  QueueReason,
  HistorySessionItem,
  HistorySessionDetail,
} from '@/types/agent';

interface State {
  mode: AgentMode | null;
  connection: AgentConnection;
  /** 客户端 id（持久化在 localStorage） */
  clientId: string;
  /** 客服端：用户昵称 */
  userName: string;
  /** 客服端：当前客服 id */
  agentId: string;
  agentName: string;
  /** 客户端：排队状态 */
  clientSession: AgentSession | null;
  /** 客服端：所有活跃会话（key=sessionId） */
  workbench: {
    activeSessions: Record<string, AgentSession>;
    pendingQueue: PendingQueueItem[];
    /** 每个会话的推荐话术 */
    suggestions: Record<string, AgentSuggestion[]>;
    /** 每个会话当前流式推送中的 intent */
    streamingIntent: Record<string, StreamingIntentMeta | null>;
  };
  /** 在线客服数 / 排队总数 */
  presence: { onlineAgents: number; queueLength: number };
  /** 历史会话（按 endedAt 倒序） */
  historySessions: HistorySessionItem[];
  /** 历史会话详情缓存（key=sessionId） */
  historySessionDetails: Record<string, HistorySessionDetail>;
  /** 正在加载的历史会话 */
  loadingHistorySessionId: string | null;
  /** 当前选中的历史会话（UI 状态） */
  selectedHistorySessionId: string | null;
}

const STORAGE_KEY = 'vue_agent_state_v1';

function loadPersisted(): Partial<State> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const persisted = loadPersisted();

export const useAgentStore = defineStore('agent', {
  state: (): State => ({
    mode: null,
    connection: 'idle',
    clientId: persisted.clientId || `client-${nanoid(8)}`,
    userName: persisted.userName || `访客${Math.floor(Math.random() * 9999)}`,
    agentId: persisted.agentId || `agent-${nanoid(6)}`,
    agentName: persisted.agentName || '客服小张',
    clientSession: null,
    workbench: {
      activeSessions: {},
      pendingQueue: [],
      suggestions: {},
      streamingIntent: {},
    },
    presence: { onlineAgents: 0, queueLength: 0 },
    historySessions: [],
    historySessionDetails: {},
    loadingHistorySessionId: null,
    selectedHistorySessionId: null,
  }),

  getters: {
    isOpen: (state) => state.connection === 'open',
    activeList: (state) =>
      Object.values(state.workbench.activeSessions)
        .filter((s) => s.status === 'inSession')
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)),
  },

  actions: {
    /** 持久化（clientId/agentId/agentName） */
    persist() {
      if (typeof window === 'undefined') return;
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            clientId: this.clientId,
            userName: this.userName,
            agentId: this.agentId,
            agentName: this.agentName,
          }),
        );
      } catch {
        // ignore
      }
    },

    setMode(mode: AgentMode | null) {
      this.mode = mode;
    },

    setConnection(c: AgentConnection) {
      this.connection = c;
    },

    /** 客户端：进入排队 */
    enqueue(reason: QueueReason, lastUserMessage?: string) {
      this.clientSession = {
        status: 'queued',
        reason,
        lastUserMessage,
        messages: [],
        startedAt: null,
      };
    },

    /** 客户端：更新排队位置 */
    updateQueuePosition(position: number, estimatedWaitSec: number) {
      if (this.clientSession && this.clientSession.status === 'queued') {
        this.clientSession.queuePosition = position;
        this.clientSession.estimatedWaitSec = estimatedWaitSec;
      }
    },

    /** 客户端：分配客服 → 切换到 inSession */
    assignedSession(sessionId: string, agentId: string, agentName: string) {
      this.clientSession = {
        ...(this.clientSession || { messages: [] }),
        sessionId,
        agentId,
        agentName,
        status: 'inSession',
        queuePosition: undefined,
        estimatedWaitSec: undefined,
        startedAt: this.clientSession?.startedAt || Date.now(),
      };
    },

    /** 客户端：取消排队 */
    cancelQueue() {
      if (this.clientSession) {
        this.clientSession.status = 'idle';
        this.clientSession.queuePosition = undefined;
      }
    },

    /** 通用：添加消息到客户端会话 */
    appendClientMessage(msg: Message) {
      if (!this.clientSession) {
        this.clientSession = {
          status: 'inSession',
          messages: [],
          startedAt: Date.now(),
        };
      }
      this.clientSession.messages = [...this.clientSession.messages, msg];
    },

    /** 客服端：activeSessions 创建/更新 */
    upsertActiveSession(s: AgentSession) {
      if (!s.sessionId) return;
      this.workbench.activeSessions = {
        ...this.workbench.activeSessions,
        [s.sessionId]: s,
      };
    },

    /** 客服端：往指定 session 追加消息 */
    appendSessionMessage(sessionId: string, msg: Message) {
      const sess = this.workbench.activeSessions[sessionId];
      if (!sess) return;
      this.workbench.activeSessions = {
        ...this.workbench.activeSessions,
        [sessionId]: {
          ...sess,
          messages: [...sess.messages, msg],
        },
      };
    },

    /** 客服端：移除会话 */
    removeSession(sessionId: string) {
      const next = { ...this.workbench.activeSessions };
      delete next[sessionId];
      this.workbench.activeSessions = next;
    },

    /** 客服端：标记会话结束 */
    endSession(sessionId: string) {
      const sess = this.workbench.activeSessions[sessionId];
      if (!sess) return;
      this.workbench.activeSessions = {
        ...this.workbench.activeSessions,
        [sessionId]: { ...sess, status: 'ended', endedAt: Date.now() },
      };
    },

    /**
     * 把"会话已结束"作为 system 消息追加到指定 session 的消息列表中。
     * 替代原先在输入区/页头展示"已结束"卡片的做法——结束原因作为聊天历史的一部分
     * 才能让用户看到完整上下文（与 React 版 agentStore 一致）。
     */
    appendSystemEndedMessage(sessionId: string, reason: string) {
      const sess = this.workbench.activeSessions[sessionId];
      if (!sess) return;
      const reasonText =
        reason === 'timeout'
          ? '由于您长时间未发送消息，会话已自动结束'
          : reason === 'agent'
            ? '客服已结束本次会话'
            : reason === 'user'
              ? '您已结束本次会话'
              : '本次会话已结束';
      const sysMsg: Message = {
        id: `sys_ended_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        sessionId,
        role: 'system',
        status: 'done',
        createdAt: Date.now(),
        parts: [{ type: 'text', content: reasonText }],
      };
      this.workbench.activeSessions = {
        ...this.workbench.activeSessions,
        [sessionId]: { ...sess, messages: [...sess.messages, sysMsg] },
      };
    },

    /** 客服端：更新 pendingQueue */
    setPendingQueue(items: PendingQueueItem[]) {
      this.workbench.pendingQueue = items;
    },

    /** 客服端：presence */
    setPresence(onlineAgents: number, queueLength: number) {
      this.presence = { onlineAgents, queueLength };
    },

    /** 客服端：追加 recommendation */
    appendSuggestion(sessionId: string, s: AgentSuggestion) {
      const list = this.workbench.suggestions[sessionId] || [];
      const existing = list.findIndex((x) => x.id === s.id);
      let next: AgentSuggestion[];
      if (existing >= 0) {
        next = list.map((x, i) => (i === existing ? s : x));
      } else {
        next = [...list, s];
      }
      this.workbench.suggestions = { ...this.workbench.suggestions, [sessionId]: next };
    },

    setStreamingIntent(sessionId: string, meta: StreamingIntentMeta | null) {
      this.workbench.streamingIntent = {
        ...this.workbench.streamingIntent,
        [sessionId]: meta,
      };
    },

    clearSuggestions(sessionId: string) {
      const next = { ...this.workbench.suggestions };
      delete next[sessionId];
      this.workbench.suggestions = next;
    },

    markSuggestionApplied(sessionId: string, suggestionId: string) {
      const list = this.workbench.suggestions[sessionId];
      if (!list) return;
      this.workbench.suggestions = {
        ...this.workbench.suggestions,
        [sessionId]: list.map((x) => (x.id === suggestionId ? { ...x, applied: true } : x)),
      };
    },

    /** 标记历史会话 loading 状态（hook 层负责 ws 发送） */
    setLoadingHistory(sessionId: string) {
      this.loadingHistorySessionId = sessionId;
    },

    /** UI：选中某个历史会话 */
    selectHistorySession(sessionId: string | null) {
      this.selectedHistorySessionId = sessionId;
    },

    /** 统一入口：处理服务端 SystemEvent */
    handleSystemEvent(event: SystemEvent) {
      switch (event.type) {
        case 'queue_accepted': {
          this.updateQueuePosition(event.position, event.estimatedWaitSec);
          break;
        }
        case 'queue_position': {
          this.updateQueuePosition(event.position, event.estimatedWaitSec);
          break;
        }
        case 'queue_assigned': {
          this.assignedSession(event.sessionId, event.agentId, event.agentName);
          break;
        }
        case 'queue_cancelled': {
          this.cancelQueue();
          break;
        }
        case 'queue_timeout': {
          if (this.clientSession) {
            this.clientSession.status = 'idle';
          }
          break;
        }
        case 'message': {
          const m = event.message;
          if (m.role === 'user' || m.role === 'assistant') {
            this.appendClientMessage(m);
          }
          // 客服端：按 sessionId 路由
          if (m.sessionId && this.workbench.activeSessions[m.sessionId]) {
            this.appendSessionMessage(m.sessionId, m);
          }
          break;
        }
        case 'session_ended': {
          const sid = (event as any).sessionId as string | undefined;
          // 客户端：标记 ended（不重复追加 sysMsg：客户端无客服会话视图，appendClientMessage 不会进 clientSession.messages，
          // 这里保留旧逻辑仅切状态；如未来客户端也接 system 消息再做适配）
          if (this.clientSession?.sessionId === sid) {
            this.clientSession.status = 'ended';
          }
          // 客服端：往对应会话追加 system 结束消息，结束原因作为聊天历史的一部分
          if (this.mode === 'agent' && sid) {
            this.appendSystemEndedMessage(sid, event.reason);
          }
          break;
        }
        case 'session_restored': {
          if (this.clientSession) {
            this.clientSession.messages = event.messages;
          }
          break;
        }
        case 'presence': {
          this.setPresence(event.onlineAgents, event.queueLength);
          break;
        }
        case 'queue_update': {
          if (this.mode !== 'agent') break;
          this.setPendingQueue(event.items);
          break;
        }
        case 'suggestion_start': {
          if (this.mode !== 'agent') break;
          this.setStreamingIntent((event as any).sessionId || '', {
            intentId: event.intentId,
            category: event.category,
            startedAt: Date.now(),
          });
          break;
        }
        case 'suggestion_chunk': {
          if (this.mode !== 'agent') break;
          const sid = (event as any).sessionId || '';
          if (event.done) {
            this.setStreamingIntent(sid, null);
          } else if (event.chunk) {
            // 单 chunk 视为 1 个 suggestion（简化：服务端每个 chunk 是一个完整 suggestion）
            for (const part of event.chunk) {
              const id = `${event.intentId}-${Date.now()}`;
              this.appendSuggestion(sid, {
                id,
                category: (this.workbench.streamingIntent[sid]?.category) || '通用',
                reason: '服务端流式推荐',
                preview: extractPreview([part]),
                parts: [part],
                createdAt: Date.now(),
              });
            }
          }
          break;
        }
        case 'history_list': {
          // 增量或全量：按 sessionId 合并 + 按 endedAt 倒序
          const map = new Map<string, HistorySessionItem>();
          for (const it of this.historySessions) map.set(it.sessionId, it);
          for (const it of event.items) map.set(it.sessionId, it);
          this.historySessions = Array.from(map.values()).sort((a, b) => b.endedAt - a.endedAt);
          break;
        }
        case 'history_session': {
          this.historySessionDetails = {
            ...this.historySessionDetails,
            [event.session.sessionId]: event.session,
          };
          this.loadingHistorySessionId = null;
          break;
        }
        case 'error': {
          console.error('[agent] server error:', event);
          this.loadingHistorySessionId = null;
          break;
        }
      }
    },
  },
});

/** 从 parts 提取预览文本 */
function extractPreview(parts: MessagePart[]): string {
  for (const p of parts) {
    if (p.type === 'text' || p.type === 'markdown') return p.content.slice(0, 80);
    if (p.type === 'rich') return '[富文本]';
    if (p.type === 'image') return '[图片]';
    if (p.type === 'file') return `[文件] ${p.name}`;
    if (p.type === 'comparison') return p.title || '[对比卡]';
    if (p.type === 'chart') return p.title || '[图表]';
  }
  return '推荐话术';
}
