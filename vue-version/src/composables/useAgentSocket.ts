/**
 * 客服工作台 - WebSocket 封装（Vue 版 - 对齐 React 端）
 *
 * 与 React 版的差异：
 *   - 用 ref 持有 ws 实例（在 setup 中创建，组件卸载时关闭）
 *   - 不暴露 setState，而是通过 emit('event', payload) 回调
 *
 * 服务端下行协议：{ seq, ts, payload: SystemEvent }（envelope 包裹）
 * 这里负责解包 + seq 去重，然后透传给 store.handleSystemEvent
 */

import { onBeforeUnmount, ref } from 'vue';
import { useAgentStore } from '@/stores/agentStore';
import type { AgentMode, ClientToServer, ServerEnvelope, SystemEvent } from '@/types/agent';

const DEFAULT_WS_URL = 'ws://localhost:3002/ws';

interface UseAgentSocketOptions {
  url?: string;
  mode: AgentMode;
  onEvent?: (event: SystemEvent, envelope: ServerEnvelope) => void;
}

export function useAgentSocket(options: UseAgentSocketOptions) {
  const store = useAgentStore();
  const ws = ref<WebSocket | null>(null);
  const reconnectTimer = ref<number | null>(null);
  const pingTimer = ref<number | null>(null);
  /** 服务端序号去重：防止重连后重复推送 */
  const lastSeq = ref(0);

  function clearTimers() {
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value);
      reconnectTimer.value = null;
    }
    if (pingTimer.value) {
      clearInterval(pingTimer.value);
      pingTimer.value = null;
    }
  }

  function send(payload: ClientToServer) {
    const sock = ws.value;
    if (!sock || sock.readyState !== WebSocket.OPEN) return false;
    sock.send(JSON.stringify(payload));
    return true;
  }

  function connect() {
    if (typeof window === 'undefined') return;
    clearTimers();
    store.setConnection('connecting');
    store.setMode(options.mode);

    let url = options.url || DEFAULT_WS_URL;
    if (options.mode === 'client') {
      // 服务端按 userId 解析（见 server/agent-ws.js:85）
      url += `?userId=${encodeURIComponent(store.clientId)}&role=client`;
    } else {
      url += `?agentId=${encodeURIComponent(store.agentId)}&role=agent`;
    }

    const sock = new WebSocket(url);
    ws.value = sock;

    sock.onopen = () => {
      store.setConnection('open');
      // 身份握手
      if (options.mode === 'client') {
        send({ type: 'client.hello', clientId: store.clientId, userName: store.userName });
      } else {
        send({ type: 'agent.hello', agentId: store.agentId, agentName: store.agentName });
      }
      // 心跳
      pingTimer.value = window.setInterval(() => send({ type: 'ping' }), 25000);
    };

    sock.onmessage = (e) => {
      try {
        const env = JSON.parse(e.data) as ServerEnvelope;
        // 序号去重（与服务端 seq 单调递增对齐）
        if (typeof env.seq === 'number') {
          if (env.seq <= lastSeq.value) return;
          lastSeq.value = env.seq;
        }
        // 解包 envelope：业务事件在 env.payload
        const event = env.payload;
        if (event && event.type) {
          store.handleSystemEvent(event);
          options.onEvent?.(event, env);
        }
      } catch (err) {
        console.error('[agent-ws] parse error', err);
      }
    };

    sock.onerror = () => {
      // 错误由 onclose 统一处理
    };

    sock.onclose = () => {
      clearTimers();
      store.setConnection('closed');
      // 5s 后自动重连
      reconnectTimer.value = window.setTimeout(() => {
        if (store.connection === 'closed') {
          store.setConnection('reconnecting');
          connect();
        }
      }, 5000);
    };
  }

  function disconnect() {
    clearTimers();
    if (ws.value) {
      ws.value.onclose = null;
      ws.value.close();
      ws.value = null;
    }
    store.setConnection('closed');
  }

  onBeforeUnmount(() => {
    disconnect();
  });

  return {
    connect,
    disconnect,
    send,
  };
}
