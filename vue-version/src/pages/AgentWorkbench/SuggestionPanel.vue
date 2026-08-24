/**
 * 客服工作台 - 右侧智能推荐工具栏（Vue 版 - 对齐 React 端 SuggestionPanel.tsx）
 */

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  App,
  Button,
  Empty,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Switch,
} from 'ant-design-vue';
import {
  ThunderboltOutlined,
  ReloadOutlined,
  CheckCircleFilled,
  LoadingOutlined,
  PictureOutlined,
  FileTextOutlined,
  AppstoreOutlined,
  CodeOutlined,
  SendOutlined,
  MessageOutlined,
  CopyOutlined,
} from '@ant-design/icons-vue';
import type { Component } from 'vue';
import type { MessagePart } from '@/types/message';
import type { AgentSuggestion } from '@/types/agent';
import { getClientFallbackSuggestions } from '@/utils/agentSuggestions';

type PartKind = 'text' | 'image' | 'file' | 'card' | 'rich';

const PART_ICON: Record<PartKind, Component> = {
  text: MessageOutlined,
  image: PictureOutlined,
  file: FileTextOutlined,
  card: AppstoreOutlined,
  rich: CodeOutlined,
};

const PART_COLOR: Record<PartKind, string> = {
  text: '#4d6bfe',
  image: '#52c41a',
  file: '#fa8c16',
  card: '#722ed1',
  rich: '#13c2c2',
};

function extractHtmlText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPartSummary(parts: MessagePart[]): Array<{ kind: PartKind; label: string; preview: string }> {
  const out: Array<{ kind: PartKind; label: string; preview: string }> = [];
  for (const p of parts) {
    switch (p.type) {
      case 'text':
        out.push({ kind: 'text', label: '文本', preview: p.content.slice(0, 60) });
        break;
      case 'markdown':
        out.push({ kind: 'text', label: '富文本', preview: p.content.slice(0, 60) });
        break;
      case 'rich':
        out.push({ kind: 'rich', label: '富文本卡片', preview: extractHtmlText(p.html).slice(0, 60) });
        break;
      case 'image':
        out.push({ kind: 'image', label: '图片', preview: p.caption || p.alt || '图片' });
        break;
      case 'image_group':
        out.push({ kind: 'image', label: '图片组', preview: `${p.data.images.length} 张图片` });
        break;
      case 'file':
        out.push({ kind: 'file', label: '文件', preview: p.name });
        break;
      case 'comparison':
        out.push({ kind: 'card', label: '对比卡', preview: p.title || `${p.items.length} 个选项` });
        break;
      case 'suggestion':
        out.push({ kind: 'card', label: '推荐', preview: `${p.items.length} 个追问` });
        break;
      case 'chart':
        out.push({ kind: 'card', label: '图表', preview: p.title || `${p.chartType} chart` });
        break;
      case 'timeline':
        out.push({ kind: 'card', label: '时间线', preview: p.title || `${p.events.length} 个事件` });
        break;
      case 'task_list':
        out.push({ kind: 'card', label: '任务', preview: p.title || `${p.tasks.length} 个任务` });
        break;
      case 'code':
        out.push({ kind: 'card', label: '代码', preview: p.filename || p.language });
        break;
      case 'thinking':
        out.push({ kind: 'card', label: '思维链', preview: p.content.slice(0, 40) });
        break;
      case 'citation':
        out.push({ kind: 'card', label: '引用', preview: `${p.sources.length} 条来源` });
        break;
      case 'function_call':
        out.push({ kind: 'card', label: '工具调用', preview: p.call.name });
        break;
      case 'image_understanding':
        out.push({ kind: 'card', label: '图片理解', preview: p.data.description.slice(0, 40) });
        break;
      case 'file_parsed':
        out.push({ kind: 'card', label: '文件解析', preview: p.data.name });
        break;
    }
  }
  return out;
}

const props = defineProps<{
  sessionId: string;
  messages: Array<{ id: string; role: 'user' | 'agent' | 'assistant'; parts: MessagePart[] }>;
  isStreaming: boolean;
  streamingCategory?: string | null;
  onRefresh: () => void;
  onUseSuggestion: (s: AgentSuggestion) => void;
  autoTrigger: boolean;
  onAutoTriggerChange: (v: boolean | string | number) => void;
}>();

const { message: antdMessage } = App.useApp();

// 简化版：组件内本地 list（实际项目可放到 store）
const list = ref<AgentSuggestion[]>([]);

function onUse(s: AgentSuggestion) {
  if (s.applied) return;
  props.onUseSuggestion(s);
  antdMessage.success('已发送推荐话术');
}

/**
 * 一键复制话术到剪贴板（不直接发送）。客服可在输入框 Ctrl/Cmd+V 粘贴后微调。
 * 仅复制 text/markdown 两种 part，富文本/卡片/图片用「一键发送」。
 */
async function onCopy(s: AgentSuggestion) {
  const text = s.parts
    .map((p) => (p.type === 'text' || p.type === 'markdown' ? p.content : ''))
    .filter(Boolean)
    .join('\n\n');
  if (!text) {
    antdMessage.warning('该话术含富文本/卡片，建议直接「一键发送」');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    antdMessage.success('已复制，去输入框粘贴吧');
  } catch {
    antdMessage.error('复制失败，请检查浏览器剪贴板权限');
  }
}

const fallback = computed(() =>
  getClientFallbackSuggestions(props.messages as any),
);

const fallbackOpen = ref(true);
</script>

<template>
  <aside class="agent-tools">
    <header class="agent-tools__head">
      <div class="agent-tools__title">
        <ThunderboltOutlined /> 智能推荐
      </div>
      <div class="agent-tools__sub">基于最近用户消息实时识别意图</div>
    </header>

    <div class="agent-tools__actions">
      <Space>
        <Switch
          size="small"
          :checked="autoTrigger"
          @change="onAutoTriggerChange"
          checked-children="自动"
          un-checked-children="手动"
        />
        <span style="font-size: 12px; color: #8c8c8c">新消息时自动推荐</span>
      </Space>
      <Tooltip title="立即请求一次推荐">
        <Button
          size="small"
          type="text"
          :disabled="isStreaming"
          @click="onRefresh"
        >
          <template #icon>
            <ReloadOutlined :spin="isStreaming" />
          </template>
          刷新
        </Button>
      </Tooltip>
    </div>

    <div class="agent-tools__body">
      <div v-if="isStreaming" class="agent-tools__loading">
        <Space>
          <LoadingOutlined />
          <span>正在识别意图{{ streamingCategory ? `（${streamingCategory}）` : '' }}…</span>
        </Space>
        <Skeleton
          active
          :paragraph="{ rows: 2 }"
          :title="false"
          style="margin-top: 8px"
        />
      </div>

      <Empty
        v-if="list.length === 0 && !isStreaming"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
        style="margin-top: 24px"
      >
        <template #description>
          <span style="color: #8c8c8c; font-size: 13px">
            暂无推荐，等待用户消息…
            <div style="font-size: 12px; margin-top: 4px">也可点"刷新"手动触发</div>
          </span>
        </template>
      </Empty>

      <template v-if="list.length > 0">
        <div
          v-for="s in list"
          :key="s.id"
          :class="['agent-suggestion', { 'is-applied': !!s.applied }]"
        >
          <div class="agent-suggestion__head">
            <Space :size="6">
              <ThunderboltOutlined style="color: #4d6bfe" />
              <span class="agent-suggestion__cat">{{ s.category }}</span>
              <Tag v-if="s.confidence !== undefined" color="blue">
                {{ Math.round((s.confidence ?? 0) * 100) }}%
              </Tag>
            </Space>
            <Tag v-if="s.applied" color="success">
              <template #icon><CheckCircleFilled /></template>
              已发送
            </Tag>
          </div>
          <div class="agent-suggestion__reason">{{ s.reason }}</div>
          <div class="agent-suggestion__parts">
            <Tooltip
              v-for="(part, i) in buildPartSummary(s.parts)"
              :key="i"
              :title="part.preview"
              placement="top"
              :mouse-enter-delay="0.3"
            >
              <span
                class="agent-suggestion__part-chip"
                :style="{
                  color: PART_COLOR[part.kind],
                  borderColor: PART_COLOR[part.kind] + '40',
                  background: PART_COLOR[part.kind] + '10',
                }"
              >
                <component :is="PART_ICON[part.kind]" />
                <span class="agent-suggestion__part-label">{{ part.label }}</span>
              </span>
            </Tooltip>
          </div>
          <div class="agent-suggestion__preview" :title="s.preview">{{ s.preview }}</div>
          <div class="agent-suggestion__actions">
            <Button
              type="primary"
              size="small"
              :disabled="!!s.applied"
              class="agent-suggestion__send"
              @click="onUse(s)"
            >
              <!--
                ant-design-vue@7 图标是函数式组件，必须用 #icon slot 语法
                否则函数体会被直接渲染到页面上（出现 "function SendOutlined3(props, context) { va..."）
              -->
              <template #icon><SendOutlined /></template>
              {{ s.applied ? '已发送' : '一键发送' }}
            </Button>
            <Tooltip title="复制话术到剪贴板（在输入框手动粘贴）">
              <Button size="small" class="agent-suggestion__copy" @click="onCopy(s)">
                <template #icon><CopyOutlined /></template>
                复制
              </Button>
            </Tooltip>
          </div>
        </div>
      </template>

      <div
        v-if="fallback.length > 0 && list.length === 0 && !isStreaming"
        class="agent-tools__fallback"
      >
        <div
          class="agent-tools__fallback-head"
          @click="fallbackOpen = !fallbackOpen"
        >
          {{ fallbackOpen ? '▼' : '▶' }} 本地模板（{{ fallback[0].category }}）
        </div>
        <div v-if="fallbackOpen" class="agent-tools__fallback-list">
          <div
            v-for="(tpl, i) in fallback[0].templates"
            :key="i"
            :class="['agent-suggestion', { 'is-applied': false }]"
          >
            <div class="agent-suggestion__head">
              <Space :size="6">
                <ThunderboltOutlined style="color: #4d6bfe" />
                <span class="agent-suggestion__cat">{{ fallback[0].category }}</span>
              </Space>
            </div>
            <div class="agent-suggestion__reason">本地模板（离线兜底）</div>
            <div class="agent-suggestion__preview" :title="tpl.preview">{{ tpl.preview }}</div>
            <div class="agent-suggestion__actions">
              <Button
                type="primary"
                size="small"
                class="agent-suggestion__send"
                @click="onUse({
                  id: `fallback_${i}`,
                  category: fallback[0].category,
                  reason: '本地模板（离线兜底）',
                  preview: tpl.preview,
                  parts: tpl.parts,
                  createdAt: Date.now(),
                })"
              >
                <template #icon><SendOutlined /></template>
                一键发送
              </Button>
              <Tooltip title="复制话术到剪贴板（在输入框手动粘贴）">
                <Button
                  size="small"
                  class="agent-suggestion__copy"
                  @click="onCopy({
                    id: `fallback_${i}`,
                    category: fallback[0].category,
                    reason: '本地模板（离线兜底）',
                    preview: tpl.preview,
                    parts: tpl.parts,
                    createdAt: Date.now(),
                  })"
                >
                  <template #icon><CopyOutlined /></template>
                  复制
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
