/**
 * useChat - 核心对话逻辑 Hook
 * - sendMessage: 发送消息（支持文本 + 图片 + 文件）
 * - stop: 中断"当前会话"的生成
 * - 内部建立 EventSource，把每个 chunk 累积到 store
 * - 通过分段器 flush 已闭合 Markdown 段，避免每 token 重渲染整篇
 *
 * 关键不变量：
 *   - processedLength 记录已 flush 的 buffer 末尾位置
 *   - 每次只处理 buf.slice(processedLength) 的增量，避免重复 appendPart
 *   - abortMap 是 module-scope 单例（不是 useRef）：
 *     InputPanel 在切换会话时会被 key 重建，若用 useRef 持有句柄，
 *     新实例初始化会把老会话的 EventSource 一起关掉。
 *   - "是否在生成"完全由 message.status === 'streaming' 表达（不维护全局流式 id）
 */

import { useCallback } from 'react';
import { nanoid } from 'nanoid';
import { useChatStore } from '@/store/chatStore';
import { splitMarkdown } from '@/utils/markdown';
import type { Message, MessagePart, SSEPayload } from '@/types/message';

interface SendAttachments {
  images: { url: string; alt?: string }[];
  files: { name: string; size: number; url: string; mime?: string }[];
}

/** flush 节流间隔：80ms 一次，避免频繁触发分段器 + appendPart */
const FLUSH_INTERVAL_MS = 80;

/**
 * module-scope：跨 InputPanel 重建持久存在
 * key = sessionId, value = 关闭该会话 EventSource 的函数
 * 必须放 module 作用域：InputPanel 在切换会话时会被 key 重建，
 * useRef 持有句柄的话新实例初始化会把老会话的 EventSource 一起关掉
 */
const abortMap = new Map<string, () => void>();

/**
 * 关闭指定会话的 EventSource（如果有）
 * 幂等：abortMap 中不存在时直接返回
 */
function abortSession(sessionId: string) {
  const abort = abortMap.get(sessionId);
  if (!abort) return;
  abort();
  abortMap.delete(sessionId);
}

export function useChat() {
  const stop = useCallback(() => {
    const state = useChatStore.getState();
    const sessionId = state.currentSessionId;
    if (!sessionId) return;

    abortSession(sessionId);

    // 把当前会话里 status === 'streaming' 的消息收尾为「已停止」状态
    // （区别于 SSE 正常 done 事件触发的 'done'，便于 UI 区分展示）
    const streamingMsg = state.messages[sessionId]?.find((m) => m.status === 'streaming');
    if (streamingMsg) {
      state.interruptStream(sessionId, streamingMsg.id);
    }
  }, []);

  const sendMessage = useCallback((text: string, attachments: SendAttachments) => {
    const state = useChatStore.getState();
    let sessionId = state.currentSessionId;

    // 1) 当前会话正在 streaming：打断旧流（标 'interrupted'），再发新消息
    //    切到别的会话时：原会话仍在生成（不打断），新会话正常发
    if (sessionId) {
      const streaming = state.messages[sessionId]?.find((m) => m.status === 'streaming');
      if (streaming) {
        abortSession(sessionId);
        state.interruptStream(sessionId, streaming.id);
      }
    }

    if (!sessionId) {
      sessionId = state.createSession('新对话');
    }

    // 2) 重复消息（上一条 user 的文本相同）跳过——双击 / StrictMode 兜底
    if (sessionId) {
      const currentMsgs = state.messages[sessionId] || [];
      const last = currentMsgs[currentMsgs.length - 1];
      if (
        last?.role === 'user' &&
        last.status === 'done' &&
        last.parts
          .filter((p) => p.type === 'text')
          .map((p) => (p as Extract<MessagePart, { type: 'text' }>).content)
          .join('') === text
      ) {
        return;
      }
    }

    // 3) 追加 user 消息
    const userParts: MessagePart[] = [];
    if (text.trim()) userParts.push({ type: 'text', content: text });
    for (const img of attachments.images) {
      userParts.push({ type: 'image', url: img.url, alt: img.alt });
    }
    for (const f of attachments.files) {
      userParts.push({ type: 'file', name: f.name, size: f.size, url: f.url, mime: f.mime });
    }

    const userMsg: Message = {
      id: nanoid(10),
      sessionId,
      role: 'user',
      parts: userParts,
      status: 'done',
      createdAt: Date.now(),
    };
    state.appendMessage(sessionId, userMsg);

    // 4) 更新会话标题：首条消息前 16 字
    const cur = state.sessions[sessionId];
    if (cur?.title === '新对话' && text) {
      state.renameSession(sessionId, text.slice(0, 16) || '新对话');
    } else if (cur) {
      state.renameSession(sessionId, cur.title);
    }

    // 5) 创建占位 AI 消息（status: 'streaming' 即为"正在生成"的唯一真值源）
    const aiMsgId = nanoid(10);
    state.appendMessage(sessionId, {
      id: aiMsgId,
      sessionId,
      role: 'assistant',
      parts: [],
      status: 'streaming',
      createdAt: Date.now(),
      pendingText: '',
    });

    // 6) 建立 EventSource
    const params = new URLSearchParams({ prompt: text || '你好' });
    const es = new EventSource(`/api/chat/sse?${params.toString()}`);
    abortMap.set(sessionId, () => es.close());

    // ---------- 流式处理内部状态 ----------
    const fullBufferRef = { current: '' };
    let processedLength = 0; // 已 flush 到 parts 的 buffer 末尾
    let flushed = false;

    /** 直接把 pending 段写入 store（绕过 rAF，用于"必须同步"场景） */
    const flushPendingText = () => {
      const pending = fullBufferRef.current.slice(processedLength);
      useChatStore.setState((s) =>
        updateMessageInList(s, sessionId, aiMsgId, (m) => ({ ...m, pendingText: pending })),
      );
    };

    // rAF 节流 pendingText 写入：SSE 推送可能 50+ chunks/s，但视觉上 60fps 够用
    // 源头把 React 渲染压力降到 1/10 以下
    let pendingRafId: number | null = null;
    const schedulePendingUpdate = () => {
      if (pendingRafId !== null) return;
      pendingRafId = requestAnimationFrame(() => {
        pendingRafId = null;
        flushPendingText();
      });
    };

    /** 取消 rAF 排队（用于切到非文本段 / 流结束场景，避免 pendingText 滞后） */
    const cancelPendingUpdate = () => {
      if (pendingRafId !== null) {
        cancelAnimationFrame(pendingRafId);
        pendingRafId = null;
      }
    };

    const tryFlush = (force: boolean) => {
      const buf = fullBufferRef.current;
      const unprocessed = buf.slice(processedLength);
      if (!unprocessed) {
        if (force) useChatStore.getState().finalizeStream(sessionId, aiMsgId);
        return;
      }

      const { flushed: newFlushed, pending } = splitMarkdown(unprocessed);

      if (newFlushed.length > 0) {
        useChatStore.getState().appendPart(sessionId, aiMsgId, {
          type: 'markdown',
          content: newFlushed.join('\n\n'),
        });
        // 推进游标：unprocessed 中除 pending 之外的部分
        processedLength += unprocessed.length - pending.length;
      }

      flushPendingText();

      // 流结束：把最后的 pending 也作为 part 落库
      if (force && pending) {
        useChatStore.getState().appendPart(sessionId, aiMsgId, {
          type: 'markdown',
          content: pending,
        });
        processedLength = buf.length;
        flushPendingText();
      }
    };

    // 节流 flush：每 FLUSH_INTERVAL_MS 最多一次
    let flushScheduled = false;
    const scheduleFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      setTimeout(() => {
        flushScheduled = false;
        tryFlush(false);
      }, FLUSH_INTERVAL_MS);
    };

    // 切到非文本段 / 流结束的公共处理：取消 rAF + 强制 flush + 落 part
    const onNonTextBoundary = (part: MessagePart) => {
      cancelPendingUpdate();
      flushPendingText();
      tryFlush(true);
      useChatStore.getState().appendPart(sessionId, aiMsgId, part);
    };

    es.addEventListener('message', (e: MessageEvent) => {
      try {
        const payload: SSEPayload = JSON.parse(e.data);
        switch (payload.type) {
          case 'text':
          case 'markdown':
            fullBufferRef.current += payload.content;
            schedulePendingUpdate();
            scheduleFlush();
            break;
          case 'image':
            onNonTextBoundary({
              type: 'image',
              url: payload.url,
              alt: payload.alt,
            });
            break;
          case 'file':
            onNonTextBoundary({
              type: 'file',
              name: payload.name,
              size: payload.size,
              url: payload.url,
              mime: undefined,
            });
            break;
          // 'done' 走单独事件，不在这里处理
        }
      } catch (err) {
        console.warn('[SSE] parse', err);
      }
    });

    es.addEventListener('done', () => {
      // 流结束：取消 rAF 排队，直接同步落库（避免最后一帧延迟）
      cancelPendingUpdate();
      tryFlush(true);
      useChatStore.getState().finalizeStream(sessionId, aiMsgId);
      es.close();
      abortMap.delete(sessionId);
      flushed = true;
    });

    es.addEventListener('error', () => {
      cancelPendingUpdate();
      if (!flushed) {
        // 避免覆盖已经被 stop() / 新消息打断 设定的 'interrupted' 状态
        // 关闭 EventSource 也会触发 'error'，这时不应该把已打断的消息再标成 'error'
        const cur = useChatStore.getState().messages[sessionId]?.find((m) => m.id === aiMsgId);
        if (cur && cur.status !== 'interrupted' && cur.status !== 'done') {
          useChatStore.getState().updateMessageStatus(sessionId, aiMsgId, 'error');
        }
      }
      es.close();
      abortMap.delete(sessionId);
    });
  }, []);

  return { sendMessage, stop };
}

// ---------- 内部工具（与 store 中的同名工具保持独立：这是 setState 内联回调，需要返回 Partial<State>） ----------

/** 在 messages[sessionId] 数组中按 id 找到并替换指定 message */
function updateMessageInList(
  s: ReturnType<typeof useChatStore.getState>,
  sessionId: string,
  messageId: string,
  patch: (m: Message) => Message,
): Partial<ReturnType<typeof useChatStore.getState>> {
  const list = s.messages[sessionId];
  if (!list) return s;
  const idx = list.findIndex((m) => m.id === messageId);
  if (idx === -1) return s;
  const next = list.slice();
  next[idx] = patch(list[idx]);
  return { messages: { ...s.messages, [sessionId]: next } };
}
