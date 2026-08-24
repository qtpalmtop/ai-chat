/**
 * NestJS Express 中间件：HTTP 路由分发
 * - /api/*          → NestJS Controllers
 * - /socket.io/*    → socket.io（WebSocket）
 * - /src/* 等 Vite 资源（dev）→ Vite middleware
 * - 其他 GET 路径   → SSR 渲染
 */
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { SsrService } from './ssr.service';

@Injectable()
export class HttpRoutingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(HttpRoutingMiddleware.name);

  constructor(private readonly ssr: SsrService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const p = req.path;
    // eslint-disable-next-line no-console
    console.log(`[http-route-mw] ${req.method} ${p} url=${req.url}`);
    this.logger.debug(`[route] ${req.method} ${p}`);

    // 业务 API 路径：交给 NestJS Controllers
    if (p.startsWith('/api/')) return next();

    // socket.io 路径：交给 socket.io（NestJS WebSocket 已挂载）
    if (p.startsWith('/socket.io/')) return next();

    // 健康检查也走 Controllers
    if (p === '/health') return next();

    // Vite 资源（dev only）
    if (!this.ssr.isProd && this.ssr.isVitePath(p)) {
      this.ssr.handleVite(req, res, next).catch((err) => {
        this.logger.error(`[vite] ${p} failed: ${err.message}`);
        next(err);
      });
      return;
    }

    // GET 走 SSR；其他交给 NestJS（避免吞掉）
    if (req.method === 'GET' && this.ssr.isSsrPath(p)) {
      this.ssr.handleSsr(req, res).catch((err) => {
        this.logger.error(`[ssr] ${p} failed: ${err.message}`);
        if (!res.writableEnded) next(err);
      });
      return;
    }

    next();
  }
}
