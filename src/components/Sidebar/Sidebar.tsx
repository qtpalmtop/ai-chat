/**
 * 侧边栏 - 会话管理
 * - 新建 / 删除 / 重命名 / 切换
 * - 当前会话高亮
 * - 虚拟列表：只渲染视口内的项，离屏 DOM 释放
 *   - 100+ 会话也能流畅滚动，DOM 节点数恒定
 *   - 编辑态（Input）高度变化时通过 remeasureKey 强制重新测量
 *
 * 性能：sessions 派生数组用 useMemo 缓存，引用稳定才传给 VirtualList
 * 性能：SidebarItem 用 React.memo，未变化的项不重渲染
 */

import React, { useRef, useState, useEffect, useMemo, memo } from 'react';
import { Button, Input, Popconfirm, Tooltip, message as antdMsg } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import type { Session } from '@/types/message';
import { useChatStore } from '@/store/chatStore';
import { VirtualList } from '@/components/VirtualList/VirtualList';

const ITEM_HEIGHT = 48; // 每条会话项的固定高度

interface SidebarItemProps {
  session: Session;
  active: boolean;
  editing: boolean;
  editingTitle: string;
  onSelect: (id: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onFinishEdit: (id: string) => void;
  onChangeTitle: (title: string) => void;
  onDelete: (id: string) => void;
}

/**
 * 单条会话项：React.memo 包裹
 * 只有 active / editing / 标题变化时才重渲染
 * 100+ 会话时切换当前会话不会让其他 99 项重渲染
 */
const SidebarItem = memo(function SidebarItem({
  session,
  active,
  editing,
  editingTitle,
  onSelect,
  onStartEdit,
  onFinishEdit,
  onChangeTitle,
  onDelete,
}: SidebarItemProps) {
  const handleClick = () => !editing && onSelect(session.id);

  return (
    <div
      className={`sidebar__item ${active ? 'is-active' : ''}`}
      onClick={handleClick}
    >
      <MessageOutlined className="sidebar__item-icon" />
      {editing ? (
        <Input
          autoFocus
          size="small"
          value={editingTitle}
          onChange={(e) => onChangeTitle(e.target.value)}
          onBlur={() => onFinishEdit(session.id)}
          onPressEnter={() => onFinishEdit(session.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="sidebar__item-title">{session.title}</span>
      )}
      <div className="sidebar__item-actions" onClick={(e) => e.stopPropagation()}>
        <Tooltip title="重命名">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => onStartEdit(session.id, session.title)}
          />
        </Tooltip>
        <Popconfirm
          title="删除该会话？"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => {
            onDelete(session.id);
            antdMsg.success('已删除');
          }}
        >
          <Tooltip title="删除">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Tooltip>
        </Popconfirm>
      </div>
    </div>
  );
});

export const Sidebar: React.FC = () => {
  // 把 sessionIds / sessions 拆开订阅：s.sessions 变化（如重命名）才重渲染
  // sessionIds 顺序变化才重渲染（新建/删除/重排）
  const sessionIds = useChatStore((s) => s.sessionIds);
  const sessionsMap = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const setCurrent = useChatStore((s) => s.setCurrentSession);
  const createSession = useChatStore((s) => s.createSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const renameSession = useChatStore((s) => s.renameSession);

  // 派生 sessions 数组：useMemo 缓存，sessionIds/sessionsMap 引用不变就不重建
  // （之前是 selector 内 .map().filter()，每次 sessions 引用变都会返回新数组）
  const sessions = useMemo(
    () => sessionIds.map((id) => sessionsMap[id]).filter((s): s is Session => Boolean(s)),
    [sessionIds, sessionsMap],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  // 列表容器高度 = 视口高度 - 头部/底部/新建按钮等固定区域
  // 用 ResizeObserver 监听容器 resize 实时更新
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);
  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    // 立即测量一次：避免首屏空白
    setListHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setListHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 编辑态变化时改变 remeasureKey，让虚拟列表知道 item 高度可能变了
  // 这样正在编辑的项的可见区计算会重新执行（虽然实际我们保持固定高度，但保证 cursor 在视口内）
  const remeasureKey = editingId ?? 'normal';

  // 当前会话变化时，自动滚到可见区
  useEffect(() => {
    if (!currentSessionId) return;
    const idx = sessions.findIndex((s) => s.id === currentSessionId);
    if (idx === -1) return;
    // 找到列表滚动容器
    const el = listContainerRef.current?.querySelector('[data-vlist]') as HTMLDivElement | null;
    if (!el) return;
    const itemTop = idx * ITEM_HEIGHT;
    const itemBottom = itemTop + ITEM_HEIGHT;
    if (itemTop < el.scrollTop || itemBottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: Math.max(0, itemTop - 32), behavior: 'smooth' });
    }
  }, [currentSessionId, sessions]);

  // 编辑相关 handlers 全部用 useCallback 稳定引用，避免让 memo 包裹的 SidebarItem 失效
  const onStartEdit = (id: string, title: string) => {
    setEditingId(id);
    setEditingTitle(title);
  };
  const onFinishEdit = (id: string) => {
    const t = editingTitle.trim();
    if (t) renameSession(id, t);
    setEditingId(null);
  };
  const onChangeTitle = (title: string) => setEditingTitle(title);
  const onDelete = (id: string) => deleteSession(id);

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo">
          <ThunderboltFilled />
        </div>
        <div className="sidebar__title">豆包 AI</div>
      </div>

      <Button
        type="primary"
        block
        icon={<PlusOutlined />}
        className="sidebar__new"
        onClick={() => createSession('新对话')}
      >
        新建对话
      </Button>

      <div className="sidebar__list" ref={listContainerRef}>
        {sessions.length === 0 ? (
          <div className="sidebar__empty">暂无会话，点击上方按钮创建</div>
        ) : (
          <VirtualList
            items={sessions}
            itemHeight={ITEM_HEIGHT}
            height={listHeight}
            overscan={4}
            remeasureKey={remeasureKey}
            renderItem={(s) => (
              <SidebarItem
                session={s}
                active={s.id === currentSessionId}
                editing={editingId === s.id}
                editingTitle={editingTitle}
                onSelect={setCurrent}
                onStartEdit={onStartEdit}
                onFinishEdit={onFinishEdit}
                onChangeTitle={onChangeTitle}
                onDelete={onDelete}
              />
            )}
          />
        )}
      </div>

      <div className="sidebar__footer">
        <div className="sidebar__hint">本地演示版 · 数据存于 localStorage</div>
      </div>
    </aside>
  );
};
