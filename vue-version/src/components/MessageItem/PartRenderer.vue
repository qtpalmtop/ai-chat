<script setup lang="ts">
/**
 * PartRenderer - 渲染单条 part
 * - 基础类型：text / markdown / rich / image / file
 * - 高阶卡片（对齐豆包）：thinking / citation / code / chart / suggestion / function_call / comparison
 */

import { ref, computed } from 'vue';
import { Tag, Image as AntdImage } from 'ant-design-vue';
import {
  FileOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  CaretRightOutlined,
  LinkOutlined,
  GlobalOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  ThunderboltOutlined,
  CodeOutlined,
  PlayCircleOutlined,
  ExperimentOutlined,
} from '@ant-design/icons-vue';
import type { MessagePart } from '@/types/message';

interface Props {
  part: MessagePart;
  onSuggestionPick?: (s: string) => void;
}

const props = defineProps<Props>();

function formatSize(size: number) {
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / 1024 / 1024).toFixed(2) + ' MB';
}

const fileIcon = computed(() => {
  if (props.part.type !== 'file') return null;
  const ext = props.part.name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return FileImageOutlined;
  if (ext === 'pdf') return FilePdfOutlined;
  if (['txt', 'md', 'doc', 'docx'].includes(ext)) return FileTextOutlined;
  return FileOutlined;
});

// ============== 思维链 ==============
const thinkingOpen = ref(false);
function toggleThinking() {
  thinkingOpen.value = !thinkingOpen.value;
}

// ============== 代码块 ==============
const codeCopied = ref(false);
async function copyCode(content: string) {
  try {
    await navigator.clipboard.writeText(content);
    codeCopied.value = true;
    setTimeout(() => (codeCopied.value = false), 1500);
  } catch {
    // 静默失败
  }
}

// ============== 工具调用 ==============
const fcOpen = ref(true);
function toggleFc() {
  fcOpen.value = !fcOpen.value;
}
const fcStatusText: Record<string, string> = {
  pending: '等待执行',
  running: '执行中',
  done: '已完成',
  error: '执行失败',
};
const fcStatusIcon = (status: string) => {
  if (status === 'pending') return 'part-fc__dot';
  if (status === 'running') return LoadingOutlined;
  if (status === 'done') return CheckCircleFilled;
  if (status === 'error') return CloseCircleFilled;
  return null;
};
</script>

<template>
  <!-- 基础类型 -->
  <template v-if="part.type === 'text'">
    <div class="part-text">{{ part.content }}</div>
  </template>
  <template v-else-if="part.type === 'markdown'">
    <!-- Markdown 由 MarkdownStream 在外层处理 -->
  </template>
  <template v-else-if="part.type === 'rich'">
    <div class="part-rich" v-html="part.html"></div>
  </template>
  <template v-else-if="part.type === 'image'">
    <div class="part-image">
      <AntdImage :src="part.url" :alt="part.alt" :width="180" :style="{ borderRadius: '8px' }" />
      <div v-if="part.caption" class="part-image__caption">{{ part.caption }}</div>
    </div>
  </template>
  <template v-else-if="part.type === 'file'">
    <a class="part-file" :href="part.url" target="_blank" rel="noreferrer">
      <span class="part-file__icon">
        <component :is="fileIcon" />
      </span>
      <div class="part-file__meta">
        <div class="part-file__name">{{ part.name }}</div>
        <div class="part-file__size">{{ formatSize(part.size) }}</div>
      </div>
    </a>
  </template>

  <!-- 思维链 -->
  <div v-else-if="part.type === 'thinking'" class="part-thinking" :class="{ 'is-open': thinkingOpen }">
    <button class="part-thinking__head" @click="toggleThinking">
      <span class="part-thinking__icon"><ThunderboltOutlined /></span>
      <span class="part-thinking__label">{{ thinkingOpen ? '已展开思考过程' : '已思考' }}</span>
      <span v-if="part.durationMs" class="part-thinking__meta">用时 {{ (part.durationMs / 1000).toFixed(1) }}s</span>
      <CaretRightOutlined class="part-thinking__caret" />
    </button>
    <div v-if="thinkingOpen" class="part-thinking__body">{{ part.content }}</div>
  </div>

  <!-- 引用来源 -->
  <div v-else-if="part.type === 'citation' && part.sources?.length" class="part-citation">
    <div class="part-citation__head">
      <GlobalOutlined /> <span>{{ part.sources.length }} 个来源</span>
    </div>
    <div class="part-citation__list">
      <a
        v-for="s in part.sources"
        :key="s.index"
        class="part-citation__item"
        :href="s.url || '#'"
        target="_blank"
        rel="noreferrer"
      >
        <span class="part-citation__num">[{{ s.index }}]</span>
        <span class="part-citation__title">{{ s.title }}</span>
        <span v-if="s.source" class="part-citation__src">{{ s.source }}</span>
        <LinkOutlined v-if="s.url" class="part-citation__link" />
      </a>
    </div>
  </div>

  <!-- 独立代码块 -->
  <div v-else-if="part.type === 'code'" class="part-code">
    <div class="part-code__head">
      <span class="part-code__lang">
        <CodeOutlined /> {{ part.filename || part.language || 'code' }}
      </span>
      <div class="part-code__actions">
        <button class="part-code__btn" :title="codeCopied ? '已复制' : '复制'" @click="copyCode(part.content)">
          {{ codeCopied ? '已复制' : '复制' }}
        </button>
      </div>
    </div>
    <pre class="part-code__pre"><code>{{ part.content }}</code></pre>
  </div>

  <!-- 图表（纯 SVG，零依赖） -->
  <div v-else-if="part.type === 'chart'" class="part-chart">
    <div v-if="part.title" class="part-chart__title">{{ part.title }}</div>
    <svg class="part-chart__svg" viewBox="0 0 480 220" preserveAspectRatio="xMidYMid meet">
      <line x1="36" y1="16" x2="36" y2="192" stroke="#e6e8ee" />
      <line x1="36" y1="192" x2="468" y2="192" stroke="#e6e8ee" />

      <!-- 柱状图 -->
      <template v-if="part.chartType === 'bar'">
        <g v-for="(label, i) in part.data.labels" :key="i">
          <rect
            :x="36 + ((i + 0.5) * (468 - 36 - 12)) / part.data.labels.length - 14"
            :y="16 + (220 - 16 - 28) * (1 - (part.data.values[i] || 0) / Math.max(...part.data.values, 1))"
            width="28"
            :height="192 - (16 + (220 - 16 - 28) * (1 - (part.data.values[i] || 0) / Math.max(...part.data.values, 1)))"
            rx="4"
            fill="url(#barGradVue)"
          />
          <text
            :x="36 + ((i + 0.5) * (468 - 36 - 12)) / part.data.labels.length"
            :y="16 + (220 - 16 - 28) * (1 - (part.data.values[i] || 0) / Math.max(...part.data.values, 1)) - 4"
            text-anchor="middle"
            font-size="11"
            fill="#1d2129"
          >
            {{ part.data.values[i] }}{{ part.data.unit || '' }}
          </text>
          <text
            :x="36 + ((i + 0.5) * (468 - 36 - 12)) / part.data.labels.length"
            y="208"
            text-anchor="middle"
            font-size="11"
            fill="#6b7280"
          >
            {{ label }}
          </text>
        </g>
      </template>

      <!-- 折线图 -->
      <template v-else-if="part.chartType === 'line'">
        <g>
          <path
            :d="part.data.values.map((v, i) => {
              const x = 36 + (i * (468 - 36 - 12)) / Math.max(part.data.values.length - 1, 1);
              const y = 16 + (220 - 16 - 28) * (1 - v / Math.max(...part.data.values, 1));
              return (i === 0 ? 'M' : 'L') + x + ',' + y;
            }).join(' ')"
            fill="none"
            stroke="url(#lineGradVue)"
            stroke-width="2.5"
          />
          <template v-for="(v, i) in part.data.values" :key="i">
            <circle
              :cx="36 + (i * (468 - 36 - 12)) / Math.max(part.data.values.length - 1, 1)"
              :cy="16 + (220 - 16 - 28) * (1 - v / Math.max(...part.data.values, 1))"
              r="4"
              fill="#4d6bfe"
            />
            <text
              :x="36 + (i * (468 - 36 - 12)) / Math.max(part.data.values.length - 1, 1)"
              y="208"
              text-anchor="middle"
              font-size="11"
              fill="#6b7280"
            >
              {{ part.data.labels[i] }}
            </text>
            <text
              :x="36 + (i * (468 - 36 - 12)) / Math.max(part.data.values.length - 1, 1)"
              :cy="16 + (220 - 16 - 28) * (1 - v / Math.max(...part.data.values, 1)) - 8"
              text-anchor="middle"
              font-size="11"
              fill="#1d2129"
            >
              {{ v }}{{ part.data.unit || '' }}
            </text>
          </template>
        </g>
      </template>

      <!-- 饼图 -->
      <template v-else-if="part.chartType === 'pie'">
        <g>
          <template v-for="(v, i) in part.data.values" :key="i">
            <path
              :d="(() => {
                const total = part.data.values.reduce((a, b) => a + b, 0) || 1;
                let acc = 0;
                for (let k = 0; k < i; k++) acc += part.data.values[k];
                const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
                const end = ((acc + v) / total) * Math.PI * 2 - Math.PI / 2;
                const large = end - start > Math.PI ? 1 : 0;
                const cx = 36 + (468 - 36 - 12) / 2;
                const cy = 16 + (220 - 16 - 28) / 2;
                const r = Math.min(468 - 36 - 12, 220 - 16 - 28) / 2 - 10;
                const x1 = cx + r * Math.cos(start);
                const y1 = cy + r * Math.sin(start);
                const x2 = cx + r * Math.cos(end);
                const y2 = cy + r * Math.sin(end);
                return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`;
              })()"
              :fill="['#4d6bfe', '#7b5cff', '#34d399', '#f59e0b', '#ef4444', '#06b6d4'][i % 6]"
              stroke="#fff"
              stroke-width="1.5"
            />
          </template>
        </g>
      </template>

      <defs>
        <linearGradient id="barGradVue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#7b5cff" />
          <stop offset="100%" stop-color="#4d6bfe" />
        </linearGradient>
        <linearGradient id="lineGradVue" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#4d6bfe" />
          <stop offset="100%" stop-color="#7b5cff" />
        </linearGradient>
      </defs>
    </svg>
    <div v-if="part.chartType === 'pie'" class="part-chart__legend">
      <span v-for="(label, i) in part.data.labels" :key="i" class="part-chart__legend-item">
        <i :style="{ background: ['#4d6bfe', '#7b5cff', '#34d399', '#f59e0b', '#ef4444', '#06b6d4'][i % 6] }" />
        {{ label }} {{ part.data.values[i] }}{{ part.data.unit || '' }}
      </span>
    </div>
  </div>

  <!-- 推荐追问 -->
  <div v-else-if="part.type === 'suggestion' && part.items?.length" class="part-suggestion">
    <div class="part-suggestion__head">推荐追问</div>
    <div class="part-suggestion__list">
      <button
        v-for="(s, i) in part.items"
        :key="i"
        class="part-suggestion__chip"
        @click="onSuggestionPick?.(s)"
      >
        {{ s }}
      </button>
    </div>
  </div>

  <!-- 工具调用 -->
  <div
    v-else-if="part.type === 'function_call'"
    class="part-fc"
    :class="`part-fc--${part.call.status}`"
  >
    <button class="part-fc__head" @click="toggleFc">
      <span class="part-fc__status">
        <template v-if="part.call.status === 'pending'">
          <span class="part-fc__dot" />
        </template>
        <component
          v-else
          :is="fcStatusIcon(part.call.status)"
          :spin="part.call.status === 'running'"
          :style="{
            color: part.call.status === 'running' ? '#4d6bfe' :
                   part.call.status === 'done' ? '#22c55e' :
                   part.call.status === 'error' ? '#ef4444' : undefined
          }"
        />
      </span>
      <span class="part-fc__name">
        <ExperimentOutlined /> 调用工具 <code>{{ part.call.name }}</code>
      </span>
      <span class="part-fc__state">{{ fcStatusText[part.call.status] }}</span>
      <CaretRightOutlined class="part-fc__caret" />
    </button>
    <div v-if="fcOpen" class="part-fc__body">
      <div class="part-fc__section">
        <div class="part-fc__label">参数</div>
        <pre class="part-fc__pre"><code>{{ JSON.stringify(part.call.args, null, 2) }}</code></pre>
      </div>
      <div v-if="part.call.result !== undefined" class="part-fc__section">
        <div class="part-fc__label">结果</div>
        <pre class="part-fc__pre"><code>{{ typeof part.call.result === 'string' ? part.call.result : JSON.stringify(part.call.result, null, 2) }}</code></pre>
      </div>
      <div v-if="part.call.errorMessage" class="part-fc__err">{{ part.call.errorMessage }}</div>
    </div>
  </div>

  <!-- 对比卡 -->
  <div v-else-if="part.type === 'comparison' && part.items?.length" class="part-comparison">
    <div v-if="part.title" class="part-comparison__title">{{ part.title }}</div>
    <div class="part-comparison__grid" :class="`part-comparison__grid--${part.items.length}`">
      <div
        v-for="(it, i) in part.items"
        :key="i"
        class="part-comparison__item"
        :class="{ 'is-highlight': it.highlight }"
      >
        <div v-if="it.icon" class="part-comparison__icon">{{ it.icon }}</div>
        <div class="part-comparison__name">{{ it.name }}</div>
        <div v-if="it.value" class="part-comparison__value">{{ it.value }}</div>
        <div v-if="it.description" class="part-comparison__desc">{{ it.description }}</div>
      </div>
    </div>
  </div>
</template>
