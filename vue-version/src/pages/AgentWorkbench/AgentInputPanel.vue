/**
 * 客服工作台 - 客服端输入面板（独立组件，避免和客户端 InputPanel 状态分支纠缠）
 *
 * 发送消息时通过 `window.dispatchEvent('agent:send-message')` 通知父组件，
 * 父组件负责把消息乐观追加到 store + 发到服务端。
 */

<script setup lang="ts">
import { ref } from 'vue';
import { Button } from 'ant-design-vue';
import type { AgentSession } from '@/types/agent';

interface Attachment {
  kind: 'image' | 'file';
  url: string;
  name: string;
  size: number;
  mime?: string;
}

const props = defineProps<{
  session: AgentSession;
  /** 用户名（来自父组件 MessageArea 已查好的 userInfoByClient 缓存） */
  userName: string;
}>();

const text = ref('');
const attachments = ref<Attachment[]>([]);

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function onUpload(file: File, kind: 'image' | 'file') {
  const url = await fileToDataURL(file);
  attachments.value = [
    ...attachments.value,
    { kind, url, name: file.name, size: file.size, mime: file.type },
  ];
}

function removeAttachment(idx: number) {
  attachments.value = attachments.value.filter((_, i) => i !== idx);
}

function onSend() {
  const trimmed = text.value.trim();
  if (!trimmed && attachments.value.length === 0) return;
  window.dispatchEvent(
    new CustomEvent('agent:send-message', {
      detail: {
        sessionId: props.session.sessionId,
        trimmed,
        attachments: attachments.value,
      },
    }),
  );
  text.value = '';
  attachments.value = [];
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
}
</script>

<template>
  <div class="agent-input">
    <div class="agent-input__head">
      正在为用户 {{ userName || `用户 ${session.clientId?.slice(-6) || '未知'}` }} 服务
    </div>

    <div v-if="attachments.length > 0" class="agent-input__attachments">
      <div
        v-for="(a, i) in attachments"
        :key="i"
        :class="['attachment-chip', { 'is-image': a.kind === 'image' }]"
      >
        <img
          v-if="a.kind === 'image'"
          :src="a.url"
          :alt="a.name"
          class="attachment-chip__thumb"
        />
        <span v-else class="attachment-chip__icon">📎</span>
        <span class="attachment-chip__name">{{ a.name }}</span>
        <span class="attachment-chip__close" @click="removeAttachment(i)">×</span>
      </div>
    </div>

    <div class="agent-input__toolbar">
      <label class="agent-input__tool">
        <span style="margin-right: 4px">🖼️</span>图片
        <input
          type="file"
          accept="image/*"
          style="display: none"
          @change="async (e: Event) => {
            const t = e.target as HTMLInputElement;
            const f = t.files?.[0];
            if (f) await onUpload(f, 'image');
            t.value = '';
          }"
        />
      </label>
      <label class="agent-input__tool">
        <span style="margin-right: 4px">📎</span>文件
        <input
          type="file"
          style="display: none"
          @change="async (e: Event) => {
            const t = e.target as HTMLInputElement;
            const f = t.files?.[0];
            if (f) await onUpload(f, 'file');
            t.value = '';
          }"
        />
      </label>
      <div style="flex: 1"></div>
      <span style="font-size: 12px; color: #8c8c8c">Enter 发送 · Shift+Enter 换行</span>
    </div>

    <textarea
      :value="text"
      rows="3"
      class="agent-input__textarea"
      placeholder="输入回复…"
      @input="(e: Event) => (text = (e.target as HTMLTextAreaElement).value)"
      @keydown="onKeyDown"
    />

    <div class="agent-input__bottom">
      <Button
        type="primary"
        class="agent-input__send"
        :disabled="!text.trim() && attachments.length === 0"
        @click="onSend"
      >
        发送
      </Button>
    </div>
  </div>
</template>
