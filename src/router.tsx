/**
 * 极简路由：使用 pathname 直接判断
 *
 * 为什么不用 react-router：
 *   - 项目 SSR 模式（vite ssrLoadModule）下，react-router 会在 SSR 阶段访问 window，
 *     引入 location/pathname 等 CJS 依赖，触发 module is not defined
 *   - 这里只需两个页面（/ 和 /agent），自实现 < 30 行
 *
 * 同步策略：
 *   - 监听 popstate（浏览器前进/后退）
 *   - 暴露 navigate(path) 调用 history.pushState
 *   - SSR 阶段用默认 path='/'，避免 hydration mismatch
 *
 * 注意：组件首屏渲染时（SSR / 客户端首次 render）应保证 path 稳定，
 *   在 useEffect 中再根据真实 pathname 切到 /agent，避免水合错位
 */
import { useEffect, useState, useCallback } from 'react';

function getCurrentPath(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname || '/';
}

export function useRouter() {
  const [path, setPath] = useState<string>(getCurrentPath);

  useEffect(() => {
    const onPop = () => setPath(getCurrentPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: string) => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname === next) return;
    window.history.pushState({}, '', next);
    setPath(next);
  }, []);

  return { path, navigate };
}

/** 替代 useNavigate 的 hook */
export function useNavigate() {
  return useRouter().navigate;
}

/** 替代 <Link> 的极简组件 */
export function Link({
  to,
  children,
  onClick,
  className,
  style,
}: {
  to: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const navigate = useNavigate();
  return (
    <a
      href={to}
      className={className}
      style={style}
      onClick={(e) => {
        // 只拦截左键 + 无修饰键的点击
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
