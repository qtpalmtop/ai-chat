# 豆包 AI 助手 · Vue 3 版本

> Vue 3 + Pinia + Vite 复刻版，保留 React 版本（`/Users/li/Desktop/AI对话助手/`）。
> 与 React 版功能 1:1 对齐：SSE 流式 + Markdown 分段渲染 + 虚拟列表 + SSR + 滚动策略 + 打字机渐隐尾段。

## 启动

```bash
cd /Users/li/Desktop/AI对话助手/vue-version
npm install
npm run dev                # 端口 3002（React 版用 3001）
```

打开 `http://localhost:3002`。

```bash
npm run build              # 双产物构建
npm start                  # 生产模式启动
npm run check              # vue-tsc 类型检查
```

## 目录结构

```text
vue-version/
├── server/                     # 与 React 版同源协议（mock.js 可直接复用）
│   ├── index.js                # Koa + Vite middleware + SSR + SSE
│   └── mock.js                 # 5 套演示回答 + 切片
├── src/
│   ├── App.vue                 # 根组件
│   ├── main.ts                 # 客户端入口
│   ├── entry-server.ts         # SSR 入口
│   ├── style.css               # 全局样式（与 React 版完全对齐）
│   ├── types/message.ts        # 消息/SSE 协议类型
│   ├── utils/markdown.ts       # 分段器（与 React 版 1:1）
│   ├── stores/
│   │   ├── chatStore.ts        # Pinia store（对应 Zustand chatStore）
│   │   └── pinia.ts            # Pinia 创建（含 SSR 安全处理）
│   ├── composables/
│   │   └── useChat.ts          # EventSource 生命周期（对应 useChat hook）
│   └── components/
│       ├── ChatWindow/         # 主对话区
│       ├── Sidebar/            # 会话列表（虚拟列表）
│       ├── InputPanel/         # 多模态输入
│       ├── MessageItem/        # 消息气泡
│       ├── MessageVirtualList/ # 变高虚拟列表 + sticky 切换
│       ├── MarkdownStream/     # 分段渲染 + 打字机渐隐尾段
│       └── VirtualList/        # 固定行高虚拟列表 + MeasuredItem
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## 架构对比：React vs Vue

| 维度 | React 版 | Vue 版 |
|---|---|---|
| **状态管理** | Zustand 4（hooks + set）| Pinia 3（Composition API + 响应式） |
| **状态访问** | `useChatStore((s) => s.x)` | `storeToRefs(store)` 保持引用稳定 |
| **副作用** | useEffect / useLayoutEffect | watch / watchEffect / onMounted / nextTick |
| **组件缓存** | React.memo + useMemo + useCallback | v-memo + computed + 模板表达式 |
| **类组件 key 重建** | `key={sessionId}` 强制重建 | `:key` + 条件 v-if |
| **强制同步** | useLayoutEffect | nextTick（仅在 watch 回调中）|
| **持久化** | Zustand persist 中间件 | pinia-plugin-persistedstate |
| **UI 库** | Antd v5（css-in-js）| ant-design-vue 4 |
| **Markdown 渲染** | react-markdown + rehype | marked + highlight.js |
| **Markdown 组件** | JSX：`<DoneMarkdown>` 包装 | SFC：`<MarkdownStream>` |
| **ref 写 DOM** | useRef + useLayoutEffect textContent | ref + watch → textContent |
| **模板语法** | JSX（TSX）| SFC `<template>` |
| **SSE 客户端** | EventSource（相同）| EventSource（相同）|
| **SSR 渲染** | renderToString + hydrateRoot | renderToString + createSSRApp + hydrate |
| **CSS-in-JS 抽取** | createCache + StyleProvider + extractStyle | 不需要（antd-vue v4 客户端注入）|

## 关键不变量（与 React 版一致）

```text
□ 流式状态：message.status === 'streaming'，不维护全局 id
□ abortMap：module-scope（不是 ref），按 sessionId 索引
□ InputPanel：:key="currentSession.id"，切会话时整体重建
□ hasHydrated：hydration 前返回稳定空数组
□ isAtBottom：ref + state 双重
□ userScrolledUpRef：用户上滑意图，自动跟随 effect 早退
□ scrollTop clamp：用 clamp 后的值写 dataset
□ 自动跟随 deps：只跟踪流式内容变化
□ 虚拟列表：流式中 item 独立高度，sticky/static 模式切换
□ 分段器表格兜底：matchParagraph 不切 table header+separator
```

## Vue 3 特有的实现技巧

### 1. storeToRefs 保持 store 状态引用稳定

```ts
const { currentMessages, currentSession, hasHydrated } = storeToRefs(store);
// 返回的 ref 在 store 状态不变时不会触发组件重渲染
```

### 2. computed 派生（替代 useMemo）

```ts
const aiMarkdown = computed(() => {
  return props.message.parts
    .filter(p => p.type === 'markdown')
    .map(p => p.content)
    .join('\n\n');
});
```

### 3. v-memo 控制单 item 重渲染

```vue
<template v-for="item in items" :key="item.id" v-memo="[item, remountKey]">
  <div>{{ item.title }}</div>
</template>
```

### 4. watch + nextTick 替代 useLayoutEffect

```ts
// React: useLayoutEffect(() => { el.scrollTop = el.scrollHeight }, [key])
watch(
  () => props.scrollToBottomKey,
  () => {
    nextTick(() => {
      const el = scrollerRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  },
);
```

### 5. watchEffect 自动追踪依赖

```ts
// 自动收集 streamingItem.id / pendingText / parts.length 依赖
// deps 变化时执行 nextTick scrollTo
watchEffect(() => {
  const sid = (props.streamingItem as any)?.id;
  void sid;  // 显式访问触发依赖收集
  if (!props.streamingItem) return;
  // ...
});
```

### 6. pinia 安全处理 SSR 端 window 引用

```ts
// stores/pinia.ts
export function setupPinia() {
  const pinia = createPinia();
  if (typeof window !== 'undefined') {
    pinia.use(piniaPluginPersistedstate);
  }
  return pinia;
}
```

## 常见问题

### Q: 为什么 Vue 版不抽 cssinjs？
A: antd-vue v4 的 css-in-js 在客户端运行时自动注入，不在服务端生成。React 版 antd v5 通过 createCache + StyleProvider 抽取是因为 v5 的 css-in-js 设计就是 SSR 友好的。

### Q: 为什么 marked + highlight.js 不用 vue 生态的库？
A: marked 是最轻量的 Markdown 解析器（30KB），没有 React/Vue 强绑定。react-markdown 是 React-only。marked 配合自研的 postProcess hook 灵活度最高。

### Q: 服务端能共享吗？
A: server/index.js 是 React 协议的独立服务，Vue 版复制了一份。两者协议完全一致（`/api/chat/sse` 协议相同），未来可以把 server 抽到独立 npm 包。

### Q: 性能对比？
A: 框架层差异很小。Vue 3 在响应式追踪上有天然优势（细粒度依赖），React 在 memo 边界明确时更可控。整体体验接近，benchmark 几乎无差异。

## 启动验证

```bash
# 1. 启动
npm run dev

# 2. 验证 SSR
curl -sS http://localhost:3002/ | head -30
# 应该看到完整 DOM：sidebar、welcome、input-panel

# 3. 验证 SSE
curl -sN --max-time 4 "http://localhost:3002/api/chat/sse?prompt=react" | head
# 应该看到 : connected + event: message 流式返回

# 4. 类型检查
npm run check
# 应该 0 错误

# 5. 浏览器打开
open http://localhost:3002
```

## 已知问题

- 浏览器自动化环境（TRAE preload script）与 hydration 兼容性需手工验证
- 暂未接入真实 LLM（与 React 版一样是 mock 数据）

## 后续可优化

- [ ] 用 `useEventListener`（@vueuse/core）替换 onMounted + addEventListener
- [ ] 用 `shallowRef` 优化大对象渲染性能
- [ ] 用 v-lazy-show / v-intersect 实现真正的按需渲染
- [ ] 接入真实 LLM（OpenAI / Claude / 自研）
- [ ] 拆分 server 到独立 package，React/Vue 共用

## 维护者

项目组 · 2026-07
