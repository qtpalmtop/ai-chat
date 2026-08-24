/**
 * useAgentSocket (NestJS + socket.io 版)
 *
 * 协议：
 *   - 服务端：ws://host:3002/?role=client&userId=u_xxx  (默认 socket.io path = /socket.io)
 *   - 上行：socket.emit('message', { type: 'client.*' | 'agent.*', ... })
 *   - 下行：socket.on('<SystemEventType>', event => onEvent(event)) — 事件名 = event.type
 *
 * 关键设计：
 *   - socket.io 自带重连、心跳、ACK，无需手写
 *   - 保留 onEvent 透传给业务层（store）处理具体事件
 *   - 兼容旧的 envelope 解析（如果服务端有发带 seq 的）→ 自动剥离
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ClientMessage,
  AgentMessage,
  SystemEvent,
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
  id: string | null;
  displayName?: string;
  displayAvatar?: string;
  autoConnect?: boolean;
  onEvent?: (event: SystemEvent) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
}

function getSocketUrl(role: string, id: string) {
  const host =
    typeof window !== 'undefined' && window.location.hostname
      ? window.location.hostname
      : 'localhost';
  // 注意：socket.io 默认 path 是 /socket.io，端口走 URL 显式指定
  // NestJS 服务端口：HTTP = 3001, WebSocket（同进程） = 3001（共享）
  const port = 3001;
  return {
    url: `http://${host}:${port}`,
    options: {
      path: '/socket.io',
      transports: ['websocket', 'polling'] as ('websocket' | 'polling')[],
      query: { role, id },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    },
  };
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
  const socketRef = useRef<Socket | null>(null);
  const closedByUserRef = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const setStatusAndNotify = useCallback((s: ConnectionStatus) => {
    setStatus(s);
    onStatusChangeRef.current?.(s);
  }, []);

  const send = useCallback((msg: ClientMessage | AgentMessage): boolean => {
    const sock = socketRef.current;
    if (!sock || !sock.connected) return false;
    sock.emit('message', msg);
    return true;
  }, []);

  const connect = useCallback(() => {
    if (!id) return;
    if (socketRef.current?.connected) return;

    closedByUserRef.current = false;
    setStatusAndNotify('connecting');

    const { url, options } = getSocketUrl(role, id);
    const sock = io(url, options);
    socketRef.current = sock;

    sock.on('connect', () => {
      setStatusAndNotify('open');
      // 上线即发 hello
      if (role === 'client') {
        sock.emit('message', {
          type: 'client.hello',
          clientId: id,
          userId: id,
          userName: displayName,
          userAvatar: displayAvatar,
        });
      } else {
        sock.emit('message', {
          type: 'agent.hello',
          agentId: id,
          agentName: displayName,
          agentAvatar: displayAvatar,
        });
      }
    });

    sock.on('disconnect', (reason) => {
      if (closedByUserRef.current) {
        setStatusAndNotify('closed');
        return;
      }
      setStatusAndNotify('reconnecting');
      void reason;
    });

    sock.on('connect_error', () => {
      setStatusAndNotify('error');
    });

    // 业务事件：监听所有可能的下行事件类型
    // 客户端只关心 SystemEvent 里的 type 字段，把事件原样透传给业务层
    const dispatch = (event: unknown) => {
      // 兼容两种格式：
      //   1) 直接是 SystemEvent（{ type, ... }）
      //   2) 包了信封的 { seq, ts, payload }（旧协议残留）
      if (event && typeof event === 'object') {
        const e = event as { type?: string; payload?: SystemEvent };
        if (e.type && e.type !== 'payload') {
          onEventRef.current?.(e as SystemEvent);
        } else if (e.payload && e.payload.type) {
          onEventRef.current?.(e.payload);
        }
      }
    };

    // 动态注册避免写死（事件名 = SystemEvent.type 字符串）
    for (const t of [
      'queue_accepted',
      'queue_position',
      'queue_assigned',
      'queue_cancelled',
      'queue_timeout',
      'message',
      'message_ack',
      'typing',
      'session_ended',
      'session_restored',
      'presence',
      'history_list',
      'history_session',
      'queue_update',
      'suggestion_start',
      'suggestion_chunk',
      'error',
    ]) {
      sock.on(t, dispatch);
    }
  }, [role, id, displayName, displayAvatar, setStatusAndNotify]);

  const disconnect = useCallback(() => {
    closedByUserRef.current = true;
    if (socketRef.current) {
      try {
        socketRef.current.disconnect();
      } catch {
        /* noop */
      }
      socketRef.current = null;
    }
    setStatusAndNotify('closed');
  }, [setStatusAndNotify]);

  const connectRef = useRef(connect);
  connectRef.current = connect;
  const disconnectRef = useRef(disconnect);
  disconnectRef.current = disconnect;

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
    isOpen: status === 'open',
  };
}
