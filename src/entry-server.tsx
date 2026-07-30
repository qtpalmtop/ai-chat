/**
 * 服务端入口（SSR - React 18 流式）
 * - 由 server/index.js 通过 vite.ssrLoadModule（dev）或直接 import（prod）调用
 * - 渲染管道：res.write(head) → pipe(React 树) → res.write(extractStyle + footer) → res.end()
 *
 * 升级点：renderToString → renderToPipeableStream（React 18 新增）
 *   - TTFB 降低：onShellReady 后立即 flush head（浏览器开始下载 script）
 *   - 流式传输：React 树边渲染边发送，无需等整页拼完
 *   - 内存更省：服务端不需要缓存完整 HTML 字符串
 *
 * 关键设计：cssinjs 样式的注入时机
 *   - antd v5 用 @ant-design/cssinjs 在渲染时填充 cache
 *   - extractStyle 必须在所有组件渲染完后才能调用
 *   - 所以 styleText 只能在 pipe 全部写完后追加到 body 末尾
 *   - 浏览器解析到 body 末尾的 <style> 时立即应用，FOUC 极短（毫秒级）
 *   - 这与"传统"在 head 注入 styleText 的方案效果一致（CSSOM 在 body 末尾 style 同样生效）
 *
 * SSR 阶段能做什么 / 不能做什么：
 *   ✓ 渲染 App 外壳（Layout / Sidebar 框架 / ChatWindow 框架 / Footer）
 *   ✓ 渲染初始状态——store 是空（无 localStorage）、hasHydrated=false
 *   ✓ 流式发送 React 树到客户端
 *   ✗ 不能读 localStorage（服务端没有）
 *   ✗ 不能建 EventSource（浏览器 API）
 *   ✗ 不能渲染真实消息（首屏数据是客户端从 localStorage 拿的）
 */

import { PassThrough } from 'node:stream';
import type { Writable } from 'node:stream';
import React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { createCache, StyleProvider, extractStyle } from '@ant-design/cssinjs';
import App from './App';

export type RenderToStreamOptions = {
  res: Writable;
  headHtml: string;
  footerHtml: string;
};

export type RenderToStreamResult = {
  promise: Promise<void>;
  abort: () => void;
};

/**
 * 启动流式 SSR，返回一个 promise + abort
 * - promise 在所有 HTML 写完后 resolve
 * - abort 会在客户端断开连接时调用，立即终止渲染节省资源
 *
 * 调用方（server/index.js）的责任：
 *   1. 准备好 headHtml（含 Vite 注入的 script）和 footerHtml
 *   2. 调用本函数拿到 result
 *   3. 不需要主动 write，本函数内部会把 head、React 流、styleText、footer 全部写完
 *   4. 客户端断开时调用 abort()
 */
export function renderToStream(opts: RenderToStreamOptions): RenderToStreamResult {
  const cache = createCache();
  const { res, headHtml, footerHtml } = opts;

  // 先写 head：浏览器立即开始解析 head、加载 script
  res.write(headHtml);

  let didError = false;
  let aborted = false;

  const { pipe, abort: reactAbort } = renderToPipeableStream(
    <StyleProvider cache={cache} hashPriority="high">
      <App />
    </StyleProvider>,
    {
      onShellReady() {
        // shell 已就绪：React 树骨架渲染完
        // pipe 已经会开始把内容推到 res，这里不需要额外动作
      },
      onAllReady() {
        // 所有 async 组件也渲染完了
        // 这里不写：pipe 的 end 事件才是真正的"全部写完"信号
      },
      onShellError(err) {
        didError = true;
        console.error('[SSR] shell error', err);
      },
      onError(err) {
        didError = true;
        console.error('[SSR] render error', err);
      },
    },
  );

  // 用 PassThrough 中转：React pipe 到 PT，PT 推到 res
  // 在 PT 'end' 触发时（React 内容全部写完）追加 styleText + footer + res.end()
  const pt = new PassThrough();
  pipe(pt);

  const promise = new Promise<void>((resolve, reject) => {
    pt.on('data', (chunk: Buffer) => {
      if (aborted) return;
      res.write(chunk);
    });
    pt.on('end', () => {
      if (aborted) return;
      try {
        // 抽取 cssinjs 样式并写 footer
        const styleText = extractStyle(cache);
        res.write(styleText);
        res.write(footerHtml);
        res.end();
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    pt.on('error', (err) => {
      reject(err);
    });
  });

  return {
    promise,
    abort: () => {
      aborted = true;
      try {
        reactAbort();
      } catch {}
      try {
        res.end();
      } catch {}
    },
  };
}
