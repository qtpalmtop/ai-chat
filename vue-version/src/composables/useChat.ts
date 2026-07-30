/**
 * useChat - 核心对话逻辑 Composable（对应 React 版的 useChat hook）
 * - sendMessage: 发送消息（支持文本 + 图片 + 文件）
 * - stop: 中断"当前会话"的生成
 * - 内部建立 EventSource，把每个 chunk 累积到 store
 * - 通过分段器 flush 已闭合 Markdown 段，避免每 token 重渲染整篇
 *
 * Vue 3 与 React 关键差异：
 *   - 用 useChatStore() 直接拿 store，actions 是 this 绑定（不需要 hook 包裹）
 *   - onUnmounted 钩子在组件卸载时清理
 *   - watch + watchEffect 替代 useEffect
 *
 * 关键不变量（与 React 版一致）：
 *   - processedLength 记录已 flush 的 buffer 末尾位置
 *   - abortMap 是 module-scope 单例（不是 ref）：
 *     InputPanel 在切换会话时会被 key 重建，若用 ref 持有句柄，
 *     新实例初始化会把老会话的 EventSource 一起关掉。
 *   - "是否在生成"完全由 message.status === 'streaming' 表达（不维护全局流式 id）
 */

import { onUnmounted } from 'vue';
import { nanoid } from 'nanoid';
import { useChatStore } from '@/stores/chatStore';
import { splitMarkdown } from '@/utils/markdown';
import type { Message, MessagePart, SSEPayload } from '@/types/message';

interface SendAttachments {
  images: { url: string; alt?: string }[];
  files: { name: string; size: number; url: string; mime?: string }[];
}

const FLUSH_INTERVAL_MS = 80;

/**
 * module-scope：跨 InputPanel 重建持久存在
 * key = sessionId, value = 关闭该会话 EventSource 的函数
 */
const abortMap = new Map<string, () => void>();

function abortSession(sessionId: string) {
  const abort = abortMap.get(sessionId);
  if (!abort) return;
  abort();
  abortMap.delete(sessionId);
}

export function useChat() {
  const store = useChatStore();

  /** 全局清理：组件卸载时关掉所有 SSE */
  onUnmounted(() => {
    abortMap.forEach((abort) => abort());
    abortMap.clear();
  });

  const stop = () => {
    const sessionId = store.currentSessionId;
    if (!sessionId) return;
    abortSession(sessionId);
    const streamingMsg = store.messages[sessionId]?.find((m) => m.status === 'streaming');
    if (streamingMsg) {
      store.interruptStream(sessionId, streamingMsg.id);
    }
  };

  const sendMessage = (text: string, attachments: SendAttachments) => {
    let sessionId = store.currentSessionId;

    // 1) 当前会话正在 streaming：打断旧流（标 'interrupted'），再发新消息
    if (sessionId) {
      const streaming = store.messages[sessionId]?.find((m) => m.status === 'streaming');
      if (streaming) {
        abortSession(sessionId);
        store.interruptStream(sessionId, streaming.id);
      }
    }

    if (!sessionId) {
      sessionId = store.createSession('新对话');
    }

    // 2) 重复消息跳过
    if (sessionId) {
      const currentMsgs = store.messages[sessionId] || [];
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
    store.appendMessage(sessionId, userMsg);

    // 4) 更新会话标题
    const cur = store.sessions[sessionId];
    if (cur?.title === '新对话' && text) {
      store.renameSession(sessionId, text.slice(0, 16) || '新对话');
    } else if (cur) {
      store.renameSession(sessionId, cur.title);
    }

    // 5) 创建占位 AI 消息
    const aiMsgId = nanoid(10);
    store.appendMessage(sessionId, {
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
    let processedLength = 0;
    let flushed = false;

    const flushPendingText = () => {
      const pending = fullBufferRef.current.slice(processedLength);
      store.setPendingText(sessionId, aiMsgId, pending);
    };

    // rAF 节流 pendingText 写入
    let pendingRafId: number | null = null;
    const schedulePendingUpdate = () => {
      if (pendingRafId !== null) return;
      pendingRafId = requestAnimationFrame(() => {
        pendingRafId = null;
        flushPendingText();
      });
    };

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
        if (force) store.finalizeStream(sessionId, aiMsgId);
        return;
      }

      const { flushed: newFlushed, pending } = splitMarkdown(unprocessed);

      if (newFlushed.length > 0) {
        store.appendPart(sessionId, aiMsgId, {
          type: 'markdown',
          content: newFlushed.join('\n\n'),
        });
        processedLength += unprocessed.length - pending.length;
      }

      flushPendingText();

      if (force && pending) {
        store.appendPart(sessionId, aiMsgId, {
          type: 'markdown',
          content: pending,
        });
        processedLength = buf.length;
        flushPendingText();
      }
    };

    // 80ms 节流 flush
    let flushScheduled = false;
    const scheduleFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      setTimeout(() => {
        flushScheduled = false;
        tryFlush(false);
      }, FLUSH_INTERVAL_MS);
    };

    // 切到非文本段 / 流结束的公共处理
    const onNonTextBoundary = (part: MessagePart) => {
      cancelPendingUpdate();
      flushPendingText();
      tryFlush(true);
      store.appendPart(sessionId, aiMsgId, part);
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
            onNonTextBoundary({ type: 'image', url: payload.url, alt: payload.alt });
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
        }
      } catch (err) {
        console.warn('[SSE] parse', err);
      }
    });

    es.addEventListener('done', () => {
      cancelPendingUpdate();
      tryFlush(true);
      store.finalizeStream(sessionId, aiMsgId);
      es.close();
      abortMap.delete(sessionId);
      flushed = true;
    });

    es.addEventListener('error', () => {
      cancelPendingUpdate();
      if (!flushed) {
        const cur = store.messages[sessionId]?.find((m) => m.id === aiMsgId);
        if (cur && cur.status !== 'interrupted' && cur.status !== 'done') {
          store.updateMessageStatus(sessionId, aiMsgId, 'error');
        }
      }
      es.close();
      abortMap.delete(sessionId);
    });
  };

  return { sendMessage, stop };
}
