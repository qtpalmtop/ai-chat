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
} from '@ant-design/icons';
import { useChat } from '@/hooks/useChat';
import { useChatStore } from '@/store/chatStore';

interface Attachment {
  kind: 'image' | 'file';
  url: string;
  name: string;
  size: number;
  mime?: string;
}

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

  // 流式状态完全按"当前会话"的消息状态判定：
  // A 在生成时切到 B，B 的消息列表里没有 status === 'streaming' 的项，自然为 false；
  // 切回 A 时，A 的消息列表里仍有 streaming 消息，自然为 true。
  const isStreaming = useChatStore((s) => {
    if (!s.currentSessionId) return false;
    const msgs = s.messages[s.currentSessionId];
    return msgs ? msgs.some((m) => m.status === 'streaming') : false;
  });

  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // 自动高度
  const taRef = useRef<any>(null);

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
   */
  const onSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) {
      antdMsg.warning('说点什么再发送吧');
      return;
    }
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
  }, [text, attachments, sendMessage]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend],
  );

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

  return (
    <div className="input-panel">
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
        <div style={{ flex: 1 }} />
        <Tooltip title="清空">
          <Button type="text" icon={<ClearOutlined />} onClick={onClear} />
        </Tooltip>
      </div>

      <Input.TextArea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          isStreaming
            ? 'AI 正在回复中…（继续输入会打断当前回复）'
            : '请输入消息，回车发送，Shift+回车换行'
        }
        autoSize={{ minRows: 2, maxRows: 8 }}
        className="input-panel__textarea"
      />

      <div className="input-panel__bottom">
        <div className="input-panel__hint">
          {isStreaming ? 'Enter 发送（打断当前）· Shift+Enter 换行' : 'Enter 发送 · Shift+Enter 换行'}
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
