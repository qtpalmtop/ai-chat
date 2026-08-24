/**
 * Agent Store：客户端 / 客服端共享的 zustand store
 *
 * 职责分工：
 *   - useAgentSocket 负责 WS 连接 + 重连 + 心跳，只透传 SystemEvent
 *   - 本 store 负责把所有 SystemEvent 翻译成具体状态变更
 *   - 业务组件只订阅本 store，不直接接触 ws
 *
 * 两套独立子树：
 *   1. client: 客户端（AI 对话页）转人工相关
 *   2. workbench: 客服工作台（/agent 页面）相关
 *
 * 不持久化（实时状态，刷新页面重新连接即可）：
 *   - 队列位置 / 在线客服数 / 消息流
 *   - activeSessions（断线后由 server session_restored 恢复）
 *
 * 持久化（用户身份）：
 *   - clientUserId / agentId（断线重连需要）
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type { ConnectionStatus } from '@/hooks/useAgentSocket';
import type {
  SystemEvent,
  AgentSession,
  AgentWorkbench,
  AgentSessionStatus,
  QueueReason,
  AgentSuggestion,
  HistorySessionItem,
  HistorySessionDetail,
} from '@/types/agent';
import type { Message, MessagePart } from '@/types/message';
import { mergeMessagesById, sortMessagesByServerTime } from '@/utils/messageSort';

interface AgentState {
  // ===== 当前激活的身份模式 =====
  // 决定 onSystemEvent 事件路由到 clientSession 还是 workbench
  // 客户端页面挂载时设为 'client'，/agent 页面设为 'agent'
  mode: 'client' | 'agent' | null;
  setMode: (m: 'client' | 'agent' | null) => void;

  // ===== 用户身份（持久化）=====
  clientUserId: string | null;
  clientUserName: string | null;
  clientUserAvatar: string | null;
  agentId: string | null;
  agentName: string | null;
  agentAvatar: string | null;

  // ===== 客户端子状态 =====
  clientSession: AgentSession;
  clientConnection: ConnectionStatus;

  // ===== 客服端子状态 =====
  workbench: AgentWorkbench;

  // ===== 历史会话（共享，client / agent 都维护各自的列表）=====
  /** 历史会话摘要列表（按 endedAt 倒序） */
  historySessions: HistorySessionItem[];
  /** 历史会话详情缓存（点击列表项时 fetch 进来） */
  historySessionDetails: Record<string, HistorySessionDetail>;
  /** 正在加载的历史会话 sessionId */
  loadingHistorySessionId: string | null;

  // ===== Setters (identity) =====
  setClientIdentity: (id: string, name?: string, avatar?: string) => void;
  setAgentIdentity: (id: string, name?: string, avatar?: string) => void;

  // ===== 客户端 actions =====
  setClientConnection: (s: ConnectionStatus) => void;
  requestTransferHuman: (reason?: QueueReason) => void;
  cancelQueue: () => void;
  sendClientMessage: (parts: MessagePart[]) => string | null; // 返回 messageId
  endClientSession: () => void;

  // ===== 客服端 actions =====
  setWorkbenchConnection: (s: ConnectionStatus) => void;
  acceptQueue: (clientId: string) => void;
  sendAgentMessage: (sessionId: string, parts: MessagePart[]) => string | null;
  endAgentSession: (sessionId: string, reason?: string) => void;
  requestSuggestions: (sessionId: string) => void;
  clearSuggestions: (sessionId: string) => void;
  applySuggestion: (sessionId: string, suggestion: AgentSuggestion) => void; // 把推荐话术加入本地草稿

  // ===== 历史会话 actions =====
  /** 拉取/刷新历史会话列表（由 hook 层负责 ws 发送） */
  fetchHistory: () => void;
  /** 拉取指定 sessionId 的历史详情（由 hook 层负责 ws 发送） */
  fetchHistorySession: (sessionId: string) => void;
  /** 选中某个历史会话查看（仅 UI 状态） */
  selectHistorySession: (sessionId: string | null) => void;
  /** 当前选中的历史会话 id（UI 状态） */
  selectedHistorySessionId: string | null;

  // ===== 核心：事件入口 =====
  onSystemEvent: (event: SystemEvent) => void;
}

// ============== 初始状态 ==============

const emptyClientSession: AgentSession = {
  sessionId: null,
  clientId: '',
  status: 'idle',
  queuePosition: null,
  estimatedWaitSec: null,
  queueReason: null,
  agent: null,
  messages: [],
  startedAt: null,
  endedAt: null,
  endReason: null,
};

const emptyWorkbench: AgentWorkbench = {
  agent: null,
  activeSessions: {},
  pendingQueue: [],
  suggestions: {},
  streamingIntent: {},
  userInfoByClient: {},
  presence: { onlineAgents: 0, queueLength: 0 },
  connection: 'idle',
};

// ============== helpers ==============

/**
 * 在 messages 列表中按 id 查找下标
 * 抽出为 helper：避免在多处重复 `findIndex` 代码漂移
 */
function findMessageIndex(messages: Message[], id: string): number {
  return messages.findIndex((m) => m.id === id);
}

/**
 * 状态机守卫：避免非法状态转移覆盖（如 ended 后又收到 in_session 事件）
 */
function canTransition(from: AgentSessionStatus, to: AgentSessionStatus): boolean {
  // 终态只能被重置
  if (from === 'ended') return to === 'idle';
  if (from === 'error') return to === 'idle';
  if (from === 'idle') return to === 'queued' || to === 'inSession' || to === 'error';
  if (from === 'queued') return to === 'inSession' || to === 'ended' || to === 'error' || to === 'idle';
  if (from === 'inSession') return to === 'ended' || to === 'error' || to === 'idle';
  return false;
}

// ============== Store ==============

// 诊断：每次模块加载时打印，看是否有多个 store 实例
if (typeof window !== 'undefined') {
  console.log('[diag] agentStore module loaded, instance tag=', Math.random().toString(36).slice(2, 6));
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      // identity
      mode: null,
      clientUserId: null,
      clientUserName: null,
      clientUserAvatar: null,
      agentId: null,
      agentName: null,
      agentAvatar: null,

      // 状态
      clientSession: emptyClientSession,
      clientConnection: 'idle',
      workbench: emptyWorkbench,
      historySessions: [],
      historySessionDetails: {},
      loadingHistorySessionId: null,
      selectedHistorySessionId: null,

      setMode: (m) => set({ mode: m }),
      setClientIdentity: (id, name, avatar) =>
        set({
          clientUserId: id,
          clientUserName: name ?? null,
          clientUserAvatar: avatar ?? null,
        }),
      setAgentIdentity: (id, name, avatar) =>
        set({
          agentId: id,
          agentName: name ?? null,
          agentAvatar: avatar ?? null,
        }),

      setClientConnection: (s) => set({ clientConnection: s }),
      setWorkbenchConnection: (s) =>
        set((state) => ({ workbench: { ...state.workbench, connection: s } })),

      // ===== 客户端 actions =====

      requestTransferHuman: (reason) => {
        // 不直接调 ws，调用方应通过 useAgentSocket 发送
        // 这里只乐观更新 UI
        set((state) => {
          if (state.clientSession.status !== 'idle') return state;
          const next: AgentSession = {
            ...state.clientSession,
            status: 'queued',
            queueReason: reason || 'normal',
          };
          return { clientSession: next };
        });
      },
      cancelQueue: () => {
        set((state) => {
          if (state.clientSession.status !== 'queued') return state;
          return {
            clientSession: {
              ...emptyClientSession,
              clientId: state.clientSession.clientId,
            },
          };
        });
      },
      sendClientMessage: (parts) => {
        const { clientSession } = get();
        if (clientSession.status !== 'inSession') return null;
        const messageId = `m_${nanoid(12)}`;
        // 乐观追加：先加入本地列表，收到 server 转发时再按 id 去重
        const message: Message = {
          id: messageId,
          sessionId: clientSession.sessionId || '',
          role: 'user',
          parts,
          status: 'done',
          createdAt: Date.now(),
        };
        set((state) => ({
          clientSession: {
            ...state.clientSession,
            messages: [...state.clientSession.messages, message],
          },
        }));
        return messageId;
      },
      endClientSession: () => {
        set((state) => {
          if (state.clientSession.status !== 'inSession') return state;
          return {
            clientSession: {
              ...emptyClientSession,
              clientId: state.clientSession.clientId,
            },
          };
        });
      },

      // ===== 客服端 actions =====

      acceptQueue: (clientId) => {
        // ws 发送在 hook 层做，这里只乐观更新
        // 实际分配结果等 server queue_assigned
        void clientId;
      },
      sendAgentMessage: (sessionId, parts) => {
        const messageId = `m_${nanoid(12)}`;
        const message: Message = {
          id: messageId,
          sessionId,
          role: 'agent',
          parts,
          status: 'done',
          createdAt: Date.now(),
        };
        set((state) => {
          const sess = state.workbench.activeSessions[sessionId];
          if (!sess) return state;
          return {
            workbench: {
              ...state.workbench,
              activeSessions: {
                ...state.workbench.activeSessions,
                [sessionId]: { ...sess, messages: [...sess.messages, message] },
              },
            },
          };
        });
        return messageId;
      },
      endAgentSession: (sessionId) => {
        set((state) => {
          const { [sessionId]: _removed, ...rest } = state.workbench.activeSessions;
          const { [sessionId]: _s1, ...suggestions } = state.workbench.suggestions;
          const { [sessionId]: _s2, ...intents } = state.workbench.streamingIntent;
          void _s1;
          void _s2;
          return {
            workbench: {
              ...state.workbench,
              activeSessions: rest,
              suggestions,
              streamingIntent: intents,
            },
          };
        });
      },
      requestSuggestions: () => {
        // ws 发送在 hook 层做
      },
      clearSuggestions: (sessionId) => {
        set((state) => {
          const { [sessionId]: _removed, ...rest } = state.workbench.suggestions;
          void _removed;
          return { workbench: { ...state.workbench, suggestions: rest } };
        });
      },
      applySuggestion: (sessionId, suggestion) => {
        // 把推荐话术作为客服消息发送（通过 hook 层 send）
        // 这里只把 suggestions 标为已用（避免重复点击）
        set((state) => {
          const list = state.workbench.suggestions[sessionId] || [];
          const next = list.map((s) => (s.id === suggestion.id ? { ...s, applied: true } : s));
          return {
            workbench: {
              ...state.workbench,
              suggestions: { ...state.workbench.suggestions, [sessionId]: next },
            },
          };
        });
      },

      // ===== 历史会话 actions =====

      fetchHistory: () => {
        // 实际 ws 发送由 hook 层（useAgentWorkbench / useAgentSocket）负责
        // 这里只更新 loading 状态（防止 UI 上多次点击）
        void 0;
      },
      fetchHistorySession: (sessionId) => {
        set({ loadingHistorySessionId: sessionId });
        // ws 发送由 hook 层负责
        void 0;
      },
      selectHistorySession: (sessionId) => {
        set({ selectedHistorySessionId: sessionId });
      },

      // ===== 核心：事件入口 =====

      onSystemEvent: (event) => {
        const mode = get().mode;
        switch (event.type) {
          // ===== 排队相关 =====
          case 'queue_accepted': {
            if (mode !== 'client') return;
            set((state) => {
              if (!canTransition(state.clientSession.status, 'queued')) return state;
              return {
                clientSession: {
                  ...state.clientSession,
                  status: 'queued',
                  queuePosition: event.position,
                  estimatedWaitSec: event.estimatedWaitSec,
                  queueReason: event.reason || state.clientSession.queueReason,
                },
              };
            });
            break;
          }
          case 'queue_position': {
            if (mode !== 'client') return;
            set((state) => ({
              clientSession: {
                ...state.clientSession,
                queuePosition: event.position,
                estimatedWaitSec: event.estimatedWaitSec,
              },
            }));
            break;
          }
          case 'queue_assigned': {
            if (mode === 'client') {
              set((state) => ({
                clientSession: {
                  ...state.clientSession,
                  status: 'inSession',
                  sessionId: event.sessionId,
                  agent: {
                    agentId: event.agentId,
                    agentName: event.agentName,
                    agentAvatar: event.agentAvatar,
                  },
                  queuePosition: null,
                  estimatedWaitSec: null,
                  startedAt: Date.now(),
                },
              }));
            } else if (mode === 'agent') {
              // 客服端：新建 activeSession
              // 关键：直接用事件里的 clientId / userName / userAvatar 填入，
              // 不再等后续 message 事件补全——否则 UI 会立刻显示"用户 未知 / ?"
              set((state) => {
                if (state.workbench.activeSessions[event.sessionId]) return state; // 已有
                const newSession: AgentSession = {
                  sessionId: event.sessionId,
                  clientId: event.clientId || '',
                  status: 'inSession',
                  queuePosition: null,
                  estimatedWaitSec: null,
                  queueReason: null,
                  agent: {
                    agentId: event.agentId,
                    agentName: event.agentName,
                    agentAvatar: event.agentAvatar,
                  },
                  messages: [],
                  startedAt: Date.now(),
                  endedAt: null,
                  endReason: null,
                };
                return {
                  workbench: {
                    ...state.workbench,
                    activeSessions: {
                      ...state.workbench.activeSessions,
                      [event.sessionId]: newSession,
                    },
                    // 同时把 userName / userAvatar 存到 userInfo 缓存（让"用户 ？/未知"显示真实名字）
                    ...(event.userName || event.userAvatar
                      ? {
                          userInfoByClient: {
                            ...(state.workbench.userInfoByClient || {}),
                            [event.clientId || event.sessionId]: {
                              userName: event.userName,
                              userAvatar: event.userAvatar,
                            },
                          },
                        }
                      : {}),
                  },
                };
              });
            }
            break;
          }
          case 'queue_cancelled': {
            if (mode !== 'client') return;
            set((state) => ({
              clientSession: {
                ...emptyClientSession,
                clientId: state.clientSession.clientId,
              },
            }));
            break;
          }
          case 'queue_timeout': {
            if (mode !== 'client') return;
            set((state) => ({
              clientSession: {
                ...state.clientSession,
                status: 'ended',
                endReason: 'timeout',
                endedAt: Date.now(),
              },
            }));
            break;
          }

          // ===== 消息转发 =====
          case 'message': {
            const msg = event.message;
            if (mode === 'client') {
              set((state) => {
                if (!state.clientSession.sessionId) return state;
                if (msg.sessionId !== state.clientSession.sessionId) return state;
                if (findMessageIndex(state.clientSession.messages, msg.id) >= 0) return state;
                return {
                  clientSession: {
                    ...state.clientSession,
                    messages: [...state.clientSession.messages, msg],
                  },
                };
              });
            } else if (mode === 'agent') {
              set((state) => {
                const sess = state.workbench.activeSessions[msg.sessionId];
                if (!sess) return state;
                if (findMessageIndex(sess.messages, msg.id) >= 0) return state;
                return {
                  workbench: {
                    ...state.workbench,
                    activeSessions: {
                      ...state.workbench.activeSessions,
                      [msg.sessionId]: {
                        ...sess,
                        clientId: sess.clientId || (msg.role === 'user' ? 'unknown' : sess.clientId),
                        messages: [...sess.messages, msg],
                      },
                    },
                  },
                };
              });
            }
            break;
          }
          case 'message_ack': {
            // 已经在 send 时乐观添加，这里只更新时间戳（暂不处理）
            void event;
            break;
          }
          case 'typing': {
            // 暂不持久化 typing 状态（如需展示"对方正在输入"可加）
            void event;
            break;
          }

          // ===== 会话结束 =====
          case 'session_ended': {
            if (mode === 'client') {
              set((state) => {
                const reasonText =
                  event.reason === 'timeout'
                    ? '由于您长时间未发送消息，会话已自动结束'
                    : event.reason === 'agent'
                      ? '客服已结束本次会话'
                      : event.reason === 'user'
                        ? '您已结束本次会话'
                        : '本次会话已结束';
                // 把"会话已结束"作为系统消息插入聊天记录，
                // 用户能完整看到这段历史（与正常消息混排），
                // 而不是只在输入区看到一个占位提示
                const sysMsg: Message = {
                  id: `sys_${nanoid(12)}`,
                  sessionId: state.clientSession.sessionId || '',
                  role: 'system',
                  status: 'done',
                  createdAt: Date.now(),
                  parts: [{ type: 'text', content: reasonText }],
                };
                return {
                  clientSession: {
                    ...state.clientSession,
                    status: 'ended',
                    endReason: event.reason,
                    endedAt: Date.now(),
                    messages: [...state.clientSession.messages, sysMsg],
                  },
                };
              });
            } else if (mode === 'agent') {
              set((state) => {
                // 删除所有 inSession 的会话（实际应按 sessionId；会话已结束会进入 history 流）
                // 注：这里不主动注入 system 消息——客服视角下：
                //   1) 客服主动 endSession（reason='agent'）时，客服自己清楚"已结束"，不需要提示
                //   2) 用户主动 endSession 或 30s 超时时，UI 上 SessionList 会从"进行中"区移除该会话，
                //      且 history_list 会立即追加一条新条目，客服可在"历史会话"区看到完整记录
                // 客户端侧的 system 消息注入见上方的 `if (mode === 'client')` 分支
                const next: typeof state.workbench.activeSessions = {};
                for (const [sid, sess] of Object.entries(state.workbench.activeSessions)) {
                  if (sess.sessionId && sess.status === 'inSession' && sess.agent?.agentId === state.agentId) {
                    continue; // 结束
                  }
                  next[sid] = sess;
                }
                return { workbench: { ...state.workbench, activeSessions: next } };
              });
            }
            break;
          }
          case 'session_restored': {
            // 服务端在两种场景下推 session_restored：
            //   1) client 重连：恢复 clientSession.messages
            //   2) agent 重连：对它负责的每个活跃会话分别推一条 session_restored（带 sessionId）
            // 用 mergeMessagesById 合并：保留乐观追加但还没收到 ack 的消息，去重服务端已有的
            if (mode === 'client') {
              set((state) => ({
                clientSession: {
                  ...state.clientSession,
                  status: 'inSession',
                  // 保留 clientId（不要重置，断线重连不应影响 client 身份）
                  clientId: state.clientSession.clientId || state.clientUserId || '',
                  // sessionId 取 event.sessionId（带的话）否则用现有的
                  sessionId: event.sessionId || state.clientSession.sessionId,
                  messages: mergeMessagesById(
                    state.clientSession.messages,
                    event.messages,
                  ),
                  startedAt: state.clientSession.startedAt || Date.now(),
                },
              }));
            } else if (mode === 'agent' && event.sessionId) {
              set((state) => {
                const existing = state.workbench.activeSessions[event.sessionId!];
                if (existing) {
                  // 已有：merge 消息（保留本地的"草稿/未提交"消息）
                  return {
                    workbench: {
                      ...state.workbench,
                      activeSessions: {
                        ...state.workbench.activeSessions,
                        [event.sessionId!]: {
                          ...existing,
                          messages: mergeMessagesById(existing.messages, event.messages),
                        },
                      },
                    },
                  };
                }
                // 没有：新建（客服断线重连前已 queue_assigned 但还没 session_restored 的会话）
                // 注意：clientId / userName / userAvatar 等需要从其他来源补，
                // 暂时只填 messages，让 UI 显示"未知用户"——但这种情况几乎不会发生
                // （agent 不会在没有 userName 的情况下被分配）
                const newSession: AgentSession = {
                  sessionId: event.sessionId!,
                  clientId: '',
                  status: 'inSession',
                  queuePosition: null,
                  estimatedWaitSec: null,
                  queueReason: null,
                  agent: {
                    agentId: state.agentId || '',
                    agentName: state.agentName || '',
                    agentAvatar: state.agentAvatar ?? undefined,
                  },
                  messages: sortMessagesByServerTime(event.messages),
                  startedAt: Date.now(),
                  endedAt: null,
                  endReason: null,
                };
                return {
                  workbench: {
                    ...state.workbench,
                    activeSessions: {
                      ...state.workbench.activeSessions,
                      [event.sessionId!]: newSession,
                    },
                  },
                };
              });
            } else if (mode === 'agent' && !event.sessionId) {
              // 兼容老版本：event.sessionId 缺失时
              // 找到 agent 唯一的 inSession 会话（agent 只有一个 active session 的场景）
              set((state) => {
                const sessionIds = Object.keys(state.workbench.activeSessions);
                const targetId = sessionIds.find(
                  (sid) =>
                    state.workbench.activeSessions[sid]?.status === 'inSession' &&
                    state.workbench.activeSessions[sid]?.agent?.agentId === state.agentId,
                );
                if (!targetId) return state;
                return {
                  workbench: {
                    ...state.workbench,
                    activeSessions: {
                      ...state.workbench.activeSessions,
                      [targetId]: {
                        ...state.workbench.activeSessions[targetId],
                        messages: mergeMessagesById(
                          state.workbench.activeSessions[targetId].messages,
                          event.messages,
                        ),
                      },
                    },
                  },
                };
              });
            }
            break;
          }

          // ===== presence =====
          case 'presence': {
            if (mode === 'agent') {
              set((state) => ({
                workbench: {
                  ...state.workbench,
                  presence: {
                    onlineAgents: event.onlineAgents,
                    queueLength: event.queueLength,
                  },
                },
              }));
            } else if (mode === 'client') {
              // 客户端：仅在排队中时更新预计等待
              set((state) => {
                if (state.clientSession.status !== 'queued') return state;
                return {
                  clientSession: {
                    ...state.clientSession,
                    estimatedWaitSec: event.queueLength * 30,
                  },
                };
              });
            }
            break;
          }
          case 'queue_update': {
            if (mode !== 'agent') return;
            set((state) => ({
              workbench: {
                ...state.workbench,
                pendingQueue: event.items.map((it) => ({
                  clientId: it.clientId,
                  userName: it.userName,
                  userAvatar: it.userAvatar,
                  queuedAt: it.queuedAt,
                  reason: it.reason,
                  lastUserMessage: it.lastUserMessage,
                })),
              },
            }));
            break;
          }

          // ===== 智能推荐话术（只对客服端）=====
          case 'suggestion_start': {
            if (mode !== 'agent') return;
            set((state) => {
              const sessionIds = Object.keys(state.workbench.activeSessions);
              if (sessionIds.length === 0) return state;
              const sid = sessionIds[sessionIds.length - 1];
              return {
                workbench: {
                  ...state.workbench,
                  streamingIntent: {
                    ...state.workbench.streamingIntent,
                    [sid]: { intentId: event.intentId, category: event.category },
                  },
                },
              };
            });
            break;
          }
          case 'suggestion_chunk': {
            if (mode !== 'agent') return;
            set((state) => {
              // 找到对应的 sessionId
              let targetSid: string | null = null;
              for (const [sid, intent] of Object.entries(state.workbench.streamingIntent)) {
                if (intent && intent.intentId === event.intentId) {
                  targetSid = sid;
                  break;
                }
              }
              if (!targetSid) return state;
              const sid = targetSid;
              const existing = state.workbench.suggestions[sid] || [];
              const intent = state.workbench.streamingIntent[sid];
              // 找到当前 intent 对应的 suggestion（最后一个且 category 匹配 + id 前缀匹配）
              const last = existing[existing.length - 1];
              const isSameIntent =
                last &&
                intent &&
                last.category === intent.category &&
                last.id.startsWith(event.intentId);

              if (isSameIntent && last) {
                const updated: AgentSuggestion = {
                  ...last,
                  parts: [...last.parts, ...event.chunk],
                  preview: extractPreview(event.chunk, last.preview),
                };
                return {
                  workbench: {
                    ...state.workbench,
                    suggestions: {
                      ...state.workbench.suggestions,
                      [sid]: [...existing.slice(0, -1), updated],
                    },
                  },
                };
              }
              const newSuggestion: AgentSuggestion = {
                id: `${event.intentId}_${existing.length}`,
                category: intent?.category || '通用',
                reason: '智能识别',
                preview: extractPreview(event.chunk, ''),
                parts: [...event.chunk],
                createdAt: Date.now(),
              };
              return {
                workbench: {
                  ...state.workbench,
                  suggestions: {
                    ...state.workbench.suggestions,
                    [sid]: [...existing, newSuggestion],
                  },
                },
              };
            });
            if (event.done) {
              // 清掉 streamingIntent
              set((state) => {
                const next: typeof state.workbench.streamingIntent = {};
                for (const [sid, intent] of Object.entries(state.workbench.streamingIntent)) {
                  if (intent && intent.intentId !== event.intentId) {
                    next[sid] = intent;
                  }
                }
                return { workbench: { ...state.workbench, streamingIntent: next } };
              });
            }
            break;
          }

          // ===== 历史会话 =====
          case 'history_list': {
            // 增量或全量：按 sessionId 合并 + 按 endedAt 倒序
            set((state) => {
              const map = new Map<string, HistorySessionItem>();
              // 旧条目（被新列表替换/补充）
              for (const it of state.historySessions) map.set(it.sessionId, it);
              // 新条目（覆盖）
              for (const it of event.items) map.set(it.sessionId, it);
              const merged = Array.from(map.values()).sort((a, b) => b.endedAt - a.endedAt);
              return { historySessions: merged };
            });
            break;
          }
          case 'history_session': {
            set((state) => ({
              historySessionDetails: {
                ...state.historySessionDetails,
                [event.session.sessionId]: event.session,
              },
              loadingHistorySessionId: null,
            }));
            break;
          }

          // ===== 错误 =====
          case 'error': {
            console.error('[agent-ws] error event', event);
            // 拉取历史详情失败时清掉 loading
            set({ loadingHistorySessionId: null });
            break;
          }
        }
      },
    }),
    {
      name: 'doubao-agent-identity',
      // 只持久化身份信息，状态全部走实时
      partialize: (state) => ({
        clientUserId: state.clientUserId,
        clientUserName: state.clientUserName,
        clientUserAvatar: state.clientUserAvatar,
        agentId: state.agentId,
        agentName: state.agentName,
        agentAvatar: state.agentAvatar,
      }),
    },
  ),
);

/**
 * 提取 parts 的简短预览（用于推荐话术列表 hover 提示）
 */
function extractPreview(parts: MessagePart[], fallback: string): string {
  for (const p of parts) {
    if (p.type === 'text' || p.type === 'markdown') {
      return p.content.slice(0, 50);
    }
  }
  return fallback;
}
