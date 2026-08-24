import { io } from 'socket.io-client';
const sock = io('http://localhost:3001', {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  query: { role: 'client', id: 'probe_test' },
  reconnection: true,
  reconnectionDelay: 1000,
});
sock.on('connect', () => { console.log('CONNECTED', sock.id); setTimeout(() => process.exit(0), 1500); });
sock.on('connect_error', (e) => console.log('ERR', e.message));
sock.on('disconnect', (r) => console.log('DISC', r));
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 8000);
