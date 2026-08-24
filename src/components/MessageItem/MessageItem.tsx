/**
 * 消息气泡 - 渲染一条完整 Message
 * - user: 右对齐渐变气泡
 * - assistant: 左对齐白底气泡 + 分段流式 Markdown + 多种扩展卡片
 * - system: 居中提示
 *
 * 交互能力（对齐豆包）：
 *   - 复制：复制整条消息文本
 *   - 点赞 / 点踩：feedback 单向选择（再点取消）
 *   - 重新生成：仅对已结束 AI 消息可用
 *   - 分享：导出单条消息 JSON
 *
 * 性能：React.memo 包裹，未变化的 message 不会重渲染
 * 性能：aiMarkdown / otherParts 用 useMemo 派生，避免每次 render 都重做 filter+map+join
 */

import React, { useMemo, useCallback } from 'react';
import { Avatar, Tooltip, Button, App, Space } from 'antd';
import {
  UserOutlined,
  RobotOutlined,
  CustomerServiceOutlined,
  CopyOutlined,
  CloseCircleOutlined,
  LikeOutlined,
  LikeFilled,
  DislikeOutlined,
  DislikeFilled,
  ReloadOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import type { Message, MessagePart, MessageFeedback } from '@/types/message';
import { MarkdownStream } from '@/components/MarkdownStream/MarkdownStream';
import { PartRenderer } from './PartRenderer';
import { useChatStore } from '@/store/chatStore';

interface Props {
  message: Message;
  onCopy?: (text: string) => void;
  onSuggestionPick?: (s: string) => void;
  onRegenerate?: (m: Message) => void;
}

const MessageItemImpl: React.FC<Props> = ({ message, onCopy, onSuggestionPick, onRegenerate }) => {
  const { message: antdMessage } = App.useApp();
  const setFeedback = useChatStore((s) => s.setMessageFeedback);

  const onCopyClick = useCallback(() => {
    const text = message.parts
      .map((p) => (p.type === 'markdown' || p.type === 'text' ? p.content : ''))
      .filter(Boolean)
      .join('\n\n');
    onCopy?.(text);
  }, [message.parts, onCopy]);

  const onFeedbackClick = useCallback(
    (v: 'like' | 'dislike') => {
      // 单向选择：再点同一项取消
      const next: MessageFeedback = message.feedback === v ? null : v;
      setFeedback(message.sessionId, message.id, next);
      if (next) antdMessage.success(next === 'like' ? '感谢你的反馈 👍' : '已记录你的反馈');
    },
    [message.feedback, message.sessionId, message.id, setFeedback, antdMessage],
  );

  const onShareClick = useCallback(() => {
    const json = JSON.stringify(
      { role: message.role, parts: message.parts, createdAt: message.createdAt },
      null,
      2,
    );
    navigator.clipboard.writeText(json).then(() => antdMessage.success('已复制消息 JSON'));
  }, [message, antdMessage]);

  if (message.role === 'system') {
    const t = message.parts.find((p) => p.type === 'text') as
      | Extract<MessagePart, { type: 'text' }>
      | undefined;
    return (
      <div className="msg msg--system">
        <span className="msg__system-text">{t?.content}</span>
      </div>
    );
  }

  const isUser = message.role === 'user';
  const isAgent = message.role === 'agent';
  const isAssistant = message.role === 'assistant';
  const isAiDone = isAssistant && message.status === 'done';

  // AI 消息：合并所有 markdown part 作为已渲染内容
  // 非 markdown/text part（图片、文件、富文本/思维链/引用/代码/图表/追问/工具调用/对比）单独渲染
  // 排除 'text' 是因为 user 的纯文本由下方独立块渲染，避免 PartRenderer 二次渲染造成重复
  //
  // ⚠️ 但 agent（客服）消息的 parts 几乎都是 text：客服发普通对话时只 push text part，
  // 不会被 userText 命中（userText 只对 isUser 渲染），也不会进 otherParts（被显式排除），
  // 也不会进 aiMarkdown（这里只收 markdown）→ 文字直接消失。
  // 解法：对 agent 角色把 text 也合并到 aiMarkdown 里（用 MarkdownStream 渲染纯文本 OK）。
  const { aiMarkdown, otherParts } = useMemo(() => {
    let md = '';
    const others: MessagePart[] = [];
    const includeText = message.role === 'agent';
    for (const p of message.parts) {
      if (p.type === 'markdown' || (includeText && p.type === 'text')) {
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

  return (
    <div className={`msg ${isUser ? 'msg--user' : isAgent ? 'msg--agent' : 'msg--ai'}`}>
      {!isUser && (
        <Avatar
          className={`msg__avatar ${isAgent ? 'msg__avatar--agent' : 'msg__avatar--ai'}`}
          icon={isAgent ? <CustomerServiceOutlined /> : <RobotOutlined />}
        />
      )}
      <div className="msg__bubble">
        {otherParts.length > 0 && (
          <div className="msg__parts">
            {otherParts.map((p, i) => (
              <PartRenderer key={i} part={p} onSuggestionPick={onSuggestionPick} />
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

          {isAiDone && (
            <>
              <Tooltip title={message.feedback === 'like' ? '取消点赞' : '有帮助'}>
                <Button
                  size="small"
                  type="text"
                  icon={message.feedback === 'like' ? <LikeFilled /> : <LikeOutlined />}
                  className={message.feedback === 'like' ? 'is-active' : ''}
                  onClick={() => onFeedbackClick('like')}
                />
              </Tooltip>
              <Tooltip title={message.feedback === 'dislike' ? '取消点踩' : '没帮助'}>
                <Button
                  size="small"
                  type="text"
                  icon={message.feedback === 'dislike' ? <DislikeFilled /> : <DislikeOutlined />}
                  className={message.feedback === 'dislike' ? 'is-active is-dislike' : ''}
                  onClick={() => onFeedbackClick('dislike')}
                />
              </Tooltip>
              <Tooltip title="重新生成">
                <Button
                  size="small"
                  type="text"
                  icon={<ReloadOutlined />}
                  onClick={() => onRegenerate?.(message)}
                />
              </Tooltip>
              <Tooltip title="分享">
                <Button size="small" type="text" icon={<ShareAltOutlined />} onClick={onShareClick} />
              </Tooltip>
            </>
          )}

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
 * - 回调 props（onCopy / onSuggestionPick / onRegenerate）必须稳定才能生效：
 *   父组件需用 useCallback 包裹；下方依赖检查把它们也纳入
 */
export const MessageItem = React.memo(
  MessageItemImpl,
  (prev, next) =>
    prev.message === next.message &&
    prev.onCopy === next.onCopy &&
    prev.onSuggestionPick === next.onSuggestionPick &&
    prev.onRegenerate === next.onRegenerate,
);
