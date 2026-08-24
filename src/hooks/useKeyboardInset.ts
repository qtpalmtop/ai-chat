/**
 * useKeyboardInset：监听虚拟键盘高度（移动端 WebView）
 * - 通过 visualViewport.height 变化判断键盘弹起/收起
 * - 通过 :root --keyboard-inset CSS 变量提供给样式表
 * - 解决"输入框被键盘遮挡"问题
 *
 * 注意：
 *  - iOS Safari 在 standalone (PWA) 模式下对 visualViewport 支持完善
 *  - Android Chrome/Edge 也支持
 *  - 旧版 WebView 退化：键盘弹起触发 window.resize（不监听更稳）
 */
import { useEffect } from 'react';

function getInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  // 键盘高度 = 视口缩减值
  const inset = Math.max(0, window.innerHeight - vv.height);
  return inset;
}

function applyInset(inset: number) {
  document.documentElement.style.setProperty(
    '--keyboard-inset',
    `${Math.round(inset)}px`,
  );
}

/**
 * 启动监听（在 App 启动时调用一次即可）
 */
export function startKeyboardInsetListener() {
  if (typeof window === 'undefined') return () => {};

  const update = () => applyInset(getInset());
  update();

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', update);
    window.visualViewport.addEventListener('scroll', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }
  // 兜底：window.resize
  window.addEventListener('resize', update);
  return () => window.removeEventListener('resize', update);
}

/**
 * React hook：在组件挂载期间监听
 */
export function useKeyboardInset() {
  useEffect(() => {
    return startKeyboardInsetListener();
  }, []);
}
