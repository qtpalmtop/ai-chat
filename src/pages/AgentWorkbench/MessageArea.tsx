/**
 * 客服工作台 - 中间聊天区
 *
 * 职责：
 *   1. 顶部：显示当前会话用户信息 + 接入时间 + 结束会话按钮
 *   2. 消息列表：复用 MessageVirtualList 渲染当前 session 的消息
 *      （包含 role='user' / role='agent' 两种气泡）
 *   3. 底部输入区：复用 InputPanel 的 inSession 分支
 *
 * 与 ChatWindow 的差异：
 *   - 顶部展示的是"用户信息"而非会话标题
 *   - 消息数据源是 workbench.activeSessions[activeSessionId].messages
 *   - 始终不展示 SSE 流式（客服消息都是 done），所以不需要 sticky bottom 流式项
 *
 * 性能：
 *   - 当前 activeSessionId 切换时整个组件重渲染（轻量）
 *   - MessageItem 仍走 React.memo + VirtualList，存量 100+ 消息也流畅
 */
import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { App, Avatar, Button, Empty, Space, Tag } from 'antd';
import {
  UserOutlined,
  ClockCircleOutlined,
  PoweroffOutlined,
  CustomerServiceOutlined,
  CheckCircleFilled,
} from '@ant-design/icons';
import { MessageItem } from '@/components/MessageItem/MessageItem';
import { MessageVirtualList } from '@/components/MessageVirtualList/MessageVirtualList';
import { InputPanel } from '@/components/InputPanel/InputPanel';
import useIsomorphicLayoutEffect from '@/hooks/useIsomorphicLayoutEffect';
import type { Message } from '@/types/message';
import type { AgentSession } from '@/types/agent';

export interface MessageAreaProps {
  session: AgentSession;
  onEndSession: (sessionId: string) => void;
  onCopy?: (text: string) => void;
}

function formatDuration(startedAt: number | null): string {
  if (!startedAt) return '00:00';
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const MessageArea: React.FC<MessageAreaProps> = ({ session, onEndSession, onCopy }) => {
  const { message: antdMessage } = App.useApp();
  const listRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);
  const [tick, setTick] = useState(0); // 触发 duration 文本每分钟更新

  // 每 30s 触发一次重渲染，更新"接待时长"文本
  useEffect(() => {
    if (!session.startedAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [session.startedAt]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setListHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setListHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 客服端无流式消息（agent.send 一次性写完），不需要 sticky bottom 流式项
  const messages: readonly Message[] = session.messages;

  const onCopyLocal = useCallback(
    (text: string) => {
      if (onCopy) {
        onCopy(text);
      } else {
        navigator.clipboard.writeText(text).then(() => antdMessage.success('已复制'));
      }
    },
    [onCopy, antdMessage],
  );

  // 客服消息：onRegenerate / onSuggestionPick 在 agent 端无意义，传空函数即可
  const noop = useCallback(() => {}, []);
  const renderItem = useCallback(
    (m: Message) => (
      <MessageItem
        message={m}
        onCopy={onCopyLocal}
        onSuggestionPick={noop}
        onRegenerate={noop}
      />
    ),
    [onCopyLocal, noop],
  );
  const renderStreaming = useCallback(
    (m: Message) => (
      <MessageItem
        message={m}
        onCopy={onCopyLocal}
        onSuggestionPick={noop}
        onRegenerate={noop}
      />
    ),
    [onCopyLocal, noop],
  );
  const getKey = useCallback((m: Message) => m.id, []);

  // 切会话时滚到底
  const scrollToBottomKey = useMemo(
    () => `${session.sessionId}-${messages.length}`,
    [session.sessionId, messages.length],
  );

  useIsomorphicLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollToBottomKey]);

  // 用户最新消息到达 → 滚到底
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.id]);

  const onEnd = useCallback(() => {
    if (!session.sessionId) return;
    onEndSession(session.sessionId);
  }, [session.sessionId, onEndSession]);

  const lastUserMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i];
    }
    return null;
  }, [messages]);

  return (
    <section className="agent-chat">
      <header className="agent-chat__head">
        <div className="agent-chat__head-left">
          <Avatar
            size={40}
            icon={<UserOutlined />}
            className="agent-chat__user-avatar"
          />
          <div>
            <div className="agent-chat__user-name">
              用户 {session.clientId?.slice(-6) || '未知'}
              <Tag color="cyan" style={{ marginLeft: 8 }}>
                进行中
              </Tag>
            </div>
            <div className="agent-chat__user-meta">
              <Space size={12}>
                <span>
                  <ClockCircleOutlined /> {formatDuration(session.startedAt)}
                </span>
                <span>{messages.length} 条消息</span>
                {lastUserMsg && (
                  <span title={lastUserMsg.parts.map((p) => ('content' in p ? p.content : '')).join(' ')}>
                    最近：{lastUserMsg.parts
                      .filter((p) => p.type === 'text' || p.type === 'markdown')
                      .map((p) => p.content)
                      .join(' ')
                      .slice(0, 20)}
                  </span>
                )}
              </Space>
            </div>
          </div>
        </div>
        <div className="agent-chat__head-right">
          <Button
            type="primary"
            danger
            icon={<PoweroffOutlined />}
            onClick={onEnd}
            disabled={!session.sessionId}
          >
            结束会话
          </Button>
        </div>
      </header>

      <div className="agent-chat__body" ref={listRef}>
        {messages.length === 0 ? (
          <div className="agent-chat__empty">
            <Empty
              description={
                <span style={{ color: '#8c8c8c' }}>
                  等待用户发送消息…
                  <div style={{ fontSize: 12, marginTop: 8 }}>
                    <CheckCircleFilled style={{ color: '#52c41a' }} /> 已建立端到端加密连接
                  </div>
                </span>
              }
            />
          </div>
        ) : (
          <MessageVirtualList
            items={messages as Message[]}
            streamingItem={null}
            getKey={getKey}
            height={listHeight}
            overscan={3}
            scrollToBottomKey={scrollToBottomKey}
            followStreaming={false}
            renderItem={renderItem}
            renderStreaming={renderStreaming}
          />
        )}
      </div>

      <div className="agent-chat__footer">
        {/* 复用 InputPanel 的 inSession 分支 - 这里仅展示基础发送框
            （agent 端不需要"转人工"按钮，且 banner 改为显示用户信息） */}
        <AgentInputPanel session={session} />
      </div>
    </section>
  );
};

/**
 * 客服端输入区（独立于客户端 InputPanel）
 * - 不显示"转人工"按钮（已经是客服）
 * - 不显示 Skill 工具栏
 * - 顶部展示当前用户信息
 * - 复用客户 InputPanel 的发送逻辑（图片/文件 + 文本）
 *
 * 实现：抽出一个简化版输入框组件，避免和客户端 InputPanel 的多状态分支纠缠
 */
const AgentInputPanel: React.FC<{ session: AgentSession }> = ({ session }) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<
    Array<{ kind: 'image' | 'file'; url: string; name: string; size: number; mime?: string }>
  >([]);

  const taRef = useRef<any>(null);
  const fileToDataURL = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const onUpload = async (file: File, kind: 'image' | 'file') => {
    const url = await fileToDataURL(file);
    setAttachments((arr) => [
      ...arr,
      { kind, url, name: file.name, size: file.size, mime: file.type },
    ]);
    return false;
  };

  const removeAttachment = (idx: number) => {
    setAttachments((arr) => arr.filter((_, i) => i !== idx));
  };

  const onSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    // 复用全局事件总线，避免直接 import store 触发循环
    window.dispatchEvent(
      new CustomEvent('agent:send-message', {
        detail: {
          sessionId: session.sessionId,
          trimmed,
          attachments,
        },
      }),
    );
    setText('');
    setAttachments([]);
  }, [text, attachments, session.sessionId]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend],
  );

  return (
    <div className="agent-input">
      <div className="agent-input__head">
        <CustomerServiceOutlined style={{ color: '#00b894' }} />
        <span>正在为用户 {session.clientId?.slice(-6) || '未知'} 服务</span>
      </div>

      {attachments.length > 0 && (
        <div className="agent-input__attachments">
          {attachments.map((a, i) => (
            <div key={i} className={`attachment-chip ${a.kind === 'image' ? 'is-image' : ''}`}>
              {a.kind === 'image' ? (
                <img src={a.url} alt={a.name} className="attachment-chip__thumb" />
              ) : (
                <span className="attachment-chip__icon">📎</span>
              )}
              <span className="attachment-chip__name">{a.name}</span>
              <span className="attachment-chip__close" onClick={() => removeAttachment(i)}>
                ×
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="agent-input__toolbar">
        <UploadButton
          accept="image/*"
          icon="🖼️"
          label="图片"
          onPick={(f) => {
            void onUpload(f, 'image');
          }}
        />
        <UploadButton
          icon="📎"
          label="文件"
          onPick={(f) => {
            void onUpload(f, 'file');
          }}
        />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>Enter 发送 · Shift+Enter 换行</span>
      </div>

      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="输入回复…"
        rows={3}
        className="agent-input__textarea"
      />

      <div className="agent-input__bottom">
        <Button
          type="primary"
          onClick={onSend}
          disabled={!text.trim() && attachments.length === 0}
          className="agent-input__send"
        >
          发送
        </Button>
      </div>
    </div>
  );
};

/** 极简上传按钮 - 避免 antd Upload 在多文件场景下的状态混乱 */
const UploadButton: React.FC<{
  accept?: string;
  icon: string;
  label: string;
  onPick: (file: File) => void | Promise<void>;
}> = ({ accept, icon, label, onPick }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="agent-input__tool"
        onClick={() => ref.current?.click()}
      >
        <span style={{ marginRight: 4 }}>{icon}</span>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await onPick(f);
          e.target.value = '';
        }}
      />
    </>
  );
};
