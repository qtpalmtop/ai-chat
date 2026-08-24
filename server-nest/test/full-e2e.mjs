/**
 * 综合自测：模拟完整真实业务全流程（用户转人工 + 客服接受 + 多轮消息 + 推荐话术 + 历史 + 重连恢复）
 *
 * 关键设计：用 `waitForFrom(sock, type, fromIdx, timeout)` 模式
 *   - 在每个动作之前先快照 sock._inbox.length
 *   - 等待只对快照后新到的事件生效
 *   - 避免"事件已到达但 waitFor 还没拍快照"的竞态
 */
import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';
const TIMEOUT = 10000;

function log(role, line) { console.log(`[${role}] ${line}`); }
function ts() { return new Date().toISOString().slice(11, 23); }

function open(role, id) {
  return new Promise((resolve, reject) => {
    const inbox = [];
    const sock = io(URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      query: { role, id },
      reconnection: false,
    });
    const timer = setTimeout(() => { sock.disconnect(); reject(new Error('连接超时')); }, TIMEOUT);
    sock.on('connect', () => {
      clearTimeout(timer);
      log(role, `connected id=${id}`);
      resolve(sock);
    });
    sock.on('connect_error', (e) => log(role, `connect_error ${e.message}`));
    const types = [
      'queue_accepted', 'queue_position', 'queue_assigned', 'queue_cancelled',
      'queue_timeout', 'message', 'message_ack', 'typing',
      'session_ended', 'session_restored', 'presence', 'history_list',
      'history_session', 'queue_update', 'suggestion_start', 'suggestion_chunk', 'error',
    ];
    for (const t of types) {
      sock.on(t, (e) => {
        inbox.push({ t, e, ts: Date.now() });
        log(role, `← ${t} (inbox=${inbox.length})`);
      });
    }
    sock._inbox = inbox;
  });
}

/** 等待 sock._inbox 索引 ≥ fromIdx 之后出现 type 类型事件。超时抛错。 */
function waitForFrom(sock, type, fromIdx, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = setInterval(() => {
      const found = sock._inbox.slice(fromIdx).find((m) => m.t === type);
      if (found) { clearInterval(tick); resolve(found.e); }
      else if (Date.now() - start > timeout) {
        clearInterval(tick);
        const recent = sock._inbox.slice(-5).map((m) => m.t).join(',');
        reject(new Error(`等待 ${type} 超时（inbox 长度 ${sock._inbox.length}，最近事件: ${recent}）`));
      }
    }, 50);
  });
}

function clearInbox(sock) {
  // 原地清空，保留原数组引用，避免破坏 sock.on 闭包对 inbox 的引用
  if (sock._inbox) sock._inbox.length = 0;
}

function popAll(sock, type) {
  // 在原数组上 splice，保持引用不变
  const out = [];
  if (!sock._inbox) return out;
  for (let i = sock._inbox.length - 1; i >= 0; i--) {
    if (sock._inbox[i].t === type) {
      out.unshift(sock._inbox[i].e);
      sock._inbox.splice(i, 1);
    }
  }
  return out;
}

function sockSend(sock, msg) {
  sock.emit('message', msg);
}

async function main() {
  console.log(`\n========== 综合自测 @ ${ts()} ==========\n`);

  const tag = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const clientId = `u_${tag}`;
  const agentId = `a_${tag}`;

  let client, agent, sessionId;
  let passed = 0, failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`✅ ${name}`); passed++; }
    catch (e) { console.error(`❌ ${name}: ${e.message}`); failed++; }
  };

  // 1. 双方连接 + 等待握手完成
  await check('1. 客户端 + 客服端双连接', async () => {
    client = await open('client', clientId);
    agent = await open('agent', agentId);
    // 快照放在 send 之前
    const cBefore = client._inbox.length;
    const aBefore = agent._inbox.length;
    sockSend(client, { type: 'client.hello', userId: clientId, userName: '综合用户' });
    sockSend(agent, { type: 'agent.hello', agentId, agentName: '综合客服' });
    await waitForFrom(client, 'history_list', cBefore, 5000);
    await waitForFrom(agent, 'history_list', aBefore, 5000);
    // 清空 inbox，从此刻开始的事件都算"业务事件"
    clearInbox(client);
    clearInbox(agent);
  });

  // 2. 客户端发起转人工
  await check('2. 客户端转人工 → 排队', async () => {
    const cBefore = client._inbox.length;
    sockSend(client, { type: 'client.transfer_human', reason: 'normal' });
    const r = await waitForFrom(client, 'queue_accepted', cBefore, 5000);
    if (r.position !== 1) throw new Error(`位置不对 ${r.position}`);
  });

  // 3. 客服端看到队列更新（含本用户）
  await check('3. 客服端收到 queue_update 含本用户', async () => {
    // step 2 已经触发 broadcastQueue，queue_update 在 server 端是异步发出
    // 1s 内通常会到；为了不依赖绝对时间，用"全 inbox 扫 + 重试"直到 2s 超时
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const found = agent._inbox.find(
        (m) => m.t === 'queue_update' && m.e.items?.some((i) => i.clientId === clientId),
      );
      if (found) {
        // 找到了，弹出所有 queue_update 让后续 inbox 干净
        popAll(agent, 'queue_update');
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('2s 内未在 queue_update 中看到本用户');
  });

  // 4. 客服接受 → 双方收到 queue_assigned
  await check('4. 客服接受 → 双方收到 queue_assigned', async () => {
    const cBefore = client._inbox.length;
    const aBefore = agent._inbox.length;
    sockSend(agent, { type: 'agent.accept_queue', clientId });
    const cEvt = await waitForFrom(client, 'queue_assigned', cBefore, 8000);
    const aEvt = await waitForFrom(agent, 'queue_assigned', aBefore, 8000);
    if (cEvt.sessionId !== aEvt.sessionId) throw new Error('sessionId 不一致');
    sessionId = cEvt.sessionId;
  });

  // 5. 用户发 3 条消息 → 客服收到
  await check('5. 用户发 3 条消息 → 客服收到', async () => {
    for (let i = 0; i < 3; i++) {
      const parts = [{ type: 'text', content: `用户消息 #${i + 1}` }];
      const aBefore = agent._inbox.length;
      sockSend(client, { type: 'client.send', messageId: `m_${i}`, parts });
      const r = await waitForFrom(agent, 'message', aBefore, 5000);
      if (!r.message || r.message.role !== 'user') throw new Error('消息角色不对');
    }
  });

  // 6. 客服回复 2 条 → 用户收到
  await check('6. 客服回复 2 条 → 用户收到', async () => {
    for (let i = 0; i < 2; i++) {
      const parts = [{ type: 'text', content: `客服回复 #${i + 1}` }];
      const cBefore = client._inbox.length;
      sockSend(agent, { type: 'agent.send', sessionId, messageId: `a_${i}`, parts });
      const r = await waitForFrom(client, 'message', cBefore, 5000);
      if (!r.message || r.message.role !== 'agent') throw new Error('消息角色不对');
    }
  });

  // 7. 推荐话术推送
  await check('7. 用户消息后 → 客服收到 suggestion 流', async () => {
    const aBefore = agent._inbox.length;
    sockSend(client, { type: 'client.send', messageId: 'm_t', parts: [{ type: 'text', content: '我快递丢了' }] });
    const start = await waitForFrom(agent, 'suggestion_start', aBefore, 5000);
    log('agent', `收到 suggestion_start intentId=${start.intentId} category=${start.category}`);
    // 等若干 chunk
    const cBefore = agent._inbox.length;
    await new Promise((r) => setTimeout(r, 2000));
    const chunks = agent._inbox.slice(cBefore).filter((m) => m.t === 'suggestion_chunk').length;
    log('agent', `收到 ${chunks} 条 suggestion_chunk`);
  });

  // 8. 客服 use_suggestion → 客户端收到
  await check('8. 客服 use_suggestion → 客户端收到', async () => {
    // 取最近的 suggestion_start 取 intentId
    const recent = agent._inbox.filter((m) => m.t === 'suggestion_start').slice(-1)[0];
    if (!recent) throw new Error('没有可用的 suggestion');
    const intentId = recent.e.intentId;
    const cBefore = client._inbox.length;
    sockSend(agent, { type: 'agent.use_suggestion', sessionId, suggestionId: intentId });
    const r = await waitForFrom(client, 'message', cBefore, 5000);
    if (!r.message) throw new Error('客户端未收到 message');
  });

  // 9. 客服端 list_history 正常推送
  await check('9. 客服端 history_list 正常推送', async () => {
    const aBefore = agent._inbox.length;
    sockSend(agent, { type: 'agent.fetch_history' });
    const r = await waitForFrom(agent, 'history_list', aBefore, 5000);
    if (!Array.isArray(r.items)) throw new Error('items 不是数组');
    log('agent', `history_list items=${r.items.length}`);
  });

  // 9.5 用户输入中 → 客服收到 typing（必须在会话中，会话结束后 server 不会转发）
  await check('9.5 客户端 typing → 客服端收到', async () => {
    const aBefore = agent._inbox.length;
    sockSend(client, { type: 'client.typing', isTyping: true });
    const r = await waitForFrom(agent, 'typing', aBefore, 5000);
    if (r.from !== 'user' || !r.isTyping) throw new Error('typing 状态不对');
  });

  // 10. 结束会话 → 双方收到 session_ended + history_list
  await check('10. 结束会话 → 双方收到 session_ended', async () => {
    const cBefore = client._inbox.length;
    const aBefore = agent._inbox.length;
    sockSend(agent, { type: 'agent.end_session', sessionId, reason: 'agent' });
    await waitForFrom(client, 'session_ended', cBefore, 5000);
    await waitForFrom(agent, 'session_ended', aBefore, 5000);
  });

  // 11. 历史会话持久化
  await check('11. 历史会话持久化（DB 查询）', async () => {
    const aBefore = agent._inbox.length;
    sockSend(agent, { type: 'agent.fetch_history' });
    const r = await waitForFrom(agent, 'history_list', aBefore, 5000);
    const found = r.items.find((i) => i.sessionId === sessionId);
    if (!found) throw new Error('历史列表中找不到本次会话');
    if (found.messageCount < 5) throw new Error(`消息数太少: ${found.messageCount}`);
  });

  // 12. 客户端重连 → 收到 history_list
  await check('12. 客户端重连 → 收到 history_list 含本次会话', async () => {
    client.disconnect();
    await new Promise((r) => setTimeout(r, 300));
    client = await open('client', clientId);
    const cBefore = client._inbox.length;
    sockSend(client, { type: 'client.hello', userId: clientId, userName: '综合用户' });
    const r = await waitForFrom(client, 'history_list', cBefore, 5000);
    const found = r.items.find((i) => i.sessionId === sessionId);
    if (!found) throw new Error('客户端重连后历史列表里没有该会话');
  });

  // 13. 错误处理：会话结束后再发 client.send → 收到 error
  await check('13. 错误处理：未在会话中发 send → 收到 error', async () => {
    // step 10 已结束会话，step 11/12 不创建新会话，所以此步触发 not_in_session
    const cBefore = client._inbox.length;
    sockSend(client, { type: 'client.send', messageId: 'bad', parts: [{ type: 'text', content: 'x' }] });
    const r = await waitForFrom(client, 'error', cBefore, 5000);
    if (r.code !== 'not_in_session') throw new Error(`错误码不对: ${r.code}`);
  });

  client.disconnect();
  agent.disconnect();

  console.log(`\n========== 综合自测结果 ==========`);
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed}`);
  if (failed === 0) console.log(`🎉 全部通过，可放心发布\n`);
  else console.log(`⚠️ 有失败项，请检查\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
