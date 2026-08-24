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
  EyeOutlined,
  FileSearchOutlined,
  ClockCircleOutlined,
  CheckOutlined,
  PictureOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import type { MessagePart, ChartData, FunctionCallPart } from '@/types/message';

interface Props {
  part: MessagePart;
  onSuggestionPick?: (s: string) => void;
  onFunctionCallRetry?: (id: string) => void;
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

// chart part 提取到本地 computed，让模板里能正常 narrowing
const chartPart = computed(() => (props.part.type === 'chart' ? props.part : null));
const chartData = computed<ChartData | null>(() => chartPart.value?.data ?? null);
const chartMax = computed(() => {
  if (!chartData.value) return 1;
  return Math.max(...chartData.value.values, 1);
});

// function_call part 提取到 computed，便于模板 narrowing
const fcPart = computed(() => (props.part.type === 'function_call' ? (props.part as { call: FunctionCallPart }).call : null));
const fcCanRetry = computed(() => fcPart.value?.status === 'error' && (fcPart.value.retries ?? 0) < 3);

// ============== 思维链 ==============
const thinkingOpen = ref(false);
function toggleThinking() {
  thinkingOpen.value = !thinkingOpen.value;
}

// 拆解思维链文本为「步骤列表 + 散落段」
function splitThinkingSteps(content: string): { steps: string[]; intro?: string; outro?: string } {
  const lines = content.split('\n');
  const stepRe = /^\s*(\d+)\.\s+(.+)$/;
  const steps: { idx: number; text: string }[] = [];
  const introLines: string[] = [];
  const outroLines: string[] = [];
  let inSteps = false;
  let afterSteps = false;
  for (const line of lines) {
    const m = line.match(stepRe);
    if (m && !afterSteps) {
      inSteps = true;
      steps.push({ idx: parseInt(m[1], 10), text: m[2].trim() });
    } else if (inSteps && !stepRe.test(line) && line.trim() === '') {
      continue;
    } else if (inSteps && !stepRe.test(line)) {
      inSteps = false;
      afterSteps = true;
      outroLines.push(line);
    } else if (!inSteps && !afterSteps) {
      introLines.push(line);
    } else {
      outroLines.push(line);
    }
  }
  if (steps.length < 2) {
    return { steps: [], intro: content };
  }
  return {
    steps: steps.map((s) => s.text),
    intro: introLines.join('\n').trim() || undefined,
    outro: outroLines.join('\n').trim() || undefined,
  };
}
const thinkingSteps = computed(() => {
  if (props.part.type !== 'thinking') return null;
  return splitThinkingSteps(props.part.content);
});

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

// chart 布局常量
const CHART_W = 480;
const CHART_H = 240;
const CHART_PAD_L = 36;
const CHART_PAD_R = 12;
const CHART_PAD_T = 16;
const CHART_PAD_B = 36;
const CHART_INNER_W = CHART_W - CHART_PAD_L - CHART_PAD_R;
const CHART_INNER_H = CHART_H - CHART_PAD_T - CHART_PAD_B;
const CHART_RIGHT_PAD = 12;
function barX(i: number, total: number) {
  return CHART_PAD_L + ((i + 0.5) * (CHART_W - CHART_PAD_L - CHART_PAD_R - CHART_RIGHT_PAD)) / total;
}
function barY(v: number) {
  return CHART_PAD_T + CHART_INNER_H * (1 - v / chartMax.value);
}
function lineX(i: number, total: number) {
  return CHART_PAD_L + (i * (CHART_W - CHART_PAD_L - CHART_PAD_R - CHART_RIGHT_PAD)) / Math.max(total - 1, 1);
}
function lineY(v: number) {
  return CHART_PAD_T + CHART_INNER_H * (1 - v / chartMax.value);
}

// 雷达图布局 + 计算结果
const RADAR_CX = CHART_PAD_L + CHART_INNER_W / 2;
const RADAR_CY = CHART_PAD_T + CHART_INNER_H / 2 + 4;
const RADAR_R = Math.min(CHART_INNER_W, CHART_INNER_H) / 2 - 24;
const RADAR_RINGS = [0.33, 0.66, 1];
function radarAngle(i: number, n: number) {
  return (i / n) * Math.PI * 2 - Math.PI / 2;
}
function ringPath(rr: number, n: number) {
  return (
    Array.from({ length: n }, (_, i) => {
      const a = radarAngle(i, n);
      const x = RADAR_CX + RADAR_R * rr * Math.cos(a);
      const y = RADAR_CY + RADAR_R * rr * Math.sin(a);
      return (i === 0 ? 'M' : 'L') + x + ',' + y;
    }).join(' ') + ' Z'
  );
}
const radarRingPaths = computed(() => {
  if (!chartData.value) return [];
  const n = chartData.value.labels.length;
  return RADAR_RINGS.map((rr) => ringPath(rr, n));
});
const radarAxisEnd = computed(() => {
  if (!chartData.value) return [];
  const n = chartData.value.labels.length;
  return Array.from({ length: n }, (_, i) => {
    const a = radarAngle(i, n);
    return { x: RADAR_CX + RADAR_R * Math.cos(a), y: RADAR_CY + RADAR_R * Math.sin(a) };
  });
});
const radarDataPath = computed(() => {
  if (!chartData.value) return '';
  const n = chartData.value.labels.length;
  return (
    chartData.value.values
      .map((v, i) => {
        const a = radarAngle(i, n);
        const rr = v / chartMax.value;
        const x = RADAR_CX + RADAR_R * rr * Math.cos(a);
        const y = RADAR_CY + RADAR_R * rr * Math.sin(a);
        return (i === 0 ? 'M' : 'L') + x + ',' + y;
      })
      .join(' ') + ' Z'
  );
});
const radarDataPoints = computed(() => {
  if (!chartData.value) return [];
  const n = chartData.value.labels.length;
  return chartData.value.values.map((v, i) => {
    const a = radarAngle(i, n);
    const rr = v / chartMax.value;
    return {
      x: RADAR_CX + RADAR_R * rr * Math.cos(a),
      y: RADAR_CY + RADAR_R * rr * Math.sin(a),
    };
  });
});
const radarLabelPos = computed(() => {
  if (!chartData.value) return [];
  const n = chartData.value.labels.length;
  return chartData.value.labels.map((_, i) => {
    const a = radarAngle(i, n);
    return { x: RADAR_CX + (RADAR_R + 14) * Math.cos(a), y: RADAR_CY + (RADAR_R + 14) * Math.sin(a) };
  });
});
const radarValuePos = computed(() => {
  if (!chartData.value) return [];
  const n = chartData.value.labels.length;
  return chartData.value.values.map((v, i) => {
    const a = radarAngle(i, n);
    const rr = v / chartMax.value;
    return { x: RADAR_CX + RADAR_R * rr * Math.cos(a), y: RADAR_CY + RADAR_R * rr * Math.sin(a) };
  });
});

// 饼图：计算每段 path
const pieColors = ['#4d6bfe', '#7b5cff', '#34d399', '#f59e0b', '#ef4444', '#06b6d4'];
const pieSlices = computed(() => {
  if (!chartData.value) return [];
  const total = chartData.value.values.reduce((a, b) => a + b, 0) || 1;
  const cx = CHART_PAD_L + CHART_INNER_W / 2;
  const cy = CHART_PAD_T + CHART_INNER_H / 2;
  const r = Math.min(CHART_INNER_W, CHART_INNER_H) / 2 - 10;
  let acc = 0;
  return chartData.value.values.map((v, i) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += v;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    return {
      d: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`,
      color: pieColors[i % pieColors.length],
    };
  });
});
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
      <span v-if="thinkingSteps && thinkingSteps.steps.length > 0" class="part-thinking__count">
        {{ thinkingSteps.steps.length }} 步
      </span>
      <CaretRightOutlined class="part-thinking__caret" />
    </button>
    <div v-if="thinkingOpen" class="part-thinking__body">
      <div v-if="thinkingSteps?.intro" class="part-thinking__intro">{{ thinkingSteps.intro }}</div>
      <ol v-if="thinkingSteps && thinkingSteps.steps.length > 0" class="part-thinking__steps">
        <li v-for="(s, i) in thinkingSteps.steps" :key="i" class="part-thinking__step">
          <span class="part-thinking__step-num">{{ i + 1 }}</span>
          <span class="part-thinking__step-text">{{ s }}</span>
        </li>
      </ol>
      <div v-if="thinkingSteps?.outro" class="part-thinking__outro">{{ thinkingSteps.outro }}</div>
    </div>
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
  <div v-else-if="part.type === 'chart' && chartData" class="part-chart">
    <div v-if="part.title" class="part-chart__title">{{ part.title }}</div>
    <svg class="part-chart__svg" :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="xMidYMid meet">
      <line :x1="CHART_PAD_L" :y1="CHART_PAD_T" :x2="CHART_PAD_L" :y2="CHART_H - CHART_PAD_B" stroke="#e6e8ee" />
      <line :x1="CHART_PAD_L" :y1="CHART_H - CHART_PAD_B" :x2="CHART_W - CHART_PAD_R" :y2="CHART_H - CHART_PAD_B" stroke="#e6e8ee" />

      <!-- 柱状图 -->
      <template v-if="part.chartType === 'bar'">
        <g v-for="(label, i) in chartData.labels" :key="`bar-${i}`">
          <rect
            :x="barX(i, chartData.labels.length) - 14"
            :y="barY(chartData.values[i] || 0)"
            width="28"
            :height="CHART_H - CHART_PAD_B - barY(chartData.values[i] || 0)"
            rx="4"
            fill="url(#barGradVue)"
          />
          <text
            :x="barX(i, chartData.labels.length)"
            :y="barY(chartData.values[i] || 0) - 4"
            text-anchor="middle"
            font-size="11"
            fill="#1d2129"
          >
            {{ chartData.values[i] }}{{ chartData.unit || '' }}
          </text>
          <text
            :x="barX(i, chartData.labels.length)"
            :y="CHART_H - CHART_PAD_B + 16"
            text-anchor="middle"
            font-size="11"
            fill="#6b7280"
          >
            {{ label }}
          </text>
        </g>
      </template>

      <!-- 折线图 -->
      <template v-else-if="part.chartType === 'line' && chartData">
        <g>
          <path
            :d="chartData.values.map((v, i) => {
              const x = lineX(i, chartData!.values.length);
              const y = lineY(v);
              return (i === 0 ? 'M' : 'L') + x + ',' + y;
            }).join(' ')"
            fill="none"
            stroke="url(#lineGradVue)"
            stroke-width="2.5"
          />
          <template v-for="(v, i) in chartData.values" :key="`line-${i}`">
            <circle
              :cx="lineX(i, chartData.values.length)"
              :cy="lineY(v)"
              r="4"
              fill="#4d6bfe"
            />
            <text
              :x="lineX(i, chartData.values.length)"
              :y="CHART_H - CHART_PAD_B + 16"
              text-anchor="middle"
              font-size="11"
              fill="#6b7280"
            >
              {{ chartData.labels[i] }}
            </text>
            <text
              :x="lineX(i, chartData.values.length)"
              :y="lineY(v) - 8"
              text-anchor="middle"
              font-size="11"
              fill="#1d2129"
            >
              {{ v }}{{ chartData.unit || '' }}
            </text>
          </template>
        </g>
      </template>

      <!-- 饼图 -->
      <template v-else-if="part.chartType === 'pie'">
        <g>
          <path
            v-for="(s, i) in pieSlices"
            :key="`pie-${i}`"
            :d="s.d"
            :fill="s.color"
            stroke="#fff"
            stroke-width="1.5"
          />
        </g>
      </template>

      <!-- 雷达图 -->
      <template v-else-if="part.chartType === 'radar' && chartData">
        <g>
          <!-- 同心多边形 (3 圈) -->
          <path
            v-for="(d, i) in radarRingPaths"
            :key="`ring-${i}`"
            :d="d"
            fill="none"
            stroke="#e6e8ee"
            :stroke-dasharray="i === radarRingPaths.length - 1 ? '0' : '3 3'"
          />
          <!-- 轴线 -->
          <line
            v-for="(p, i) in radarAxisEnd"
            :key="`axis-${i}`"
            :x1="RADAR_CX"
            :y1="RADAR_CY"
            :x2="p.x"
            :y2="p.y"
            stroke="#e6e8ee"
          />
          <!-- 数据多边形 -->
          <path
            :d="radarDataPath"
            fill="rgba(77, 107, 254, 0.18)"
            stroke="#4d6bfe"
            stroke-width="2"
          />
          <!-- 数据点 -->
          <circle
            v-for="(p, i) in radarDataPoints"
            :key="`pt-${i}`"
            :cx="p.x"
            :cy="p.y"
            r="3"
            fill="#4d6bfe"
          />
          <!-- 标签 -->
          <text
            v-for="(p, i) in radarLabelPos"
            :key="`lbl-${i}`"
            :x="p.x"
            :y="p.y"
            text-anchor="middle"
            dominant-baseline="middle"
            font-size="11"
            fill="#6b7280"
          >
            {{ chartData.labels[i] }}
          </text>
          <!-- 数值 -->
          <text
            v-for="(p, i) in radarValuePos"
            :key="`val-${i}`"
            :x="p.x"
            :y="p.y - 8"
            text-anchor="middle"
            font-size="10"
            fill="#1d2129"
          >
            {{ chartData.values[i] }}{{ chartData.unit || '' }}
          </text>
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
    <div v-if="part.chartType === 'pie' && chartData" class="part-chart__legend">
      <span v-for="(label, i) in chartData.labels" :key="i" class="part-chart__legend-item">
        <i :style="{ background: pieColors[i % pieColors.length] }" />
        {{ label }} {{ chartData.values[i] }}{{ chartData.unit || '' }}
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
      <span class="part-fc__name" :title="part.call.description || part.call.name">
        <ExperimentOutlined /> 调用工具 <code>{{ part.call.name }}</code>
      </span>
      <span v-if="part.call.retries && part.call.retries > 0" class="part-fc__retries">
        已重试 {{ part.call.retries }} 次
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
      <div v-if="fcCanRetry" class="part-fc__actions">
        <button class="part-fc__retry" @click="onFunctionCallRetry?.(part.call.id)">
          <ReloadOutlined /> 重试调用
        </button>
      </div>
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

  <!-- 图片理解 -->
  <div v-else-if="part.type === 'image_understanding'" class="part-img-und">
    <div class="part-img-und__head">
      <PictureOutlined /> <span>图片理解</span>
    </div>
    <div class="part-img-und__body">
      <div class="part-img-und__thumb">
        <AntdImage :src="part.data.imageUrl" :width="140" :style="{ borderRadius: '8px' }" />
      </div>
      <div class="part-img-und__content">
        <div class="part-img-und__desc">{{ part.data.description }}</div>
        <div v-if="part.data.tags?.length" class="part-img-und__tags">
          <Tag v-for="(t, i) in part.data.tags" :key="i" color="blue" style="margin-inline-end: 4px">{{ t }}</Tag>
        </div>
      </div>
    </div>
    <div v-if="part.data.followUpQuestions?.length" class="part-img-und__followup">
      <button
        v-for="(q, i) in part.data.followUpQuestions"
        :key="i"
        class="part-suggestion__chip"
        @click="onSuggestionPick?.(q)"
      >
        {{ q }}
      </button>
    </div>
  </div>

  <!-- 文件解析 -->
  <div v-else-if="part.type === 'file_parsed'" class="part-file-parsed">
    <div class="part-file-parsed__head">
      <FileSearchOutlined />
      <span class="part-file-parsed__title">{{ part.data.name }}</span>
      <Tag v-if="part.data.pages" color="default">{{ part.data.pages }} 页</Tag>
      <span v-if="part.data.durationMs" class="part-file-parsed__meta">
        解析用时 {{ (part.data.durationMs / 1000).toFixed(1) }}s
      </span>
    </div>
    <div class="part-file-parsed__summary">{{ part.data.summary }}</div>
    <div v-if="part.data.keyPoints?.length" class="part-file-parsed__points">
      <div class="part-file-parsed__label">关键要点</div>
      <ul>
        <li v-for="(p, i) in part.data.keyPoints" :key="i">{{ p }}</li>
      </ul>
    </div>
  </div>

  <!-- 时间线 -->
  <div v-else-if="part.type === 'timeline' && part.events?.length" class="part-timeline">
    <div v-if="part.title" class="part-timeline__title">{{ part.title }}</div>
    <div class="part-timeline__list">
      <div
        v-for="(e, i) in part.events"
        :key="i"
        class="part-timeline__item"
        :class="`part-timeline__item--${e.status || 'done'}`"
      >
        <div class="part-timeline__dot">
          <ClockCircleOutlined v-if="e.status === 'current'" />
          <CheckOutlined v-else />
        </div>
        <div class="part-timeline__content">
          <div class="part-timeline__time">{{ e.time }}</div>
          <div class="part-timeline__name">{{ e.title }}</div>
          <div v-if="e.description" class="part-timeline__desc">{{ e.description }}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- 任务清单 -->
  <div v-else-if="part.type === 'task_list' && part.tasks?.length" class="part-tasks">
    <div v-if="part.title" class="part-tasks__title">{{ part.title }}</div>
    <div class="part-tasks__progress">
      <div class="part-tasks__bar">
        <div
          class="part-tasks__bar-fill"
          :style="{ width: Math.round((part.tasks.filter((t) => t.done).length / part.tasks.length) * 100) + '%' }"
        />
      </div>
      <div class="part-tasks__pct">
        {{ part.tasks.filter((t) => t.done).length }} / {{ part.tasks.length }} ·
        {{ Math.round((part.tasks.filter((t) => t.done).length / part.tasks.length) * 100) }}%
      </div>
    </div>
    <ul class="part-tasks__list">
      <li
        v-for="(t, i) in part.tasks"
        :key="i"
        class="part-tasks__item"
        :class="{ 'is-done': t.done }"
      >
        <span class="part-tasks__check">
          <CheckCircleFilled v-if="t.done" :style="{ color: '#22c55e' }" />
          <span v-else class="part-tasks__empty" />
        </span>
        <span class="part-tasks__label">{{ t.label }}</span>
      </li>
    </ul>
  </div>

  <!-- 图片组 -->
  <div v-else-if="part.type === 'image_group' && part.data.images?.length" class="part-image-group">
    <div v-for="(img, i) in part.data.images" :key="i" class="part-image-group__item">
      <AntdImage :src="img.url" :alt="img.alt" :width="120" :style="{ borderRadius: '6px' }" />
      <div v-if="img.caption" class="part-image-group__caption">{{ img.caption }}</div>
    </div>
  </div>
</template>
