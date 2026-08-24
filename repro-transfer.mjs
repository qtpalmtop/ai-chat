/**
 * 复现脚本：模拟前端 useAgentSocket 的实际连接行为
 *  1. agent 端连接（用 id 参数）
 *  2. client 端连接（用 id 参数）
 *  3. client 发 transfer_human
 *  4. 检查 agent 是否收到 queue_update
 */
import WebSocket from 'ws';

function open(role, id) {
  return new Promise((resolve) => {
    // 模拟前端 useAgentSocket 的 URL 格式
    const ws = new WebSocket(`ws://localhost:3002/ws?role=${role}&id=${encodeURIComponent(id)}`);
    const inbox = [];
    ws.on('open', () => {
      console.log(`[${role}] connected id=${id}`);
      resolve(ws);
    });
    ws.on('message', (raw) => {
      const env = JSON.parse(raw.toString());
      const data = env.payload || env;
      inbox.push(data);
      console.log(`[${role}] ← ${data.type}`);
    });
    ws.on('error', (e) => console.log(`[${role}] ERR ${e.message}`));
    ws._inbox = inbox;
  });
}

async function main() {
  // 模拟 agent 端：先建立连接（模拟客服打开 /agent 页面）
  const agentWs = await open('agent', 'a_repro_test');
  // 模拟 agent 发 hello
  agentWs.send(JSON.stringify({ type: 'agent.hello', agentId: 'a_repro_test', agentName: '测试客服' }));

  // 模拟 client 端：先建立连接（模拟用户打开首页）
  const clientWs = await open('client', 'u_repro_test');
  clientWs.send(JSON.stringify({ type: 'client.hello', clientId: 'u_repro_test', userName: '测试访客' }));

  // 等待 500ms 让连接稳定
  await new Promise((r) => setTimeout(r, 500));

  // 模拟 client 点击"转人工"
  console.log('\n--- client 点击转人工 ---\n');
  clientWs.send(JSON.stringify({ type: 'client.transfer_human', reason: 'normal' }));

  // 等待 1.5s
  await new Promise((r) => setTimeout(r, 1500));

  // 检查 agent 是否收到 queue_update
  const updates = agentWs._inbox.filter((m) => m.type === 'queue_update');
  console.log(`\n=== 结果：agent 收到 ${updates.length} 次 queue_update ===`);
  updates.forEach((u, i) => {
    console.log(`  [${i}] items.length = ${u.items?.length || 0}`);
    u.items?.forEach((it) => console.log(`      clientId=${it.clientId}, userName=${it.userName}`));
  });

  // 关闭
  agentWs.close();
  clientWs.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
