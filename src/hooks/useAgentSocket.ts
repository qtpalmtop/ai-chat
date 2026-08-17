/**
 * useAgentSocket：客户端 / 客服端共享的 WebSocket Hook
 *
 * 能力：
 *   1. 自动建立连接（传入 role + id）
 *   2. 心跳（30s ping + 收到任意消息恢复 alive）
 *   3. 断线重连（指数退避：1s/2s/4s/8s...，上限 30s）
 *   4. 消息去重（按 seq 单调递增）
 *   5. 暴露 send / onEvent / status
 *
 * 设计原则：
 *   - 单一连接复用：role+id 相同则不重连
 *   - 事件透传：业务层（agentStore）订阅 onEvent 处理具体逻辑
 *   - 不耦合业务：hook 不直接修改 store，只暴露原始事件流
 *
 * 为什么用 useEffect 启停：
 *   - 组件 unmount 时关闭 ws，避免泄漏
 *   - role/id 变化时重连
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  ClientMessage,
  AgentMessage,
  SystemEvent,
  ServerEnvelope,
} from '@/types/agent';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'error';

export interface UseAgentSocketOptions {
  role: 'client' | 'agent';
  /** 用户 id 或 客服 id */
  id: string | null;
  /** 展示名（首次 hello 时携带） */
  displayName?: string;
  displayAvatar?: string;
  /** 是否自动连接（默认 true） */
  autoConnect?: boolean;
  /** 业务事件回调 */
  onEvent?: (event: SystemEvent, envelope: ServerEnvelope) => void;
  /** 连接状态变化回调（用于驱动 store.connection） */
  onStatusChange?: (status: ConnectionStatus) => void;
}

const HEARTBEAT_INTERVAL_MS = 25_000; // < 服务端 30s
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const PING_FRAME = '{"type":"ping"}';

function getWsUrl(role: string, id: string) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // agent-ws.js 独立进程监听 3002；与 HTTP 服务 (3001/3003) 端口错开
  const host =
    typeof window !== 'undefined' && window.location.port
      ? window.location.hostname
      : 'localhost';
  return `${proto}://${host}:3002/ws?role=${role}&id=${encodeURIComponent(id)}`;
}

export function useAgentSocket(opts: UseAgentSocketOptions) {
  const {
    role,
    id,
    displayName,
    displayAvatar,
    autoConnect = true,
    onEvent,
    onStatusChange,
  } = opts;

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const lastSeqRef = useRef(0);
  const closedByUserRef = useRef(false);
  // 用 ref 持回调，避免 onEvent 引用变化导致重连
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const setStatusAndNotify = useCallback((s: ConnectionStatus) => {
    setStatus(s);
    onStatusChangeRef.current?.(s);
  }, []);

  const clearHeartbeat = () => {
    if (heartbeatRef.current != null) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };
  const clearReconnect = () => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const send = useCallback((msg: ClientMessage | AgentMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }, []);

  const connect = useCallback(() => {
    if (!id) return;
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

    closedByUserRef.current = false;
    setStatusAndNotify(reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting');

    const ws = new WebSocket(getWsUrl(role, id));
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      reconnectAttemptsRef.current = 0;
      setStatusAndNotify('open');
      // 发送 hello
      if (role === 'client') {
        ws.send(
          JSON.stringify({
            type: 'client.hello',
            clientId: id,
            userId: id,
            userName: displayName,
            userAvatar: displayAvatar,
          }),
        );
      } else {
        ws.send(
          JSON.stringify({
            type: 'agent.hello',
            agentId: id,
            agentName: displayName,
            agentAvatar: displayAvatar,
          }),
        );
      }
      // 启动心跳
      clearHeartbeat();
      heartbeatRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(PING_FRAME);
          } catch {}
        }
      }, HEARTBEAT_INTERVAL_MS);
    });

    ws.addEventListener('message', (e) => {
      let env: ServerEnvelope;
      try {
        env = JSON.parse(e.data);
      } catch {
        return;
      }
      // 序号去重：防止服务端重传/重连后重复推送
      if (typeof env.seq === 'number' && env.seq <= lastSeqRef.current) return;
      if (typeof env.seq === 'number') lastSeqRef.current = env.seq;
      onEventRef.current?.(env.payload, env);
    });

    ws.addEventListener('close', () => {
      clearHeartbeat();
      wsRef.current = null;
      if (closedByUserRef.current) {
        setStatusAndNotify('closed');
        return;
      }
      // 自动重连
      const attempt = reconnectAttemptsRef.current++;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      setStatusAndNotify('reconnecting');
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    });

    ws.addEventListener('error', () => {
      // 'close' 会紧跟其后，错误状态由 close 处理
      setStatusAndNotify('error');
    });
  }, [role, id, displayName, displayAvatar, setStatusAndNotify]);

  const disconnect = useCallback(() => {
    closedByUserRef.current = true;
    clearHeartbeat();
    clearReconnect();
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'client disconnect');
      } catch {}
      wsRef.current = null;
    }
    setStatusAndNotify('closed');
  }, [setStatusAndNotify]);

  // 用 ref 持有最新的 connect / disconnect，避免它们身份变化触发自动 effect 重连
  const connectRef = useRef(connect);
  connectRef.current = connect;
  const disconnectRef = useRef(disconnect);
  disconnectRef.current = disconnect;

  // 自动连接 / 断开
  // deps 只放业务参数（autoConnect / id）；connect / disconnect 通过 ref 访问，
  // 防止它们的 useCallback 身份变化导致 effect 重复挂载/卸载，把刚开好的 WS 立刻关掉
  useEffect(() => {
    if (!autoConnect || !id) return;
    connectRef.current();
    return () => {
      disconnectRef.current();
    };
  }, [autoConnect, id]);

  return {
    status,
    send,
    connect,
    disconnect,
    /** 是否已连接（用于 send 前的快速判断） */
    isOpen: status === 'open',
  };
}
