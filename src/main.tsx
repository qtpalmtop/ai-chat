/**
 * 客户端入口（hydrate）
 * - SSR 模式：用 hydrateRoot 把 SSR 渲染的 HTML 接管，避免重新创建 DOM
 * - 静态模式（无 SSR）：fallback 到 createRoot（如 SSR 失败时兜底）
 *
 * 关键时序：
 *   1. 同步 hydrateRoot（服务端已经渲染了 shell）—— 避免闪烁
 *   2. 客户端 mount 时 React 复用 SSR DOM（不重建节点）
 *   3. useEffect 里 store 从 localStorage 同步读取 → setHasHydrated(true)
 *   4. 触发 re-render 显示真实消息
 *
 * Hydration Mismatch 防护：
 *   - 客户端首次 render 输出必须 == SSR 输出
 *   - 因此 store 状态在首次 render 时必须是空（hasHydrated=false, messages=[]）
 *   - 数据加载延迟到 hydrate 后的 useEffect 中
 *
 * 不启用 StrictMode：避免 SSE 流被双订阅 / setState 双调用。
 */

import { hydrateRoot, createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './styles/mobile.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element not found');
}

// 检测 SSR 是否成功：rootEl 已经有子节点说明 SSR 渲染过
// - 有子节点：SSR 成功，用 hydrateRoot（复用 DOM，最快）
// - 无子节点：SSR 失败或未启用，用 createRoot（兜底）
if (rootEl.hasChildNodes()) {
  hydrateRoot(rootEl, <App />);
  console.log('hydrateRoot');
} else {
  createRoot(rootEl).render(<App />);
  console.log('createRoot');
}
