/**
 * useAgentWorkbench：客服工作台连接 + 状态管理 hook
 *
 * - 初始化 agent 身份（持久化到 localStorage）
 * - 建立 WS 连接
 * - 把服务端事件通过 store.onSystemEvent 路由
 * - 暴露便捷 actions（接单 / 发消息 / 结束会话 / 请求推荐）
 *
 * 使用：
 *   const { connection, presence, activeSessions, acceptQueue, sendMessage, endSession } = useAgentWorkbench();
 */

import { useEffect, useMemo, useCallback } from 'react';
import { useAgentStore } from '@/store/agentStore';
import { useAgentSocket } from '@/hooks/useAgentSocket';
import type { MessagePart } from '@/types/message';
import type { Message } from '@/types/message';
import { detectCategory } from '@/utils/agentSuggestions';

export function useAgentWorkbench() {
  const mode = useAgentStore((s) => s.mode);
  const setMode = useAgentStore((s) => s.setMode);
  const agentId = useAgentStore((s) => s.agentId);
  const agentName = useAgentStore((s) => s.agentName);
  const agentAvatar = useAgentStore((s) => s.agentAvatar);
  const setAgentIdentity = useAgentStore((s) => s.setAgentIdentity);
  const onSystemEvent = useAgentStore((s) => s.onSystemEvent);
  const workbench = useAgentStore((s) => s.workbench);
  const sendAgentMessage = useAgentStore((s) => s.sendAgentMessage);
  const endAgentSession = useAgentStore((s) => s.endAgentSession);
  const setWorkbenchConnection = useAgentStore((s) => s.setWorkbenchConnection);
  const requestSuggestions = useAgentStore((s) => s.requestSuggestions);
  const clearSuggestions = useAgentStore((s) => s.clearSuggestions);
  const applySuggestion = useAgentStore((s) => s.applySuggestion);
  const fetchHistorySession = useAgentStore((s) => s.fetchHistorySession);

  // 首次挂载：进入 agent 模式 + 恢复 / 生成 agentId
  useEffect(() => {
    setMode('agent');
    if (!agentId) {
      const newId = `a_${Date.now().toString(36)}`;
      setAgentIdentity(newId, `客服${newId.slice(-4)}`);
    }
  }, [mode, setMode, agentId, setAgentIdentity]);

  // WS 连接
  const { send: wsSend, isOpen, status } = useAgentSocket({
    role: 'agent',
    id: agentId,
    displayName: agentName || undefined,
    displayAvatar: agentAvatar || undefined,
    onEvent: onSystemEvent,
    onStatusChange: setWorkbenchConnection,
  });

  /**
   * 接单：从排队队列里挑一个 clientId 接管
   * 服务端在收到 agent.accept_queue 后会回 queue_assigned 事件
   */
  const acceptQueue = useCallback(
    (clientId: string) => {
      wsSend({ type: 'agent.accept_queue', clientId });
    },
    [wsSend],
  );

  /**
   * 发送客服消息
   *  - 乐观更新在 store 内部做（sendAgentMessage）
   *  - 通过 ws 发到服务端，服务端再转发给客户端
   */
  const sendMessage = useCallback(
    (sessionId: string, parts: MessagePart[]) => {
      const messageId = sendAgentMessage(sessionId, parts);
      if (messageId) {
        wsSend({ type: 'agent.send', sessionId, messageId, parts });
      }
      return messageId;
    },
    [sendAgentMessage, wsSend],
  );

  /** 结束会话 */
  const endSession = useCallback(
    (sessionId: string, reason?: string) => {
      endAgentSession(sessionId);
      clearSuggestions(sessionId);
      wsSend({ type: 'agent.end_session', sessionId, reason });
    },
    [endAgentSession, clearSuggestions, wsSend],
  );

  /**
   * 主动请求智能推荐（如客服手动点"刷新推荐"）
   * 服务端会基于该会话最近用户消息触发意图识别
   */
  const fetchSuggestions = useCallback(
    (sessionId: string) => {
      const sess = workbench.activeSessions[sessionId];
      if (!sess) return;
      requestSuggestions(sessionId);
      wsSend({ type: 'agent.request_suggestions', sessionId, context: sess.messages });
    },
    [workbench.activeSessions, requestSuggestions, wsSend],
  );

  /**
   * 一键应用推荐话术：
   *   - 标记为已使用
   *   - 直接作为客服消息发送到当前会话
   */
  const useSuggestion = useCallback(
    (sessionId: string, suggestionId: string) => {
      const list = workbench.suggestions[sessionId] || [];
      const suggestion = list.find((s) => s.id === suggestionId);
      if (!suggestion || suggestion.applied) return;
      applySuggestion(sessionId, suggestion);
      sendMessage(sessionId, suggestion.parts);
    },
    [workbench.suggestions, applySuggestion, sendMessage],
  );

  /**
   * 客户端 fallback 推荐：拿到当前会话最新用户消息，立刻给一组推荐
   * （在服务端 suggestion_chunk 推送前先显示，避免工具栏空等）
   */
  const getFallbackSuggestions = useCallback(
    (sessionId: string) => {
      const sess = workbench.activeSessions[sessionId];
      if (!sess) return [];
      const parts = sess.messages.map((m: Message) => ({ role: m.role, parts: m.parts }));
      const category = detectCategory(parts);
      return [{ category, sessionId }];
    },
    [workbench.activeSessions],
  );

  /**
   * 主动拉取历史会话列表（连接时已自动推一次，UI 上提供"刷新"按钮时可用）
   */
  const fetchHistory = useCallback(() => {
    wsSend({ type: 'agent.fetch_history' });
  }, [wsSend]);

  /**
   * 拉取指定 sessionId 的历史详情（点击历史会话列表项时调用）
   *  - 立即把 loading 状态写到 store，UI 展示骨架屏
   *  - ws 推送的 history_session 事件会被 onSystemEvent 路由
   */
  const loadHistorySession = useCallback(
    (sessionId: string) => {
      fetchHistorySession(sessionId);
      wsSend({ type: 'agent.fetch_history_session', sessionId });
    },
    [fetchHistorySession, wsSend],
  );

  return useMemo(
    () => ({
      connection: status,
      isOpen,
      presence: workbench.presence,
      activeSessions: workbench.activeSessions,
      suggestions: workbench.suggestions,
      streamingIntent: workbench.streamingIntent,
      acceptQueue,
      sendMessage,
      endSession,
      fetchSuggestions,
      useSuggestion,
      getFallbackSuggestions,
      fetchHistory,
      loadHistorySession,
    }),
    [
      status,
      isOpen,
      workbench.presence,
      workbench.activeSessions,
      workbench.suggestions,
      workbench.streamingIntent,
      acceptQueue,
      sendMessage,
      endSession,
      fetchSuggestions,
      useSuggestion,
      getFallbackSuggestions,
      fetchHistory,
      loadHistorySession,
    ],
  );
}
