/**
 * 轻量虚拟列表
 * - 只渲染视口内 + overscan 的项
 * - 视口外的项不入 DOM → 离屏 DOM 释放
 * - 固定行高（适合 Sidebar 会话项）
 * - 支持自定义 item 渲染
 *
 * 用法：
 *   <VirtualList
 *     items={sessions}
 *     itemHeight={48}
 *     height={containerHeight}
 *     overscan={3}
 *     renderItem={(item, index) => <ItemView ... />}
 *   />
 *
 * 为什么不直接用 react-window：
 * - 避免增加依赖和包体积
 * - Sidebar 列表结构简单（固定高度 + 单个滚动容器），自实现可控性更强
 * - 编辑态（Input）的高度变化用 reflow 兜底
 */

import React, { useRef, useState, useCallback } from 'react';
import useIsomorphicLayoutEffect from '@/hooks/useIsomorphicLayoutEffect';

interface Props<T> {
  items: T[];
  itemHeight: number;
  height: number;
  overscan?: number;
  className?: string;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** 空状态 */
  empty?: React.ReactNode;
  /** 强制重新测量 item 高度的 key（编辑态变化时让列表 re-render） */
  remeasureKey?: string | number;
}

export function VirtualList<T>({
  items,
  itemHeight,
  height,
  overscan = 3,
  className,
  renderItem,
  empty,
  remeasureKey,
}: Props<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // 用 useLayoutEffect 同步设置初始 scrollTop
  // 避免初次渲染时 scrollTop 短暂为 0 导致首屏渲染最顶部几项
  useIsomorphicLayoutEffect(() => {
    if (scrollerRef.current && scrollerRef.current.scrollTop !== scrollTop) {
      scrollerRef.current.scrollTop = scrollTop;
    }
  }, [scrollTop]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop);
  }, []);

  // 计算可见区
  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + height) / itemHeight) + overscan,
  );

  // 视口上方 padding：让滚动条长度正确，同时把可见项顶到正确位置
  const paddingTop = startIndex * itemHeight;
  // 视口下方 padding：撑起剩余高度
  const paddingBottom = Math.max(0, totalHeight - endIndex * itemHeight);

  if (items.length === 0 && empty) {
    return (
      <div className={className} style={{ height, overflowY: 'auto' }}>
        {empty}
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className={className}
      onScroll={onScroll}
      style={{ height, overflowY: 'auto' }}
      // 供外部查找虚拟列表的滚动容器（例如 Sidebar 自动滚动到当前项）
      data-vlist="scroller"
      // key 变化时强制重新测量（编辑态 item 高度变化时让 visible window 重算）
      data-remeasure-key={remeasureKey}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: paddingTop,
            left: 0,
            right: 0,
            // 渲染从 startIndex 到 endIndex 的项
            // 离屏项不入 DOM → 真正的"离屏 DOM 释放"
          }}
        >
          {items.slice(startIndex, endIndex).map((item, i) => {
            const realIndex = startIndex + i;
            return (
              <div
                key={(item as any).id || realIndex}
                style={{ height: itemHeight }}
              >
                {renderItem(item, realIndex)}
              </div>
            );
          })}
        </div>
        {/* 占位：底部 padding 用来撑起 totalHeight 的滚动长度 */}
        {paddingBottom > 0 && (
          <div style={{ height: paddingBottom, position: 'absolute', top: endIndex * itemHeight, left: 0, right: 0 }} />
        )}
      </div>
    </div>
  );
}
