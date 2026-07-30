<script setup lang="ts">
/**
 * 消息气泡 - 渲染一条完整 Message
 * - user: 右对齐渐变气泡
 * - assistant: 左对齐白底气泡 + 分段流式 Markdown + 多种扩展卡片
 * - system: 居中提示
 *
 * 交互能力（对齐豆包）：
 *   - 复制 / 点赞 / 点踩 / 重新生成 / 分享
 */

import { computed } from 'vue';
import { Avatar, Tooltip, Button, message as antdMsg } from 'ant-design-vue';
import {
  UserOutlined,
  RobotOutlined,
  CopyOutlined,
  CloseCircleOutlined,
  LikeOutlined,
  LikeFilled,
  DislikeOutlined,
  DislikeFilled,
  ReloadOutlined,
  ShareAltOutlined,
} from '@ant-design/icons-vue';
import type { Message, MessagePart, MessageFeedback } from '@/types/message';
import MarkdownStream from '@/components/MarkdownStream/MarkdownStream.vue';
import PartRenderer from './PartRenderer.vue';
import { useChatStore } from '@/stores/chatStore';

interface Props {
  message: Message;
  onSuggestionPick?: (s: string) => void;
  onRegenerate?: (m: Message) => void;
}

const props = defineProps<Props>();

const store = useChatStore();

const isUser = computed(() => props.message.role === 'user');
const isAiDone = computed(() => !isUser.value && props.message.status === 'done');

// AI 消息：合并所有 markdown part 作为已渲染内容
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

const onFeedbackClick = (v: 'like' | 'dislike') => {
  const next: MessageFeedback = props.message.feedback === v ? null : v;
  store.setMessageFeedback(props.message.sessionId, props.message.id, next);
  if (next) {
    antdMsg.success(next === 'like' ? '感谢你的反馈 👍' : '已记录你的反馈');
  }
};

const onShareClick = () => {
  const json = JSON.stringify(
    { role: props.message.role, parts: props.message.parts, createdAt: props.message.createdAt },
    null,
    2,
  );
  navigator.clipboard.writeText(json).then(() => antdMsg.success('已复制消息 JSON'));
};
</script>

<template>
  <div v-if="message.role === 'system'" class="msg msg--system">
    <span class="msg__system-text">{{ systemText }}</span>
  </div>

  <div v-else class="msg" :class="isUser ? 'msg--user' : 'msg--ai'">
    <Avatar v-if="!isUser" class="msg__avatar msg__avatar--ai">
      <template #icon><RobotOutlined /></template>
    </Avatar>

    <div class="msg__bubble">
      <div v-if="otherParts.length > 0" class="msg__parts">
        <PartRenderer
          v-for="(p, i) in otherParts"
          :key="i"
          :part="p"
          :on-suggestion-pick="onSuggestionPick"
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

        <template v-if="isAiDone">
          <Tooltip :title="message.feedback === 'like' ? '取消点赞' : '有帮助'">
            <Button
              size="small"
              type="text"
              :class="['msg__fb', { 'is-active': message.feedback === 'like' }]"
              @click="onFeedbackClick('like')"
            >
              <template #icon>
                <component :is="message.feedback === 'like' ? LikeFilled : LikeOutlined" />
              </template>
            </Button>
          </Tooltip>
          <Tooltip :title="message.feedback === 'dislike' ? '取消点踩' : '没帮助'">
            <Button
              size="small"
              type="text"
              :class="['msg__fb', { 'is-active': message.feedback === 'dislike', 'is-dislike': message.feedback === 'dislike' }]"
              @click="onFeedbackClick('dislike')"
            >
              <template #icon>
                <component :is="message.feedback === 'dislike' ? DislikeFilled : DislikeOutlined" />
              </template>
            </Button>
          </Tooltip>
          <Tooltip title="重新生成">
            <Button size="small" type="text" @click="onRegenerate?.(message)">
              <template #icon><ReloadOutlined /></template>
            </Button>
          </Tooltip>
          <Tooltip title="分享">
            <Button size="small" type="text" @click="onShareClick">
              <template #icon><ShareAltOutlined /></template>
            </Button>
          </Tooltip>
        </template>

        <span v-if="message.status === 'interrupted'" class="msg__status msg__status--stop">
          <CloseCircleOutlined /> 已停止生成
        </span>
        <span v-if="message.status === 'error'" class="msg__status msg__status--err">
          生成失败
        </span>
      </div>
    </div>

    <Avatar v-if="isUser" class="msg__avatar msg__avatar--user">
      <template #icon><UserOutlined /></template>
    </Avatar>
  </div>
</template>
