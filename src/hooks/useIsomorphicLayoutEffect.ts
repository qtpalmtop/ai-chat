import { useEffect, useLayoutEffect } from 'react';

/**
 * SSR-safe 的 useLayoutEffect
 * - SSR 端 (typeof window === 'undefined')：回退到 useEffect
 *   原因：useLayoutEffect 在 SSR 端 React 18 会打印警告：
 *   "useLayoutEffect does nothing on the server, because its effect cannot be encoded
 *    into the server renderer's output format."
 *   改用 useEffect 后 SSR 不输出警告，hydrate 完成后也无功能差异
 *   （hydrate 后仍是 useLayoutEffect，因为模块已重载）
 * - Client 端：用 useLayoutEffect 保留同步 layout 性能
 *   （scrollTo、textContent 直写等场景必须在 paint 前完成）
 *
 * 注意：模块加载时 typeof window 求值是定值。
 *   - Node 端 SSR：window undefined → useEffect
 *   - 浏览器端：window defined → useLayoutEffect
 * 因此 SSR 端产物和 client 端产物的这个 hook 引用的是不同 React hook。
 * 两者 hook 调用顺序必须一致（React 要求 hook 数量/顺序稳定），
 * 但本文件只导出 1 个 hook 名（useIsomorphicLayoutEffect），所以调用点代码完全相同。
 */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export default useIsomorphicLayoutEffect;
