/**
 * 端到端测试：30s 用户静默自动结束 + 历史会话列表/详情
 *
 * 场景：
 *   1. 客户端连接 → 客服端连接 → 客户端 transfer_human
 *   2. 客服端 accept_queue → 双方收到 queue_assigned
 *   3. 双方各发一条消息（确认 session 正常交互）
 *   4. 客服端等待 30s 不动（不主动 end_session） → 验证服务端自动推送 session_ended(reason=timeout)
 *   5. 客服端验证 history_list 收到一条新条目
 *   6. 客服端 fetch_history_session → 验证 history_session 含双方消息
 *   7. 客户端 fetch_history → 验证客户端也收到 history_list
 *
 * 退出码：0 表示全部通过
 */

import WebSocket from 'ws';

const URL = 'ws://localhost:3002/ws';
const TIMEOUT = 60_000; // 30s 超时 + 缓冲

function log(role, line) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${role}] ${line}`);
}

function open(role, id) {
  return new Promise((resolve, reject) => {
    const qs = role === 'client' ? `role=client&userId=${id}` : `role=agent&agentId=${id}`;
    const ws = new WebSocket(`${URL}?${qs}`);
    const inbox = [];
    let opened = false;
    const timer = setTimeout(() => {
      if (!opened) reject(new Error(`${role} ${id} 连接超时`));
    }, 5000);

    ws.on('open', () => {
      opened = true;
      clearTimeout(timer);
      log(role, `connected id=${id}`);
      resolve(ws);
    });
    ws.on('message', (raw) => {
      try {
        const env = JSON.parse(raw.toString());
        const data = env.payload || env;
        inbox.push(data);
        log(role, `← ${data.type}`);
      } catch {}
    });
    ws.on('error', (err) => {
      log(role, `ERROR ${err.message}`);
    });
    ws.on('close', (code, reason) => {
      log(role, `closed code=${code} reason=${reason?.toString() || ''}`);
    });

    ws._inbox = inbox;
  });
}

function waitFor(ws, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const seenFrom = ws._inbox.length;
    const tick = setInterval(() => {
      const found = ws._inbox.slice(seenFrom).find((m) => m.type === type);
      if (found) {
        clearInterval(tick);
        resolve(found);
      } else if (Date.now() - start > timeout) {
        clearInterval(tick);
        reject(new Error(`等待 ${type} 超时（${timeout}ms）`));
      }
    }, 100);
  });
}

function waitForCondition(ws, predicate, timeout = 5000, desc = 'condition') {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    // 不使用 seenFrom：服务端可能在我们调用 waitFor 之前就把事件推送过来
    // 扫整个 inbox 找匹配（测试脚本中合理：不在意是否"新"事件）
    const tick = setInterval(() => {
      const found = ws._inbox.find(predicate);
      if (found) {
        clearInterval(tick);
        resolve(found);
      } else if (Date.now() - start > timeout) {
        clearInterval(tick);
        reject(new Error(`等待 ${desc} 超时（${timeout}ms）`));
      }
    }, 100);
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString().slice(11, 23)}] [send] → ${msg.type}`);
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
  const clientId = `hist_client_${tag}`;
  const agentId = `hist_agent_${tag}`;

  let client, agent;
  let sessionId = null;

  // 1. 客户端连接
  await check('客户端 WebSocket 连接', async () => {
    client = await open('client', clientId);
    send(client, { type: 'client.hello', clientId, userName: '历史用户' });
  });

  // 2. 客服端连接（连接时应立即收到 history_list，初始为空）
  await check('客服端 WebSocket 连接 + 收到空 history_list', async () => {
    agent = await open('agent', agentId);
    send(agent, { type: 'agent.hello', agentId, agentName: '历史客服' });
    const ev = await waitFor(agent, 'history_list', 3000);
    if (!Array.isArray(ev.items)) throw new Error('history_list.items 非数组');
    if (ev.items.length !== 0) throw new Error('首次连接 history_list 应为空');
  });

  // 3. 客户端 transfer_human
  await check('客户端 transfer_human', async () => {
    send(client, { type: 'client.transfer_human', reason: 'normal', lastUserMessage: '你好' });
    await waitFor(client, 'queue_accepted', 3000);
  });

  // 4. 客服端 accept_queue → 双方收到 queue_assigned
  await check('客服端 accept_queue → 双方收到 queue_assigned', async () => {
    send(agent, { type: 'agent.accept_queue', clientId });
    const [evAgent, evClient] = await Promise.all([
      waitFor(agent, 'queue_assigned'),
      waitFor(client, 'queue_assigned'),
    ]);
    if (evAgent.sessionId !== evClient.sessionId) {
      throw new Error('双方 sessionId 不一致');
    }
    sessionId = evAgent.sessionId;
  });

  // 5. 双方各发一条消息
  await check('双方各发一条消息（确认 session 正常）', async () => {
    send(client, {
      type: 'client.send',
      sessionId,
      parts: [{ type: 'text', content: '我有一个问题' }],
    });
    await waitFor(agent, 'message', 3000);
    send(agent, {
      type: 'agent.send',
      sessionId,
      parts: [{ type: 'text', content: '您好，请问需要什么帮助' }],
    });
    await waitFor(client, 'message', 3000);
  });

  // 6. 等待 30s 静默 → 服务端自动推送 session_ended(reason=timeout)
  // 30s 后还要等 1-2s 让服务端完成 push history_list
  await check('30s 用户静默 → 自动 session_ended(reason=timeout)', async () => {
    console.log('  ... 等待 32s 触发静默超时 ...');
    const [evAgent, evClient] = await Promise.all([
      waitFor(agent, 'session_ended', 35_000),
      waitFor(client, 'session_ended', 35_000),
    ]);
    if (evAgent.reason !== 'timeout') {
      throw new Error(`agent 收到 reason=${evAgent.reason}（期望 timeout）`);
    }
    if (evClient.reason !== 'timeout') {
      throw new Error(`client 收到 reason=${evClient.reason}（期望 timeout）`);
    }
    if (evAgent.sessionId !== sessionId || evClient.sessionId !== sessionId) {
      throw new Error(`session_ended 携带的 sessionId 不匹配：agent=${evAgent.sessionId}, client=${evClient.sessionId}, expected=${sessionId}`);
    }
  });

  // 7. 客服端立即收到 history_list 增量（含 1 条新条目）
  await check('客服端收到 history_list 增量推送', async () => {
    // history_list 可能在 session_ended 之前/之后到达，不依赖 seenFrom
    // 扫整个 inbox 直到找到匹配项；用 8s timeout 兜底
    const ev = await waitForCondition(
      agent,
      (m) => m.type === 'history_list' && m.items?.some((it) => it.sessionId === sessionId),
      8000,
      'history_list',
    );
    const item = ev.items.find((it) => it.sessionId === sessionId);
    if (!item) throw new Error('新会话未出现在 history_list.items');
    if (item.endReason !== 'timeout') {
      throw new Error(`history endReason=${item.endReason}（期望 timeout）`);
    }
    if (item.messageCount < 2) {
      throw new Error(`messageCount=${item.messageCount}（期望 ≥ 2）`);
    }
    if (!item.lastUserMessage || !item.lastAgentMessage) {
      throw new Error('lastUserMessage / lastAgentMessage 为空');
    }
  });

  // 8. 客户端也收到 history_list
  await check('客户端收到 history_list 增量推送', async () => {
    const ev = await waitForCondition(
      client,
      (m) => m.type === 'history_list' && m.items?.some((it) => it.sessionId === sessionId),
      8000,
      'history_list',
    );
    const item = ev.items.find((it) => it.sessionId === sessionId);
    if (!item) throw new Error('客户端 history_list 缺失新会话');
  });

  // 9. 客服端拉取历史详情
  await check('客服端 fetch_history_session 拿到完整消息', async () => {
    send(agent, { type: 'agent.fetch_history_session', sessionId });
    const ev = await waitFor(agent, 'history_session', 3000);
    if (ev.session.sessionId !== sessionId) {
      throw new Error('history_session.sessionId 不匹配');
    }
    if (ev.session.endReason !== 'timeout') {
      throw new Error(`history endReason=${ev.session.endReason}`);
    }
    if (ev.session.messages.length < 2) {
      throw new Error(`messages.length=${ev.session.messages.length}（期望 ≥ 2）`);
    }
    const userMsg = ev.session.messages.find((m) => m.role === 'user');
    const agentMsg = ev.session.messages.find((m) => m.role === 'agent');
    if (!userMsg || !agentMsg) throw new Error('消息缺少 user/agent 角色');
  });

  // 10. 客服端主动 fetch_history 拿到完整列表（含本次新加的）
  await check('客服端 fetch_history 拿到含本次的完整列表', async () => {
    send(agent, { type: 'agent.fetch_history' });
    const ev = await waitFor(agent, 'history_list', 3000);
    const item = ev.items.find((it) => it.sessionId === sessionId);
    if (!item) throw new Error('fetch_history 列表中缺失本次会话');
  });

  // 清理
  client?.close();
  agent?.close();

  // 输出汇总
  console.log('\n========== 历史会话测试结果 ==========');
  console.log(`通过: ${results.passed} / ${results.passed + results.failed}`);
  console.log(`失败: ${results.failed}`);
  if (results.failed === 0) {
    console.log('\n🎉 全部通过，30s 超时 + 历史会话连通 OK');
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
