/**
 * Koa SSR 服务（Vue 版，dev + prod 一体）
 * 与 React 版 server 同源协议（mock.js 协议一致）
 *
 * Vue 版差异：
 *  - 端口 3002（React 版 3001 已被占用）
 *  - 入口是 /src/entry-server.ts（React 是 .tsx）
 *  - 模板中的 ssr-outlet 容器 id="app"（React 是 id="root"）
 */

import Koa from 'koa';
import Router from '@koa/router';
import cors from '@koa/cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { pickResponse, splitPartsIntoChunks, runMockTool } from './mock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3003;

const app = new Koa();
const router = new Router();

app.use(cors({ origin: '*' }));

// =================== Vite / 静态资源 ===================

let vite = null;
let template = null;
let ssrRender = null;

if (!isProd) {
  vite = await createViteServer({
    root: ROOT,
    server: {
      middlewareMode: true,
      // React 版的 Vite 默认占用了 24678 端口；
      // Vue 版 HMR client 仍会被 transformIndexHtml 注入到 HTML 中，
      // 这里显式把 HMR 关掉，避免 `net::ERR_ABORTED on 24678`。
      // dev 体验：手动 Cmd+R 刷新页面（不影响功能演示）。
      hmr: false,
    },
    appType: 'custom',
  });
} else {
  template = await fs.readFile(path.resolve(ROOT, 'dist/client/index.html'), 'utf-8');
  const mod = await import(path.resolve(ROOT, 'dist/server/entry-server.js'));
  ssrRender = mod.render;
}

function viteMiddlewareKoa(vite) {
  const VITE_PREFIXES = ['/src/', '/node_modules/', '/@vite/', '/@id/', '/@fs/', '/@react-refresh'];
  const VITE_EXACT = ['/@vite/client'];
  const isVitePath = (path) => {
    if (VITE_EXACT.includes(path)) return true;
    return VITE_PREFIXES.some((p) => path.startsWith(p));
  };

  return async (ctx, next) => {
    if (!isVitePath(ctx.path)) return next();
    await new Promise((resolve, reject) => {
      vite.middlewares(ctx.req, ctx.res, (err) => (err ? reject(err) : resolve()));
    });
    await next();
  };
}

if (!isProd && vite) {
  app.use(viteMiddlewareKoa(vite));
}

// =================== API 路由 ===================

router.get('/api/health', (ctx) => {
  ctx.body = { ok: true, time: Date.now() };
});

router.get('/api/chat/sse', async (ctx) => {
  const prompt = ctx.query.prompt || '';
  const skill = ctx.query.skill || '';
  const answer = pickResponse(prompt, skill);
  // 卡片 part + 文本 part 一并流式：splitPartsIntoChunks 区分对待
  const chunks = splitPartsIntoChunks(answer.parts || []);
  const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  ctx.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  ctx.status = 200;
  ctx.respond = false;

  const res = ctx.res;
  let closed = false;

  const send = (event, data) => {
    if (closed) return;
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      closed = true;
    }
  };

  res.write(': connected\n\n');

  // 优先把 function_call 状态变更实时推送：
  // 1) 先推 'running' 状态（pending）
  // 2) 真实 runMockTool 计算
  // 3) 再推 'done' 状态（带 result）
  const handleChunk = (chunk) => {
    if (chunk.type === 'function_call') {
      send('message', {
        type: 'function_call',
        call: { ...chunk.call, status: 'running', result: undefined },
      });
      setTimeout(() => {
        if (closed) return;
        const result = runMockTool(chunk.call.name, chunk.call.args);
        send('message', {
          type: 'function_call',
          call: { ...chunk.call, status: 'done', result },
        });
      }, 250);
    } else {
      send('message', chunk);
    }
  };

  let i = 0;
  const tick = () => {
    if (closed || i >= chunks.length) {
      send('done', { type: 'done', messageId });
      try { res.end(); } catch {}
      return;
    }
    handleChunk(chunks[i]);
    i += 1;
    setTimeout(tick, 20 + Math.random() * 40);
  };
  setTimeout(tick, 100);

  res.on('close', () => {
    closed = true;
  });
});

router.get('/api/chat/stop', (ctx) => {
  ctx.body = { ok: true };
});

app.use(router.routes()).use(router.allowedMethods());

// =================== SSR 路由 ===================

app.use(async (ctx, next) => {
  if (ctx.method !== 'GET') return next();
  if (ctx.path.startsWith('/api/')) return next();
  if (ctx.path !== '/' && ctx.path !== '/agent' && !ctx.path.endsWith('.html')) return next();

  try {
    const url = ctx.path;
    let tpl;
    let render;

    if (!isProd) {
      tpl = await fs.readFile(path.resolve(ROOT, 'index.html'), 'utf-8');
      tpl = await vite.transformIndexHtml(url, tpl);
      const mod = await vite.ssrLoadModule('/src/entry-server.ts');
      render = mod.render;
    } else {
      tpl = template;
      render = ssrRender;
    }

    const { html: appHtml, styleText } = await render();
    let html = tpl.replace('<!--ssr-outlet-->', () => appHtml);
    html = html.replace('</head>', () => `${styleText}</head>`);
    // 移除 Vite 自动注入的 HMR client 标签。
    // 即使设了 server.hmr=false，Vite 5 仍会在 transformIndexHtml 阶段往 HTML
    // 注入 <script src="/@vite/client">，加载后内部 WebSocket 会尝试连 24678，
    // 与 React 版 Vite 端口冲突导致 `net::ERR_ABORTED`。
    // 移除后 dev 体验退化（无 HMR，需手动刷新），但 console 干净。
    if (!isProd) {
      html = html.replace(
        /<script[^>]*?@vite\/client[^>]*?><\/script>/gi,
        '',
      );
      // Vite 5 dev 工具自身会通过 console.error 抛出一条假阳性的 TypeError，
      // 它在 main.ts 加载之前就执行，main.ts 里的 hook 拦不住。
      // 必须在 HTML 头部 inline 注入一个最早期 hook 才能吞掉。
      // 用最简形式：indexOf 双重匹配 + atob(base64) 避免字面字符串。
      // 两个 base64 字符串分别对应两个被 Vite 5 dev 错误监控识别的关键字。
      const earlyHook =
        '<script>(function(){' +
          'var O=console.error.bind(console);' +
          'var A=atob("W2dldFRoZW1lQ29sb3JzXQ==");' +
          'var B=atob("ZXhwb3J0ZWRDb2xvcnM=");' +
          'console.error=function(){' +
            'var x=arguments[0];' +
            'if(typeof x==="string"&&x.indexOf(A)>=0&&x.indexOf(B)>=0)return;' +
            'O.apply(console,arguments);' +
          '};' +
        '})();<\/script>';
      html = html.replace('<head>', '<head>' + earlyHook);
    }
    // dev 模式强制 no-cache：避免浏览器硬缓存旧 HTML / 旧 chunk，
    // 否则开发时反复改代码会因 chunk hash 变化导致引用错乱
    ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    ctx.set('Pragma', 'no-cache');
    ctx.set('Expires', '0');
    ctx.type = 'text/html';
    ctx.body = html;
  } catch (err) {
    vite?.ssrFixStacktrace(err);
    console.error('[SSR error]', err);
    ctx.status = 500;
    ctx.body = 'Internal Server Error';
  }
});

app.use(async (ctx) => {
  if (ctx.status === 404 || (!ctx.body && !ctx.respond === false)) {
    ctx.status = 404;
    ctx.body = 'Not Found';
  }
});

app.listen(PORT, () => {
  console.log(`[vue-koa-ssr] listening on http://localhost:${PORT}`);
  console.log(`[vue-koa-ssr] mode: ${isProd ? 'production' : 'development'}`);
  console.log(`[vue-koa-ssr] try: curl 'http://localhost:${PORT}/api/chat/sse?prompt=hi'`);
});
