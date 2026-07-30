/**
 * 消息气泡 - 渲染一条完整 Message
 * - user: 右对齐渐变气泡
 * - assistant: 左对齐白底气泡 + 分段流式 Markdown
 * - system: 居中提示
 *
 * 性能：React.memo 包裹，未变化的 message 不会重渲染
 * 性能：aiMarkdown / otherParts 用 useMemo 派生，避免每次 render 都重做 filter+map+join
 */

import React, { useMemo } from 'react';
import { Avatar, Tooltip, Button } from 'antd';
import { UserOutlined, RobotOutlined, CopyOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { Message, MessagePart } from '@/types/message';
import { MarkdownStream } from '@/components/MarkdownStream/MarkdownStream';
import { PartRenderer } from './PartRenderer';

interface Props {
  message: Message;
  onCopy?: (text: string) => void;
}

const MessageItemImpl: React.FC<Props> = ({ message, onCopy }) => {
  if (message.role === 'system') {
    return (
      <div className="msg msg--system">
        <span className="msg__system-text">
          {message.parts.find((p) => p.type === 'text')?.content}
        </span>
      </div>
    );
  }

  const isUser = message.role === 'user';

  // AI 消息：合并所有 markdown part 作为已渲染内容
  // 非 markdown/text part（图片、文件、富文本）单独渲染
  // 排除 'text' 是因为 user 的纯文本由下方独立块渲染，避免 PartRenderer 二次渲染造成重复
  const { aiMarkdown, otherParts } = useMemo(() => {
    let md = '';
    const others: MessagePart[] = [];
    for (const p of message.parts) {
      if (p.type === 'markdown') {
        md += (md ? '\n\n' : '') + p.content;
      } else if (p.type !== 'text') {
        others.push(p);
      }
    }
    return { aiMarkdown: md, otherParts: others };
  }, [message.parts]);

  const userText = useMemo(
    () =>
      isUser
        ? message.parts
            .filter((p) => p.type === 'text')
            .map((p) => (p as Extract<MessagePart, { type: 'text' }>).content)
        : [],
    [isUser, message.parts],
  );

  const onCopyClick = () => {
    const text = isUser
      ? userText.join('\n')
      : aiMarkdown || message.pendingText || '';
    onCopy?.(text);
  };

  return (
    <div className={`msg ${isUser ? 'msg--user' : 'msg--ai'}`}>
      {!isUser && <Avatar className="msg__avatar msg__avatar--ai" icon={<RobotOutlined />} />}
      <div className="msg__bubble">
        {otherParts.length > 0 && (
          <div className="msg__parts">
            {otherParts.map((p, i) => (
              <PartRenderer key={i} part={p} />
            ))}
          </div>
        )}

        {isUser && userText.length > 0 && (
          <div className="msg__text">
            {userText.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
          </div>
        )}

        {!isUser && (aiMarkdown || message.pendingText !== undefined) && (
          <MarkdownStream
            content={aiMarkdown}
            pending={message.pendingText || ''}
            streaming={message.status === 'streaming'}
          />
        )}

        <div className="msg__actions">
          <Tooltip title="复制">
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={onCopyClick} />
          </Tooltip>
          {message.status === 'interrupted' && (
            <span className="msg__status msg__status--stop">
              <CloseCircleOutlined /> 已停止生成
            </span>
          )}
          {message.status === 'error' && (
            <span className="msg__status msg__status--err">生成失败</span>
          )}
        </div>
      </div>
      {isUser && <Avatar className="msg__avatar msg__avatar--user" icon={<UserOutlined />} />}
    </div>
  );
};

/**
 * React.memo 包裹：message 引用未变就不重渲染
 * - 父组件 ChatWindow 流式期间，pendingText 变化的消息会换引用 → 这条会重渲染
 *   其他已完成消息引用稳定 → 不会重渲染 → 这是虚拟列表"已闭合"section 性能的关键
 */
export const MessageItem = React.memo(MessageItemImpl, (prev, next) => prev.message === next.message && prev.onCopy === next.onCopy);
