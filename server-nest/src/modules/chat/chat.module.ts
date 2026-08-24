/**
 * Chat SSE 模块
 * - GET /api/chat/sse?prompt=xxx&skill=yyy
 * - 流式返回 chunks（text/markdown/thinking/citation/code/...）
 * - 内置 mock 数据，与原 server/mock.js 协议兼容
 *
 * 设计要点：
 *   - 单独一个 service 提供 pickResponse / splitPartsIntoChunks / runMockTool
 *   - Controller 只负责 HTTP/SSE 协议：响应头 + res.write + 客户端断开清理
 */
import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatMockService } from './chat-mock.service';

@Module({
  controllers: [ChatController],
  providers: [ChatMockService],
  exports: [ChatMockService],
})
export class ChatModule {}
