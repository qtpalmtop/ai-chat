/**
 * 客服工作台 - WebSocket 封装（Vue 版 - NestJS + socket.io）
 *
 * 与 React 端保持协议一致：
 *   - 上行：socket.emit('message', { type, ... })
 *   - 下行：socket.on('<event.type>', event => ...)
 *   - 自动重连：socket.io 内置
 */

import { computed, onBeforeUnmount, ref } from 'vue';
import { io, Socket } from 'socket.io-client';
import { useAgentStore } from '@/stores/agentStore';
import type { AgentMode, ClientToServer, SystemEvent } from '@/types/agent';

interface UseAgentSocketOptions {
  url?: string;
  mode: AgentMode;
  onEvent?: (event: SystemEvent) => void;
}

function defaultUrl() {
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname || 'localhost';
  return `http://${host}:3001`;
}

const EVENT_TYPES = [
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
];

export function useAgentSocket(options: UseAgentSocketOptions) {
  const store = useAgentStore();
  const sock = ref<Socket | null>(null);
  const reconnectAttempts = ref(0);
  const isOpen = computed(() => store.connection === 'open');
  let manuallyClosed = false;

  function clearSocket() {
    if (sock.value) {
      try {
        sock.value.removeAllListeners();
        sock.value.disconnect();
      } catch {
        /* noop */
      }
      sock.value = null;
    }
  }

  function send(payload: ClientToServer) {
    const s = sock.value;
    if (!s || !s.connected) return false;
    s.emit('message', payload);
    return true;
  }

  function connect() {
    if (typeof window === 'undefined') return;
    clearSocket();
    manuallyClosed = false;
    store.setConnection('connecting');
    store.setMode(options.mode);

    const url = options.url || defaultUrl();
    const query: Record<string, string> = { role: options.mode };
    if (options.mode === 'client') {
      query.id = store.clientId;
    } else {
      query.id = store.agentId;
    }

    const s = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      query,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });
    sock.value = s;

    s.on('connect', () => {
      reconnectAttempts.value = 0;
      store.setConnection('open');
      // 身份握手
      // 注意：client.hello 同时携带 clientId 和 userId（React 端约定），服务端按 userId 做反向路由
      if (options.mode === 'client') {
        send({
          type: 'client.hello',
          clientId: store.clientId,
          userId: store.clientId,
          userName: store.userName,
        });
      } else {
        send({ type: 'agent.hello', agentId: store.agentId, agentName: store.agentName });
      }
    });

    s.on('disconnect', () => {
      if (manuallyClosed) {
        store.setConnection('closed');
        return;
      }
      store.setConnection('reconnecting');
    });

    s.on('connect_error', () => {
      store.setConnection('error');
    });

    // 业务事件统一注册
    for (const t of EVENT_TYPES) {
      s.on(t, (event: unknown) => {
        if (event && typeof event === 'object') {
          const e = event as { type?: string; payload?: SystemEvent };
          if (e.type) {
            store.handleSystemEvent(e as SystemEvent);
            options.onEvent?.(e as SystemEvent);
          } else if (e.payload && e.payload.type) {
            store.handleSystemEvent(e.payload);
            options.onEvent?.(e.payload);
          }
        }
      });
    }
  }

  function disconnect() {
    manuallyClosed = true;
    clearSocket();
    store.setConnection('closed');
  }

  onBeforeUnmount(() => {
    disconnect();
  });

  return {
    connect,
    disconnect,
    send,
    isOpen,
    status: computed(() => store.connection),
  };
}
