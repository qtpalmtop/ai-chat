/**
 * Mock 回答库（多模态 SSE 演示）
 * - 与原 server/mock.js 同协议：pickResponse → parts 数组
 * - splitPartsIntoChunks：把每个 part 切成可流式推送的最小单元（文本可继续切片）
 * - runMockTool：工具调用 mock 结果
 *
 * 生产应替换为调用 LLM
 */
import { Injectable } from '@nestjs/common';

interface MockToolResult {
  [key: string]: (args: Record<string, unknown>) => unknown;
}

const MOCK_TOOL_RESULT: MockToolResult = {
  get_weather: (args) => ({
    city: args.city || '北京',
    temperature: 22,
    condition: '晴',
    humidity: 45,
    wind: '微风',
  }),
  web_search: (args) => ({
    query: args.query,
    results: [
      {
        title: 'Vue 3 与 React 18 的对比分析',
        url: 'https://example.com/vue-vs-react',
        snippet: '本文从多个维度对比...',
      },
      {
        title: '前端框架选型指南 2026',
        url: 'https://example.com/framework-2026',
        snippet: '2026 年前端框架...',
      },
    ],
  }),
  calculate: (args) => {
    const expr = String(args.expression || '0');
    try {
      // 注意：真实生产绝对不能用 eval；这里仅 mock
      // eslint-disable-next-line no-new-func
      return { expression: expr, result: Function(`"use strict"; return (${expr});`)() };
    } catch {
      return { expression: expr, result: '无法计算' };
    }
  },
};

@Injectable()
export class ChatMockService {
  pickResponse(prompt: string, _skill: string): { parts: unknown[] } {
    const lower = (prompt || '').toLowerCase();
    if (lower.includes('weather') || lower.includes('天气')) {
      return {
        parts: [
          { type: 'thinking', content: '用户问的是天气，需要调用 get_weather 工具。', durationMs: 320 },
          { type: 'text', content: '正在为您查询天气...' },
          {
            type: 'function_call',
            call: {
              id: 'call_' + Date.now(),
              name: 'get_weather',
              args: { city: '北京' },
              status: 'pending',
            },
          },
        ],
      };
    }
    if (lower.includes('search') || lower.includes('搜索')) {
      return {
        parts: [
          { type: 'text', content: '为您搜索到以下结果：' },
          {
            type: 'function_call',
            call: {
              id: 'call_' + Date.now(),
              name: 'web_search',
              args: { query: prompt },
              status: 'pending',
            },
          },
        ],
      };
    }
    if (lower.includes('chart') || lower.includes('图表')) {
      return {
        parts: [
          { type: 'text', content: '为您生成了销售趋势图：' },
          {
            type: 'chart',
            chartType: 'bar',
            title: '2026 Q1 销售',
            data: { labels: ['1月', '2月', '3月'], values: [120, 145, 178], unit: '万' },
          },
        ],
      };
    }
    if (lower.includes('code') || lower.includes('代码')) {
      return {
        parts: [
          { type: 'text', content: '示例代码：' },
          {
            type: 'code',
            language: 'typescript',
            content: 'const greet = (name: string) => `Hello, ${name}!`;\nconsole.log(greet("NestJS"));',
            filename: 'greet.ts',
          },
        ],
      };
    }
    // 默认
    return {
      parts: [
        { type: 'text', content: `已收到您的消息："${prompt}"。这是一个 mock 回答。` },
        {
          type: 'suggestion',
          items: ['帮我查天气', '搜索 Vue 3', '生成图表', '示例代码'],
        },
      ],
    };
  }

  /** 把 parts 切成可流式推送的最小单元 */
  splitPartsIntoChunks(parts: unknown[]): unknown[] {
    const out: unknown[] = [];
    for (const part of parts as Array<{ type: string; [k: string]: unknown }>) {
      if (part.type === 'text' || part.type === 'markdown') {
        // 文本可继续切字
        const content = String(part.content || '');
        const size = 8;
        for (let i = 0; i < content.length; i += size) {
          out.push({ type: part.type, content: content.slice(i, i + size) });
        }
      } else {
        out.push(part);
      }
    }
    return out;
  }

  runMockTool(name: string, args: Record<string, unknown>): unknown {
    const fn = MOCK_TOOL_RESULT[name];
    return fn ? fn(args) : { error: 'unknown tool' };
  }
}
