/**
 * 全局异常过滤器
 * - 把所有未捕获异常包装成标准 JSON：{ code, message, statusCode }
 * - WebSocket 场景下尽量不抛 socket 关闭，由 Gateway 转成 'error' 事件
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? (exception as HttpException).getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let code = 'INTERNAL_ERROR';
    let message = '服务器内部错误';
    if (isHttp) {
      const resp = (exception as HttpException).getResponse() as
        | string
        | { code?: string; message?: string | string[] };
      if (typeof resp === 'string') {
        message = resp;
      } else {
        code = resp.code || code;
        message = Array.isArray(resp.message)
          ? resp.message.join('; ')
          : resp.message || message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    this.logger.error(
      `${req?.method} ${req?.url} → ${status} ${code}: ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    res.status(status).json({ code, message, statusCode: status });
  }
}
