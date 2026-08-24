/**
 * 最小化测试：单步检查 accept_queue 后是否真的收到 queue_assigned
 */
import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';
const ts = () => new Date().toISOString().slice(11, 23);
const log = (r, m) => console.log(`[${ts()}] [${r}] ${m}`);

const tag = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const clientId = `u_min_${tag}`;
const agentId = `a_min_${tag}`;

const cInbox = [];
const aInbox = [];

const client = io(URL, {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  query: { role: 'client', id: clientId },
  reconnection: false,
});
const agent = io(URL, {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  query: { role: 'agent', id: agentId },
  reconnection: false,
});

for (const t of ['queue_accepted', 'queue_position', 'queue_assigned', 'queue_update', 'history_list', 'presence', 'message', 'message_ack', 'session_ended', 'suggestion_start', 'suggestion_chunk', 'error']) {
  client.on(t, (e) => { log('C', `← ${t} ${JSON.stringify(e).slice(0, 200)}`); cInbox.push({ t, e, ts: Date.now() }); });
  agent.on(t, (e) => { log('A', `← ${t} ${JSON.stringify(e).slice(0, 200)}`); aInbox.push({ t, e, ts: Date.now() }); });
}
client.on('connect', () => log('C', 'connected'));
agent.on('connect', () => log('A', 'connected'));
client.on('connect_error', (e) => log('C', `ERR ${e.message}`));
agent.on('connect_error', (e) => log('A', `ERR ${e.message}`));

await new Promise((res) => setTimeout(res, 1500));
log('X', 'sending hello');
client.emit('message', { type: 'client.hello', userId: clientId, userName: '最小用户' });
agent.emit('message', { type: 'agent.hello', agentId, agentName: '最小客服' });

await new Promise((res) => setTimeout(res, 800));
log('X', 'sending transfer_human');
client.emit('message', { type: 'client.transfer_human', reason: 'normal' });

await new Promise((res) => setTimeout(res, 800));
log('X', 'sending accept_queue');
agent.emit('message', { type: 'agent.accept_queue', clientId });

await new Promise((res) => setTimeout(res, 2000));
log('X', 'final state');
log('X', `client inbox types: ${cInbox.map(m => m.t).join(', ')}`);
log('X', `agent inbox types: ${aInbox.map(m => m.t).join(', ')}`);

client.disconnect();
agent.disconnect();
process.exit(0);
