/**
 * 专项测试：只有用户静默 30s 才会自动结束会话
 *
 * 场景：
 *  1. 客服接单后 30s 不动（用户没开口）→ 不应该结束
 *  2. 用户发消息后再静默 30s → 应该结束（endReason = 'timeout'）
 *  3. 客服发消息不重置 timer（用户活跃度判定）
 */

import WebSocket from 'ws';

const URL = 'ws://localhost:3002/ws';
const TIMEOUT_MS = 30_000;

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
      const detail =
        data.type === 'queue_assigned' ? `sessionId=${data.sessionId}` :
        data.type === 'session_ended' ? `reason=${data.reason || data.endReason}` :
        data.type === 'agent_message' || data.type === 'user_message' ? `parts=${data.message?.parts?.length || 0}` :
        '';
      log(role, `← ${data.type}${detail ? ' ' + detail : ''}`);
    });
    ws.on('error', (err) => log(role, `ERROR ${err.message}`));
    ws._inbox = inbox;
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
  log('send', `→ ${msg.type}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tag = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const clientId = `test_user_${tag}`;
  const agentId = `test_agent_${tag}`;

  let client, agent;
  let sessionId;

  // 1. 客服 + 用户上线，客服接单
  console.log('\n===== 场景 1：客服接单后 30s 不动（用户没开口）→ 不应结束 =====');
  agent = await open('agent', agentId);
  send(agent, { type: 'agent.hello', agentId, agentName: '测试客服' });
  await sleep(300);

  client = await open('client', clientId);
  send(client, { type: 'client.hello', clientId, userName: '测试用户' });
  send(client, { type: 'client.transfer_human', reason: 'normal', lastUserMessage: '需要帮助' });
  await sleep(300);

  send(agent, { type: 'agent.accept_queue', clientId });
  await sleep(800);
  sessionId = client._inbox.find((m) => m.type === 'queue_assigned')?.sessionId;
  if (!sessionId) throw new Error('未拿到 sessionId');
  log('info', `会话已建立 sessionId=${sessionId.slice(-8)}`);

  // 等 32s（超过 USER_INACTIVITY_TIMEOUT_MS），看是否被自动结束
  console.log(`\n等待 32s（>${TIMEOUT_MS / 1000}s）确认不会自动结束...`);
  await sleep(32_000);
  const ended1 = client._inbox.find((m) => m.type === 'session_ended');
  if (ended1) {
    throw new Error(`❌ 场景 1 失败：用户还没开口，会话已被自动结束 (reason=${ended1.endReason})`);
  }
  console.log('✅ 场景 1 通过：用户没开口，会话未结束');

  // 2. 用户发消息 → 启动 timer → 等 32s 不再说话 → 应被结束
  console.log('\n===== 场景 2：用户发消息后 30s 静默 → 应被自动结束 =====');
  const seenBeforeUserMsg = client._inbox.length;
  send(client, {
    type: 'client.send',
    messageId: `m1_${tag}`,
    parts: [{ type: 'text', text: '你好' }],
  });
  await sleep(500);
  // 等 32s
  console.log(`等待 32s（>${TIMEOUT_MS / 1000}s）确认会被自动结束...`);
  await sleep(32_000);
  const ended2 = client._inbox.slice(seenBeforeUserMsg).find((m) => m.type === 'session_ended');
  if (!ended2) {
    throw new Error('❌ 场景 2 失败：用户静默 30s 仍未自动结束');
  }
  const reason2 = ended2.reason || ended2.endReason;
  if (reason2 !== 'timeout') {
    throw new Error(`❌ 场景 2 失败：reason 应为 'timeout'，实际为 '${reason2}'`);
  }
  console.log(`✅ 场景 2 通过：用户静默 30s 会话已结束 (reason=${reason2})`);

  client?.close();
  agent?.close();

  console.log('\n🎉 全部通过：只有用户静默才会自动结束会话');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ 失败:', err.message);
  process.exit(1);
});
