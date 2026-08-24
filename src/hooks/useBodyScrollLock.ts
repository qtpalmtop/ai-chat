/**
 * useBodyScrollLock：移动端弹窗/全屏时锁定 body 滚动
 * - 解决"弹窗出现时底层页面滚动"问题
 * - 解决 iOS 弹窗底层橡皮筋
 *
 * 关键点：
 *  - 锁定时 position: fixed + 记录 scrollTop，避免"锁住后跳到顶部"
 *  - 解锁时还原
 *  - 多次调用引用计数
 */
import { useEffect } from 'react';

let lockCount = 0;
let savedScrollTop = 0;
let savedBodyStyle = '';

function getScrollTop(): number {
  return (
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    window.scrollY ||
    0
  );
}

function setScrollTop(top: number) {
  document.documentElement.scrollTop = top;
  document.body.scrollTop = top;
  window.scrollTo(0, top);
}

export function lockBodyScroll() {
  if (lockCount === 0) {
    savedScrollTop = getScrollTop();
    savedBodyStyle = document.body.style.cssText;
    document.body.style.cssText = `
      position: fixed;
      top: -${savedScrollTop}px;
      left: 0;
      right: 0;
      width: 100%;
      overflow: hidden;
      overscroll-behavior: none;
    `;
    document.body.classList.add('scroll-lock');
  }
  lockCount++;
}

export function unlockBodyScroll() {
  if (lockCount === 0) return;
  lockCount--;
  if (lockCount === 0) {
    document.body.style.cssText = savedBodyStyle;
    document.body.classList.remove('scroll-lock');
    // 异步恢复，否则部分浏览器会闪一下
    requestAnimationFrame(() => setScrollTop(savedScrollTop));
  }
}

/**
 * React hook：组件 mount 时锁定，unmount 时解锁
 * - 同一组件可多次实例化，引用计数保证成对释放
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return () => {
      unlockBodyScroll();
    };
  }, [active]);
}
