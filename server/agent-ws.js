/**
 * Mock WebSocket Server：用户端 ↔ 客服工作台
 *
 * 端口：3002（与 HTTP 3001 / Vue 3003 错开）
 *
 * 连接方式：
 *   ws://localhost:3002/ws?role=client&userId=u_xxx[&userName=xxx]
 *   ws://localhost:3002/ws?role=agent&agentId=a_xxx[&agentName=xxx]
 *
 * 职责：
 *   1. 维护用户/客服连接池（支持断线重连清理）
 *   2. 排队队列：FIFO 分配
 *   3. 消息路由：双向转发 + 会话持久化（支持断线重连恢复）
 *   4. 模拟"智能意图识别"：收到 client.send 后 1-2 秒内推送推荐话术给客服端
 *
 * 协议：见 src/types/agent.ts
 *   客户端上行 → { type: 'client.*' }
 *   客服端上行 → { type: 'agent.*' }
 *   服务端下行 → { type, seq, ts, payload: SystemEvent }
 *
 * 心跳：30s ping，不通则断开
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.AGENT_WS_PORT) || 3002;
const HEARTBEAT_INTERVAL_MS = 30_000;
const SUGGESTION_DELAY_MS = 1500; // 收到用户消息 → 推送推荐话术的延迟
const USER_INACTIVITY_TIMEOUT_MS = 30_000; // 用户静默 30s 自动结束会话
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000; // 历史会话保留 24h（按 endedAt 过期清理）
const HISTORY_MAX_PER_AGENT = 200; // 单客服最多保留的历史会话数（FIFO）

// ============== 内存数据结构 ==============

/** 客户端连接：clientId → ws + 元数据 */
const clients = new Map();

/** 客服连接：agentId → ws + 元数据 */
const agents = new Map();

/**
 * 排队队列：FIFO 数组
 * 每项：{ clientId, queuedAt, reason, lastUserMessage }
 */
const queue = [];

/**
 * 活跃会话：sessionId → 会话快照
 *  - clientId / agentId 双向索引
 *  - messages 持久化用于断线重连恢复
 */
const sessions = new Map();

/**
 * 最近的智能推荐话术：sessionId → Array<{ intentId, category, parts }>
 * 供 use_suggestion 取出最近一条带 parts 的模板，转为 agent 消息
 */
const lastSuggestions = new Map();

/**
 * 历史会话（endSession 后转存）：
 *   - 按客服维度隔离：agentId → Array<HistorySessionDetail>，按 endedAt 倒序
 *   - 按客户端维度隔离：clientId → Array<HistorySessionDetail>
 *
 * 设计原则：
 *   1. 不复用 sessions（endSession 后 30s 就清了，会话内容会丢）
 *   2. 单独存：保留完整 messages 数组，供客服端 / 客户端"历史会话"列表查看
 *   3. 受 24h 过期 + 单客服 200 条上限控制，避免内存爆炸
 */
const historyByAgent = new Map(); // agentId → HistorySessionDetail[]
const historyByClient = new Map(); // clientId → HistorySessionDetail[]

/** 消息序号（服务端下行单调递增） */
let seq = 0;

const now = () => Date.now();
const newId = (prefix) => `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ============== HTTP + WS 启动 ==============

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        time: now(),
        clients: clients.size,
        agents: agents.size,
        queue: queue.length,
        sessions: sessions.size,
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const role = url.searchParams.get('role');
  // 兼容：client 端 useAgentSocket 用 `id` 参数，client.send/agent.* 协议里又用
  // `userId/agentId`。这里两个名字都认，避免连接被 1008 主动关闭。
  const id =
    url.searchParams.get('id') ||
    (role === 'agent' ? url.searchParams.get('agentId') : url.searchParams.get('userId'));

  if (!role || !id || (role !== 'client' && role !== 'agent')) {
    ws.close(1008, 'invalid role or id');
    return;
  }

  // 注册连接
  const meta = { ws, role, id, joinedAt: now(), alive: true };
  if (role === 'agent') {
    // 同一 agent 重连：覆盖旧连接，避免消息发到死连接
    const old = agents.get(id);
    if (old) safeClose(old.ws, 1000, 'replaced');
    agents.set(id, meta);
    sendToAgent(meta, {
      type: 'presence',
      onlineAgents: agents.size,
      queueLength: queue.length,
    });
    // 上线时立即推一次待接单列表（让客服打开工作台就有数据）
    sendToAgent(meta, {
      type: 'queue_update',
      items: queue.map((q) => ({
        clientId: q.clientId,
        userName: q.userName,
        userAvatar: q.userAvatar,
        queuedAt: q.queuedAt,
        reason: q.reason,
        lastUserMessage: q.lastUserMessage,
      })),
    });
    // 推一次该客服的历史会话列表
    sendHistoryListToAgent(meta);
  } else {
    const old = clients.get(id);
    if (old) safeClose(old.ws, 1000, 'replaced');
    clients.set(id, meta);
  }

  // 客户端连接后：检查是否已有 inSession 的 sessionId（断线重连场景）
  if (role === 'client') {
    const existing = findSessionByClient(id);
    if (existing && existing.status === 'inSession') {
      // 恢复会话：发 session_restored 把历史消息给客户端
      sendToClient(meta, {
        type: 'session_restored',
        messages: existing.messages,
      });
    }
    // 推一次该用户的历史会话列表（自己看自己的）
    sendHistoryListToClient(meta);
  }

  console.log(`[ws] ${role} ${id} connected (clients=${clients.size}, agents=${agents.size})`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // 忽略非 JSON
    }
    handleMessage(meta, msg);
  });

  ws.on('pong', () => {
    meta.alive = true;
  });

  ws.on('close', (code, reason) => {
    console.log(`[ws] ${role} ${id} close code=${code} reason=${reason?.toString() || '(none)'} alive=${meta.alive}`);
    handleDisconnect(meta);
  });

  ws.on('error', () => {
    // 静默：close 事件会清理
  });
});

// ============== 心跳 ==============

const heartbeatTimer = setInterval(() => {
  for (const meta of [...clients.values(), ...agents.values()]) {
    if (!meta.alive) {
      safeClose(meta.ws, 1006, 'heartbeat timeout');
      continue;
    }
    meta.alive = false;
    try {
      meta.ws.ping();
    } catch {
      safeClose(meta.ws, 1006, 'ping failed');
    }
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeatTimer));

// ============== 消息处理 ==============

function handleMessage(meta, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

  if (msg.type === 'client.pong' || msg.type === 'agent.pong') {
    meta.alive = true;
    return;
  }

  if (meta.role === 'client') {
    handleClientMessage(meta, msg);
  } else {
    handleAgentMessage(meta, msg);
  }
}

function handleClientMessage(meta, msg) {
  switch (msg.type) {
    case 'client.hello': {
      // 可选：刷新 clientId 上的 userName/userAvatar
      meta.userName = msg.userName;
      meta.userAvatar = msg.userAvatar;
      break;
    }

    case 'client.transfer_human': {
      // 已在队列里 / 已在会话里 → 忽略
      if (queue.some((q) => q.clientId === meta.id)) {
        sendError(meta.ws, 'already_queued', '已在排队中');
        return;
      }
      const sess = findSessionByClient(meta.id);
      if (sess && sess.status === 'inSession') {
        sendError(meta.ws, 'already_in_session', '已在客服会话中');
        return;
      }

      queue.push({
        clientId: meta.id,
        userName: meta.userName,
        userAvatar: meta.userAvatar,
        queuedAt: now(),
        reason: msg.reason || 'normal',
        lastUserMessage: undefined,
      });
      // 通知客户端进入排队
      sendToClient(meta, {
        type: 'queue_accepted',
        position: getQueuePosition(meta.id),
        estimatedWaitSec: estimateWaitSec(queue.length),
        reason: msg.reason || 'normal',
      });
      // 通知所有客服：有人排队了（presence + 待接单列表）
      broadcastPresence();
      broadcastQueue();
      break;
    }

    case 'client.cancel_queue': {
      const idx = queue.findIndex((q) => q.clientId === meta.id);
      if (idx === -1) {
        sendError(meta.ws, 'not_in_queue', '当前不在排队中');
        return;
      }
      queue.splice(idx, 1);
      sendToClient(meta, { type: 'queue_cancelled' });
      broadcastPresence();
      broadcastQueue();
      break;
    }

    case 'client.send': {
      const sess = findSessionByClient(meta.id);
      if (!sess || sess.status !== 'inSession') {
        sendError(meta.ws, 'not_in_session', '当前不在客服会话中');
        return;
      }
      // 用户发消息 → 标记为"用户已开口"，并重置 30s 静默计时器
      sess.userHasSpoken = true;
      resetInactivityTimer(sess);
      // 构造完整 Message 存入会话
      const message = {
        id: msg.messageId || newId('msg'),
        sessionId: sess.sessionId,
        role: 'user',
        parts: msg.parts || [],
        status: 'done',
        createdAt: now(),
      };
      sess.messages.push(message);
      // 转发给客服
      const agentMeta = agents.get(sess.agentId);
      if (agentMeta) {
        sendToAgent(agentMeta, { type: 'message', message });
        // ack 给客户端
        sendToClient(meta, { type: 'message_ack', messageId: message.id, timestamp: message.createdAt });
        // 模拟"智能识别用户意图"：1.5s 后推推荐话术
        scheduleSuggestion(agentMeta, sess, message);
      } else {
        sendError(meta.ws, 'agent_offline', '客服已离线');
      }
      break;
    }

    case 'client.typing': {
      const sess = findSessionByClient(meta.id);
      if (!sess || sess.status !== 'inSession') return;
      const agentMeta = agents.get(sess.agentId);
      if (agentMeta) {
        sendToAgent(agentMeta, {
          type: 'typing',
          from: 'user',
          isTyping: !!msg.isTyping,
        });
      }
      break;
    }

    case 'client.end_session': {
      const sess = findSessionByClient(meta.id);
      if (!sess) return;
      endSession(sess, 'user');
      break;
    }

    case 'client.fetch_history': {
      // 客户端主动拉取自己的历史会话列表（断线重连/刷新场景）
      sendHistoryListToClient(meta);
      break;
    }
  }
}

function handleAgentMessage(meta, msg) {
  switch (msg.type) {
    case 'agent.hello': {
      meta.agentName = msg.agentName;
      meta.agentAvatar = msg.agentAvatar;
      // 把当前 queue 同步给新上线的客服（让它能看到待接单列表）
      sendToAgent(meta, {
        type: 'presence',
        onlineAgents: agents.size,
        queueLength: queue.length,
      });
      sendToAgent(meta, {
        type: 'queue_update',
        items: queue.map((q) => ({
          clientId: q.clientId,
          userName: q.userName,
          userAvatar: q.userAvatar,
          queuedAt: q.queuedAt,
          reason: q.reason,
          lastUserMessage: q.lastUserMessage,
        })),
      });
      break;
    }

    case 'agent.accept_queue': {
      const idx = queue.findIndex((q) => q.clientId === msg.clientId);
      if (idx === -1) {
        sendError(meta.ws, 'not_in_queue', '该用户已不在排队中');
        return;
      }
      const item = queue.splice(idx, 1)[0];
      const sessionId = newId('sess');
      const sess = {
        sessionId,
        clientId: item.clientId,
        agentId: meta.id,
        status: 'inSession',
        messages: [],
        createdAt: now(),
        startedAt: now(),
        userName: item.userName,
        inactivityTimer: null,
        // 用户活跃度判定：只有用户发过消息后，30s 用户静默才会自动结束会话
        // 客服接单时不立即启动 timer，避免"用户刚转人工还在打字就被结束"
        userHasSpoken: false,
      };
      sessions.set(sessionId, sess);
      // 客服接单 → 不启动 timer，等用户说第一句话后再启动
      // 通知客户端：分配成功
      const clientMeta = clients.get(item.clientId);
      if (clientMeta) {
        sendToClient(clientMeta, {
          type: 'queue_assigned',
          agentId: meta.id,
          agentName: meta.agentName || meta.id,
          agentAvatar: meta.agentAvatar,
          sessionId,
        });
      }
      // 通知客服：会话建立
      sendToAgent(meta, {
        type: 'queue_assigned',
        agentId: meta.id,
        agentName: meta.agentName || meta.id,
        agentAvatar: meta.agentAvatar,
        sessionId,
      });
      broadcastPresence();
      broadcastQueue();
      break;
    }

    case 'agent.send': {
      const sess = sessions.get(msg.sessionId);
      if (!sess || sess.agentId !== meta.id) {
        sendError(meta.ws, 'not_your_session', '无权操作该会话');
        return;
      }
      const message = {
        id: msg.messageId || newId('msg'),
        sessionId: sess.sessionId,
        role: 'agent',
        parts: msg.parts || [],
        status: 'done',
        createdAt: now(),
      };
      sess.messages.push(message);
      const clientMeta = clients.get(sess.clientId);
      if (clientMeta) {
        sendToClient(clientMeta, { type: 'message', message });
      }
      sendToAgent(meta, { type: 'message_ack', messageId: message.id, timestamp: message.createdAt });
      break;
    }

    case 'agent.typing': {
      const sess = sessions.get(msg.sessionId);
      if (!sess || sess.agentId !== meta.id) return;
      const clientMeta = clients.get(sess.clientId);
      if (clientMeta) {
        sendToAgent(clientMeta, {
          type: 'typing',
          from: 'agent',
          isTyping: !!msg.isTyping,
        });
      }
      break;
    }

    case 'agent.end_session': {
      const sess = sessions.get(msg.sessionId);
      if (!sess || sess.agentId !== meta.id) return;
      endSession(sess, 'agent', msg.reason);
      break;
    }

    case 'agent.request_suggestions':
    case 'agent.fetch_suggestions': {
      // 客服主动要求推荐（如打开工具栏时）
      const sess = sessions.get(msg.sessionId);
      if (!sess || sess.agentId !== meta.id) return;
      scheduleSuggestion(meta, sess, null, msg.context);
      break;
    }

    case 'agent.use_suggestion': {
      // 客服点击"一键发送"：把对应 suggestion 转为 agent 消息
      const sess = sessions.get(msg.sessionId);
      if (!sess || sess.agentId !== meta.id) {
        sendError(meta.ws, 'not_your_session', '无权操作该会话');
        return;
      }
      // 从最近的 suggestion_chunk 流里找 parts；找不到则降级为纯文本
      const recent = lastSuggestions.get(sess.sessionId) || [];
      const sug = recent.find((x) => x.intentId === msg.suggestionId);
      const parts = sug?.parts?.length
        ? sug.parts
        : [{ type: 'text', content: '[已应用推荐话术]' }];
      const message = {
        id: newId('msg'),
        sessionId: sess.sessionId,
        role: 'agent',
        parts,
        status: 'done',
        createdAt: now(),
      };
      sess.messages.push(message);
      const clientMeta = clients.get(sess.clientId);
      if (clientMeta) {
        sendToClient(clientMeta, { type: 'message', message });
        sendToAgent(meta, { type: 'message_ack', messageId: message.id, timestamp: message.createdAt });
      }
      break;
    }

    case 'agent.fetch_history': {
      // 客服主动拉取自己的历史会话列表
      sendHistoryListToAgent(meta);
      break;
    }

    case 'agent.fetch_history_session': {
      // 客服查看某条历史会话的完整消息
      const agentList = historyByAgent.get(meta.id) || [];
      const detail = agentList.find((s) => s.sessionId === msg.sessionId);
      if (!detail) {
        sendError(meta.ws, 'history_not_found', '历史会话不存在或已过期');
        return;
      }
      sendToAgent(meta, { type: 'history_session', session: detail });
      break;
    }
  }
}

// ============== 工具函数 ==============

function findSessionByClient(clientId) {
  for (const sess of sessions.values()) {
    if (sess.clientId === clientId) return sess;
  }
  return null;
}

function getQueuePosition(clientId) {
  const idx = queue.findIndex((q) => q.clientId === clientId);
  return idx === -1 ? -1 : idx + 1;
}

function estimateWaitSec(queueLen) {
  // 简单估算：每个客服平均 60s 处理一个会话
  const onlineAgents = Math.max(1, agents.size);
  return Math.ceil((queueLen / onlineAgents) * 60);
}

function endSession(sess, reason) {
  if (sess.status === 'ended') return; // 幂等
  sess.status = 'ended';
  sess.endedAt = now();
  sess.endReason = reason;
  // 清掉静默计时器
  if (sess.inactivityTimer) {
    clearTimeout(sess.inactivityTimer);
    sess.inactivityTimer = null;
  }
  // ===== 转存到历史会话 =====
  const detail = buildHistoryDetail(sess);
  pushHistory(detail);
  // 通知双方：session_ended 携带 sessionId，便于客户端定位自己的历史会话
  const clientMeta = clients.get(sess.clientId);
  const agentMeta = agents.get(sess.agentId);
  if (clientMeta) sendToClient(clientMeta, { type: 'session_ended', reason, sessionId: sess.sessionId });
  if (agentMeta) sendToAgent(agentMeta, { type: 'session_ended', reason, sessionId: sess.sessionId });
  // ===== 增量推送：让在线的客服 / 客户端实时看到新历史条目 =====
  const newItem = toHistoryItem(detail);
  // 客服端：推给"该会话关联的客服"
  if (agentMeta) {
    sendToAgent(agentMeta, { type: 'history_list', items: [newItem] });
  } else {
    // 客服不在线：等他下次连接时由 sendHistoryListToAgent 一次性推完
  }
  // 客户端：推给"该会话关联的用户"
  if (clientMeta) {
    sendToClient(clientMeta, { type: 'history_list', items: [newItem] });
  }
  // 30s 后清理活跃会话（让断线重连仍能恢复，超时后清空）
  setTimeout(() => sessions.delete(sess.sessionId), 30_000);
  // 顺便清掉 lastSuggestions
  lastSuggestions.delete(sess.sessionId);
}

/**
 * 重置 30s 用户静默计时器：
 *   - 用户每次发消息都会调用（重置倒计时）
 *   - 客服发消息不重置（避免客服发完一条又得等 30s）
 *     —— 这里的设计意图是"用户活跃度"判定
 *   - 到点 → endSession(sess, 'timeout')
 */
function resetInactivityTimer(sess) {
  if (!sess.userHasSpoken) {
    // 用户还没开口（可能在思考/打字），不能自动结束会话
    return;
  }
  if (sess.inactivityTimer) clearTimeout(sess.inactivityTimer);
  sess.inactivityTimer = setTimeout(() => {
    if (sess.status !== 'inSession') return;
    console.log(`[ws] session ${sess.sessionId} 30s 用户静默，自动结束`);
    endSession(sess, 'timeout');
  }, USER_INACTIVITY_TIMEOUT_MS);
}

/**
 * 把 sess 快照成 HistorySessionDetail（endSession 时调用一次）
 * 注意：必须深拷贝 messages，避免被 sessions.delete 后引用失效
 */
function buildHistoryDetail(sess) {
  // 找到 userName：用户第一次 hello / 排队时记录的
  const clientMeta = clients.get(sess.clientId);
  const userName = sess.userName || clientMeta?.userName;
  const agentMeta = agents.get(sess.agentId);
  const agentName = agentMeta?.agentName || sess.agentId;
  return {
    sessionId: sess.sessionId,
    clientId: sess.clientId,
    userName,
    agentId: sess.agentId,
    agentName,
    startedAt: sess.startedAt || sess.createdAt,
    endedAt: sess.endedAt || now(),
    endReason: sess.endReason || 'user',
    messages: sess.messages.map((m) => ({
      ...m,
      parts: m.parts.map((p) => ({ ...p })),
    })),
  };
}

/**
 * HistorySessionDetail → HistorySessionItem（列表展示用，去掉 messages 减少流量）
 */
function toHistoryItem(detail) {
  const lastUser = [...detail.messages].reverse().find((m) => m.role === 'user');
  const lastAgent = [...detail.messages].reverse().find((m) => m.role === 'agent');
  const extractText = (m) =>
    m
      ? m.parts
          .filter((p) => p.type === 'text' || p.type === 'markdown')
          .map((p) => p.content)
          .join(' ')
          .slice(0, 80)
      : undefined;
  return {
    sessionId: detail.sessionId,
    clientId: detail.clientId,
    userName: detail.userName,
    agentId: detail.agentId,
    agentName: detail.agentName,
    startedAt: detail.startedAt,
    endedAt: detail.endedAt,
    endReason: detail.endReason,
    messageCount: detail.messages.length,
    lastUserMessage: extractText(lastUser),
    lastAgentMessage: extractText(lastAgent),
  };
}

/**
 * 把历史会话推入 historyByAgent / historyByClient
 * 触发：
 *   - 24h 过期清理
 *   - 单客服 200 条上限
 */
function pushHistory(detail) {
  // 客户端维度
  const clientList = historyByClient.get(detail.clientId) || [];
  clientList.unshift(detail);
  pruneHistoryList(clientList);
  historyByClient.set(detail.clientId, clientList);
  // 客服维度
  const agentList = historyByAgent.get(detail.agentId) || [];
  agentList.unshift(detail);
  pruneHistoryList(agentList);
  historyByAgent.set(detail.agentId, agentList);
}

/**
 * 历史会话列表维护：
 *   - 移除 endedAt 超过 HISTORY_RETENTION_MS 的过期会话
 *   - 单客服 / 单客户端最多保留 HISTORY_MAX_PER_AGENT 条
 */
function pruneHistoryList(list) {
  const cutoff = now() - HISTORY_RETENTION_MS;
  // 过滤过期
  let pruned = list.filter((s) => s.endedAt >= cutoff);
  // 截断上限（FIFO 丢最老的）
  if (pruned.length > HISTORY_MAX_PER_AGENT) {
    pruned = pruned.slice(0, HISTORY_MAX_PER_AGENT);
  }
  list.length = 0;
  list.push(...pruned);
}

/**
 * 推送给指定客服：自己处理过的所有历史会话摘要列表（按 endedAt 倒序）
 */
function sendHistoryListToAgent(meta) {
  const list = historyByAgent.get(meta.id) || [];
  // 先做一次过期清理，避免给客服推一堆垃圾
  pruneHistoryList(list);
  const items = list.map(toHistoryItem);
  sendToAgent(meta, { type: 'history_list', items });
}

/**
 * 推送给指定客户端：自己参与过的所有历史会话摘要列表
 */
function sendHistoryListToClient(meta) {
  const list = historyByClient.get(meta.id) || [];
  pruneHistoryList(list);
  const items = list.map(toHistoryItem);
  sendToClient(meta, { type: 'history_list', items });
}

function handleDisconnect(meta) {
  if (meta.role === 'client') {
    // 仅清理连接引用，会话保持（支持断线重连）
    clients.delete(meta.id);
    console.log(`[ws] client ${meta.id} disconnected`);
  } else {
    agents.delete(meta.id);
    console.log(`[ws] agent ${meta.id} disconnected`);
    broadcastPresence();
  }
}

/**
 * 广播在线客服数 / 排队人数
 */
function broadcastPresence() {
  const data = {
    onlineAgents: agents.size,
    queueLength: queue.length,
  };
  for (const meta of agents.values()) {
    sendToAgent(meta, { type: 'presence', ...data });
  }
}

/**
 * 广播队列更新给所有客服：
 *   - 每次队列变化（入队/出队/分配/取消）都推一次
 *   - 客服工作台左侧"待接单"列表直接消费
 */
function broadcastQueue() {
  const items = queue.map((q) => ({
    clientId: q.clientId,
    userName: q.userName,
    userAvatar: q.userAvatar,
    queuedAt: q.queuedAt,
    reason: q.reason,
    lastUserMessage: q.lastUserMessage,
  }));
  console.log(`[ws] broadcastQueue items=${items.length} agents=${agents.size}`);
  for (const meta of agents.values()) {
    console.log(`[ws]   → agent ${meta.id} readyState=${meta.ws?.readyState}`);
    sendToAgent(meta, { type: 'queue_update', items });
  }
}

// ============== 模拟智能推荐话术 ==============

/**
 * 关键词 → 类别（mock 意图识别）
 * 真实场景应接 LLM；这里在前端关键词匹配后由服务端"再次打包"推送
 */
const KEYWORD_RULES = [
  { match: /退款|退钱|退货|refund/i, category: '退款' },
  { match: /投诉|举报|差评|工单/i, category: '投诉' },
  { match: /物流|快递|发货|到哪|单号/i, category: '物流' },
  { match: /优惠|折扣|券|促销/i, category: '优惠' },
  { match: /发票|收据|报销/i, category: '发票' },
  { match: /故障|坏了|用不了|错误/i, category: '故障' },
];

function detectCategory(text) {
  for (const rule of KEYWORD_RULES) {
    if (rule.match.test(text)) return rule.category;
  }
  return '通用';
}

/**
 * 每个类别对应 2-3 条推荐话术（服务端预置）
 * 实际项目中应来自知识库/LLM 生成
 */
const SUGGESTION_TEMPLATES = {
  退款: [
    {
      preview: '亲，非常抱歉给您带来困扰～我先帮您核实一下订单情况。',
      parts: [{ type: 'text', content: '亲，非常抱歉给您带来困扰～我先帮您核实一下订单情况。' }],
    },
    {
      preview: '【图片】退款流程示意图 + 文字说明',
      parts: [
        {
          type: 'image',
          url: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Customer%20service%20refund%20flow%20infographic%2C%20flat%20design%2C%20Chinese%20e-commerce%20app%20style&image_size=landscape_4_3',
          alt: '退款流程示意图',
          caption: '退款操作流程',
        },
        { type: 'text', content: '请按上图操作，款项会在 1-3 个工作日内原路退回。' },
      ],
    },
  ],
  投诉: [
    {
      preview: '非常理解您的心情，我马上为您升级处理，专人跟进。',
      parts: [{ type: 'text', content: '非常理解您的心情，我马上为您升级处理，专人跟进。' }],
    },
    {
      preview: '【卡片】补偿方案选择（优惠券/现金/积分）',
      parts: [
        {
          type: 'comparison',
          title: '补偿方案',
          items: [
            { name: '20 元无门槛券', description: '即时到账', icon: '🎟️', highlight: true },
            { name: '现金 10 元', description: '原路退回', icon: '💰' },
            { name: '500 积分', description: '可换购商品', icon: '⭐' },
          ],
        },
      ],
    },
  ],
  物流: [
    {
      preview: '请提供一下订单号或快递单号，我帮您查询。',
      parts: [{ type: 'text', content: '请提供一下订单号或快递单号，我帮您查询。' }],
    },
  ],
  优惠: [
    {
      preview: '【文件】新客专享 50 元优惠券包',
      parts: [
        {
          type: 'file',
          name: '新客优惠券.pdf',
          size: 128000,
          url: 'https://example.com/coupon.pdf',
          mime: 'application/pdf',
        },
        { type: 'text', content: '这是为您申请的专属优惠券包，请查收～' },
      ],
    },
  ],
  发票: [
    {
      preview: '电子发票会在订单完成后 24 小时内开具，请提供邮箱。',
      parts: [{ type: 'text', content: '电子发票会在订单完成后 24 小时内开具，请提供邮箱。' }],
    },
  ],
  故障: [
    {
      preview: '【富文本】常见故障排查清单',
      parts: [
        {
          type: 'rich',
          html: '<div style="background:#f7f8fa;padding:12px;border-radius:8px"><b>排查步骤：</b><ol><li>检查网络连接</li><li>重启 App</li><li>清除缓存</li><li>仍异常请截图反馈</li></ol></div>',
        },
      ],
    },
  ],
  通用: [
    {
      preview: '请问还有什么可以帮您的吗？',
      parts: [{ type: 'text', content: '请问还有什么可以帮您的吗？' }],
    },
  ],
};

/**
 * 模拟"智能识别意图"：
 *  - 收集最近 N 条用户消息
 *  - 关键词匹配得到 category
 *  - 拿对应话术模板
 *  - 流式推送 suggestion_start / suggestion_chunk / done
 */
function scheduleSuggestion(agentMeta, sess, lastUserMessage, ctxMessages) {
  setTimeout(() => {
    // 已经不在会话中
    if (sess.status !== 'inSession' || sess.agentId !== agentMeta.id) return;
    const messages = ctxMessages || sess.messages;
    const recentUserText = messages
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) =>
        m.parts
          .filter((p) => p.type === 'text' || p.type === 'markdown')
          .map((p) => p.content)
          .join(' '),
      )
      .join(' ');
    const category = detectCategory(recentUserText);
    const templates = SUGGESTION_TEMPLATES[category] || SUGGESTION_TEMPLATES['通用'];
    const intentId = newId('intent');
    // 记录本次 intent 的全部 parts，供 use_suggestion 取出
    const accumulatedParts = [];
    const recorded = { intentId, category, parts: accumulatedParts };

    sendToAgent(agentMeta, { type: 'suggestion_start', intentId, category });
    // 模拟"流式"：每 400ms 推一条
    templates.forEach((tpl, idx) => {
      setTimeout(() => {
        if (sess.status !== 'inSession' || sess.agentId !== agentMeta.id) return;
        // 累加 part（深拷贝避免引用问题）
        for (const p of tpl.parts) accumulatedParts.push(structuredClone(p));
        sendToAgent(agentMeta, {
          type: 'suggestion_chunk',
          intentId,
          chunk: tpl.parts,
          done: idx === templates.length - 1,
        });
      }, 400 * (idx + 1));
    });
    // 整组推完后登记到 lastSuggestions
    setTimeout(() => {
      const arr = lastSuggestions.get(sess.sessionId) || [];
      // 同一 intentId 只保留一份
      const filtered = arr.filter((x) => x.intentId !== recorded.intentId);
      filtered.push(recorded);
      lastSuggestions.set(sess.sessionId, filtered);
    }, 400 * templates.length + 50);
  }, SUGGESTION_DELAY_MS);
}

// ============== 发送辅助 ==============

function sendToClient(meta, payload) {
  sendEnvelope(meta.ws, payload);
}
function sendToAgent(meta, payload) {
  sendEnvelope(meta.ws, payload);
}
function sendEnvelope(ws, payload) {
  if (!ws || ws.readyState !== 1) return; // OPEN
  const envelope = { seq: ++seq, ts: now(), payload };
  try {
    ws.send(JSON.stringify(envelope));
  } catch (err) {
    console.error('[ws] send failed', err);
  }
}
function sendError(ws, code, message) {
  sendEnvelope(ws, { type: 'error', code, message });
}
function safeClose(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {}
}

// ============== 启动 ==============

httpServer.listen(PORT, () => {
  console.log(`[agent-ws] listening on ws://localhost:${PORT}/ws`);
  console.log(`[agent-ws] health: http://localhost:${PORT}/health`);
});

process.on('SIGINT', () => {
  console.log('\n[agent-ws] shutting down...');
  clearInterval(heartbeatTimer);
  wss.close();
  httpServer.close();
  process.exit(0);
});
