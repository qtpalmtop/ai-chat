/**
 * 专项测试：用户取消排队 → 客服端实时收到 queue_update（items 不含该用户）
 */

import WebSocket from 'ws';

const URL = 'ws://localhost:3002/ws';

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
      const env = JSON.parse(raw.toString());
      const data = env.payload || env;
      inbox.push(data);
      if (data.type === 'queue_update') {
        log(role, `← queue_update items=[${(data.items || []).map((it) => it.clientId.slice(-8)).join(',')}]`);
      } else {
        log(role, `← ${data.type}`);
      }
    });
    ws.on('error', (err) => log(role, `ERROR ${err.message}`));
    ws.on('close', () => log(role, 'closed'));
    ws._inbox = inbox;
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
  log('send', `→ ${msg.type}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const tag = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const clientId = `test_user_${tag}`;
  const agentId = `test_agent_${tag}`;

  let client, agent;

  // 1. 客服端先连接
  console.log('\n===== Step 1: 客服端先连接 =====');
  agent = await open('agent', agentId);
  send(agent, { type: 'agent.hello', agentId, agentName: '测试客服' });
  await sleep(300);
  // 记录"transfer_human 之前"的 inbox 位置
  const seenBeforeTransfer = agent._inbox.length;

  // 2. 用户连接 + 转人工
  console.log('\n===== Step 2: 用户连接 + 转人工 =====');
  client = await open('client', clientId);
  send(client, { type: 'client.hello', clientId, userName: '测试用户' });
  send(client, { type: 'client.transfer_human', reason: 'normal', lastUserMessage: '需要帮助' });
  await sleep(300);

  // 3. 客服端应收到含该用户的 queue_update
  console.log('\n===== Step 3: 客服端应收到含该用户的 queue_update =====');
  let q1 = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 2000) {
    q1 = agent._inbox
      .slice(seenBeforeTransfer)
      .find((m) => m.type === 'queue_update' && m.items?.some((it) => it.clientId === clientId));
    if (q1) break;
    await sleep(30);
  }
  if (!q1) throw new Error('客服端未收到含该用户的 queue_update');
  console.log(`✅ 排队成功，items 含目标用户`);

  // 4. 用户取消排队
  console.log('\n===== Step 4: 用户取消排队 =====');
  // 记录"cancel 之前"的 inbox 位置
  const seenBeforeCancel = agent._inbox.length;
  send(client, { type: 'client.cancel_queue' });
  await sleep(300);

  // 5. 客服端应实时收到 items 不含该用户的 queue_update
  console.log('\n===== Step 5: 客服端应收到 queue_update（items 不含该用户）=====');
  let q2 = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 2000) {
    q2 = agent._inbox
      .slice(seenBeforeCancel)
      .find((m) => m.type === 'queue_update' && !m.items?.some((it) => it.clientId === clientId));
    if (q2) break;
    await sleep(30);
  }
  if (!q2) {
    const recent = agent._inbox.slice(seenBeforeCancel).map((m) => `${m.type}${m.items ? `(${m.items.length})` : ''}`).join(' / ');
    throw new Error(`客服端在 2s 内未收到"items 不含该用户"的 queue_update。收到: ${recent}`);
  }
  console.log(`✅ 实时收到 queue_update（items=${q2.items.length}，不含目标用户）`);

  client?.close();
  agent?.close();

  console.log('\n🎉 全部通过：用户取消排队 → 客服端实时收到更新');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ 失败:', err.message);
  process.exit(1);
});
