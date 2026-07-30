/**
 * Mock 回答库
 * 根据 prompt 关键词匹配不同演示场景的 Markdown 回答
 * 真实生产中应替换为调用 LLM 服务
 */

const RESPONSES = {
  greeting: `你好呀！我是**豆包**，你的智能对话助手 🤖

我可以帮你做这些事情：

- 回答各类知识问题
- 编写和调试代码
- 总结长文本、翻译
- 创意写作、头脑风暴
- 解析图片、识别文件内容

试试问我：\`写一个 React Hook 例子\` 或者 \`用 Markdown 表格对比 Vue 与 React\`。`,

  react: `好的，下面是一个完整的 React 自定义 Hook 示例：

\`\`\`tsx
import { useEffect, useState } from 'react';

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// 使用
function Search() {
  const [keyword, setKeyword] = useState('');
  const debouncedKeyword = useDebounce(keyword, 500);
  useEffect(() => {
    if (debouncedKeyword) fetch('/api/search?q=' + debouncedKeyword);
  }, [debouncedKeyword]);
  return <input value={keyword} onChange={(e) => setKeyword(e.target.value)} />;
}
\`\`\`

要点说明：

1. 使用 \`useState\` 保留防抖后的值
2. 使用 \`useEffect\` + \`setTimeout\` 实现延迟
3. 在清理函数中清除上一次的 timer，避免内存泄漏
4. 泛型 \`<T>\` 让 Hook 支持任意类型`,

  vue: `下面从多个维度对比 Vue 和 React：

| 维度 | Vue 3 | React 18 |
|------|-------|----------|
| API 风格 | Options / Composition | Function Component |
| 响应式 | Proxy 自动追踪 | useState / useReducer |
| 模板 | SFC (.vue) + 指令 | JSX (TSX) |
| 状态管理 | Pinia / Vuex | Zustand / Redux / Jotai |
| 生态 | Vite / Nuxt | Vite / Next.js |
| 学习曲线 | 较平缓 | 较陡（JSX + Hooks 心智） |

> 选择建议：中小型项目 / 后端转前端 → Vue；复杂大型 SPA / 跨端 → React。`,

  sse: `SSE（Server-Sent Events）是一种**服务端主动推送**到浏览器的协议，基于 HTTP 长连接。

\`\`\`ts
// 服务端
app.use(async (ctx) => {
  ctx.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (data) => controller.enqueue(enc.encode(\`data: \${JSON.stringify(data)}\\n\\n\`));
      let i = 0;
      const timer = setInterval(() => {
        send({ type: 'text', content: 'chunk ' + i++ });
        if (i > 10) {
          controller.close();
          clearInterval(timer);
        }
      }, 200);
    },
  });
  ctx.body = stream;
});
\`\`\`

\`\`\`ts
// 客户端
const es = new EventSource('/api/chat/sse');
es.addEventListener('message', (e) => console.log(e.data));
es.addEventListener('done', () => es.close());
\`\`\`

相比 WebSocket：

- 单向（仅服务端 → 客户端）
- 基于 HTTP，天然支持重连
- 适合"打字机"式输出、日志推送、股票行情`,

  default: `这是一个演示回答，用来展示**Markdown 分段流式渲染**的能力。

## 渲染能力一览

### 1. 标题层级
\`# H1\` / \`## H2\` / \`## H3\` 都能正确渲染。

### 2. 代码块高亮

\`\`\`javascript
// JavaScript 示例
function fib(n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}
console.log(fib(10));
\`\`\`

\`\`\`python
# Python 示例
def quicksort(arr):
    if len(arr) <= 1: return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    mid = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + mid + quicksort(right)
\`\`\`

### 3. 表格

| 库 | 大小 | 性能 | 适用场景 |
|----|------|------|----------|
| React Markdown | 30KB | 中 | 通用 |
| Marked | 30KB | 高 | 简单场景 |
| markdown-it | 80KB | 中 | 插件丰富 |

### 4. 列表 / 引用

> 引用：流式输出时优先切分"段落（\\n\\n）"和"代码块（\`\`\`\`）"，对其它块按行聚合即可。

- 流式响应
- 增量解析
- 自动滚动

1. 建立 SSE 连接
2. 接收 chunk
3. 累积到 buffer
4. 按边界切段
5. 渲染已闭合段
6. 保留未闭合段（光标效果）`,
};

export function pickResponse(prompt) {
  const p = (prompt || '').toLowerCase();
  if (/你好|hi|hello|嗨|hey/.test(p)) return RESPONSES.greeting;
  if (/react|hook|组件/.test(p)) return RESPONSES.react;
  if (/vue|react.*对比|对比.*react/.test(p)) return RESPONSES.vue;
  if (/sse|流式|event.?source/.test(p)) return RESPONSES.sse;
  return RESPONSES.default;
}

/**
 * 将长 Markdown 文本按字符切片成"流式 chunk"
 * - 优先级：代码块（完整 ```…```）> 段落（\n\n）> 行
 * - 每个 chunk 2~6 字符，模拟真实 LLM 打字速度
 */
export function splitIntoChunks(text) {
  const chunks = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    // 在代码块边界优先切分
    if (text.startsWith('```', i)) {
      const end = text.indexOf('```', i + 3);
      if (end !== -1) {
        const blockEnd = end + 3;
        // 整块作为一个或两个 chunk 推送
        chunks.push(text.slice(i, blockEnd));
        i = blockEnd;
        continue;
      }
    }
    // 段落边界
    if (text[i] === '\n' && text[i + 1] === '\n') {
      chunks.push(text.slice(i, i + 2));
      i += 2;
      continue;
    }
    // 普通字符：每次 2~5 个
    const len = 2 + Math.floor(Math.random() * 4);
    chunks.push(text.slice(i, i + len));
    i += len;
  }
  return chunks;
}
