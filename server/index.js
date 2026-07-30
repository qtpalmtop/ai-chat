/**
 * Koa SSR 服务（dev + prod 一体）
 *
 * 路由：
 *   - GET /api/health               健康检查
 *   - GET /api/chat/sse?prompt=     SSE 流式接口
 *   - GET /api/chat/stop?id=        停止接口（占位）
 *   - GET /                          SSR 渲染（HTML 注入到模板）
 *   - GET /src/... 或 /node_modules/... 或 /@vite/...   Vite middleware（dev）
 *
 * 架构：
 *   dev 模式：Vite middlewareMode + Koa，Vite 在内存里编译 React
 *   prod 模式：预构建的 client bundle + server bundle 拼装 HTML
 *
 * 为什么用 SSR：
 *   - 首屏直出 HTML，浏览器无需等待 JS 下载/解析/执行就能看到 shell
 *   - 服务端渲染 App 外壳（Layout / Sidebar 框架 / ChatWindow 框架 / Footer）
 *   - 客户端 hydrate 接管 DOM，store 从 localStorage 拿数据填充消息
 *   - 已有 hasHydrated 状态完美兼容 SSR/CSR 状态对齐
 *
 * Vite + Koa 集成要点：
 *   - vite.middlewares 是 Connect 风格 (req, res, next)，不能直接 app.use
 *   - 必须用 Promise 包装手动调用，并保证 res 写完后再走 next
 *   - 只在 vite 资源路径上调用（/src, /node_modules, /@vite, /@id, /@fs）
 *   - 其他路径直接 next() 走到 Koa 自己的 router / SSR handler
 */

import Koa from 'koa';
import Router from '@koa/router';
import cors from '@koa/cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { pickResponse, splitIntoChunks } from './mock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3001;

const app = new Koa();
const router = new Router();

// 跨域
app.use(cors({ origin: '*' }));

// =================== Vite / 静态资源 ===================

let vite = null;
let template = null;
let ssrRender = null;

if (!isProd) {
  // dev: Vite middleware 模式（内存编译、HMR 注入）
  // hmr: false：dev 时显式关掉 HMR WebSocket，避免与 Vue 版 Vite 共享 24678 端口冲突
  //      代价：dev 时无 HMR，需手动刷新页面（不影响功能演示）
  vite = await createViteServer({
    root: ROOT,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
} else {
  // prod: 加载预构建产物
  // 客户端模板（包含 vite 注入的资源引用）
  template = await fs.readFile(path.resolve(ROOT, 'dist/client/index.html'), 'utf-8');
  // 加载预构建的服务端 bundle（导出 renderToStream 流式函数）
    const mod = await import(path.resolve(ROOT, 'dist/server/entry-server.js'));
    ssrRender = mod.renderToStream;
}

/**
 * 把 Vite 的 Connect-style 中间件手动包成 Koa 中间件
 * - 用 Promise 包装，保证 res 写完才返回
 * - 只对 Vite 资源路径生效（/src/, /node_modules/, /@vite/, /@id/, /@fs/）
 *   跳过 /api/ 等业务路径——这些路径应该走 Koa 的 router，而不是被 Vite 触碰
 *   否则 Vite 的 res 监听器（finish/close）会干扰 SSE 长连接，导致 EventSource 报 error
 */
function viteMiddlewareKoa(vite) {
  // Vite 应该处理的路径前缀
  const VITE_PREFIXES = ['/src/', '/node_modules/', '/@vite/', '/@id/', '/@fs/', '/@react-refresh'];
  const VITE_EXACT = ['/@vite/client'];

  const isVitePath = (path) => {
    if (VITE_EXACT.includes(path)) return true;
    return VITE_PREFIXES.some((p) => path.startsWith(p));
  };

  return async (ctx, next) => {
    // 业务路径完全跳过 Vite，避免 Vite 干扰 SSE / API
    if (!isVitePath(ctx.path)) {
      return next();
    }
    await new Promise((resolve, reject) => {
      vite.middlewares(ctx.req, ctx.res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    // vite.middlewares 已经自己处理了 res 写入（如果它没调用 next()）
    // 调用 next() 让 Koa 继续（但 res 已结束，Koa 会 noop）
    await next();
  };
}

// 只在 dev 模式下挂载 Vite 中间件
if (!isProd && vite) {
  app.use(viteMiddlewareKoa(vite));
}

// =================== API 路由 ===================

router.get('/api/health', (ctx) => {
  ctx.body = { ok: true, time: Date.now() };
});

router.get('/api/chat/sse', async (ctx) => {
  const prompt = ctx.query.prompt || '';
  const answer = pickResponse(prompt);
  const chunks = splitIntoChunks(answer);
  const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  // SSE 头
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

  // 初始 comment
  res.write(': connected\n\n');

  let i = 0;
  const tick = () => {
    if (closed || i >= chunks.length) {
      send('done', { type: 'done', messageId });
      try { res.end(); } catch {}
      return;
    }
    send('message', { type: 'text', content: chunks[i] });
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

// =================== SSR 路由（HTML 注入）====================

app.use(async (ctx, next) => {
  if (ctx.method !== 'GET') return next();
  if (ctx.path.startsWith('/api/')) return next();
  // 只处理 HTML 入口路径（/ 和明确的 .html），其他静态资源走 Vite/prod 静态服务
  if (ctx.path !== '/' && !ctx.path.endsWith('.html')) return next();

  try {
    const url = ctx.path;
    let tpl;
    let render;

    if (!isProd) {
      // dev: 每次都读最新模板（避免 HMR 后模板过期）
      tpl = await fs.readFile(path.resolve(ROOT, 'index.html'), 'utf-8');
      tpl = await vite.transformIndexHtml(url, tpl);
      // 动态加载 SSR 模块（Vite 编译 .tsx/.ts）
      const mod = await vite.ssrLoadModule('/src/entry-server.tsx');
      // entry-server 导出流式渲染函数 renderToStream
      render = mod.renderToStream;
    } else {
      tpl = template;
      render = ssrRender;
    }

    // 拆分 SSR 模板为 head 和 footer 两段
    // - head：<!DOCTYPE> + <html><head>...</head><body><div id="root">
    //   （含 Vite 注入的 client script / @react-refresh 等；浏览器收到 head 后立即开始下载脚本）
    // - footer：从 </div> 到 </html> 结束
    //
    // 渲染管道（与 entry-server.tsx 配合）：
    //   1. res.write(head)                       ← 立即 flush，TTFB 最低
    //   2. entry-server pipe React 树到 res       ← 流式传输，浏览器边接收边解析
    //   3. entry-server 末尾追加 styleText + footer + res.end()
    let html = tpl;
    // dev 模式：移除 Vite 自动注入的 HMR 标签（避免 24678 WebSocket 错误）
    if (!isProd) {
      html = html.replace(
        /<script[^>]*?@vite\/client[^>]*?><\/script>/gi,
        '',
      );
      html = html.replace(
        /<script[^>]*?@react-refresh[^>]*?><\/script>/gi,
        '',
      );
    }
    // 移除 SSR 占位符（React pipe 输出会完整覆盖 <div id="root"> 内部）
    html = html.replace('<!--ssr-outlet-->', '');

    const headEnd = html.indexOf('</head>');
    const rootDivStart = html.indexOf('<div id="root">');
    const rootDivEnd = html.lastIndexOf('</div>');
    if (headEnd === -1 || rootDivStart === -1 || rootDivEnd === -1) {
      throw new Error('[SSR] 模板缺少 </head> 或 <div id="root"></div>');
    }
    // head = 模板从开头到 <div id="root"> 结束（含 <head>、<body>、<div id="root">）
    const headHtml = html.slice(0, rootDivStart + '<div id="root">'.length);
    // footer = 从 </div> 到模板末尾（含 </div></body></html> + main.tsx script）
    const footerHtml = html.slice(rootDivEnd);

    // 绕开 Koa 的 ctx.body，自己接管 res 写入
    ctx.respond = false;
    const res = ctx.res;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!isProd) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    }

    const { promise, abort } = render({ res, headHtml, footerHtml });

    // 客户端断开时立即 abort 渲染，节省服务端资源
    res.on('close', () => {
      if (!res.writableEnded) {
        abort();
      }
    });

    try {
      await promise;
    } catch (err) {
      vite?.ssrFixStacktrace(err);
      console.error('[SSR error]', err);
      if (!res.writableEnded) {
        try { res.end('Internal Server Error'); } catch {}
      }
    }
  } catch (err) {
    vite?.ssrFixStacktrace(err);
    console.error('[SSR error]', err);
    ctx.status = 500;
    ctx.body = 'Internal Server Error';
  }
});

// 404 fallback
app.use(async (ctx) => {
  if (ctx.status === 404 || (!ctx.body && !ctx.respond === false)) {
    ctx.status = 404;
    ctx.body = 'Not Found';
  }
});

app.listen(PORT, () => {
  console.log(`[koa-ssr] listening on http://localhost:${PORT}`);
  console.log(`[koa-ssr] mode: ${isProd ? 'production' : 'development'}`);
  console.log(`[koa-ssr] try: curl 'http://localhost:${PORT}/api/chat/sse?prompt=hi'`);
});
