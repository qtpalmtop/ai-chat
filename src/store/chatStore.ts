/**
 * Zustand 全局状态
 * - 会话列表 / 当前会话 / 消息映射
 * - 流式状态完全由 message.status === 'streaming' 表达（按会话天然隔离）
 * - 通过 persist 中间件持久化到 localStorage
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type { Message, MessagePart, Session, MessageStatus } from '@/types/message';

interface ChatState {
  sessions: Record<string, Session>;
  sessionIds: string[];
  messages: Record<string, Message[]>;
  currentSessionId: string | null;
  /** persist hydration 是否完成（localStorage → store 数据回填） */
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;

  // 会话操作
  createSession: (title?: string) => string;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setCurrentSession: (id: string) => void;
  clearAll: () => void;

  // 消息操作
  appendMessage: (sessionId: string, msg: Message) => void;
  updateMessageStatus: (sessionId: string, messageId: string, status: MessageStatus) => void;
  appendPart: (sessionId: string, messageId: string, part: MessagePart) => void;
  /** 流式结束：把 pendingText 转为正式 part，并把 status 置为 done */
  finalizeStream: (sessionId: string, messageId: string) => void;
  /** 主动打断流式：同 finalizeStream，但 status 置为 'interrupted'（用户主动停止 / 被新消息打断） */
  interruptStream: (sessionId: string, messageId: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      sessions: {},
      sessionIds: [],
      messages: {},
      currentSessionId: null,
      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),

      createSession: (title) => {
        const id = nanoid(10);
        const now = Date.now();
        const session: Session = {
          id,
          title: title || '新对话',
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          sessions: { ...s.sessions, [id]: session },
          sessionIds: [id, ...s.sessionIds],
          currentSessionId: id,
          messages: { ...s.messages, [id]: [] },
        }));
        return id;
      },

      deleteSession: (id) => {
        set((s) => {
          const { [id]: _removed, ...sessions } = s.sessions;
          const { [id]: _msgs, ...messages } = s.messages;
          const sessionIds = s.sessionIds.filter((x) => x !== id);
          return {
            sessions,
            sessionIds,
            messages,
            currentSessionId:
              s.currentSessionId === id ? sessionIds[0] ?? null : s.currentSessionId,
          };
        });
      },

      renameSession: (id, title) => {
        set((s) => {
          const cur = s.sessions[id];
          if (!cur || cur.title === title) return s;
          return {
            sessions: {
              ...s.sessions,
              [id]: { ...cur, title, updatedAt: Date.now() },
            },
          };
        });
      },

      setCurrentSession: (id) => set({ currentSessionId: id }),

      clearAll: () => {
        set({
          sessions: {},
          sessionIds: [],
          messages: {},
          currentSessionId: null,
        });
      },

      appendMessage: (sessionId, msg) => {
        set((s) => ({
          messages: {
            ...s.messages,
            [sessionId]: [...(s.messages[sessionId] || []), msg],
          },
        }));
      },

      updateMessageStatus: (sessionId, messageId, status) => {
        set((s) => updateMessageInList(s, sessionId, messageId, (m) => ({ ...m, status })));
      },

      appendPart: (sessionId, messageId, part) => {
        set((s) =>
          updateMessageInList(s, sessionId, messageId, (m) => ({
            ...m,
            parts: [...m.parts, part],
          })),
        );
      },

      finalizeStream: (sessionId, messageId) => {
        set((s) =>
          updateMessageInList(s, sessionId, messageId, (m) => closeStream(m, 'done')),
        );
      },

      interruptStream: (sessionId, messageId) => {
        set((s) =>
          updateMessageInList(s, sessionId, messageId, (m) => closeStream(m, 'interrupted')),
        );
      },
    }),
    {
      name: 'doubao-chat-storage',
      partialize: (s) => ({
        sessions: s.sessions,
        sessionIds: s.sessionIds,
        messages: s.messages,
        currentSessionId: s.currentSessionId,
      }),
      // hydration 完成回调：把 hasHydrated 置 true
      // 组件用此等待 hydration 完成后才进行"消息已加载"相关操作
      // （例如：刷新页面后 ChatWindow 必须等 hydration 完成再 scrollTo 到底，
      // 否则 messages.length 还是 0，scrollTop 滚到的是 WelcomePanel 高度）
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

// ---------- 内部工具 ----------

type Store = ChatState;

/**
 * 在 messages[sessionId] 数组中按 id 找到并替换指定 message。
 * 没找到或目标引用未变时返回原 state（避免无意义的 re-render）。
 */
function updateMessageInList(
  s: Store,
  sessionId: string,
  messageId: string,
  patch: (m: Message) => Message,
): Partial<Store> {
  const list = s.messages[sessionId];
  if (!list) return s;
  const idx = list.findIndex((m) => m.id === messageId);
  if (idx === -1) return s;
  const next = list.slice();
  next[idx] = patch(list[idx]);
  return { messages: { ...s.messages, [sessionId]: next } };
}

/** 把流式中消息收尾：把 pendingText 落库成最后一个 markdown part，清空 buffer，置 status */
function closeStream(m: Message, status: 'done' | 'interrupted'): Message {
  if (m.status !== 'streaming') return m; // 已收尾过，跳过
  const remaining = m.pendingText?.trim();
  const parts = m.parts.slice();
  if (remaining) {
    parts.push({ type: 'markdown', content: remaining });
  }
  return { ...m, parts, pendingText: undefined, status };
}

// ---------- 派生 hooks ----------

/** 稳定的空数组 fallback：避免 selector 每次返回新引用 */
const EMPTY_MESSAGES: readonly Message[] = Object.freeze([]) as readonly Message[];

/** 派生：当前会话 */
export const useCurrentSession = (): Session | null => {
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  return useChatStore((s) => (currentSessionId ? s.sessions[currentSessionId] ?? null : null));
};

/** 派生：当前会话的消息列表（无当前会话时返回稳定空数组） */
export const useCurrentMessages = (): readonly Message[] => {
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  return useChatStore((s) =>
    currentSessionId ? s.messages[currentSessionId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES,
  );
};
