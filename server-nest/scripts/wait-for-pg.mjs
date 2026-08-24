/**
 * 等待 PostgreSQL 就绪
 * 用于 npm run db:up 后等 docker 容器起来
 */
import { createConnection } from 'net';

const HOST = process.env.DB_HOST || '127.0.0.1';
const PORT = Number(process.env.DB_PORT) || 5432;
const TIMEOUT_MS = 30_000;
const start = Date.now();

function tryConnect() {
  const sock = createConnection({ host: HOST, port: PORT });
  sock.setTimeout(2000);
  sock.once('connect', () => {
    sock.end();
    console.log(`[wait-for-pg] postgres ready on ${HOST}:${PORT} (${Date.now() - start}ms)`);
    process.exit(0);
  });
  sock.once('error', () => {
    sock.destroy();
    if (Date.now() - start > TIMEOUT_MS) {
      console.error(`[wait-for-pg] timeout after ${TIMEOUT_MS}ms`);
      process.exit(1);
    }
    setTimeout(tryConnect, 500);
  });
  sock.once('timeout', () => {
    sock.destroy();
    if (Date.now() - start > TIMEOUT_MS) {
      console.error(`[wait-for-pg] timeout after ${TIMEOUT_MS}ms`);
      process.exit(1);
    }
    setTimeout(tryConnect, 500);
  });
}

tryConnect();
