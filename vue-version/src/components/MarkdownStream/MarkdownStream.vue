<script setup lang="ts">
/**
 * Markdown 流式渲染组件（Vue 版）
 * - 已闭合段（parts）逐段独立渲染，享受完整 Markdown 体验
 * - pendingText 用 ref + watch 直接写 textContent，零虚拟 DOM 开销
 * - 代码高亮用 marked + highlight.js
 *
 * 性能优化：
 *   - DoneMarkdown 用 v-memo（content 变化才重渲染）
 *   - pendingText 写 DOM 走 ref，绕过 vdom diff
 *   - 解析器（marked）只在 content 变化时调用
 */

import { ref, watch, onMounted, computed } from 'vue';
import { Marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

interface Props {
  content: string;
  pending?: string;
  streaming?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  pending: '',
  streaming: false,
});

// 每次组件实例一个 marked 实例（避免全局污染 / 重复注册 renderer）
const md = new Marked({ gfm: true, breaks: true });

// 自定义 code 渲染：包 data-lang 供 PostProcess hook 识别
md.use({
  renderer: {
    code(this: any, codeToken: any) {
      // marked 9+ 新签名：codeToken 对象
      const code = codeToken?.text ?? '';
      const lang = codeToken?.lang;
      const safe = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<pre data-lang="${lang || 'text'}"><code class="hljs language-${lang || 'text'}">${safe}</code></pre>\n`;
    },
  },
});

// PostProcess：对所有 code 块做 highlight
md.use({
  hooks: {
    postprocess(html: string) {
      return html.replace(
        /<pre data-lang="(\w+)"><code class="hljs language-\w+">([\s\S]*?)<\/code><\/pre>/g,
        (_match, lang: string, code: string) => {
          // 反转义
          const raw = code
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
          let highlighted: string;
          try {
            highlighted = lang && lang !== 'text' && hljs.getLanguage(lang)
              ? hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value
              : escapeHtml(raw);
          } catch {
            highlighted = escapeHtml(raw);
          }
          return `<pre data-lang="${lang}"><code class="hljs language-${lang}">${highlighted}</code></pre>`;
        },
      );
    },
  },
});

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const renderedHtml = computed(() => {
  if (!props.content) return '';
  return md.parse(props.content) as string;
});

/** pendingText：ref + watch 直接写 textContent，零 vdom 开销 */
const pendingRef = ref<HTMLPreElement | null>(null);
watch(
  () => props.pending,
  (val) => {
    if (pendingRef.value) pendingRef.value.textContent = val;
  },
);
onMounted(() => {
  if (pendingRef.value) pendingRef.value.textContent = props.pending;
});
</script>

<template>
  <div class="md-stream">
    <div v-if="content" class="md-stream__done" v-html="renderedHtml"></div>
    <div v-if="pending !== undefined" class="md-stream__pending">
      <pre ref="pendingRef" class="md-stream__pending-text"></pre>
    </div>
  </div>
</template>

<style scoped>
.md-stream__pending-text {
  display: inline-block;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  background-image: linear-gradient(
    to right,
    rgba(0, 0, 0, 0.85) 0%,
    rgba(0, 0, 0, 0.85) 70%,
    rgba(0, 0, 0, 0) 100%
  );
  background-repeat: repeat-y;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
</style>
