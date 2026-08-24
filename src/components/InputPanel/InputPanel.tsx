/**
 * 输入区 - 多模态输入
 * - 文本 + 富文本工具栏 + 图片 + 文件
 * - Enter 发送 / Shift+Enter 换行
 * - **允许在 AI 生成中继续输入**：
 *   - 输入框始终可写
 *   - 按 Enter 发送时若正在 streaming，先 stop 旧流（标 'interrupted'），再发新消息
 *   - 右侧始终显示"发送"按钮，stop 作为独立的小图标按钮
 *
 * 性能：isStreaming 用单 selector，依赖当前会话的 messages 长度
 *       messages 内部未变（其他会话或 pendingText）时不会重渲染
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Button,
  Input,
  Tooltip,
  Upload,
  message as antdMsg,
  Space,
} from 'antd';
import {
  SendOutlined,
  StopOutlined,
  PictureOutlined,
  FileAddOutlined,
  BoldOutlined,
  CodeOutlined,
  UnorderedListOutlined,
  ClearOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
  TranslationOutlined,
  EditOutlined,
  CodeSandboxOutlined,
  BarChartOutlined,
  CloseOutlined,
  CustomerServiceOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useChat } from '@/hooks/useChat';
import { useChatStore } from '@/store/chatStore';
import { useAgentStore } from '@/store/agentStore';
import { useAgentSocket } from '@/hooks/useAgentSocket';
import { SKILLS } from '@/components/SkillBar/skills';
import type { SkillMeta } from '@/types/message';

interface Attachment {
  kind: 'image' | 'file';
  url: string;
  name: string;
  size: number;
  mime?: string;
}

const SKILL_ICONS: Record<string, React.ReactNode> = {
  default: <ThunderboltOutlined />,
  thinking: <ThunderboltOutlined />,
  web: <GlobalOutlined />,
  translate: <TranslationOutlined />,
  writer: <EditOutlined />,
  coder: <CodeSandboxOutlined />,
  analyst: <BarChartOutlined />,
};

const WELCOME = '你好，我是豆包 👋 试试问我：写一个 React Hook 例子 / 用图表展示销售占比 / 深度思考 2024 营收趋势';
const SUGGESTIONS = [
  '写一个 React Hook 例子',
  '深度思考：2024 年营收趋势',
  '用图表展示销售占比',
  '对比 iPhone / 华为 / 小米',
  '北京今天天气',
];

export const InputPanel: React.FC = () => {
  const { sendMessage, stop } = useChat();
  const createSession = useChatStore((s) => s.createSession);

  // ===== 客服会话状态 =====
  const mode = useAgentStore((s) => s.mode);
  const setMode = useAgentStore((s) => s.setMode);
  const clientUserId = useAgentStore((s) => s.clientUserId);
  const clientUserName = useAgentStore((s) => s.clientUserName);
  const setClientIdentity = useAgentStore((s) => s.setClientIdentity);
  const clientSession = useAgentStore((s) => s.clientSession);
  const onSystemEvent = useAgentStore((s) => s.onSystemEvent);
  const requestTransferHuman = useAgentStore((s) => s.requestTransferHuman);
  const cancelQueue = useAgentStore((s) => s.cancelQueue);
  const sendClientMessage = useAgentStore((s) => s.sendClientMessage);
  const endClientSession = useAgentStore((s) => s.endClientSession);

  // 首次挂载：进入 client 模式 + 自动生成/恢复 userId
  useEffect(() => {
    console.log('[diag] mount effect; clientUserId=', clientUserId, 'mode=', mode,
      'setMode===', setMode === (window as any).__diag_setMode ? 'SAME' : 'CHANGED',
      'setClientIdentity===', setClientIdentity === (window as any).__diag_setClientIdentity ? 'SAME' : 'CHANGED');
    (window as any).__diag_setMode = setMode;
    (window as any).__diag_setClientIdentity = setClientIdentity;
    setMode('client');
    if (!clientUserId) {
      const newId = `u_${Date.now().toString(36)}`;
      console.log('[diag] generating new clientId', newId);
      setClientIdentity(newId, `访客${newId.slice(-4)}`);
    }
    return () => {
      console.log('[diag] unmount cleanup');
    };
  }, [mode, setMode, clientUserId, setClientIdentity]);

  // WS 连接
  const { send: wsSend, isOpen: wsOpen } = useAgentSocket({
    role: 'client',
    id: clientUserId,
    displayName: clientUserName || undefined,
    onEvent: onSystemEvent,
  });

  // 流式状态完全按"当前会话"的消息状态判定：
  // A 在生成时切到 B，B 的消息列表里没有 status === 'streaming' 的项，自然为 false；
  // 切回 A 时，A 的消息列表里仍有 streaming 消息，自然为 true。
  const isStreaming = useChatStore((s) => {
    if (!s.currentSessionId) return false;
    const msgs = s.messages[s.currentSessionId];
    return msgs ? msgs.some((m) => m.status === 'streaming') : false;
  });

  // 当前激活的 Skill（同步顶部 SkillBar）
  const activeSkillId = useChatStore((s) => s.activeSkillId) || 'default';
  const setActiveSkill = useChatStore((s) => s.setActiveSkill);
  const activeSkill: SkillMeta =
    SKILLS.find((s) => s.id === activeSkillId) || SKILLS[0];

  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // @ 唤起 Skill 弹窗
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  // 自动高度
  const taRef = useRef<any>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 切换会话时清空本地输入态（替代外层用 key={sessionId} 强制重建的旧方案）
  // 不重建组件是因为 InputPanel 持有 useAgentSocket，重建会立刻断开 WS
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const prevSessionIdRef = useRef<string | null>(currentSessionId);
  useEffect(() => {
    if (prevSessionIdRef.current !== currentSessionId) {
      prevSessionIdRef.current = currentSessionId;
      setText('');
      setAttachments([]);
    }
  }, [currentSessionId]);

  const insertMarkdown = useCallback(
    (snippet: string, offset = 0) => {
      const ta = taRef.current?.resizableTextArea?.textArea as HTMLTextAreaElement | undefined;
      if (!ta) {
        setText((t) => t + snippet);
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = text.slice(0, start);
      const after = text.slice(end);
      const next = before + snippet + after;
      setText(next);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + offset, start + snippet.length - offset);
      });
    },
    [text],
  );

  /**
   * 发送逻辑：
   * - 始终允许发送（输入框不锁）
   * - 若当前会话正在 streaming：sendMessage 内部会自动 stop 旧流 + 标 'interrupted'
   *   旧 AI 消息会保留在历史里（带"已停止"标记），新消息接在后面
   * - AI 只对最新 user 消息生成回复
   *
   * 客服模式（clientSession.status === 'inSession'）：改为走 WS 发给客服
   *   乐观更新在 store 内部做（sendClientMessage），这里只负责构造 parts 并通过 wsSend 发送
   */
  const onSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) {
      antdMsg.warning('说点什么再发送吧');
      return;
    }

    // 客服对话模式：发到客服
    if (clientSession.status === 'inSession' && wsOpen) {
      const parts: import('@/types/message').MessagePart[] = [];
      if (trimmed) {
        parts.push({ type: trimmed.includes('\n') ? 'markdown' : 'text', content: trimmed });
      }
      for (const a of attachments) {
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
      const messageId = sendClientMessage(parts);
      if (messageId) {
        wsSend({ type: 'client.send', messageId, parts });
        setText('');
        setAttachments([]);
      }
      return;
    }

    // 普通 AI 对话模式
    sendMessage(trimmed, {
      images: attachments
        .filter((a) => a.kind === 'image')
        .map((a) => ({ url: a.url, alt: a.name })),
      files: attachments
        .filter((a) => a.kind === 'file')
        .map((a) => ({ name: a.name, size: a.size, url: a.url, mime: a.mime })),
    });
    setText('');
    setAttachments([]);
  }, [text, attachments, sendMessage, clientSession.status, wsOpen, sendClientMessage, wsSend]);

  /** 点击 "转人工"：向 server 发起转人工请求 */
  const onTransferHuman = useCallback(() => {
    if (!wsOpen) {
      antdMsg.warning('连接尚未就绪，请稍后再试');
      return;
    }
    requestTransferHuman('normal');
    wsSend({ type: 'client.transfer_human', reason: 'normal' });
  }, [wsOpen, requestTransferHuman, wsSend]);

  /** 取消排队 */
  const onCancelQueue = useCallback(() => {
    cancelQueue();
    wsSend({ type: 'client.cancel_queue' });
  }, [cancelQueue, wsSend]);

  /** 结束客服对话 */
  const onEndSession = useCallback(() => {
    endClientSession();
    wsSend({ type: 'client.end_session' });
  }, [endClientSession, wsSend]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 兜底：Cmd/Ctrl + A 全选。
      // antd Input.TextArea 在 controlled value 模式下，
      // macOS Chrome/Safari 的 Cmd+A 浏览器默认 select-all 行为不可靠
      // （puppeteer + 真实浏览器均可复现：selection 仍停在光标处）。
      // 手动 select() 兜底，不 preventDefault 让浏览器先尝试默认行为。
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        const t = e.currentTarget;
        if (t && typeof t.select === 'function') {
          // 延后到 keydown 同步代码执行完后再 select，避免 antd 内部 onKeydown
          // 链路上有 setSelectionRange 之类的覆盖
          requestAnimationFrame(() => {
            try {
              t.focus();
              t.select();
            } catch {
              /* noop */
            }
          });
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend],
  );

  // @ 唤起 Skill 弹窗：监听输入框内 "@" 字符 → 弹面板
  const onTextChange = useCallback((next: string) => {
    setText(next);
    // 简化版：输入框为空时不弹；输入 "@" 时弹
    if (next.endsWith('@') && !next.slice(0, -1).endsWith('@')) {
      setShowSkillMenu(true);
    }
  }, []);

  const onPickSkill = useCallback(
    (s: SkillMeta) => {
      setActiveSkill(s.id === 'default' ? null : s.id);
      setShowSkillMenu(false);
      // 移除输入框末尾的 "@"
      setText((t) => t.replace(/@$/, ''));
      antdMsg.success(`已切换到 ${s.name}`);
    },
    [setActiveSkill],
  );

  // 点击外部关闭弹窗
  useEffect(() => {
    if (!showSkillMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowSkillMenu(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showSkillMenu]);

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
    return false; // 阻止 antd Upload 自动上传
  };

  const removeAttachment = (idx: number) => {
    setAttachments((arr) => arr.filter((_, i) => i !== idx));
  };

  const onClear = () => {
    setText('');
    setAttachments([]);
  };

  /**
   * 监听"推荐追问" chip 点击事件
   * - ChatWindow 通过 window.dispatchEvent('doubao:send-suggestion', { detail: s })
   * - 这里直接调用 sendMessage（不写入输入框）——与豆包行为一致：点 chip 立刻追问
   */
  useEffect(() => {
    const onSuggestion = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === 'string' && detail.trim()) {
        sendMessage(detail, { images: [], files: [] });
      }
    };
    window.addEventListener('doubao:send-suggestion', onSuggestion as EventListener);
    return () => window.removeEventListener('doubao:send-suggestion', onSuggestion as EventListener);
  }, [sendMessage]);

  // ===== 状态分支：排队中 =====
  if (clientSession.status === 'queued') {
    const waitMin = clientSession.estimatedWaitSec
      ? Math.max(1, Math.ceil(clientSession.estimatedWaitSec / 60))
      : 1;
    return (
      <div className="input-panel input-panel--agent" ref={panelRef}>
        <div className="agent-queue">
          <div className="agent-queue__icon">
            <ClockCircleOutlined spin />
          </div>
          <div className="agent-queue__title">正在为您接入客服…</div>
          <div className="agent-queue__sub">
            当前排队位置：
            <b>第 {clientSession.queuePosition || 1} 位</b>
            ，预计等待约 <b>{waitMin} 分钟</b>
          </div>
          <div className="agent-queue__tip">客服接入后将自动开始对话，请稍候</div>
          <Button onClick={onCancelQueue} className="agent-queue__cancel">
            取消排队
          </Button>
        </div>
      </div>
    );
  }

  // ===== 状态分支：客服对话中 =====
  if (clientSession.status === 'inSession') {
    return (
      <div className="input-panel input-panel--agent" ref={panelRef}>
        <div className="agent-banner">
          <CustomerServiceOutlined className="agent-banner__icon" />
          <span className="agent-banner__label">客服对话中</span>
          <span className="agent-banner__name">
            {clientSession.agent?.agentName || '客服'}
            <CheckCircleOutlined className="agent-banner__verified" />
          </span>
          <div style={{ flex: 1 }} />
          <Button size="small" type="text" danger onClick={onEndSession}>
            结束对话
          </Button>
        </div>

        {attachments.length > 0 && (
          <div className="input-panel__attachments">
            {attachments.map((a, i) => (
              <div key={i} className={`attachment-chip ${a.kind === 'image' ? 'is-image' : ''}`}>
                {a.kind === 'image' ? (
                  <img src={a.url} alt={a.name} className="attachment-chip__thumb" />
                ) : (
                  <span className="attachment-chip__icon">📎</span>
                )}
                <span className="attachment-chip__name">{a.name}</span>
                <span
                  className="attachment-chip__close"
                  onClick={() => removeAttachment(i)}
                >
                  ×
                </span>
              </div>
            ))}
          </div>
        )}

        <Input.TextArea
          ref={taRef}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`正在和 ${clientSession.agent?.agentName || '客服'} 对话…`}
          autoSize={{ minRows: 2, maxRows: 8 }}
          className="input-panel__textarea"
        />

        <div className="input-panel__bottom">
          <div className="input-panel__hint">
            {!wsOpen ? '连接已断开，正在重连…' : 'Enter 发送 · Shift+Enter 换行'}
          </div>
          <Space size={4}>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={onSend}
              disabled={!text.trim() && attachments.length === 0}
              className="input-panel__send"
            >
              发送
            </Button>
          </Space>
        </div>
      </div>
    );
  }

  // ===== 状态分支：客服会话已结束 =====
  // 不再渲染大块"会话已结束"卡片——
  // 结束原因已经作为 system 消息插入到 ChatWindow 的聊天记录中（见 agentStore.onSystemEvent('session_ended')），
  // 用户能在历史中看到完整结束说明。输入区这里只放一行轻量提示，提示用户会话已结束（不可再发消息）。
  if (clientSession.status === 'ended') {
    return (
      <div className="input-panel input-panel--agent input-panel--ended" ref={panelRef}>
        <div className="agent-ended-hint">
          <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
          <span>本次客服对话已结束</span>
          <span className="agent-ended-hint__sub">
            如需继续咨询，请点击聊天区上方"再次转人工"
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="input-panel" ref={panelRef}>
      {/* 当前激活 Skill 提示条（不是 default 时显示） */}
      {activeSkillId !== 'default' && (
        <div className="input-panel__skill-chip">
          <span className="input-panel__skill-icon">
            {SKILL_ICONS[activeSkillId] || <ThunderboltOutlined />}
          </span>
          <span className="input-panel__skill-name">{activeSkill.name}</span>
          <span className="input-panel__skill-hint">{activeSkill.description}</span>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={() => setActiveSkill(null)}
            className="input-panel__skill-close"
          />
        </div>
      )}

      {attachments.length > 0 && (
        <div className="input-panel__attachments">
          {attachments.map((a, i) => (
            <div key={i} className={`attachment-chip ${a.kind === 'image' ? 'is-image' : ''}`}>
              {a.kind === 'image' ? (
                <img src={a.url} alt={a.name} className="attachment-chip__thumb" />
              ) : (
                <span className="attachment-chip__icon">📎</span>
              )}
              <span className="attachment-chip__name">{a.name}</span>
              <span className="attachment-chip__close" onClick={() => removeAttachment(i)}>×</span>
            </div>
          ))}
        </div>
      )}

      <div className="input-panel__toolbar">
        <Tooltip title="加粗">
          <Button type="text" icon={<BoldOutlined />} onClick={() => insertMarkdown('**加粗文字**', 4)} />
        </Tooltip>
        <Tooltip title="代码">
          <Button type="text" icon={<CodeOutlined />} onClick={() => insertMarkdown('`code`', 1)} />
        </Tooltip>
        <Tooltip title="列表">
          <Button
            type="text"
            icon={<UnorderedListOutlined />}
            onClick={() => insertMarkdown('\n- 列表项 1\n- 列表项 2\n')}
          />
        </Tooltip>
        <Upload
          accept="image/*"
          multiple
          showUploadList={false}
          beforeUpload={(f) => onUpload(f, 'image')}
        >
          <Tooltip title="上传图片">
            <Button type="text" icon={<PictureOutlined />} />
          </Tooltip>
        </Upload>
        <Upload multiple showUploadList={false} beforeUpload={(f) => onUpload(f, 'file')}>
          <Tooltip title="上传文件">
            <Button type="text" icon={<FileAddOutlined />} />
          </Tooltip>
        </Upload>
        {/* @ 唤起 Skill */}
        <Tooltip title="唤起 Skill（输入 @ 也可）">
          <Button
            type="text"
            icon={<ThunderboltOutlined />}
            onClick={() => setShowSkillMenu((v) => !v)}
            className={activeSkillId !== 'default' ? 'is-active' : ''}
          />
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Tooltip title="清空">
          <Button type="text" icon={<ClearOutlined />} onClick={onClear} />
        </Tooltip>
      </div>

      {/* @ 唤起的 Skill 弹窗（浮在工具栏下方） */}
      {showSkillMenu && (
        <div className="skill-menu">
          <div className="skill-menu__head">选择 Skill</div>
          <div className="skill-menu__list">
            {SKILLS.map((s) => (
              <button
                key={s.id}
                className={`skill-menu__item ${activeSkillId === s.id ? 'is-active' : ''}`}
                onClick={() => onPickSkill(s)}
              >
                <span className="skill-menu__icon">
                  {SKILL_ICONS[s.id] || <ThunderboltOutlined />}
                </span>
                <span className="skill-menu__main">
                  <span className="skill-menu__name">{s.name}</span>
                  <span className="skill-menu__desc">{s.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Input.TextArea
        ref={taRef}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          isStreaming
            ? 'AI 正在回复中…（继续输入会打断当前回复；输入 @ 唤起 Skill）'
            : '请输入消息，回车发送，Shift+回车换行，输入 @ 唤起 Skill'
        }
        autoSize={{ minRows: 2, maxRows: 8 }}
        className="input-panel__textarea"
      />

      <div className="input-panel__bottom">
        <div className="input-panel__hint">
          {isStreaming ? 'Enter 发送（打断当前）· Shift+Enter 换行 · @ 唤起 Skill' : 'Enter 发送 · Shift+Enter 换行 · @ 唤起 Skill'}
        </div>
        <Space size={4}>
          {/* 显式停止按钮：仅 streaming 时出现，给用户主动停止而不发新消息的选项 */}
          {isStreaming && (
            <Tooltip title="停止当前生成（不发送新消息）">
              <Button
                danger
                type="default"
                icon={<StopOutlined />}
                onClick={stop}
                className="input-panel__stop"
              >
                停止
              </Button>
            </Tooltip>
          )}
          <Tooltip title="转人工客服">
            <Button
              icon={<CustomerServiceOutlined />}
              onClick={onTransferHuman}
              disabled={!wsOpen}
              className="input-panel__transfer"
            >
              转人工
            </Button>
          </Tooltip>
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={onSend}
            disabled={!text.trim() && attachments.length === 0}
            className="input-panel__send"
          >
            发送
          </Button>
        </Space>
      </div>
    </div>
  );
};

export const WelcomePanel: React.FC = () => {
  const createSession = useChatStore((s) => s.createSession);
  return (
    <div className="welcome">
      <div className="welcome__hero">
        <div className="welcome__logo">豆</div>
        <h1>你好，我是豆包</h1>
        <p>{WELCOME}</p>
      </div>
      <div className="welcome__suggestions">
        {SUGGESTIONS.map((s) => (
          <Button key={s} className="welcome__chip" onClick={() => createSession(s)}>
            {s}
          </Button>
        ))}
      </div>
    </div>
  );
};
