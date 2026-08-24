/**
 * 客服工作台 - 左侧会话列表
 *
 * 职责：
 *   1. 显示待接单队列（pendingQueue，server queue_update 推送）
 *   2. 显示已接单活跃会话（activeSessions）
 *   3. 显示历史会话（historySessions，session_ended 后转存）
 *   4. 选中活跃/历史会话 → 触发父组件 onSelectSession / onSelectHistory
 *
 * pendingQueue 来源：server.queue_update
 * 活跃会话来源：server.queue_assigned + message 流
 * 历史会话来源：server.history_list（连接时全量推 + endSession 时增量推）
 */

import React, { useEffect, useState } from 'react';
import { Avatar, Badge, Button, Empty, Space, Tag, Tooltip } from 'antd';
import {
  UserOutlined,
  HourglassOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  HistoryOutlined,
  MessageOutlined,
  WarningFilled,
} from '@ant-design/icons';
import type { AgentSession, HistorySessionItem } from '@/types/agent';

export interface SessionListProps {
  /** 当前选中的 sessionId（活跃会话） */
  activeSessionId: string | null;
  /** 接单（从队列接一个 client） */
  onAcceptQueue: (clientId: string) => void;
  /** 选中某个活跃会话 */
  onSelectSession: (sessionId: string) => void;
  /** 已接单的活跃会话（key = sessionId） */
  activeSessions: Record<string, AgentSession>;
  /**
   * 用户信息缓存（key = clientId）。在 queue_assigned 时已写入 userName / userAvatar，
   * 这里用于把"用户 xxxx/?"替换为真实用户名/头像。
   */
  userInfoByClient: Record<string, { userName?: string; userAvatar?: string }>;
  /** 等待接单的队列 */
  pendingQueue: Array<{
    clientId: string;
    userName?: string;
    userAvatar?: string;
    queuedAt: number;
    reason: string;
    lastUserMessage?: string;
  }>;
  /** 历史会话列表（按 endedAt 倒序） */
  historySessions: HistorySessionItem[];
  /** 当前选中的历史会话 id */
  selectedHistorySessionId: string | null;
  /** 点击历史会话项 */
  onSelectHistory: (sessionId: string) => void;
  /** 刷新历史列表 */
  onRefreshHistory: () => void;
  /** 当前在线客服数 / 排队总数 */
  presence: { onlineAgents: number; queueLength: number };
  /** ws 连接是否就绪 */
  isConnected: boolean;
}

function timeAgo(ts: number, now: number): string {
  const s = Math.floor((now - ts) / 1000);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
}

/** 1s 刷一次"现在"：让 timeAgo 按秒更新；组件卸载时清理 timer 避免泄漏 */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * 排队超过 30s 进入"警告"状态：橙红边框 + 警告图标，
 * 提示客服这位用户等得较久，建议优先接单
 */
const QUEUE_WARN_MS = 30_000;
function isOverdue(queuedAt: number, now: number): boolean {
  return now - queuedAt > QUEUE_WARN_MS;
}

const REASON_LABEL: Record<string, { color: string; text: string }> = {
  normal: { color: 'blue', text: '普通' },
  vip: { color: 'gold', text: 'VIP' },
  after_hours: { color: 'orange', text: '非工作时段' },
  all_busy: { color: 'red', text: '繁忙' },
};

const END_REASON_LABEL: Record<string, { color: string; text: string }> = {
  user: { color: 'default', text: '用户结束' },
  agent: { color: 'default', text: '客服结束' },
  timeout: { color: 'orange', text: '超时结束' },
  error: { color: 'red', text: '异常结束' },
};

export const SessionList: React.FC<SessionListProps> = ({
  activeSessionId,
  onAcceptQueue,
  onSelectSession,
  activeSessions,
  userInfoByClient,
  pendingQueue,
  historySessions,
  selectedHistorySessionId,
  onSelectHistory,
  onRefreshHistory,
  presence,
  isConnected,
}) => {
  const activeList = Object.values(activeSessions).filter((s) => s.status === 'inSession');
  // 每秒刷新"当前时间"：让待接单/进行中/历史会话里的"X 秒前"按秒跳
  const now = useNow(1000);

  return (
    <aside className="agent-sidebar">
      <div className="agent-sidebar__head">
        <div className="agent-sidebar__title">客服工作台</div>
        <div className="agent-sidebar__presence">
          <Badge
            status={isConnected ? 'success' : 'default'}
            text={
              <span className="agent-sidebar__presence-text">
                {presence.onlineAgents} 客服在线 · {presence.queueLength} 人排队
              </span>
            }
          />
        </div>
      </div>

      <div className="agent-sidebar__section">
        <div className="agent-sidebar__section-title">
          <HourglassOutlined /> 待接单
          <span className="agent-sidebar__count">{pendingQueue.length}</span>
        </div>
        {pendingQueue.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无排队"
            className="agent-sidebar__empty"
          />
        ) : (
          <div className="agent-sidebar__list">
            {pendingQueue.map((item) => {
              const reason = REASON_LABEL[item.reason] || REASON_LABEL.normal;
              const overdue = isOverdue(item.queuedAt, now);
              return (
                <div
                  className={`agent-sidebar__item ${overdue ? 'is-overdue' : ''}`}
                  key={item.clientId}
                >
                  <div className="agent-sidebar__item-row">
                    <Avatar size="small" icon={<UserOutlined />} />
                    <span className="agent-sidebar__item-name">
                      {item.userName || `用户${item.clientId.slice(-4)}`}
                    </span>
                    <Tag color={reason.color} className="agent-sidebar__item-tag">
                      {reason.text}
                    </Tag>
                    {overdue && (
                      <Tag color="error" className="agent-sidebar__item-tag">
                        <WarningFilled /> 超时
                      </Tag>
                    )}
                  </div>
                  {item.lastUserMessage && (
                    <div className="agent-sidebar__item-msg" title={item.lastUserMessage}>
                      {item.lastUserMessage}
                    </div>
                  )}
                  <div className="agent-sidebar__item-row agent-sidebar__item-meta">
                    {overdue ? (
                      <WarningFilled style={{ color: '#ff4d4f' }} />
                    ) : (
                      <ClockCircleOutlined />
                    )}
                    <span style={overdue ? { color: '#ff4d4f', fontWeight: 500 } : undefined}>
                      {timeAgo(item.queuedAt, now)}
                    </span>
                    <div style={{ flex: 1 }} />
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => onAcceptQueue(item.clientId)}
                      disabled={!isConnected}
                    >
                      接单
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="agent-sidebar__section">
        <div className="agent-sidebar__section-title">
          <CheckCircleOutlined /> 进行中
          <span className="agent-sidebar__count">{activeList.length}</span>
        </div>
        {activeList.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无会话"
            className="agent-sidebar__empty"
          />
        ) : (
          <div className="agent-sidebar__list">
            {activeList.map((sess) => {
              const lastMsg = sess.messages[sess.messages.length - 1];
              const lastPreview = lastMsg
                ? lastMsg.parts
                    .filter((p) => p.type === 'text' || p.type === 'markdown')
                    .map((p) => p.content)
                    .join(' ')
                    .slice(0, 40)
                : '（暂无消息）';
              const isActive = sess.sessionId === activeSessionId;
              // 优先从 userInfoByClient 缓存读 userName（queue_assigned 写入），
              // 没有则降级到 clientId 截取——避免显示"用户 ?/未知"
              const cached = sess.clientId ? userInfoByClient[sess.clientId] : undefined;
              const displayName = cached?.userName || `用户 ${sess.clientId?.slice(-4) || '?'}`;
              const displayAvatar = cached?.userAvatar;
              return (
                <Tooltip key={sess.sessionId} title={lastPreview} placement="right">
                  <div
                    className={`agent-sidebar__item agent-sidebar__item--active ${
                      isActive ? 'is-active' : ''
                    }`}
                    onClick={() => sess.sessionId && onSelectSession(sess.sessionId)}
                  >
                    <div className="agent-sidebar__item-row">
                      <Avatar
                        size="small"
                        src={displayAvatar}
                        icon={<UserOutlined />}
                      />
                      <span className="agent-sidebar__item-name">{displayName}</span>
                    </div>
                    <div className="agent-sidebar__item-msg">{lastPreview}</div>
                    <div className="agent-sidebar__item-row agent-sidebar__item-meta">
                      <Space size={4}>
                        <Tag color="cyan" style={{ margin: 0 }}>
                          {sess.messages.length} 条
                        </Tag>
                        {sess.startedAt && (
                          <span style={{ color: '#8c8c8c' }}>{timeAgo(sess.startedAt, now)}</span>
                        )}
                      </Space>
                    </div>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>

      <div className="agent-sidebar__section">
        <div className="agent-sidebar__section-title">
          <HistoryOutlined /> 历史会话
          <span className="agent-sidebar__count">{historySessions.length}</span>
          <div style={{ flex: 1 }} />
          <Button
            type="text"
            size="small"
            icon={<HistoryOutlined />}
            onClick={onRefreshHistory}
            disabled={!isConnected}
            title="刷新历史会话"
          />
        </div>
        {historySessions.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无历史会话"
            className="agent-sidebar__empty"
          />
        ) : (
          <div className="agent-sidebar__list">
            {historySessions.map((h) => {
              const reason = END_REASON_LABEL[h.endReason] || END_REASON_LABEL.user;
              const preview = h.lastUserMessage || h.lastAgentMessage || '（无消息）';
              const isSelected = h.sessionId === selectedHistorySessionId;
              return (
                <Tooltip key={h.sessionId} title={preview} placement="right">
                  <div
                    className={`agent-sidebar__item agent-sidebar__item--history ${
                      isSelected ? 'is-active' : ''
                    }`}
                    onClick={() => onSelectHistory(h.sessionId)}
                  >
                    <div className="agent-sidebar__item-row">
                      <Avatar size="small" icon={<UserOutlined />} />
                      <span className="agent-sidebar__item-name">
                        {h.userName || `用户 ${h.clientId?.slice(-4) || '?'}`}
                      </span>
                      <Tag color={reason.color} className="agent-sidebar__item-tag">
                        {reason.text}
                      </Tag>
                    </div>
                    <div className="agent-sidebar__item-msg">{preview}</div>
                    <div className="agent-sidebar__item-row agent-sidebar__item-meta">
                      <Space size={4}>
                        <Tag color="default" style={{ margin: 0 }}>
                          <MessageOutlined /> {h.messageCount}
                        </Tag>
                        <span style={{ color: '#8c8c8c' }}>{timeAgo(h.endedAt, now)}</span>
                      </Space>
                    </div>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
