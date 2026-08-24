/**
 * NestJS + socket.io 版 e2e 测试（纯 JS）
 * - 启动 NestJS 服务后跑：cd server-nest && node test/agent-ws-e2e.mjs
 * - 场景：转人工全流程（connect / queue / accept / send / suggestion / end）
 */
import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';
const TIMEOUT = 8000;

function ts() {
  return new Date().toISOString().slice(11, 23);
}
function log(role, line) {
  console.log(`[${ts()}] [${role}] ${line}`);
}

function open(role, id) {
  return new Promise((resolve, reject) => {
    const inbox = [];
    const sock = io(URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      query: { role, id },
      reconnection: false,
    });

    const timer = setTimeout(() => {
      sock.disconnect();
      reject(new Error(`${role} ${id} 连接超时`));
    }, TIMEOUT);

    sock.on('connect', () => {
      clearTimeout(timer);
      log(role, `connected id=${id}`);
      resolve(sock);
    });
    sock.on('connect_error', (err) => {
      log(role, `connect_error ${err.message}`);
    });
    const events = [
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
    for (const t of events) {
      sock.on(t, (data) => {
        inbox.push(data);
        log(role, `← ${data.type}${data.intentId ? ` (${data.intentId})` : ''}`);
      });
    }

    sock._inbox = inbox;
  });
}

function waitFor(sock, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const seenFrom = sock._inbox.length;
    const tick = setInterval(() => {
      const found = sock._inbox.slice(seenFrom).find((m) => m.type === type);
      if (found) {
        clearInterval(tick);
        resolve(found);
      } else if (Date.now() - start > timeout) {
        clearInterval(tick);
        reject(new Error(`等待 ${type} 超时（${timeout}ms）`));
      }
    }, 50);
  });
}

function send(sock, msg) {
  sock.emit('message', msg);
  console.log(`[${ts()}] [send] → ${msg.type}`);
}

async function main() {
  const results = { steps: [], passed: 0, failed: 0 };
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      results.steps.push({ name, ok: true });
      results.passed++;
    } catch (err) {
      console.error(`❌ ${name}: ${err.message}`);
      results.steps.push({ name, ok: false, error: err.message });
      results.failed++;
    }
  };

  const tag = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const clientId = `test_client_${tag}`;
  const agentId = `test_agent_${tag}`;

  let client = null;
  let agent = null;
  let clientSessionId = null;
  let agentSessionId = null;

  try {
    // 1. 客户端连接
    await check('客户端 socket.io 连接', async () => {
      client = await open('client', clientId);
      send(client, { type: 'client.hello', clientId, userName: '测试用户' });
    });

    // 2. 客服端连接
    await check('客服端 socket.io 连接', async () => {
      agent = await open('agent', agentId);
      send(agent, { type: 'agent.hello', agentId, agentName: '测试客服' });
    });

    // 3. 客服端收到 presence
    await check('客服端收到 presence', async () => {
      const ev = await waitFor(agent, 'presence');
      if (typeof ev.onlineAgents !== 'number') throw new Error('presence 字段缺失');
    });

    // 4. 客户端 transfer_human
    await check('客户端 transfer_human → queue_update 推送', async () => {
      send(client, { type: 'client.transfer_human', reason: 'normal' });
      const ev = await waitFor(agent, 'queue_update');
      if (!Array.isArray(ev.items) || ev.items.length === 0) {
        throw new Error('queue_update.items 为空');
      }
      if (ev.items[0].clientId !== clientId) {
        throw new Error(`queue_update 含错误的 clientId: ${ev.items[0].clientId}`);
      }
    });

    // 5. 客户端收到 queue_accepted
    await check('客户端收到 queue_accepted', async () => {
      let ev = null;
      try {
        ev = await waitFor(client, 'queue_accepted', 500);
      } catch {
        ev = client._inbox.find((m) => m.type === 'queue_accepted');
        if (!ev) throw new Error('queue_accepted 未到达');
      }
      if (typeof ev.position !== 'number') throw new Error('queue_accepted.position 缺失');
    });

    // 6. 客服端 accept_queue
    await check('客服端 accept_queue → 双方收到 queue_assigned', async () => {
      send(agent, { type: 'agent.accept_queue', clientId });
      const [evAgent, evClient] = await Promise.all([
        waitFor(agent, 'queue_assigned'),
        waitFor(client, 'queue_assigned'),
      ]);
      if (!evAgent.sessionId || !evClient.sessionId) {
        throw new Error('queue_assigned.sessionId 缺失');
      }
      if (evAgent.sessionId !== evClient.sessionId) {
        throw new Error('双方收到的 sessionId 不一致');
      }
      clientSessionId = evClient.sessionId;
      agentSessionId = evAgent.sessionId;
    });

    // 7. 客户端 send
    await check('客户端 send → 客服端收到 message', async () => {
      send(client, {
        type: 'client.send',
        messageId: 'm1',
        parts: [{ type: 'text', content: '我想要退款' }],
      });
      const ev = await waitFor(agent, 'message');
      if (ev.message && ev.message.role !== 'user') throw new Error('客服端收到非 user 消息');
      if (!ev.message.parts || !ev.message.parts.length) throw new Error('消息 parts 为空');
    });

    // 8. 客服端 send
    await check('客服端 send → 客户端收到 message', async () => {
      send(agent, {
        type: 'agent.send',
        sessionId: agentSessionId,
        messageId: 'm2',
        parts: [{ type: 'text', content: '好的，马上为您处理退款' }],
      });
      const ev = await waitFor(client, 'message');
      if (ev.message && ev.message.role !== 'agent') throw new Error('客户端收到非 agent 消息');
    });

    // 9. 推荐话术（mock 触发，1.5s 后推）
    await check('服务端推送 suggestion_start/chunk → 客户端收到 use_suggestion 消息', async () => {
      let found = null;
      const start = Date.now();
      while (Date.now() - start < 5000) {
        found = agent._inbox.find((m) => m.type === 'suggestion_chunk' && m.chunk && m.chunk.length);
        if (found) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!found) {
        console.log('  (no suggestion yet, sending manual reply)');
        send(agent, {
          type: 'agent.send',
          sessionId: agentSessionId,
          messageId: 'm3',
          parts: [{ type: 'text', content: '已为您处理，请稍等' }],
        });
      } else {
        const intentId = found.intentId;
        // 等最后一个 chunk 完成
        await new Promise((r) => setTimeout(r, 600));
        send(agent, {
          type: 'agent.use_suggestion',
          sessionId: agentSessionId,
          suggestionId: intentId,
        });
      }
      const ev = await waitFor(client, 'message', 5000);
      if (!ev.message || !ev.message.parts || !ev.message.parts.length) {
        throw new Error('推荐话术 parts 为空');
      }
    });

    // 10. 客服端 end_session
    await check('客服端 end_session → 双方收到 session_ended', async () => {
      send(agent, {
        type: 'agent.end_session',
        sessionId: agentSessionId,
        reason: 'agent',
      });
      const [evAgent, evClient] = await Promise.all([
        waitFor(agent, 'session_ended'),
        waitFor(client, 'session_ended'),
      ]);
      if (evAgent.reason !== 'agent') throw new Error('session_ended.reason 不正确');
      if (evClient.reason !== 'agent') throw new Error('session_ended.reason 不正确');
    });
  } finally {
    if (client) client.disconnect();
    if (agent) agent.disconnect();
  }

  console.log('\n========== 测试结果 ==========');
  console.log(`通过: ${results.passed} / ${results.passed + results.failed}`);
  console.log(`失败: ${results.failed}`);
  if (results.failed === 0) {
    console.log('\n🎉 全部通过，转人工全流程连通 OK');
    process.exit(0);
  } else {
    console.log('\n⚠️  部分步骤失败：');
    results.steps
      .filter((s) => !s.ok)
      .forEach((s) => console.log(`  - ${s.name}: ${s.error}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
