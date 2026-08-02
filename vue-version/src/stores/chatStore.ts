/**
 * Pinia 全局状态（对应 React 版的 chatStore）
 * - 会话列表 / 当前会话 / 消息映射
 * - 流式状态完全由 message.status === 'streaming' 表达（按会话天然隔离）
 * - 通过 pinia-plugin-persistedstate 持久化到 localStorage
 *
 * 与 React 版 Zustand 的关键差异：
 *   - state 是 ref，actions 是普通函数（无需 set((s) => ...)）
 *   - persist 通过插件配置
 *   - 派生数据用 getters（类似 Vuex）
 */

import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import type { Message, MessagePart, Session, MessageStatus } from '@/types/message';

interface State {
  sessions: Record<string, Session>;
  sessionIds: string[];
  messages: Record<string, Message[]>;
  currentSessionId: string | null;
  /** persist hydration 是否完成（localStorage → store 数据回填） */
  hasHydrated: boolean;
  /** 当前激活的 Skill id */
  activeSkillId: string | null;
}

export const useChatStore = defineStore('chat', {
  state: (): State => ({
    sessions: {},
    sessionIds: [],
    messages: {},
    currentSessionId: null,
    hasHydrated: false,
    activeSkillId: null,
  }),

  getters: {
    /** 派生：当前会话 */
    currentSession(state): Session | null {
      return state.currentSessionId ? state.sessions[state.currentSessionId] ?? null : null;
    },
    /** 派生：当前会话的消息列表 */
    currentMessages(state): readonly Message[] {
      return state.currentSessionId
        ? state.messages[state.currentSessionId] ?? EMPTY_MESSAGES
        : EMPTY_MESSAGES;
    },
    /** 派生：当前会话是否在流式生成中 */
    isCurrentStreaming(state): boolean {
      if (!state.currentSessionId) return false;
      const list = state.messages[state.currentSessionId];
      return !!list?.some((m) => m.status === 'streaming');
    },
  },

  actions: {
    setHasHydrated(v: boolean) {
      this.hasHydrated = v;
    },

    setActiveSkill(id: string | null) {
      this.activeSkillId = id;
    },

    createSession(title?: string): string {
      const id = nanoid(10);
      const now = Date.now();
      const session: Session = { id, title: title || '新对话', createdAt: now, updatedAt: now };
      this.sessions[id] = session;
      this.sessionIds = [id, ...this.sessionIds];
      this.currentSessionId = id;
      this.messages[id] = [];
      return id;
    },

    deleteSession(id: string) {
      delete this.sessions[id];
      delete this.messages[id];
      this.sessionIds = this.sessionIds.filter((x) => x !== id);
      if (this.currentSessionId === id) {
        this.currentSessionId = this.sessionIds[0] ?? null;
      }
    },

    renameSession(id: string, title: string) {
      const cur = this.sessions[id];
      if (!cur || cur.title === title) return;
      this.sessions[id] = { ...cur, title, updatedAt: Date.now() };
    },

    setCurrentSession(id: string) {
      this.currentSessionId = id;
    },

    clearAll() {
      this.sessions = {};
      this.sessionIds = [];
      this.messages = {};
      this.currentSessionId = null;
    },

    appendMessage(sessionId: string, msg: Message) {
      this.messages[sessionId] = [...(this.messages[sessionId] || []), msg];
    },

    updateMessageStatus(sessionId: string, messageId: string, status: MessageStatus) {
      this.updateMessageInList(sessionId, messageId, (m) => ({ ...m, status }));
    },

    appendPart(sessionId: string, messageId: string, part: MessagePart) {
      this.updateMessageInList(sessionId, messageId, (m) => ({
        ...m,
        parts: [...m.parts, part],
      }));
    },

    /** 内部 helper：在 messages[sessionId] 数组中按 id 找到并替换指定 message */
    updateMessageInList(
      sessionId: string,
      messageId: string,
      patch: (m: Message) => Message,
    ) {
      const list = this.messages[sessionId];
      if (!list) return;
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      const next = list.slice();
      next[idx] = patch(list[idx]);
      this.messages[sessionId] = next;
    },

    setPendingText(sessionId: string, messageId: string, pending: string) {
      this.updateMessageInList(sessionId, messageId, (m) => ({ ...m, pendingText: pending }));
    },

    finalizeStream(sessionId: string, messageId: string) {
      this.updateMessageInList(sessionId, messageId, (m) => closeStream(m, 'done'));
    },

    interruptStream(sessionId: string, messageId: string) {
      this.updateMessageInList(sessionId, messageId, (m) => closeStream(m, 'interrupted'));
    },

    /** 设置消息反馈（点赞/点踩） */
    setMessageFeedback(sessionId: string, messageId: string, feedback: 'like' | 'dislike' | null) {
      this.updateMessageInList(sessionId, messageId, (m) => ({ ...m, feedback }));
    },

    /** 截断消息列表：保留到 fromMessageId（含），之后的全部移除 */
    truncateAfter(sessionId: string, fromMessageId: string) {
      const list = this.messages[sessionId];
      if (!list) return;
      const idx = list.findIndex((m) => m.id === fromMessageId);
      if (idx === -1) return;
      this.messages[sessionId] = list.slice(0, idx + 1);
    },
  },

  // 持久化：仅业务数据
  persist: {
    key: 'doubao-chat-storage-vue',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    pick: ['sessions', 'sessionIds', 'messages', 'currentSessionId', 'activeSkillId'],
    afterHydrate: (ctx) => {
      // hydrate 完成后 setHasHydrated(true)，
      // 组件用此等待 hydration 完成后才进行"消息已加载"相关操作
      ctx.store.setHasHydrated(true);
    },
  },
});

/** 收尾：把 pendingText 落库为最后一个 markdown part，清空 buffer，置 status */
function closeStream(m: Message, status: 'done' | 'interrupted'): Message {
  if (m.status !== 'streaming') return m;
  const remaining = m.pendingText?.trim();
  const parts = m.parts.slice();
  if (remaining) {
    parts.push({ type: 'markdown', content: remaining });
  }
  return { ...m, parts, pendingText: undefined, status };
}

/** 稳定空数组 fallback：避免 getter 每次返回新引用 */
const EMPTY_MESSAGES: readonly Message[] = Object.freeze([]) as readonly Message[];
