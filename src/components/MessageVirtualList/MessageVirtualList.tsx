/**
 * 消息虚拟列表（变高 + 流式安全）
 *
 * 核心设计：
 *   1. 拆分流式中 / 已完成消息
 *   2. 已完成消息进入虚拟列表（高度稳定、可累加 offset）
 *   3. 流式中消息根据状态切换：
 *      a) 用户上滑看历史 → position: static（避免和历史消息重叠）
 *      b) 用户在底部 + 内容较短 → position: sticky 贴底（持续可见）
 *      c) 用户在底部 + 内容过高（≥ 视口 - 100px）→ position: static
 *         原因：CSS 规范规定 sticky 元素高度 ≥ containing block（视口）高度时 sticky 失效，
 *           元素会被压到顶部，看不到新生成的底部内容。
 *         修复：主动切 static + 自动滚到底，保证用户能看到最新内容。
 *   4. 这样 SSE 打字机增长 pendingText 时，不会让虚拟列表 offset 重算
 *   5. 也不会在用户向上滑动时盖住历史消息
 *
 * 为什么之前不做 sticky 兜底：
 *   - VariableSizeList + 流式更新：pendingText 增长 → 当前 message 高度变化 →
 *     所有下方 message 的 offsetTop 累加失效 → 滚动条跳动 / 错位
 *   - 解法：把"变高"的部分剥离到虚拟列表外
 *
 * 为什么用户向上滚时不能让 streaming 保持 sticky：
 *   - sticky bottom: 0 会让流式中 item 始终贴在视口底部
 *   - 用户向上滚后视口底部正好压在某条历史 message 上 → 视觉重叠
 *   - 正确做法：用户上滑时把 streaming 从 sticky 切到 static（文档流），
 *     并把它的当前高度纳入 totalHeight，让用户能滚过它看完整历史
 *
 * 为什么 streaming 过高时也要切 static：
 *   - CSS spec：sticky 元素高度 ≥ containing block 高度时 sticky 失效
 *   - 失效后元素被定位在 containing block 顶部（"If the box is taller than
 *     the containing block, the box is positioned at the top"）
 *   - 用户看到的会变成"陈旧顶部"而非"刚生成的新内容"——非常糟糕的体验
 *   - 必须主动切到 static 模式 + 触发自动滚到底
 *
 * 高度测量：
 *   - 已完成：进入列表时 ResizeObserver 测量一次，缓存
 *   - 流式中：独立 ref 测量；static 模式下纳入 totalHeight，sticky 模式下不纳入
 */

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import useIsomorphicLayoutEffect from '@/hooks/useIsomorphicLayoutEffect';

interface Props<T> {
  items: readonly T[];
  /** 当前正在流式生成的项目（如果有），会被移到虚拟列表外 */
  streamingItem?: T | null;
  /** 判断 item 的唯一 key */
  getKey: (item: T) => string;
  /** 渲染单条 item */
  renderItem: (item: T) => React.ReactNode;
  /** 渲染流式中的 item */
  renderStreaming: (item: T) => React.ReactNode;
  /** 容器高度 */
  height: number;
  /** 上下 overscan 行数 */
  overscan?: number;
  /** 触发滚到底部（首次进入 / 切会话 / 增量更新） */
  scrollToBottomKey?: string | number;
  /** 流式中 item 变化时也滚到底 */
  followStreaming?: boolean;
  className?: string;
}

/** 自动跟随 effect 需要的最小字段约束（不耦合具体 Message 类型） */
type StreamingLike = {
  id: string;
  pendingText?: string;
  parts: { length: number };
};

const DEFAULT_ESTIMATED_HEIGHT = 120; // 单条 message 估算高度（避免滚动条抖动）
const STREAMING_GAP = 8;
/** 距底部 50px 内视为"在底部"——容忍弹性滚动 / 程序化滚动 */
const AT_BOTTOM_THRESHOLD = 50;
/**
 * streaming 元素"过高"阈值：距视口高度不足此值时，认为元素过高
 * 原因：CSS 规范规定，sticky 元素高度 ≥ containing block（视口）高度时 sticky 失效，
 *   元素会被压到 containing block 顶部，导致用户看不到"刚生成的新内容"（最新内容在底部）。
 *   此时必须主动切到 static 模式 + 自动滚到底，让用户能看到最新内容。
 *   100px 留白：避免"刚好 800px"临界值频繁切换模式。
 */
const STREAMING_OVERFLOW_THRESHOLD = 100;

export function MessageVirtualList<T>({
  items,
  streamingItem,
  getKey,
  renderItem,
  renderStreaming,
  height,
  overscan = 3,
  scrollToBottomKey,
  followStreaming = true,
  className,
}: Props<T>) {
  // 关键兜底：父级可能因时序问题传 0 进来。给 1px 让滚动容器至少有个高度，touch 事件才有目标。
  // 一旦父级 ResizeObserver 触发新值，setListHeight 会把这个覆盖成正确高度。
  const safeHeight = height > 0 ? height : 1;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  // 缓存每条 item 的高度：Map<key, height>
  const heightsRef = useRef<Map<string, number>>(new Map());
  // 缓存总高度（用于渲染 spacer）—— 已完成消息累加 +（static 模式下）流式 item 高度
  const [totalHeight, setTotalHeight] = useState(items.length * DEFAULT_ESTIMATED_HEIGHT);
  // 流式中 item 的实时高度
  const streamingHeightRef = useRef<number>(0);
  // 流式中 item 高度的 state 版本（用于触发 re-render 让 totalHeight 跟上）
  const [streamingHeightState, setStreamingHeightState] = useState(0);

  // 用户是否在底部（影响 streaming item 的 position 策略）
  //   - true  → streaming 走 sticky bottom 模式（持续可见）
  //   - false → streaming 走 static 文档流模式（用户在看历史时不重叠）
  // 用 ref + state 双重：ref 用于 scroll handler 立即判断，state 用于驱动渲染
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // 用户是否「主动上滑离开」——一旦为 true，自动跟随 effect 立刻停止工作，
  // 直到用户重新滚回底部（distance < AT_BOTTOM_THRESHOLD）才解除。
  // 解决：用户滚 30px → 触发 setScrollTop → 触发 re-render → 自动跟随 effect 跑 → 把用户弹回底部
  // 加这个 ref 后，用户滚了就再也不会被弹回，直到他主动回去。
  const userScrolledUpRef = useRef(false);

  /**
   * 是否使用 static 模式（不进 sticky）
   * - 用户上滑（isAtBottom = false）→ 必须 static，避免覆盖用户在看的历史消息
   * - streaming 元素过高（高度 ≥ 视口 - 阈值）→ sticky CSS 失效，必须 static
   *   否则用户看到的是 streaming 元素的"陈旧顶部"，看不到"刚生成的新内容"
   * 用 ref + state 双重：ref 用于事件回调立即判断，state 用于驱动渲染
   */
  const useStaticRef = useRef(false);
  // streamingTooTall 在 render 中实时计算（基于最新 streamingHeightState）
  const streamingTooTall = streamingHeightState > height - STREAMING_OVERFLOW_THRESHOLD;
  // 当 streaming 元素不存在 / 高度还没测出来时，useStatic 跟随 isAtBottom
  const useStatic = !isAtBottom || streamingTooTall;
  useStaticRef.current = useStatic;

  /**
   * 计算总高度（统一函数，避免在多处重复实现）
   * - 累加已测量的项
   * - 未测量的项用 DEFAULT_ESTIMATED_HEIGHT 估算
   * - includeStreaming = true 时把流式 item 高度计入（static 模式用）
   */
  const computeTotalHeight = useCallback((includeStreaming: boolean) => {
    let total = 0;
    heightsRef.current.forEach((v) => (total += v));
    const measured = heightsRef.current.size;
    if (measured < items.length) {
      total += (items.length - measured) * DEFAULT_ESTIMATED_HEIGHT;
    }
    if (includeStreaming && streamingHeightRef.current > 0) {
      total += streamingHeightRef.current;
    }
    return total;
  }, [items.length]);

  // 暴露给子项的"测量器"——子项 mount/update 时调用，更新对应 key 的高度
  const measureItem = useCallback(
    (key: string, h: number) => {
      if (heightsRef.current.get(key) === h) return;
      heightsRef.current.set(key, h);
      // static 模式才把 streaming 高度计入；sticky 模式 streaming 不在文档流内
      // 重要：读 useStaticRef.current 而不是 useStatic（避免 measureItem 闭包陈旧）
      setTotalHeight(computeTotalHeight(useStaticRef.current));
    },
    [computeTotalHeight],
  );

  // 流式中 item 的高度变化
  //   - sticky 模式：不纳入 totalHeight（自然位置已超出视口，不影响 offset）
  //   - static 模式：纳入 totalHeight，让用户能滚过它
  const measureStreaming = useCallback(
    (h: number) => {
      if (streamingHeightRef.current === h) return;
      streamingHeightRef.current = h;
      setStreamingHeightState(h);
      // 无论现在是不是 static 模式：只要 h 变化，totalHeight 都按 useStaticRef 重算
      // （因为新 h 可能让"streamingTooTall"判断翻车，模式跟着翻车）
      setTotalHeight(computeTotalHeight(useStaticRef.current));
    },
    [computeTotalHeight],
  );

  // 计算可见区
  const { startIndex, endIndex, paddingTop, paddingBottom } = useMemo(() => {
    const cumulative: number[] = [];
    let sum = 0;
    for (let i = 0; i < items.length; i++) {
      const h = heightsRef.current.get(getKey(items[i])) || DEFAULT_ESTIMATED_HEIGHT;
      sum += h;
      cumulative.push(sum);
    }
    // 找到 startIndex：第一个 offsetTop + h > scrollTop 的项
    let start = 0;
    for (let i = 0; i < cumulative.length; i++) {
      if (cumulative[i] > scrollTop) {
        start = Math.max(0, i - overscan);
        break;
      }
    }
    // 找到 endIndex：第一个 offsetTop > scrollTop + height 的项
    let end = items.length;
    for (let i = start; i < cumulative.length; i++) {
      if (cumulative[i] > scrollTop + height) {
        end = Math.min(items.length, i + overscan + 1);
        break;
      }
    }
    return {
      startIndex: start,
      endIndex: end,
      paddingTop: start === 0 ? 0 : cumulative[start - 1],
      paddingBottom:
        items.length === 0
          ? 0
          : Math.max(0, cumulative[cumulative.length - 1] - cumulative[end - 1]),
    };
  }, [items, scrollTop, height, overscan, getKey, totalHeight]);

  /**
   * onScroll：用「距离底部」判断，不用「方向」
   * 原因：方向检测（el.scrollTop < lastTop）会被 scrollTop 的 clamp 行为欺骗
   *   - 写入 scrollTop = scrollHeight 时，浏览器自动 clamp 到 max
   *   - 实际 scrollTop = scrollHeight - clientHeight
   *   - 如果 lastTop 存的是 scrollHeight（未 clamp），onScroll 会判定 "scrollTop 变小" → 误判为用户上滑
   * 距离检测不依赖上一次值，永远只看「当前离底部多远」：
   *   - 距离 < 50px → 视为在底部（容忍弹性滚动 / 程序化滚动）
   *   - 距离 ≥ 50px → 视为离开底部
   * 这样程序化滚动和用户滚动的判断结果一致。
   */
  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.target as HTMLDivElement;
      setScrollTop(el.scrollTop);

      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nowAtBottom = distanceToBottom < AT_BOTTOM_THRESHOLD;

      // 同步用户上滑意图：与 isAtBottom 互斥
      //   - 在底部（distance < 50）→ 允许自动跟随
      //   - 离开底部               → 禁止自动跟随，避免用户被弹回
      // 放在 early-return 之前：每次 onScroll 都要更新，不依赖 isAtBottom 状态变化
      userScrolledUpRef.current = !nowAtBottom;

      if (nowAtBottom === isAtBottomRef.current) return; // 状态没变，不用更新

      isAtBottomRef.current = nowAtBottom;
      setIsAtBottom(nowAtBottom);

      // 切模式时同步 totalHeight：
      //   sticky 模式：streaming 不在文档流，不计入
      //   static  模式：streaming 进入文档流，必须计入，否则滚动条长度不对
      // 注意：是否纳入 streaming 高度看 useStaticRef（综合 isAtBottom + streamingTooTall）
      //       而不是只看 !nowAtBottom——用户也可能因"过高"被切到 static
      if (streamingHeightRef.current > 0) {
        setTotalHeight(computeTotalHeight(useStaticRef.current));
      }
    },
    [computeTotalHeight],
  );

  // 首次 / 切会话 / scrollToBottomKey 变化 → 滚到底并重置 atBottom 状态
  useIsomorphicLayoutEffect(() => {
    if (scrollToBottomKey === undefined) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // ⚠️ 关键：el.scrollTop 会被浏览器自动 clamp 到 [0, scrollHeight - clientHeight]
    //   写入 dataset.lastTop 时必须用 clamp 后的值，否则 onScroll 后续会误判"用户向上滚"
    const clamped = el.scrollTop;
    setScrollTop(clamped);
    el.dataset.lastTop = String(clamped);
    // 滚到底 = atBottom = true
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    // 显式滚到底 = 用户意图"看最新"，重置上滑标记，允许后续流式自动跟随
    userScrolledUpRef.current = false;
  }, [scrollToBottomKey]);

  // 流式更新时自动跟随（仅在用户贴近底部时）
  // 关键：deps 只跟踪流式内容变化，**不**依赖 setScrollTop / setIsAtBottom 触发的 re-render
  //   - 之前 useEffect 没写 deps → 每次 render 都跑 → 用户滚一下就被弹回 → 抖动
  //   - 现在 deps 明确 = pendingText/parts 变化才跑
  // 加上 userScrolledUpRef 兜底：用户主动上滑后即便 deps 变化也不跟随
  // 加上 streamingHeightState 兜底：sticky → static 切换瞬间（元素变高导致 sticky 失效），
  //   主动滚到底，避免 paint 闪烁（否则用户先看到 streaming 顶部，再被弹到底部）
  useEffect(() => {
    if (!followStreaming || !streamingItem) return;
    if (!isAtBottomRef.current) return; // 不在底部 → 不跟随
    if (userScrolledUpRef.current) return; // 用户已主动上滑 → 不跟随（防回弹）
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // 同上：用 clamp 后的 scrollTop 写 dataset.lastTop，避免被 onScroll 误判
    const clamped = el.scrollTop;
    setScrollTop(clamped);
    el.dataset.lastTop = String(clamped);
  }, [
    followStreaming,
    (streamingItem as StreamingLike | null)?.id,
    (streamingItem as StreamingLike | null)?.pendingText,
    (streamingItem as StreamingLike | null)?.parts?.length,
    streamingHeightState,
  ]);

  return (
    <div
      ref={scrollerRef}
      className={className}
      onScroll={onScroll}
      style={{
        height: safeHeight,
        // 关键：iOS Safari / WebView 内 div 滚动必须显式声明 -webkit-overflow-scrolling: touch，
        // 否则触摸拖动时整个页面跟随移动，但内部 div 不会滚动（典型"页面无法向下滚动"症状）。
        WebkitOverflowScrolling: 'touch',
        // 关键：滚动到顶部/底部时不让事件冒泡到 body，避免触发"下拉刷新"和"页面整体橡皮筋"
        overscrollBehavior: 'contain',
        // 关键：touch-action 明确"允许垂直平移"，避免被全局 manipulation 误判拦截
        touchAction: 'pan-y',
        overflowY: 'auto',
        overflowX: 'hidden',
        // 兜底：父级 flex 高度为 0 时也能保证至少有一行可滚动（避免被父级 overflow:hidden 吞掉）
        minHeight: 1,
        position: 'relative',
      }}
    >
      {/* 顶部 spacer：把可见项顶到正确位置 */}
      <div style={{ height: paddingTop }} />

      {/* 可见区 + overscan 内的已闭合消息 */}
      {items.slice(startIndex, endIndex).map((item) => {
        const key = getKey(item);
        return (
          <MeasuredItem key={key} measure={(h) => measureItem(key, h)}>
            {renderItem(item)}
          </MeasuredItem>
        );
      })}

      {/* 底部 spacer：撑起总高度，让滚动条长度正确 */}
      <div style={{ height: paddingBottom }} />

      {/* 流式中 item
          - useStatic = true  → static：进入文档流，避免和历史消息重叠 / 避免 sticky 失效被压顶
          - useStatic = false → sticky bottom 0：用户停留底部时始终可见
          - 切换时通过 measureStreaming 同步 totalHeight，保证滚动条长度正确
          - 切到 static 后，自动跟随 effect 仍会滚到底，让用户能看到"刚生成的新内容" */}
      {streamingItem && (
        <div
          style={
            useStatic
              ? {
                  // static 模式：进入文档流，自然占据 totalHeight 一部分
                  // 用户能滚过它，把所有历史消息都看完
                  // 也用于"streaming 元素过高"的场景：sticky CSS 会失效被压到顶部，
                  //   此时用 static + 滚到底，保证用户看到最新内容
                  position: 'static',
                  marginTop: STREAMING_GAP,
                }
              : {
                  // sticky 模式：固定在视口底部（仅在 streaming 元素较小时有效）
                  position: 'sticky',
                  bottom: 0,
                  background: 'inherit',
                  marginTop: STREAMING_GAP,
                }
          }
        >
          <MeasuredItem measure={measureStreaming}>{renderStreaming(streamingItem)}</MeasuredItem>
        </div>
      )}
    </div>
  );
}

/**
 * 测量子项高度的容器
 * - 用 ResizeObserver 测量实际高度
 * - 高度变化时回调 measure(height)
 */
const MeasuredItem: React.FC<{
  measure: (h: number) => void;
  children: React.ReactNode;
}> = ({ measure, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        measure(entry.contentRect.height);
      }
    });
    ro.observe(el);
    // 立即测量一次：避免首屏空白
    measure(el.offsetHeight);
    return () => ro.disconnect();
  }, [measure]);
  return <div ref={ref}>{children}</div>;
};
