/**
 * 客服工作台 - 顶层页面
 *
 * 三栏布局：
 *   ┌──────────────┬────────────────────────────┬──────────────┐
 *   │  左侧会话列表  │  中间：当前会话聊天区        │  右侧推荐工具栏│
 *   │  - 待接单     │  - 用户信息 + 时长           │  - 智能话术   │
 *   │  - 进行中     │  - 消息列表                  │  - 离线模板   │
 *   │              │  - 输入区                    │              │
 *   └──────────────┴────────────────────────────┴──────────────┘
 *
 * 状态来源：
 *   - workbench.activeSessions：来自 server.queue_assigned + 后续 message 事件
 *   - workbench.pendingQueue：来自 server.queue_update
 *   - workbench.suggestions[sessionId]：来自 server.suggestion_chunk 流式推送
 *
 * 核心交互：
 *   - 接单：调 useAgentWorkbench().acceptQueue(clientId) → server.agent.accept_queue
 *   - 发消息：调 useAgentWorkbench().sendMessage(sessionId, parts) → server.agent.send
 *   - 应用推荐话术：useSuggestion(sessionId, suggestionId)
 *   - 结束会话：endSession(sessionId)
 *
 * 自动触发推荐：
 *   - 监听 workbench.activeSessions[sessionId].messages 变化
 *   - 用户角色消息新增 → 自动调 fetchSuggestions
 */

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { App, Avatar, Button, Empty, Space, Tag, Tooltip, Modal } from 'antd';
import {
  ReloadOutlined,
  LogoutOutlined,
  BellOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from '@/router';
import { useAgentWorkbench } from '@/hooks/useAgentWorkbench';
import { useAgentStore } from '@/store/agentStore';
import { MessageItem } from '@/components/MessageItem/MessageItem';
import { MessageVirtualList } from '@/components/MessageVirtualList/MessageVirtualList';
import useIsomorphicLayoutEffect from '@/hooks/useIsomorphicLayoutEffect';
import { SessionList } from './SessionList';
import { MessageArea } from './MessageArea';
import { SuggestionPanel } from './SuggestionPanel';
import type { AgentSuggestion } from '@/types/agent';

export const AgentWorkbench: React.FC = () => {
  const navigate = useNavigate();
  const { message: antdMessage } = App.useApp();

  // ===== Workbench 状态 =====
  const {
    connection,
    isOpen,
    presence,
    activeSessions,
    suggestions,
    streamingIntent,
    acceptQueue,
    sendMessage,
    endSession,
    fetchSuggestions,
    useSuggestion,
    fetchHistory,
    loadHistorySession,
  } = useAgentWorkbench();

  const pendingQueue = useAgentStore((s) => s.workbench.pendingQueue);
  const userInfoByClient = useAgentStore((s) => s.workbench.userInfoByClient);
  const historySessions = useAgentStore((s) => s.historySessions);
  const historySessionDetails = useAgentStore((s) => s.historySessionDetails);
  const loadingHistorySessionId = useAgentStore((s) => s.loadingHistorySessionId);
  const selectedHistorySessionId = useAgentStore((s) => s.selectedHistorySessionId);
  const selectHistorySession = useAgentStore((s) => s.selectHistorySession);

  // ===== 当前选中会话 =====
  // 默认选中第一个 inSession 会话
  const activeList = useMemo(
    () =>
      Object.values(activeSessions)
        .filter((s) => s.status === 'inSession')
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)),
    [activeSessions],
  );

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // activeList 变化时，自动选最新会话（但如果当前在看历史会话，不抢焦点）
  useEffect(() => {
    if (selectedHistorySessionId) return; // 当前在看历史，让历史区保持选中
    if (activeSessionId && activeSessions[activeSessionId]?.status === 'inSession') return;
    if (activeList.length > 0) {
      setActiveSessionId(activeList[0].sessionId);
    } else {
      setActiveSessionId(null);
    }
  }, [activeList, activeSessionId, activeSessions, selectedHistorySessionId]);

  const activeSession = activeSessionId ? activeSessions[activeSessionId] : null;

  // 当前选中的历史会话：优先用缓存的详情（如果已 fetch 完），否则回退到摘要
  const selectedHistoryDetail = selectedHistorySessionId
    ? historySessionDetails[selectedHistorySessionId]
    : null;
  const selectedHistoryItem = selectedHistorySessionId
    ? historySessions.find((h) => h.sessionId === selectedHistorySessionId)
    : null;

  // ===== 智能推荐自动触发开关 =====
  const [autoTrigger, setAutoTrigger] = useState(true);
  const lastTriggeredMsgIdRef = useRef<string | null>(null);

  // 监听用户消息变化 → 自动触发推荐
  useEffect(() => {
    if (!autoTrigger || !activeSession || !isOpen) return;
    const lastUserMsg = [...activeSession.messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;
    if (lastUserMsg.id === lastTriggeredMsgIdRef.current) return;
    lastTriggeredMsgIdRef.current = lastUserMsg.id;
    fetchSuggestions(activeSession.sessionId!);
  }, [activeSession, autoTrigger, isOpen, fetchSuggestions]);

  // ===== 接收 InputPanel 的发送事件 =====
  useEffect(() => {
    const onSend = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        sessionId: string | null;
        trimmed: string;
        attachments: Array<{ kind: 'image' | 'file'; url: string; name: string; size: number; mime?: string }>;
      };
      if (!detail.sessionId) return;
      const parts: import('@/types/message').MessagePart[] = [];
      if (detail.trimmed) {
        parts.push({
          type: detail.trimmed.includes('\n') ? 'markdown' : 'text',
          content: detail.trimmed,
        });
      }
      for (const a of detail.attachments) {
        if (a.kind === 'image') {
          parts.push({ type: 'image', url: a.url, alt: a.name });
        } else {
          parts.push({
            type: 'file',
            name: a.name,
            size: a.size,
            url: a.url,
            mime: a.mime,
          });
        }
      }
      sendMessage(detail.sessionId, parts);
    };
    window.addEventListener('agent:send-message', onSend as EventListener);
    return () => window.removeEventListener('agent:send-message', onSend as EventListener);
  }, [sendMessage]);

  // ===== 主动接单 =====
  const onAcceptQueue = useCallback(
    (clientId: string) => {
      acceptQueue(clientId);
      antdMessage.info('正在接单…');
    },
    [acceptQueue, antdMessage],
  );

  // ===== 结束会话 =====
  const onEndSession = useCallback(
    (sessionId: string) => {
      Modal.confirm({
        title: '结束当前会话？',
        content: '结束后用户端会收到结束通知，且无法再发送消息。',
        okText: '结束',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => {
          endSession(sessionId);
          antdMessage.success('已结束会话');
        },
      });
    },
    [endSession, antdMessage],
  );

  // ===== 应用推荐话术 =====
  const onUseSuggestion = useCallback(
    (s: AgentSuggestion) => {
      if (!activeSessionId) return;
      useSuggestion(activeSessionId, s.id);
    },
    [activeSessionId, useSuggestion],
  );

  // ===== 点击历史会话 =====
  // 清空活跃选中（避免历史详情和活跃会话同时显示），从服务端拉详情
  const onSelectHistory = useCallback(
    (sessionId: string) => {
      setActiveSessionId(null);
      selectHistorySession(sessionId);
      loadHistorySession(sessionId);
    },
    [loadHistorySession, selectHistorySession],
  );

  // ===== 返回活跃会话（用于"关闭历史查看"按钮）=====
  const onBackToActive = useCallback(() => {
    selectHistorySession(null);
    if (activeList.length > 0) {
      setActiveSessionId(activeList[0].sessionId);
    }
  }, [activeList, selectHistorySession]);

  // ===== 主动刷新历史列表 =====
  const onRefreshHistory = useCallback(() => {
    fetchHistory();
  }, [fetchHistory]);

  // ===== 退出工作台 =====
  const onExit = useCallback(() => {
    Modal.confirm({
      title: '退出客服工作台？',
      content: '退出后会断开 WebSocket 连接，正在进行的会话会保持在服务端。',
      okText: '退出',
      cancelText: '取消',
      onOk: () => {
        navigate('/');
      },
    });
  }, [navigate]);

  // ===== 监听推荐流式状态 =====
  const currentStreamingIntent = activeSessionId
    ? streamingIntent[activeSessionId]
    : null;
  const isStreaming = !!currentStreamingIntent;
  const streamingCategory = currentStreamingIntent?.category || null;

  return (
    <div className="agent-workbench">
      <header className="agent-workbench__topbar">
        <div className="agent-workbench__brand">
          <span className="agent-workbench__logo">客</span>
          <span className="agent-workbench__brand-text">智能客服工作台</span>
          <Tag color={isOpen ? 'success' : 'default'} style={{ marginLeft: 8 }}>
            {isOpen ? '已连接' : connection === 'reconnecting' ? '重连中…' : '未连接'}
          </Tag>
        </div>
        <div className="agent-workbench__stats">
          <Space size={20}>
            <Tooltip title="在线客服数">
              <span>
                <UserOutlined /> {presence.onlineAgents} 在线
              </span>
            </Tooltip>
            <Tooltip title="排队总人数">
              <span>
                <BellOutlined /> {presence.queueLength} 排队
              </span>
            </Tooltip>
            <Tooltip title="当前接待中">
              <span>
                <span style={{ color: '#4d6bfe', fontWeight: 600 }}>{activeList.length}</span> 进行中
              </span>
            </Tooltip>
          </Space>
        </div>
        <div className="agent-workbench__actions">
          <Button
            icon={<ReloadOutlined />}
            onClick={() => activeSession && fetchSuggestions(activeSession.sessionId!)}
            disabled={!activeSession}
          >
            刷新推荐
          </Button>
          <Button icon={<LogoutOutlined />} onClick={onExit}>
            退出
          </Button>
        </div>
      </header>

      <div className="agent-workbench__layout">
        <SessionList
          activeSessionId={activeSessionId}
          onAcceptQueue={onAcceptQueue}
          onSelectSession={(sid) => {
            setActiveSessionId(sid);
            selectHistorySession(null);
          }}
          activeSessions={activeSessions}
          userInfoByClient={userInfoByClient}
          pendingQueue={pendingQueue}
          historySessions={historySessions}
          selectedHistorySessionId={selectedHistorySessionId}
          onSelectHistory={onSelectHistory}
          onRefreshHistory={onRefreshHistory}
          presence={presence}
          isConnected={isOpen}
        />

        {selectedHistorySessionId ? (
          <HistoryView
            item={selectedHistoryItem || null}
            detail={selectedHistoryDetail || null}
            loading={loadingHistorySessionId === selectedHistorySessionId}
            onBack={onBackToActive}
          />
        ) : activeSession ? (
          <MessageArea
            session={activeSession}
            onEndSession={onEndSession}
          />
        ) : (
          <div className="agent-chat agent-chat--empty">
            <div className="agent-chat__empty-pick">
              <h2>请选择或接单一个会话</h2>
              <p style={{ color: '#8c8c8c' }}>
                {pendingQueue.length > 0
                  ? `左侧有 ${pendingQueue.length} 位用户等待接单`
                  : '当前没有待接单用户，可以等待或刷新'}
              </p>
              <Button
                type="primary"
                size="large"
                onClick={() => activeList[0] && setActiveSessionId(activeList[0].sessionId)}
                disabled={activeList.length === 0}
              >
                切换到最近会话
              </Button>
            </div>
          </div>
        )}

        {activeSession ? (
          <SuggestionPanel
            sessionId={activeSession.sessionId!}
            messages={activeSession.messages}
            isStreaming={isStreaming}
            streamingCategory={streamingCategory}
            onRefresh={() => fetchSuggestions(activeSession.sessionId!)}
            onUseSuggestion={onUseSuggestion}
            autoTrigger={autoTrigger}
            onAutoTriggerChange={setAutoTrigger}
          />
        ) : (
          <aside className="agent-tools agent-tools--empty">
            <div className="agent-tools__empty">
              <h3>暂无会话</h3>
              <p style={{ color: '#8c8c8c' }}>选择会话后将显示智能推荐</p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

export default AgentWorkbench;

// ============== 历史会话查看 ==============

interface HistoryViewProps {
  item: import('@/types/agent').HistorySessionItem | null;
  detail: import('@/types/agent').HistorySessionDetail | null;
  loading: boolean;
  onBack: () => void;
}

const END_REASON_LABEL: Record<string, { color: string; text: string }> = {
  user: { color: 'default', text: '用户结束' },
  agent: { color: 'default', text: '客服结束' },
  timeout: { color: 'orange', text: '30s 超时自动结束' },
  error: { color: 'red', text: '异常结束' },
};

/**
 * 历史会话详情查看区：
 *   - 顶部：用户信息 + 结束原因 + 时长 + 返回按钮
 *   - 主体：消息列表（复用 MessageVirtualList 渲染）
 *   - 底部：无输入框（已结束会话不能再发消息）
 */
const HistoryView: React.FC<HistoryViewProps> = ({ item, detail, loading, onBack }) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setListHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setListHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const messages: import('@/types/message').Message[] = detail?.messages || [];
  const onCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);
  const noop = useCallback(() => {}, []);
  const renderItem = useCallback(
    (m: import('@/types/message').Message) => (
      <MessageItem message={m} onCopy={onCopy} onSuggestionPick={noop} onRegenerate={noop} />
    ),
    [onCopy, noop],
  );
  const getKey = useCallback((m: import('@/types/message').Message) => m.id, []);
  const scrollToBottomKey = useMemo(() => `h-${messages.length}`, [messages.length]);

  useIsomorphicLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollToBottomKey]);

  const duration =
    detail?.startedAt && detail?.endedAt
      ? Math.max(0, Math.floor((detail.endedAt - detail.startedAt) / 1000))
      : 0;
  const durationText = (() => {
    if (duration < 60) return `${duration} 秒`;
    if (duration < 3600) return `${Math.floor(duration / 60)} 分 ${duration % 60} 秒`;
    return `${Math.floor(duration / 3600)} 小时 ${Math.floor((duration % 3600) / 60)} 分`;
  })();

  return (
    <section className="agent-chat">
      <header className="agent-chat__head">
        <div className="agent-chat__head-left">
          <Avatar size={40} icon={<UserOutlined />} className="agent-chat__user-avatar" />
          <div>
            <div className="agent-chat__user-name">
              {item?.userName || `用户 ${item?.clientId?.slice(-6) || '未知'}`}
              {item && (
                <Tag
                  color={END_REASON_LABEL[item.endReason]?.color || 'default'}
                  style={{ marginLeft: 8 }}
                >
                  {END_REASON_LABEL[item.endReason]?.text || '已结束'}
                </Tag>
              )}
            </div>
            <div className="agent-chat__user-meta">
              <Space size={12}>
                <span>共 {detail?.messages.length ?? item?.messageCount ?? 0} 条消息</span>
                <span>会话时长：{durationText}</span>
                {item?.startedAt && (
                  <span style={{ color: '#8c8c8c' }}>
                    {new Date(item.startedAt).toLocaleString('zh-CN')}
                  </span>
                )}
              </Space>
            </div>
          </div>
        </div>
        <div className="agent-chat__head-right">
          <Button onClick={onBack}>返回活跃会话</Button>
        </div>
      </header>

      <div className="agent-chat__body" ref={listRef}>
        {loading && !detail ? (
          <div className="agent-chat__empty">
            <Empty description="加载历史消息中…" />
          </div>
        ) : messages.length === 0 ? (
          <div className="agent-chat__empty">
            <Empty description="该会话暂无消息" />
          </div>
        ) : (
          <MessageVirtualList
            items={messages}
            streamingItem={null}
            getKey={getKey}
            height={listHeight}
            overscan={3}
            scrollToBottomKey={scrollToBottomKey}
            followStreaming={false}
            renderItem={renderItem}
            renderStreaming={renderItem}
          />
        )}
      </div>

      <div className="agent-chat__footer">
        <div
          style={{
            padding: 16,
            textAlign: 'center',
            color: '#8c8c8c',
            background: '#fafafa',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          🔒 该会话已结束（仅供查看，不能发送新消息）
        </div>
      </div>
    </section>
  );
};
