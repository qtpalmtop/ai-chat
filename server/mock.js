/**
 * Mock 回答库（多模态 SSE 演示）
 *
 * pickResponse(prompt) 现在返回一个 parts 数组（不是单个 Markdown 字符串）：
 *   - 演示各种 MessagePart 的真实组合方式
 *   - 对齐豆包的"一条回答里包含 思维链 + 引用 + 代码块 + 图表 + 追问 + 工具调用 + 对比卡"
 *   - 服务端 SSE 依次推 type=thinking/citation/code/chart/suggestion/function_call/comparison
 *     以及中间夹杂的 text/markdown 字符流，客户端按顺序 appendPart 即可
 *
 * 真实生产中应替换为调用 LLM 服务
 */

/** 工具调用 mock 结果：根据工具名返回固定输出 */
const MOCK_TOOL_RESULT = {
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
      { title: 'Vue 3 与 React 18 的对比分析', url: 'https://example.com/vue-vs-react', snippet: '本文从多个维度对比...' },
      { title: '前端框架选型指南 2026', url: 'https://example.com/framework-2026', snippet: '2026 年前端框架...' },
    ],
  }),
  calculate: (args) => {
    const expr = String(args.expression || '0');
    try {
      // 注意：仅作演示，真实场景不应 eval
      // eslint-disable-next-line no-new-func
      return { result: Function('"use strict";return (' + expr + ')')() };
    } catch {
      return { error: 'invalid expression' };
    }
  },
};

const RESPONSES = {
  // 简单场景：仅一段 Markdown
  greeting: {
    parts: [
      { type: 'markdown', content: '你好呀！我是**豆包**，你的智能对话助手 🤖\n\n我可以帮你做这些事情：\n\n- 回答各类知识问题\n- 编写和调试代码\n- 总结长文本、翻译\n- 创意写作、头脑风暴\n- 解析图片、识别文件内容\n\n试试问我：`写一个 React Hook 例子` 或者 `用 Markdown 表格对比 Vue 与 React`（带图表那种）。' },
    ],
  },

  // React Hook 示例 + 独立代码块卡片
  react: {
    parts: [
      { type: 'markdown', content: '好的，下面是一个完整的 React 自定义 Hook 示例（可独立运行的代码块卡片）：' },
      {
        type: 'code',
        language: 'tsx',
        filename: 'useDebounce.ts',
        content: "import { useEffect, useState } from 'react';\n\nfunction useDebounce<T>(value: T, delay = 300): T {\n  const [debounced, setDebounced] = useState(value);\n  useEffect(() => {\n    const timer = setTimeout(() => setDebounced(value), delay);\n    return () => clearTimeout(timer);\n  }, [value, delay]);\n  return debounced;\n}",
      },
      { type: 'markdown', content: '### 要点说明\n\n1. 使用 `useState` 保留防抖后的值\n2. 使用 `useEffect` + `setTimeout` 实现延迟\n3. 在清理函数中清除上一次的 timer，避免内存泄漏\n4. 泛型 `<T>` 让 Hook 支持任意类型' },
    ],
  },

  // Vue vs React：表格 + 引用来源 + 对比卡
  vue: {
    parts: [
      { type: 'markdown', content: '下面从多个维度对比 Vue 和 React：' },
      {
        type: 'comparison',
        title: 'Vue 3 vs React 18 关键差异',
        items: [
          { icon: '⚡', name: '响应式系统', value: 'Proxy 自动追踪', description: 'Vue 3 优势：心智负担更小' },
          { icon: '🧩', name: '组件 API', value: 'Function / Hooks', description: 'React 心智更彻底', highlight: true },
          { icon: '📦', name: '状态管理', value: 'Pinia / Zustand', description: '两者都有优秀方案' },
          { icon: '🛠', name: '生态', value: 'Vite / Nuxt / Next', description: '构建工具已统一' },
        ],
      },
      { type: 'markdown', content: '\n**文字版对比**\n\n| 维度 | Vue 3 | React 18 |\n|------|-------|----------|\n| API 风格 | Options / Composition | Function Component |\n| 响应式 | Proxy 自动追踪 | useState / useReducer |\n| 模板 | SFC (.vue) + 指令 | JSX (TSX) |\n| 状态管理 | Pinia / Vuex | Zustand / Redux / Jotai |\n| 学习曲线 | 较平缓 | 较陡（JSX + Hooks 心智） |' },
      {
        type: 'citation',
        sources: [
          { index: 1, title: '2026 前端框架选型白皮书', source: 'blog.example.com', url: 'https://example.com/whitepaper-2026' },
          { index: 2, title: 'Vue 3 官方文档 - 响应式原理', source: 'vuejs.org', url: 'https://vuejs.org/guide/reactivity' },
          { index: 3, title: 'React 18 新特性详解', source: 'react.dev', url: 'https://react.dev/blog/2024/04/25/react-19' },
        ],
      },
      {
        type: 'suggestion',
        items: [
          'Vue 3 的 Composition API 和 React Hooks 在心智上有什么主要差异？',
          '推荐一个适合初创公司的前端技术栈',
          'Pinia 和 Zustand 在性能上有什么区别？',
        ],
      },
    ],
  },

  // SSE 原理：代码 + 推荐追问
  sse: {
    parts: [
      { type: 'markdown', content: 'SSE（Server-Sent Events）是一种**服务端主动推送**到浏览器的协议，基于 HTTP 长连接。' },
      {
        type: 'code',
        language: 'ts',
        filename: 'sse-server.ts',
        content: "import Koa from 'koa';\n\napp.use(async (ctx) => {\n  ctx.set({\n    'Content-Type': 'text/event-stream',\n    'Cache-Control': 'no-cache',\n    'Connection': 'keep-alive',\n  });\n  const stream = new ReadableStream({\n    start(controller) {\n      const enc = new TextEncoder();\n      const send = (data) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\\n\\n`));\n      let i = 0;\n      const timer = setInterval(() => {\n        send({ type: 'text', content: 'chunk ' + i++ });\n        if (i > 10) {\n          controller.close();\n          clearInterval(timer);\n        }\n      }, 200);\n    },\n  });\n  ctx.body = stream;\n});",
      },
      {
        type: 'code',
        language: 'ts',
        filename: 'sse-client.ts',
        content: "const es = new EventSource('/api/chat/sse');\nes.addEventListener('message', (e) => console.log(e.data));\nes.addEventListener('done', () => es.close());",
      },
      { type: 'markdown', content: '\n相比 WebSocket：\n\n- 单向（仅服务端 → 客户端）\n- 基于 HTTP，天然支持重连\n- 适合"打字机"式输出、日志推送、股票行情' },
      {
        type: 'suggestion',
        items: ['SSE 如何断线重连？', 'SSE 和 WebSocket 选哪个？', '用 SSE 推送日志的注意事项'],
      },
    ],
  },

  // 思维链 + 工具调用 + 图表：深度思考场景
  think: {
    parts: [
      {
        type: 'thinking',
        content: '用户问"用图表展示 2024 年 Q1~Q4 公司营收趋势"。\n我需要：\n1. 先构造合理的示例数据（Q1: 120, Q2: 145, Q3: 168, Q4: 192 万）\n2. 选择合适的图表类型——折线图最能体现"趋势"\n3. 配合工具调用查询真实数据（演示用 mock）\n4. 给出结论 + 推荐追问',
        durationMs: 1850,
      },
      {
        type: 'function_call',
        call: {
          id: 'fc_001',
          name: 'web_search',
          args: { query: '某公司 2024 年 Q1 Q2 Q3 Q4 营收' },
          result: { query: '某公司 2024 年 Q1 Q2 Q3 Q4 营收', results: [{ title: '2024 财报', url: '#', snippet: 'Q1 120 / Q2 145 / Q3 168 / Q4 192' }] },
          status: 'done',
        },
      },
      { type: 'markdown', content: '根据查询结果，2024 全年营收呈持续增长态势，下面用折线图展示：' },
      {
        type: 'chart',
        chartType: 'line',
        title: '2024 年季度营收（万元）',
        data: { labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [120, 145, 168, 192], unit: '万' },
      },
      { type: 'markdown', content: '\n**关键洞察**：\n\n- Q2 较 Q1 增长 **20.8%**\n- Q3 较 Q2 增长 **15.9%**\n- Q4 较 Q3 增长 **14.3%**\n- 全年同比增长 **约 51%**' },
      {
        type: 'suggestion',
        items: ['分析增长放缓的可能原因', '对比 2023 年同期数据', '给出 2025 年 Q1 的预测'],
      },
    ],
  },

  // 工具调用场景：天气
  weather: {
    parts: [
      { type: 'markdown', content: '好的，我帮你查一下北京今天的天气：' },
      {
        type: 'function_call',
        call: {
          id: 'fc_002',
          name: 'get_weather',
          args: { city: '北京' },
          result: { city: '北京', temperature: 22, condition: '晴', humidity: 45, wind: '微风' },
          status: 'done',
        },
      },
      { type: 'markdown', content: '\n北京当前天气 **晴**，气温 **22℃**，湿度 45%，微风。适合户外活动 ☀️' },
      {
        type: 'suggestion',
        items: ['明天北京会下雨吗？', '上海今天天气', '推荐北京周末游玩路线'],
      },
    ],
  },

  // 图表场景：饼图/柱状图/对比卡
  chart: {
    parts: [
      { type: 'markdown', content: '下面是本周各品类销售占比的饼图：' },
      {
        type: 'chart',
        chartType: 'pie',
        title: '本周销售占比',
        data: { labels: ['服饰', '美妆', '数码', '食品', '其他'], values: [320, 240, 410, 180, 90], unit: ' 单' },
      },
      { type: 'markdown', content: '\n下面是各品类近 5 天销量的柱状图：' },
      {
        type: 'chart',
        chartType: 'bar',
        title: '近 5 天品类销量',
        data: { labels: ['服饰', '美妆', '数码', '食品', '其他'], values: [320, 240, 410, 180, 90] },
      },
    ],
  },

  // 复杂对比：手机对比卡
  phone: {
    parts: [
      {
        type: 'markdown',
        content: '为你对比三款主流旗舰手机的关键参数：',
      },
      {
        type: 'comparison',
        title: '三款旗舰手机对比',
        items: [
          { icon: '📱', name: 'iPhone 15 Pro', value: '¥8999 起', description: 'A17 Pro · 8GB · 钛合金', highlight: true },
          { icon: '📱', name: '华为 Mate 60 Pro', value: '¥6999 起', description: '麒麟 9000S · 12GB · 鸿蒙' },
          { icon: '📱', name: '小米 14 Ultra', value: '¥6499 起', description: '骁龙 8 Gen 3 · 16GB · 徕卡' },
        ],
      },
      {
        type: 'suggestion',
        items: ['拍照效果对比', '游戏性能跑分', '续航和充电速度'],
      },
    ],
  },

  // 默认：完整 demo
  default: {
    parts: [
      { type: 'markdown', content: '这是一个**多卡片**演示回答。我会在一条消息里同时展示：\n\n1. 思维链（CoT）\n2. 引用来源\n3. 独立代码块\n4. 数据图表\n5. 工具调用卡片\n6. 推荐追问\n7. 对比卡\n\n下面用示例数据让你快速看到效果：' },
      {
        type: 'thinking',
        content: '用户问的是"演示回答"，最佳策略是把所有扩展卡片都展示一遍，让她理解消息协议的能力。',
        durationMs: 920,
      },
      { type: 'markdown', content: '\n## 1. 标题 / 列表 / 引用' },
      { type: 'markdown', content: '- 流式响应\n- 增量解析\n- 自动滚动\n- 多卡片组合' },
      { type: 'markdown', content: '> 引用：流式输出时优先切分"段落（\\\\n\\\\n）"和"代码块（\\`\\`\\`\\`）"，对其它块按行聚合即可。' },
      { type: 'markdown', content: '\n## 2. 表格' },
      { type: 'markdown', content: '| 库 | 大小 | 性能 | 适用场景 |\n|----|------|------|----------|\n| React Markdown | 30KB | 中 | 通用 |\n| Marked | 30KB | 高 | 简单场景 |\n| markdown-it | 80KB | 中 | 插件丰富 |' },
      { type: 'markdown', content: '\n## 3. 独立代码块卡片（深色 + 复制按钮）' },
      {
        type: 'code',
        language: 'ts',
        filename: 'example.ts',
        content: "function fib(n: number): number {\n  if (n < 2) return n;\n  return fib(n - 1) + fib(n - 2);\n}\nconsole.log(fib(10));",
      },
      { type: 'markdown', content: '\n## 4. 引用来源' },
      {
        type: 'citation',
        sources: [
          { index: 1, title: 'Anthropic Function Calling 协议', source: 'docs.anthropic.com', url: '#' },
          { index: 2, title: 'OpenAI Tools 规范', source: 'platform.openai.com', url: '#' },
        ],
      },
      { type: 'markdown', content: '\n## 5. 数据图表（柱状图 + 饼图）' },
      {
        type: 'chart',
        chartType: 'bar',
        title: '近 4 周用户活跃度',
        data: { labels: ['W1', 'W2', 'W3', 'W4'], values: [1200, 1580, 1820, 2100], unit: ' 人' },
      },
      { type: 'markdown', content: '\n## 6. 工具调用（Function Call）' },
      {
        type: 'function_call',
        call: {
          id: 'fc_demo',
          name: 'web_search',
          args: { query: 'AI 对话前端最佳实践' },
          result: { results: [{ title: 'Best Practices for AI Chat UI', url: '#', snippet: '...' }] },
          status: 'done',
        },
      },
      { type: 'markdown', content: '\n## 7. 对比卡' },
      {
        type: 'comparison',
        title: '技术栈选型',
        items: [
          { icon: '⚛️', name: 'React', value: '生态最全', description: '适合复杂 SPA', highlight: true },
          { icon: '🟢', name: 'Vue', value: '学习曲线平缓', description: '适合中小型项目' },
          { icon: '🧡', name: 'Svelte', value: '编译时优化', description: '运行时最轻' },
        ],
      },
      { type: 'markdown', content: '\n## 8. 推荐追问' },
      {
        type: 'suggestion',
        items: [
          '如何实现 SSE 自动重连？',
          'Function Call 和 MCP 的区别？',
          '用 Vite + React 做 SSR 的最佳实践',
        ],
      },
    ],
  },
};

/** 关键词 → 场景映射 */
const SCENARIOS = [
  { re: /你好|hi|hello|嗨|hey/, key: 'greeting' },
  { re: /react|hook|组件/, key: 'react' },
  { re: /vue|react.*对比|对比.*react/, key: 'vue' },
  { re: /sse|流式|event.?source/, key: 'sse' },
  { re: /思维|思考|think|推理|cot|深度/, key: 'think' },
  { re: /天气|weather|温度/, key: 'weather' },
  { re: /图表|chart|可视化|占比|销量|营收|销售/, key: 'chart' },
  { re: /手机|iphone|华为|小米|对比|选哪款|旗舰/, key: 'phone' },
];

/** 决策：prompt → 返回 parts 数组（MessagePart[]） */
export function pickResponse(prompt) {
  const p = (prompt || '').toLowerCase();
  for (const s of SCENARIOS) {
    if (s.re.test(p)) return RESPONSES[s.key];
  }
  return RESPONSES.default;
}

/** 兼容旧调用：parts → 单段 markdown 字符串（用于拆分 chunk 推送） */
export function partsToMarkdown(parts) {
  return parts
    .map((p) => (p.type === 'markdown' || p.type === 'text' ? p.content : ''))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 把 parts 序列化成"流式 chunk"序列：
 *   - markdown / text part：按段落或代码块切分为小 chunk
 *   - 其他 part：作为一个完整 chunk 推一次（type 与 part.type 一一对应）
 *
 * 每个 chunk 最终序列化为 SSE 事件：
 *   - 文本 → { type: 'text', content: chunk }
 *   - 卡片 → { type: part.type, ...part 自身字段 }
 */
export function splitPartsIntoChunks(parts) {
  const chunks = [];
  for (const part of parts) {
    if (part.type === 'markdown' || part.type === 'text') {
      const text = part.content;
      let i = 0;
      const n = text.length;
      while (i < n) {
        // 代码块优先整段推
        if (text.startsWith('```', i)) {
          const end = text.indexOf('```', i + 3);
          if (end !== -1) {
            chunks.push({ type: 'text', content: text.slice(i, end + 3) });
            i = end + 3;
            continue;
          }
        }
        // 段落边界
        if (text[i] === '\n' && text[i + 1] === '\n') {
          chunks.push({ type: 'text', content: text.slice(i, i + 2) });
          i += 2;
          continue;
        }
        const len = 2 + Math.floor(Math.random() * 4);
        chunks.push({ type: 'text', content: text.slice(i, i + len) });
        i += len;
      }
    } else {
      // 整张卡片作为单个 chunk（携带 type 字段和 part 其余字段）
      const { type, ...rest } = part;
      chunks.push({ type, ...rest });
    }
  }
  return chunks;
}

/**
 * 旧 API 兼容：splitIntoChunks 仍然导出
 * - 旧版 mock.js 是按"返回 Markdown 字符串"切分
 * - 新版按"返回 parts 数组"切分，但保留旧函数签名供潜在调用方使用
 */
export function splitIntoChunks(text) {
  const parts = [{ type: 'markdown', content: text }];
  return splitPartsIntoChunks(parts);
}

/** 暴露工具 mock 结果（供 server 路由计算 function_call 实际结果） */
export function runMockTool(name, args) {
  const fn = MOCK_TOOL_RESULT[name];
  if (fn) return fn(args);
  return { error: `unknown tool: ${name}` };
}
