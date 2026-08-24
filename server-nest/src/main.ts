/**
 * NestJS 启动入口
 * - Express adapter
 * - 全局异常过滤器
 * - 全局 CORS
 * - 优雅关闭
 * - Vite SSR + 静态资源由 SsrService 提供，在 main 启动时通过 Express middleware 注入
 */
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { SsrService } from './modules/ssr/ssr.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const port = config.get<number>('port')!;
  const corsOrigin = config.get<string>('corsOrigin')!;
  const isProd = config.get<boolean>('isProd')!;

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: corsOrigin, credentials: true });
  app.enableShutdownHooks();

  // HTTP 路由分发：/api → Controllers；/socket.io → socket.io；其余 → SSR/Vite
  // 用 Express middleware 形式注入，避开 NestJS forRoutes('*') 的兼容性问题
  const ssr = app.get(SsrService);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (p.startsWith('/api/')) return next();
    if (p.startsWith('/socket.io/')) return next();
    if (p === '/health') return next();
    if (!ssr.isProd && ssr.isVitePath(p)) {
      ssr.handleVite(req, res, next).catch((err) => {
        next(err);
      });
      return;
    }
    if (req.method === 'GET' && ssr.isSsrPath(p)) {
      ssr.handleSsr(req, res).catch((err) => {
        if (!res.writableEnded) next(err);
      });
      return;
    }
    next();
  });

  await app.listen(port, '0.0.0.0');
  const logger = new Logger('Bootstrap');
  logger.log(`[server-nest] listening on http://localhost:${port} (${isProd ? 'prod' : 'dev'})`);
  logger.log(`[server-nest] socket.io path: /socket.io (default)`);
  logger.log(`[server-nest] health: http://localhost:${port}/api/health`);
  logger.log(`[server-nest] chat SSE: http://localhost:${port}/api/chat/sse?prompt=hi`);
  logger.log(`[server-nest] agent page: http://localhost:${port}/agent`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server-nest] bootstrap failed', err);
  process.exit(1);
});
