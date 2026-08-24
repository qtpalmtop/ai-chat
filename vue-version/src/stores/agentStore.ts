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
import { mergeMessagesById, sortMessagesByServerTime } from '@/utils/messageSort';

interface State {
  mode: AgentMode | null;
  connection: AgentConnection;
  /**
   * 客户端 id（持久化在 localStorage）。
   * 注意：字段名沿用 Vue 版现有的 clientId，UI 层不再另起 clientUserId 别名。
   * React 端用 clientUserId；为了不对外暴露两个字段，这里用 clientId 作为单一来源。
   */
  clientId: string;
  /** 客户端显示名 */
  userName: string;
  /** 客服端：当前客服 id */
  agentId: string;
  agentName: string;
  /** 客户端：排队/客服会话状态（idle/queued/inSession/ended） */
  clientSession: AgentSession;
  /** 客服端：所有活跃会话（key=sessionId） */
  workbench: {
    activeSessions: Record<string, AgentSession>;
    pendingQueue: PendingQueueItem[];
    /** 每个会话的推荐话术 */
    suggestions: Record<string, AgentSuggestion[]>;
    /** 每个会话当前流式推送中的 intent */
    streamingIntent: Record<string, StreamingIntentMeta | null>;
    /**
     * 用户信息缓存：key = clientId（fallback sessionId）
     * queue_assigned 事件写入，让 UI 不显示"用户 ?/未知"
     */
    userInfoByClient: Record<string, { userName?: string; userAvatar?: string }>;
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
    // 关键：默认是 idle 状态的 AgentSession 而非 null，
    // 与 React 端 emptyClientSession 对齐——让 InputPanel 的 clientSession.status 分支稳定工作
    clientSession: {
      status: 'idle',
      messages: [],
      startedAt: null,
    },
    workbench: {
      activeSessions: {},
      pendingQueue: [],
      suggestions: {},
      streamingIntent: {},
      userInfoByClient: {},
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

    /**
     * 设置客户端身份（与 React 端 setClientIdentity 对齐）。
     * 三个参数都是可选的，传哪个改哪个——未传的保留旧值。
     * 实际场景：mount 时 InputPanel 会传 id（生成/恢复 clientId）+ name（首次生成时设访客名）。
     */
    setClientIdentity(id?: string, name?: string) {
      if (id) this.clientId = id;
      if (name) this.userName = name;
      this.persist();
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
    assignedSession(
      sessionId: string,
      agentId: string,
      agentName: string,
      extra?: { agentAvatar?: string },
    ) {
      this.clientSession = {
        ...(this.clientSession || { status: 'idle', messages: [] }),
        sessionId,
        agentId,
        agentName,
        agentAvatar: extra?.agentAvatar,
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

    /**
     * 客户端：发起转人工请求
     * - 只乐观更新 UI（状态切到 'queued'）
     * - ws 发送由 InputPanel 调 useAgentSocket.send
     * - 实际分配结果等服务端 queue_assigned 事件
     *
     * 与 React 端 requestTransferHuman 行为对齐：仅当当前状态为 idle 时切换。
     * 若用户已 queued/inSession，重复点击不重复触发（避免服务端收到多次 queue 请求）。
     */
    requestTransferHuman(reason: QueueReason = 'normal') {
      if (!this.clientSession || this.clientSession.status !== 'idle') return;
      this.clientSession = {
        ...this.clientSession,
        status: 'queued',
        reason,
        messages: this.clientSession.messages || [],
        startedAt: this.clientSession.startedAt || null,
      };
    },

    /**
     * 客户端：乐观追加自己发送的消息
     * 关键：服务端 client.send 不会回 message 事件给客户端自己（只回 message_ack），
     * 所以必须 store 立即 push 让 UI 立刻刷新。handleSystemEvent 的 message 分支
     * 已加按 id 去重，重复回传也不会重复追加。
     */
    sendClientMessage(parts: MessagePart[]): string | null {
      if (!this.clientSession) return null;
      // 仅在客服会话中允许发消息；queued 阶段不能发（避免消息丢失）
      if (this.clientSession.status !== 'inSession') return null;
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const message: Message = {
        id: messageId,
        sessionId: this.clientSession.sessionId || '',
        role: 'user',
        parts,
        status: 'done',
        createdAt: Date.now(),
      };
      this.clientSession = {
        ...this.clientSession,
        messages: [...this.clientSession.messages, message],
      };
      return messageId;
    },

    /**
     * 客户端：主动结束客服会话
     * 把 clientSession 标记为 ended 但保留 clientId（用户身份），
     * 便于后续再次发起转人工。
     * 实际结束确认等服务端 session_ended 事件。
     */
    endClientSession() {
      if (!this.clientSession) return;
      if (this.clientSession.status !== 'inSession') return;
      this.clientSession = {
        ...this.clientSession,
        status: 'ended',
        endedAt: Date.now(),
      };
    },

    /** 通用：添加消息到客户端会话 */
    appendClientMessage(msg: Message) {
      if (!this.clientSession) {
        this.clientSession = {
          status: 'inSession',
          messages: [msg],
          startedAt: Date.now(),
        };
        return;
      }
      // 客户端：按 id 去重，避免乐观更新 + 服务端回传重复
      if (this.clientSession.messages.some((m) => m.id === msg.id)) return;
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

    /**
     * 客服端：乐观追加自己发送的消息
     * 关键：服务端 agent.send / agent.use_suggestion 不会回 message 事件给客服端自己
     * （只回 message_ack），所以必须在 store 这里立即 push，让 UI 立刻刷新。
     * handleSystemEvent 的 message 分支已加按 id 去重，重复回传也不会重复追加。
     */
    sendAgentMessage(sessionId: string, parts: MessagePart[]): string | null {
      const sess = this.workbench.activeSessions[sessionId];
      if (!sess) return null;
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const message: Message = {
        id: messageId,
        sessionId,
        role: 'agent',
        parts,
        status: 'done',
        createdAt: Date.now(),
      };
      this.workbench.activeSessions = {
        ...this.workbench.activeSessions,
        [sessionId]: { ...sess, messages: [...sess.messages, message] },
      };
      return messageId;
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
        id: `sys_${nanoid(12)}`,
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

    /**
     * 统一事件入口（与 React 端 onSystemEvent 对齐）
     * - 这是 useAgentSocket 注入的 onEvent 回调；
     * - 内部委托给 handleSystemEvent
     * - 加这一层包装是为未来扩展（如埋点、跨 store 同步）留余地
     */
    onSystemEvent(event: SystemEvent) {
      this.handleSystemEvent(event);
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
          if (this.mode === 'client') {
            this.assignedSession(event.sessionId, event.agentId, event.agentName, {
              agentAvatar: event.agentAvatar,
            });
          } else if (this.mode === 'agent') {
            // 客服端：创建 activeSession + 写入 userInfoByClient
            // 关键：直接用事件里的 userName / userAvatar 缓存，
            // 不再等后续 message 事件补全——避免 UI 立刻显示"用户 ?/未知"
            const key = event.clientId || event.sessionId;
            if (event.userName || event.userAvatar) {
              this.workbench.userInfoByClient = {
                ...this.workbench.userInfoByClient,
                [key]: { userName: event.userName, userAvatar: event.userAvatar },
              };
            }
            this.upsertActiveSession({
              sessionId: event.sessionId,
              clientId: event.clientId || '',
              userName: event.userName,
              userAvatar: event.userAvatar,
              agentId: event.agentId,
              agentName: event.agentName,
              agentAvatar: event.agentAvatar,
              status: 'inSession',
              startedAt: Date.now(),
              messages: [],
            });
          }
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
          // 客户端：所有非自己发的消息（agent / assistant / system）都进 clientSession.messages
          // 注意：role='user' 在客户端模式下也走这里（user 发的自己已在 sendClientMessage 乐观加入，
          //   appendClientMessage 已按 id 去重，重复回传不会重复追加）
          if (this.mode === 'client') {
            this.appendClientMessage(m);
          }
          // 客服端：按 sessionId 路由（按 id 去重，避免乐观消息和服务端回传重复）
          if (m.sessionId && this.workbench.activeSessions[m.sessionId]) {
            const sess = this.workbench.activeSessions[m.sessionId];
            if (sess.messages.some((x) => x.id === m.id)) return;
            this.appendSessionMessage(m.sessionId, m);
          }
          break;
        }
        case 'session_ended': {
          const sid = (event as any).sessionId as string | undefined;
          // 客户端：标记 ended + 追加 system 消息（与 React 端一致，让用户看到完整结束说明）
          if (this.clientSession && this.clientSession.sessionId === sid) {
            const reasonText =
              event.reason === 'timeout'
                ? '由于您长时间未发送消息，会话已自动结束'
                : event.reason === 'agent'
                  ? '客服已结束本次会话'
                  : event.reason === 'user'
                    ? '您已结束本次会话'
                    : '本次会话已结束';
            const sysMsg: Message = {
              id: `sys_${nanoid(12)}`,
              sessionId: sid || '',
              role: 'system',
              status: 'done',
              createdAt: Date.now(),
              parts: [{ type: 'text', content: reasonText }],
            };
            this.clientSession = {
              ...this.clientSession,
              status: 'ended',
              endedAt: Date.now(),
              messages: [...this.clientSession.messages, sysMsg],
            };
          }
          // 客服端：往对应会话追加 system 结束消息，结束原因作为聊天历史的一部分
          if (this.mode === 'agent' && sid) {
            this.appendSystemEndedMessage(sid, event.reason);
          }
          break;
        }
        case 'session_restored': {
          // 服务端在两种场景下推 session_restored：
          //   1) client 重连：恢复 clientSession.messages
          //   2) agent 重连：对它负责的每个活跃会话分别推一条 session_restored（带 sessionId）
          // 用 mergeMessagesById 合并：保留乐观追加但还没收到 ack 的消息，去重服务端已有的
          if (this.mode === 'client') {
            if (this.clientSession) {
              this.clientSession.messages = mergeMessagesById(
                this.clientSession.messages,
                event.messages,
              );
              if (event.sessionId) this.clientSession.sessionId = event.sessionId;
            }
          } else if (this.mode === 'agent' && event.sessionId) {
            const sid = event.sessionId;
            const existing = this.workbench.activeSessions[sid];
            if (existing) {
              // 已有：merge 消息（保留本地的"草稿/未提交"消息）
              existing.messages = mergeMessagesById(existing.messages, event.messages);
            } else {
              // 没有：新建（agent 断线重连前已 queue_assigned 但还没 session_restored 的会话）
              this.workbench.activeSessions[sid] = {
                sessionId: sid,
                clientId: '',
                status: 'inSession',
                queuePosition: undefined,
                estimatedWaitSec: undefined,
                reason: undefined,
                agentId: this.agentId,
                agentName: this.agentName,
                agentAvatar: undefined,
                messages: sortMessagesByServerTime(event.messages),
                startedAt: Date.now(),
                endedAt: null,
              };
            }
          } else if (this.mode === 'agent' && !event.sessionId) {
            // 兼容老版本：event.sessionId 缺失时
            // 找到 agent 唯一的 inSession 会话
            const targetId = Object.keys(this.workbench.activeSessions).find(
              (s) =>
                this.workbench.activeSessions[s]?.status === 'inSession' &&
                this.workbench.activeSessions[s]?.agentId === this.agentId,
            );
            if (targetId) {
              const tgt = this.workbench.activeSessions[targetId];
              tgt.messages = mergeMessagesById(tgt.messages, event.messages);
            }
          }
          break;
        }
        case 'message_ack': {
          // 客户端：服务端确认已收到 sendClientMessage 发的消息。
          // 由于 sendClientMessage 已经乐观追加，这里无需再 push；
          // 这里保留为 hook 点（如未来要做"送达/已读"标识可在此处扩展）。
          if (this.mode === 'client' && this.clientSession) {
            // 找到对应的本地消息，更新 createdAt 戳记为服务端确认时间（未来扩展）
            void event;
          }
          break;
        }
        case 'typing': {
          // 暂不持久化 typing 状态（与 React 端一致）
          // 如需展示"客服正在输入"可加 isAgentTyping 字段
          void event;
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
