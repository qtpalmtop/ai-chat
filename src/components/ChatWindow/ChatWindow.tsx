/**
 * 主对话区
 * - 顶部 Header（标题 / Skill 切换器 / 操作菜单）
 * - 消息列表（**虚拟列表**：离屏 DOM 释放，100+ 条消息也流畅）
 * - 输入区
 * - 历史会话进入：useLayoutEffect 同步 scrollTo，浏览器 paint 前完成定位，
 *   用户看不到"从顶部滚到底"的中间过程
 *
 * 虚拟列表的特殊处理：
 *   - 已完成消息（status !== 'streaming'）进入虚拟列表（高度稳定、可累加 offset）
 *   - 流式中消息（status === 'streaming'）**剥离**到虚拟列表外（用 sticky bottom 固定）
 *   - 这样 SSE 打字机更新时不会触发虚拟列表 offset 重算 → 滚动条不跳动
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Button, App, Dropdown } from 'antd';
import { DeleteOutlined, MoreOutlined, CodeOutlined, CopyOutlined, CustomerServiceOutlined } from '@ant-design/icons';
import { useChatStore, useCurrentSession, useCurrentMessages } from '@/store/chatStore';
import { useChat } from '@/hooks/useChat';
import { useAgentStore } from '@/store/agentStore';
import useIsomorphicLayoutEffect from '@/hooks/useIsomorphicLayoutEffect';
import { MessageItem } from '@/components/MessageItem/MessageItem';
import { InputPanel, WelcomePanel } from '@/components/InputPanel/InputPanel';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { MessageVirtualList } from '@/components/MessageVirtualList/MessageVirtualList';
import { SkillBar } from '@/components/SkillBar/SkillBar';
import type { Message } from '@/types/message';
import { sortMessagesByServerTime } from '@/utils/messageSort';

export const ChatWindow: React.FC = () => {
  if (typeof window !== 'undefined') {
    console.log('[diag] ChatWindow render start');
  }
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log('[diag] ChatWindow MOUNT');
      return () => console.log('[diag] ChatWindow UNMOUNT');
    }
  }, []);
  const session = useCurrentSession();
  const aiMessages = useCurrentMessages();
  const clearAll = useChatStore((s) => s.clearAll);
  // 等 store 从 localStorage 完成 hydration（关键：刷新页面时 messages 才会是完整数据）
  const hasHydrated = useChatStore((s) => s.hasHydrated);
  const { message } = App.useApp();
  const listRef = useRef<HTMLDivElement>(null);

  // ===== 客服会话状态 =====
  const clientSession = useAgentStore((s) => s.clientSession);

  /**
   * 消息数据源统一：
   *   - 客服会话中（inSession）→ 用 clientSession.messages（来自 WS）
   *   - 其他状态 → 用 chatStore 的 aiMessages（来自 SSE / localStorage）
   *
   * 这样切换不丢消息，且客服消息（含 role='agent'）能复用 MessageItem 渲染
   */
  const isAgentMode = clientSession.status === 'inSession';
  const messages: readonly Message[] = isAgentMode ? clientSession.messages : aiMessages;

  // 排序：按 createdAt 升序（同 createdAt 时按 id 字典序）
  // 为什么需要：
  //   - 客户端时区变更 / 时钟漂移会让本地 createdAt 顺序错位
  //   - WS 批量转发多条消息时 createdAt 可能乱序
  //   - 断网重连增量同步边界处的消息需稳定排序
  // 不修改入参数组 / 不修改 message 引用，下游 React.memo 能正确复用
  const sortedMessages = useMemo(
    () => sortMessagesByServerTime(messages),
    [messages],
  );

  // 标记用户是否"贴近底部"——只有贴近底部时才允许 SSE 自动跟随
  // 用 ref 而不是 state：避免每次滚动都触发组件重渲染
  const isAtBottomRef = useRef(true);

  // 屏蔽程序触发的 scroll 事件：自动跟随 scrollTo 会触发 onScroll，
  // 如果不屏蔽，每次自动跟随都会把 isAtBottom 重置（误判）
  const suppressScrollRef = useRef(false);

  // 记录上一次 scrollTop，用于检测"用户主动向上滚"的方向意图
  const lastScrollTopRef = useRef(0);

  // 切会话时重置：用户期望看到新会话的最新内容，自动滚到底
  useEffect(() => {
    isAtBottomRef.current = true;
    lastScrollTopRef.current = 0;
    suppressScrollRef.current = false;
  }, [session?.id]);

  // 拆分消息：已完成 + 流式中
  // 流式中消息（status === 'streaming'）固定在虚拟列表外，避免影响 offset 累加
  // 入参用 sortedMessages（已按 createdAt 排序）保证 doneMessages 渲染顺序稳定
  const { doneMessages, streamingMessage } = useMemo(() => {
    let streaming: Message | null = null;
    const done: Message[] = [];
    for (const m of sortedMessages) {
      if (m.status === 'streaming') {
        streaming = m;
      } else {
        done.push(m);
      }
    }
    return { doneMessages: done, streamingMessage: streaming };
  }, [sortedMessages]);

  // 列表容器高度
  const [listHeight, setListHeight] = useState(0);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // 立即测量一次：避免首屏空白
    // 用 Math.max(1, ...) 兜底：移动端偶发 .main__body 拿到 0 高度（flex 塌缩 / 父级未渲染完），
    // 此时给 1px 让 MessageVirtualList 至少能渲染出滚动容器结构，
    // 后续 ResizeObserver 会以正确高度覆盖回来。
    const measure = () => {
      const h = el.clientHeight;
      const next = h > 0 ? h : Math.max(1, el.getBoundingClientRect().height || 0);
      setListHeight(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // 移动端键盘弹起 / 旋转屏幕会触发 window.resize，额外再测一次
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // 滚到底触发器：hydration 完成 / 切会话 / messages 数量变化
  // 用 useMemo 缓存：避免每次 render 都生成新字符串让子组件 props 抖动
  const scrollToBottomKey = useMemo(
    () => `${hasHydrated}-${session?.id}-${messages.length}`,
    [hasHydrated, session?.id, messages.length],
  );

  /**
   * useIsomorphicLayoutEffect 同步在浏览器 paint 之前执行
   * - 首次挂载：消息列表 DOM 已创建但浏览器还没 paint → scrollTo bottom → 用户看到的就是"已到底"
   * - 切会话：列表组件重渲染（messages 引用变了）→ useIsomorphicLayoutEffect 同步滚到底 → paint 时无中间过程
   * - 不会看到"从顶部开始往下滚"的视觉跳跃
   * - SSR 端自动降级为 useEffect，避免 React 18 useLayoutEffect SSR 警告
   */
  useIsomorphicLayoutEffect(() => {
    if (!hasHydrated) return;
    const el = listRef.current;
    if (!el) return;
    suppressScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    void el.offsetHeight;
  }, [hasHydrated, scrollToBottomKey]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;

    if (suppressScrollRef.current) {
      suppressScrollRef.current = false;
      lastScrollTopRef.current = el.scrollTop;
      return;
    }

    if (el.scrollTop < lastScrollTopRef.current) {
      isAtBottomRef.current = false;
    } else {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      isAtBottomRef.current = distanceToBottom < 50;
    }

    lastScrollTopRef.current = el.scrollTop;
  }, []);

  // 增量更新：SSE 流式更新时如果贴近底部 → 跟随
  // 注意：这里依赖的是已闭合消息的 parts/pendingText 变化
  // 流式中的 message 自身在 MessageVirtualList 内部处理跟随
  useEffect(() => {
    if (!isAtBottomRef.current) return;
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      suppressScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
    });
  }, [
    doneMessages.length,
    doneMessages[doneMessages.length - 1]?.parts.length,
    streamingMessage?.pendingText,
    streamingMessage?.parts.length,
  ]);

  const onCopy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(() => message.success('已复制到剪贴板'));
    },
    [message],
  );

  const { regenerate } = useChat();

  // 点击推荐追问 chip：把它作为新消息发出（与豆包"点击推荐追问直接发送"行为一致）
  const onSuggestionPick = useCallback(
    (s: string) => {
      // 直接通过 store + useChat 的公共方法发送
      const state = useChatStore.getState();
      if (!state.currentSessionId) state.createSession('新对话');
      // 拿到最新 sendMessage
      useChatStore.getState(); // 占位，避免 lint 警告
      // 简单做法：触发一次全局事件，InputPanel 监听后写入并发送
      // 但更直接：通过 useChat hook 拿 sendMessage 不易（hook 只能在组件顶层用）
      // 这里用 store 里暴露的 addUserMessageAndSend 风格的辅助：暂用自定义事件
      window.dispatchEvent(new CustomEvent('doubao:send-suggestion', { detail: s }));
    },
    [],
  );

  const onRegenerate = useCallback(
    (m: Message) => {
      regenerate(m);
    },
    [regenerate],
  );

  // MessageItem 已被 React.memo 包裹，render fn 必须稳定引用，否则 props.onCopy 抖动会让所有项重渲染
  const renderItem = useCallback(
    (m: Message) => (
      <MessageItem
        message={m}
        onCopy={onCopy}
        onSuggestionPick={onSuggestionPick}
        onRegenerate={onRegenerate}
      />
    ),
    [onCopy, onSuggestionPick, onRegenerate],
  );
  const renderStreaming = useCallback(
    (m: Message) => (
      <MessageItem
        message={m}
        onCopy={onCopy}
        onSuggestionPick={onSuggestionPick}
        onRegenerate={onRegenerate}
      />
    ),
    [onCopy, onSuggestionPick, onRegenerate],
  );
  const getKey = useCallback((m: Message) => m.id, []);

  // 复制下拉菜单的 items：依赖 messages / session，重建是必要的（要取最新数据）
  const dropdownItems = useMemo(
    () => [
      {
        key: 'export',
        icon: <CodeOutlined />,
        label: '复制会话 JSON',
        onClick: () => {
          navigator.clipboard.writeText(JSON.stringify(messages, null, 2));
          message.success('已复制');
        },
      },
      {
        key: 'copy-md',
        icon: <CopyOutlined />,
        label: '复制为 Markdown',
        onClick: () => {
          const md = messages
            .map((m) => {
              const text = m.parts
                .map((p) => (p.type === 'markdown' || p.type === 'text' ? p.content : ''))
                .join('\n');
              return `### ${m.role}\n\n${text}`;
            })
            .join('\n\n---\n\n');
          navigator.clipboard.writeText(md);
          message.success('已复制');
        },
      },
      { type: 'divider' as const },
      {
        key: 'clear',
        icon: <DeleteOutlined />,
        danger: true,
        label: '清空所有会话',
        onClick: () => {
          clearAll();
          message.success('已清空');
        },
      },
    ],
    [messages, clearAll, message],
  );

  return (
    <div className="layout">
      <Sidebar />
      <main className="main">
        <header className="main__header">
          <div className="main__title">
            {isAgentMode ? (
              <>
                <CustomerServiceOutlined style={{ marginRight: 8, color: '#00b894' }} />
                客服对话中
                <span className="main__title-sub">
                  {clientSession.agent?.agentName || ''}
                </span>
              </>
            ) : clientSession.status === 'queued' ? (
              <>正在为您接入客服…</>
            ) : (
              session?.title || '豆包 AI'
            )}
          </div>
          <div className="main__actions">
            <Dropdown menu={{ items: dropdownItems }}>
              <Button type="text" icon={<MoreOutlined />} />
            </Dropdown>
          </div>
        </header>

        <SkillBar />

        <div className="main__body" ref={listRef} onScroll={onScroll}>
          {(!session && !isAgentMode) ||
          (aiMessages.length === 0 && !streamingMessage && !isAgentMode) ? (
            <div className="main__inner">
              <WelcomePanel />
            </div>
          ) : (
            <MessageVirtualList
              items={doneMessages}
              streamingItem={streamingMessage}
              getKey={getKey}
              height={listHeight}
              overscan={2}
              scrollToBottomKey={scrollToBottomKey}
              followStreaming
              renderItem={renderItem}
              renderStreaming={renderStreaming}
            />
          )}
        </div>

        <div className="main__footer">
          {/* 不再加 key={session.id}：那会让 InputPanel 在 hydration 期间重建，
              顺带把 useAgentSocket 已连上的 WS 立刻关掉，转人工按钮变 disabled。
              切换会话时清空 text/attachments 由 InputPanel 内部 useEffect 监听
              currentSessionId 变化完成。 */}
          <InputPanel />
        </div>
      </main>
    </div>
  );
};

// 诊断：ChatWindow unmount 跟踪
if (typeof window !== 'undefined') {
  const _origRender = ChatWindow;
  // 不好用 hook 跟踪 unmount；用 console.log 替代
}
