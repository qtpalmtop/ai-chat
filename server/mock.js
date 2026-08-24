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
      { type: 'markdown', content: '\n## 5. 数据图表（柱状图 + 饼图 + 雷达图）' },
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

  // 图片理解：拍照问答场景
  '图片理解': {
    parts: [
      {
        type: 'thinking',
        content: '用户上传了一张街景照片，需要识别主体、文字、场景信息。',
        durationMs: 1100,
      },
      {
        type: 'image_understanding',
        data: {
          imageUrl: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=street%20scene%20with%20people%20walking%2C%20photorealistic%2C%20sunset%2C%20urban&image_size=square',
          description: '这是一张城市街景照片，拍摄于傍晚的黄金时刻。画面中可以看到：\n\n- 主体：3 位行人正在人行道上行走，其中一位穿红色外套的女士推着购物车\n- 背景：远处有玻璃幕墙的写字楼，夕阳从右侧斜射进来\n- 文字：左侧店铺招牌上写着 "COFFEE & TEA"\n- 整体氛围：温暖、悠闲的傍晚购物时段',
          tags: ['街景', '傍晚', '城市', '行人', '夕阳', '购物'],
          followUpQuestions: [
            '这是哪个城市的街景？',
            '帮我用英文描述这张图片',
            '给这张图片写一段小红书文案',
          ],
        },
      },
      {
        type: 'suggestion',
        items: [
          '帮我写一段配图文案',
          '识别图片中的所有文字',
          '分析这张图的摄影参数',
        ],
      },
    ],
  },

  // 文件解析：PDF/Word 总结
  '文件解析': {
    parts: [
      { type: 'markdown', content: '已解析你上传的文档，下面是结构化摘要：' },
      {
        type: 'file_parsed',
        data: {
          name: '2024 年度营收分析报告.pdf',
          pages: 24,
          summary: '本文档分析了 2024 全年公司营收情况。Q1 受春节影响营收 1.2 亿；Q2 增长至 1.45 亿，主要由新产品发布驱动；Q3 达到 1.68 亿；Q4 增长至 1.92 亿，YoY 增长 51%。同时分析了各业务线占比、海外市场拓展情况。',
          keyPoints: [
            'Q4 营收 1.92 亿，同比增长 51%',
            '海外市场营收占比从 12% 提升至 23%',
            '新产品线贡献 35% 的增量营收',
            '建议 2025 Q1 重点投入：海外渠道、新产品迭代',
          ],
          durationMs: 1850,
        },
      },
      {
        type: 'suggestion',
        items: [
          '对比 2023 年同期数据',
          '把报告核心摘要翻译成英文',
          '基于这份报告生成 5 页 PPT 大纲',
        ],
      },
    ],
  },

  // 时间线：项目里程碑
  '时间线': {
    parts: [
      { type: 'markdown', content: '这是产品 V2.0 的关键里程碑时间线：' },
      {
        type: 'timeline',
        title: '产品 V2.0 关键节点',
        events: [
          { time: '2024-09', title: '需求评审', description: '完成 PRD 评审与设计稿评审', status: 'done' },
          { time: '2024-10', title: '技术方案', description: '完成架构设计与技术选型', status: 'done' },
          { time: '2024-11', title: '开发联调', description: '前后端联调、接口对齐', status: 'done' },
          { time: '2024-12', title: '内部灰度', description: '内部员工灰度测试与 Bug 修复', status: 'current' },
          { time: '2025-01', title: '正式发布', description: '对外发布 + 推广', status: 'planned' },
        ],
      },
      {
        type: 'suggestion',
        items: [
          '分析延期风险',
          '为每个节点分配负责人',
          '导出时间线为 Markdown',
        ],
      },
    ],
  },

  // 任务清单：代办计划
  '任务清单': {
    parts: [
      { type: 'markdown', content: '这是启动新项目的完整代办清单：' },
      {
        type: 'task_list',
        title: '新项目启动 10 件事',
        tasks: [
          { label: '完成商业计划书', done: true },
          { label: '注册公司主体', done: true },
          { label: '完成产品 MVP', done: true },
          { label: '组建核心团队（产品+研发+设计）', done: true },
          { label: '首轮天使融资（300 万）', done: false },
          { label: '招聘 3 名高级工程师', done: false },
          { label: '对接第一批种子用户', done: false },
          { label: '建立数据看板与指标体系', done: false },
        ],
      },
      {
        type: 'suggestion',
        items: [
          '把任务按四象限重新排序',
          '为每个任务估算工时',
          '导出任务清单为飞书多维表格',
        ],
      },
    ],
  },

  // 雷达图：多维度对比
  '雷达图': {
    parts: [
      { type: 'markdown', content: '下面用雷达图对比三款手机在 5 个维度上的表现（满分 100）：' },
      {
        type: 'chart',
        chartType: 'radar',
        title: 'iPhone 15 Pro / 华为 Mate 60 / 小米 14 Ultra 性能雷达',
        data: {
          labels: ['性能', '拍照', '续航', '屏幕', '系统流畅'],
          values: [95, 92, 88, 94, 96],
        },
      },
      { type: 'markdown', content: '\n下面是另一组数据（华为 Mate 60 Pro）：' },
      {
        type: 'chart',
        chartType: 'radar',
        title: '华为 Mate 60 Pro 性能雷达',
        data: {
          labels: ['性能', '拍照', '续航', '屏幕', '系统流畅'],
          values: [88, 90, 95, 87, 85],
        },
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
  { re: /拍照|图片理解|看图|识别图片|image|photo/, key: '图片理解' },
  { re: /文件解析|解析|pdf|word|文档/, key: '文件解析' },
  { re: /时间线|里程碑|roadmap|节点/, key: '时间线' },
  { re: /任务|代办|todo|清单|checklist/, key: '任务清单' },
  { re: /雷达|radar|多维度/, key: '雷达图' },
];

/** 决策：prompt → 返回 parts 数组（MessagePart[]）
 * skill 注入：在用户已选中的 Skill 场景下，给响应追加符合该 Skill 形态的卡片
 *   - thinking → 强制加一段思维链
 *   - web      → 强制加一组引用来源
 *   - translate→ 把 markdown 包成一个"翻译结果"code 块
 */
export function pickResponse(prompt, skill = '') {
  const p = (prompt || '').toLowerCase();
  for (const s of SCENARIOS) {
    if (s.re.test(p)) {
      return wrapBySkill(RESPONSES[s.key], skill, p);
    }
  }
  return wrapBySkill(RESPONSES.default, skill, p);
}

/** 根据 skill 注入额外卡片（仅当用户当前激活的 Skill 与该 prompt 匹配时） */
function wrapBySkill(base, skill, prompt) {
  if (!skill || !base) return base;
  const parts = [...(base.parts || [])];
  if (skill === 'thinking') {
    // 已在 prompt 中显式提到"思考/CoT"则不重复注入
    if (!/思考|think|cot|深度|推理/.test(prompt)) {
      parts.unshift({
        type: 'thinking',
        content: '用户启用了"深度思考"模式。我需要拆解问题、列出关键步骤，再给出最终答案。\n1. 识别用户意图\n2. 拆解为子问题\n3. 逐个解决\n4. 综合输出',
        durationMs: 1200,
      });
    }
  } else if (skill === 'web') {
    // 联网搜索：追加一组引用来源
    parts.push({
      type: 'citation',
      sources: [
        { index: 1, title: '2025 AI 行业趋势报告', source: 'example.com', url: 'https://example.com' },
        { index: 2, title: 'Gartner 2025 Hype Cycle', source: 'gartner.com', url: 'https://gartner.com' },
        { index: 3, title: '斯坦福 AI Index 2025', source: 'stanford.edu', url: 'https://stanford.edu' },
      ],
    });
  } else if (skill === 'translate') {
    // 翻译：把文字包成 code 块，并加建议追问
    const out = [];
    for (const p of parts) {
      if (p.type === 'markdown' || p.type === 'text') {
        out.push({ type: 'code', language: 'translation', filename: '译文', content: p.content });
      } else {
        out.push(p);
      }
    }
    out.push({
      type: 'suggestion',
      items: ['翻译得更正式一点', '换成商务口吻', '用通俗易懂的版本'],
    });
    return { ...base, parts: out };
  } else if (skill === 'analyst') {
    // 数据分析：若响应里没有 chart，自动追加一个
    if (!parts.some((p) => p.type === 'chart')) {
      parts.push({
        type: 'chart',
        chartType: 'bar',
        title: '默认分析视图',
        data: {
          labels: ['A', 'B', 'C', 'D', 'E'],
          values: [42, 67, 38, 91, 55],
          unit: '',
        },
      });
    }
  }
  return { ...base, parts };
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
