<script setup lang="ts">
/**
 * 消息气泡 - 渲染一条完整 Message
 * - user: 右对齐渐变气泡
 * - assistant: 左对齐白底气泡 + 分段流式 Markdown
 * - system: 居中提示
 *
 * 性能：defineOptions({ inheritAttrs: false }) + computed 派生内容，避免重复 filter+map
 */

import { computed } from 'vue';
import { Avatar, Tooltip, Button, message as antdMsg } from 'ant-design-vue';
import {
  UserOutlined,
  RobotOutlined,
  CopyOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons-vue';
import type { Message, MessagePart } from '@/types/message';
import MarkdownStream from '@/components/MarkdownStream/MarkdownStream.vue';
import PartRenderer from './PartRenderer.vue';

interface Props {
  message: Message;
}

const props = defineProps<Props>();

const isUser = computed(() => props.message.role === 'user');

// AI 消息：合并所有 markdown part 作为已渲染内容
// 排除 'text' 是因为 user 的纯文本由下方独立块渲染，避免 PartRenderer 二次渲染造成重复
const aiMarkdown = computed(() => {
  if (isUser.value) return '';
  let md = '';
  for (const p of props.message.parts) {
    if (p.type === 'markdown') {
      md += (md ? '\n\n' : '') + p.content;
    }
  }
  return md;
});

const otherParts = computed(() => {
  return props.message.parts.filter((p) => p.type !== 'markdown' && p.type !== 'text');
});

const userText = computed(() => {
  if (!isUser.value) return [];
  return props.message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as Extract<MessagePart, { type: 'text' }>).content);
});

const systemText = computed(() => {
  if (props.message.role !== 'system') return '';
  const t = props.message.parts.find((p) => p.type === 'text') as
    | Extract<MessagePart, { type: 'text' }>
    | undefined;
  return t?.content || '';
});

const onCopyClick = () => {
  const text = isUser.value
    ? userText.value.join('\n')
    : aiMarkdown.value || props.message.pendingText || '';
  navigator.clipboard.writeText(text).then(() => antdMsg.success('已复制到剪贴板'));
};
</script>

<template>
  <div
    v-if="message.role === 'system'"
    class="msg msg--system"
  >
    <span class="msg__system-text">{{ systemText }}</span>
  </div>

  <div v-else class="msg" :class="isUser ? 'msg--user' : 'msg--ai'">
    <Avatar
      v-if="!isUser"
      class="msg__avatar msg__avatar--ai"
    >
      <template #icon><RobotOutlined /></template>
    </Avatar>

    <div class="msg__bubble">
      <div v-if="otherParts.length > 0" class="msg__parts">
        <PartRenderer
          v-for="(p, i) in otherParts"
          :key="i"
          :part="p"
        />
      </div>

      <div v-if="isUser && userText.length > 0" class="msg__text">
        <p v-for="(t, i) in userText" :key="i">{{ t }}</p>
      </div>

      <MarkdownStream
        v-if="!isUser && (aiMarkdown || message.pendingText !== undefined)"
        :content="aiMarkdown"
        :pending="message.pendingText || ''"
        :streaming="message.status === 'streaming'"
      />

      <div class="msg__actions">
        <Tooltip title="复制">
          <Button size="small" type="text" @click="onCopyClick">
            <template #icon><CopyOutlined /></template>
          </Button>
        </Tooltip>
        <span
          v-if="message.status === 'interrupted'"
          class="msg__status msg__status--stop"
        >
          <CloseCircleOutlined /> 已停止生成
        </span>
        <span v-if="message.status === 'error'" class="msg__status msg__status--err">
          生成失败
        </span>
      </div>
    </div>

    <Avatar
      v-if="isUser"
      class="msg__avatar msg__avatar--user"
    >
      <template #icon><UserOutlined /></template>
    </Avatar>
  </div>
</template>
