/**
 * 业务异常类
 * - 用于 service 层主动抛错，由 AllExceptionsFilter 统一格式化
 * - error code 与前端 ws 协议里的 { type: 'error', code } 一致
 */
import { HttpException, HttpStatus } from '@nestjs/common';

export class BusinessException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message, statusCode: status }, status);
  }
}
