/**
 * Vite SSR 中间件
 * - 在 dev 模式：把 Vite 作为 Express middleware 运行（middlewareMode + hmr:false）
 * - 在 prod 模式：把构建好的 client bundle 作为静态资源服务
 * - 双端支持：根据路径前缀 /agent → Vue 版，其他路径 → React 版
 *
 * 关键设计：
 *   1. Vite 的 middlewares 是 Connect 风格（req, res, next），必须用 Promise 包成 Koa/Nest 风格
 *   2. SSR 渲染时把 head / footer 拆开，先 res.write(head) 再 pipe React/Vue 流，最后追加 styleText + footer
 *   3. 业务路径（/api, /socket.io）完全不进 Vite，避免干扰 SSE / WebSocket
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response, NextFunction } from 'express';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type ViteDevServer = {
  middlewares: (req: Request, res: Response, next: NextFunction) => void;
  transformIndexHtml: (url: string, html: string) => Promise<string>;
  ssrLoadModule: (mod: string) => Promise<Record<string, unknown>>;
  ssrFixStacktrace: (err: Error) => void;
};

@Injectable()
export class SsrService implements OnModuleInit {
  private readonly logger = new Logger(SsrService.name);
  private vite: ViteDevServer | null = null;
  private clientTemplate: string | null = null;
  private vueClientTemplate: string | null = null;
  private clientSsrRender: ((opts: unknown) => unknown) | null = null;
  private vueClientSsrRender: ((opts: unknown) => unknown) | null = null;
  readonly isProd: boolean;
  private readonly projectRoot: string;
  private readonly vueProjectRoot: string;

  // 路径前缀：进入 Vue 客服端
  private readonly VUE_PREFIX = '/agent';

  // Vite 应该处理的资源路径前缀（dev only）
  // 注意：保留 '/server-nest/' 与 '/vue-version/'，用于兼容某些 Vite
  // 旧版本/老 chunk 产物中出现的 `process.cwd()` 相对路径（会带 server-nest/ 前缀）
  private readonly VITE_PREFIXES = [
    '/src/',
    '/node_modules/',
    '/@vite/',
    '/@id/',
    '/@fs/',
    '/@react-refresh',
    '/server-nest/',
    '/vue-version/',
  ];
  private readonly VITE_EXACT = ['/@vite/client'];

  constructor(private readonly config: ConfigService) {
    this.isProd = config.get<boolean>('isProd')!;
    // 根项目目录 = /Users/li/Desktop/AI对话助手/（含 React src / index.html / vite.config.ts 等）
    // dev 时 __dirname = server-nest/src/modules/ssr，需要 4 层 ../
    // prod 时 __dirname = server-nest/dist/modules/ssr，需要 3 层 ../
    this.projectRoot = this.isProd
      ? path.resolve(__dirname, '..', '..', '..')
      : path.resolve(__dirname, '..', '..', '..', '..');
    this.vueProjectRoot = path.resolve(this.projectRoot, 'vue-version');
  }

  async onModuleInit() {
    if (!this.isProd) {
      // dev: 启动 Vite middleware
      // 注意：延迟 import vite 避免 dev 启动时的依赖问题
      const { createServer: createViteServer } = await import('vite');
      // React 版
      this.vite = (await createViteServer({
        root: this.projectRoot,
        server: {
          middlewareMode: true,
          hmr: false,
          watch: {
            ignored: [
              path.resolve(this.projectRoot, 'server-nest'),
              path.resolve(this.projectRoot, 'node_modules'),
              path.resolve(this.projectRoot, 'dist'),
              '**/server-nest/**',
              '**/server/*',
              '**/vue-version/server/**',
              '**/node_modules/**',
              '**/dist/**',
            ],
          },
        },
        appType: 'custom',
      })) as unknown as ViteDevServer;
      this.logger.log('[SSR] React Vite middleware ready');
    } else {
      // prod: 加载预构建模板和 SSR bundle
      try {
        this.clientTemplate = await fs.readFile(
          path.resolve(this.projectRoot, 'dist/client/index.html'),
          'utf-8',
        );
        const mod = await import(
          path.resolve(this.projectRoot, 'dist/server/entry-server.js')
        );
        this.clientSsrRender = mod.renderToStream;
        this.logger.log('[SSR] React prod bundle loaded');
      } catch (e) {
        this.logger.warn(`[SSR] React prod bundle not built yet: ${(e as Error).message}`);
      }
      try {
        this.vueClientTemplate = await fs.readFile(
          path.resolve(this.vueProjectRoot, 'dist/client/index.html'),
          'utf-8',
        );
        const mod = await import(
          path.resolve(this.vueProjectRoot, 'dist/server/entry-server.js')
        );
        this.vueClientSsrRender = mod.renderToStream;
        this.logger.log('[SSR] Vue prod bundle loaded');
      } catch (e) {
        this.logger.warn(`[SSR] Vue prod bundle not built yet: ${(e as Error).message}`);
      }
    }
  }

  isVitePath(p: string): boolean {
    if (this.VITE_EXACT.includes(p)) return true;
    return this.VITE_PREFIXES.some((pre) => p.startsWith(pre));
  }

  isSsrPath(p: string): boolean {
    return p === '/' || p === this.VUE_PREFIX || p.endsWith('.html');
  }

  isVuePath(p: string): boolean {
    return p === this.VUE_PREFIX || p.startsWith(`${this.VUE_PREFIX}/`);
  }

  /** Vite middleware（dev only） */
  async handleVite(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!this.vite) return next();
    // 兼容兜底：把 /server-nest/xxx 与 /vue-version/xxx 重写为 /xxx
    // 适用场景：浏览器加载了带有 process.cwd() 相对路径的旧 chunk
    // （例如 `/server-nest/node_modules/vite/dist/client/env.mjs`），
    // 这种路径 Vite 自身不会处理，需要在进入 Vite 之前去掉错误前缀。
    const p = req.path;
    if (p.startsWith('/server-nest/')) {
      req.url = '/' + p.slice('/server-nest/'.length);
    } else if (p.startsWith('/vue-version/')) {
      req.url = '/' + p.slice('/vue-version/'.length);
    }
    await new Promise<void>((resolve) => {
      this.vite!.middlewares(req, res, (err?: unknown) => {
        if (err) {
          this.logger.error(`[vite] ${req.path} error: ${(err as Error)?.message ?? String(err)}`);
        }
        resolve();
      });
    });
    next();
  }

  /** SSR 渲染 */
  async handleSsr(req: Request, res: Response): Promise<void> {
    const isVue = this.isVuePath(req.path);
    try {
      if (isVue) {
        await this.renderVue(req, res);
      } else {
        await this.renderReact(req, res);
      }
    } catch (err) {
      this.vite?.ssrFixStacktrace(err as Error);
      this.logger.error(`[SSR] ${req.path} failed: ${(err as Error).message}`);
      if (!res.writableEnded) {
        try {
          res.statusCode = 500;
          res.end('Internal Server Error');
        } catch {
          /* noop */
        }
      }
    }
  }

  private async renderReact(req: Request, res: Response): Promise<void> {
    const url = req.path;
    let tpl: string;
    let render: (opts: unknown) => unknown;

    if (!this.isProd) {
      tpl = await fs.readFile(path.resolve(this.projectRoot, 'index.html'), 'utf-8');
      tpl = await this.vite!.transformIndexHtml(url, tpl);
      const mod = await this.vite!.ssrLoadModule('/src/entry-server.tsx');
      render = mod.renderToStream as (opts: unknown) => unknown;
    } else {
      if (!this.clientTemplate || !this.clientSsrRender) {
        res.statusCode = 500;
        res.end('React SSR bundle not built. Run `npm run build` first.');
        return;
      }
      tpl = this.clientTemplate;
      render = this.clientSsrRender;
    }

    const html = this.prepTemplate(tpl, !this.isProd);
    const { headHtml, footerHtml } = this.splitTemplate(html);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!this.isProd) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    }
    this.streamSsr(res, render, { res, headHtml, footerHtml });
  }

  private async renderVue(req: Request, res: Response): Promise<void> {
    const url = req.path;
    let tpl: string;
    let render: (opts: unknown) => unknown = () => undefined;

    if (!this.isProd) {
      // dev 模式下 Vue 版由独立 Vite 服务（3003）处理，
      // 本服务直接重定向，避免在 3001 进程内再启一个 Vite 实例造成端口/HMR 冲突
      res.statusCode = 302;
      res.setHeader(
        'Location',
        `http://${req.headers.host?.split(':')[0] || 'localhost'}:3003${url}`,
      );
      res.end();
      return;
    }

    if (!this.vueClientTemplate || !this.vueClientSsrRender) {
      res.statusCode = 500;
      res.end('Vue SSR bundle not built. Run `cd vue-version && npm run build` first.');
      return;
    }
    tpl = this.vueClientTemplate;
    render = this.vueClientSsrRender;
    const html = this.prepTemplate(tpl, false);
    const { headHtml, footerHtml } = this.splitTemplate(html);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    this.streamSsr(res, render, { res, headHtml, footerHtml });
  }

  private prepTemplate(tpl: string, isDev: boolean): string {
    let html = tpl;
    if (isDev) {
      html = html.replace(/<script[^>]*?@vite\/client[^>]*?><\/script>/gi, '');
      html = html.replace(/<script[^>]*?@react-refresh[^>]*?><\/script>/gi, '');
    }
    html = html.replace('<!--ssr-outlet-->', '');
    return html;
  }

  private splitTemplate(html: string): { headHtml: string; footerHtml: string } {
    const rootStart = html.indexOf('<div id="root">');
    const altStart = html.indexOf('<div id="app">');
    const useStart = rootStart >= 0 ? rootStart : altStart;
    const idStr = rootStart >= 0 ? '<div id="root">' : '<div id="app">';
    if (useStart < 0) throw new Error('SSR template missing #root/#app div');
    const rootEnd = html.lastIndexOf('</div>');
    if (rootEnd < 0) throw new Error('SSR template missing closing </div>');
    return {
      headHtml: html.slice(0, useStart + idStr.length),
      footerHtml: html.slice(rootEnd),
    };
  }

  private streamSsr(
    res: Response,
    render: (opts: unknown) => unknown,
    opts: { res: Response; headHtml: string; footerHtml: string },
  ): void {
    const r = render(opts) as { promise: Promise<void>; abort: () => void };
    res.on('close', () => {
      if (!res.writableEnded) r.abort();
    });
    r.promise.catch((err) => {
      this.logger.error('[SSR] stream error', err);
      if (!res.writableEnded) {
        try {
          res.end('Internal Server Error');
        } catch {
          /* noop */
        }
      }
    });
  }

  /** PassThrough 中转（暴露供测试用） */
  passthrough() {
    return new PassThrough();
  }
}
