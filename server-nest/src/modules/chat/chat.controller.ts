/**
 * SSE Controller：流式返回 chat 响应
 * - 协议：event: message / data: {...} / event: done / data: {...}
 * - 客户端 EventSource 监听
 * - 客户端断开时停止 tick（节省服务端资源）
 */
import { Controller, DefaultValuePipe, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ChatMockService } from './chat-mock.service';
import { newId } from '../../common/utils/id.util';

@Controller('api/chat')
export class ChatController {
  constructor(private readonly mock: ChatMockService) {}

  @Get('sse')
  sse(
    @Query('prompt', new DefaultValuePipe('')) prompt: string,
    @Query('skill', new DefaultValuePipe('')) skill: string,
    @Res() res: Response,
  ): void {
    const answer = this.mock.pickResponse(prompt || '', skill || '');
    const chunks = this.mock.splitPartsIntoChunks(answer.parts || []);
    const messageId = newId('msg');

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.status(200);
    res.flushHeaders?.();

    let closed = false;
    const send = (event: string, data: unknown) => {
      if (closed) return;
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
      }
    };

    // 初始 comment 让 EventSource 立即拿到连接
    res.write(': connected\n\n');

    const handleChunk = (chunk: { type: string; [k: string]: unknown }) => {
      if (chunk.type === 'function_call') {
        // pending
        send('message', {
          type: 'function_call',
          call: { ...(chunk.call as Record<string, unknown>), status: 'running', result: undefined },
        });
        setTimeout(() => {
          if (closed) return;
          const call = chunk.call as { name: string; args: Record<string, unknown> };
          const result = this.mock.runMockTool(call.name, call.args);
          send('message', {
            type: 'function_call',
            call: { ...(chunk.call as Record<string, unknown>), status: 'done', result },
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
        try {
          res.end();
        } catch {
          /* noop */
        }
        return;
      }
      handleChunk(chunks[i] as { type: string; [k: string]: unknown });
      i += 1;
      setTimeout(tick, 20 + Math.random() * 40);
    };
    setTimeout(tick, 100);

    res.on('close', () => {
      closed = true;
    });
  }

  @Get('stop')
  stop(): { ok: true } {
    return { ok: true };
  }
}
