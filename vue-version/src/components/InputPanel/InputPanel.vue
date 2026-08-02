<script setup lang="ts">
/**
 * 输入区 - 多模态输入
 * - 文本 + 富文本工具栏 + 图片 + 文件
 * - Enter 发送 / Shift+Enter 换行
 * - 允许在 AI 生成中继续输入：
 *   - 输入框始终可写
 *   - 按 Enter 发送时若正在 streaming，先 stop 旧流（标 'interrupted'），再发新消息
 *
 * Vue 3 与 React 关键差异：
 *   - ant-design-vue 提供 v-model:value / v-model:file-list 等双向绑定
 *   - 模板语法替代 JSX
 *   - store 变化自动驱动组件
 */

import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import {
  Button,
  Input,
  Tooltip,
  Upload,
  message as antdMsg,
  Space,
} from 'ant-design-vue';
import {
  SendOutlined,
  StopOutlined,
  PictureOutlined,
  FileAddOutlined,
  BoldOutlined,
  CodeOutlined,
  UnorderedListOutlined,
  ClearOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
  TranslationOutlined,
  EditOutlined,
  CodeSandboxOutlined,
  BarChartOutlined,
  CloseOutlined,
} from '@ant-design/icons-vue';
import { storeToRefs } from 'pinia';
import { useChat } from '@/composables/useChat';
import { useChatStore } from '@/stores/chatStore';
import { SKILLS } from '@/components/SkillBar/skills';
import type { SkillMeta } from '@/types/message';

const SKILL_ICONS: Record<string, any> = {
  default: ThunderboltOutlined,
  thinking: ThunderboltOutlined,
  web: GlobalOutlined,
  translate: TranslationOutlined,
  writer: EditOutlined,
  coder: CodeSandboxOutlined,
  analyst: BarChartOutlined,
};

interface Attachment {
  kind: 'image' | 'file';
  url: string;
  name: string;
  size: number;
  mime?: string;
}

const WELCOME = '你好，我是豆包 👋 试试问我：写一个 React Hook 例子 / 用 Markdown 做个表格 / 上传一张图片';
const SUGGESTIONS = [
  '写一个 React Hook 例子',
  '用 Markdown 表格对比 Vue 与 React',
  '解释一下 SSE 流式原理',
  '上传一张图片描述它',
];

const { sendMessage, stop } = useChat();
const store = useChatStore();
const { currentSessionId, messages, activeSkillId } = storeToRefs(store);
const setActiveSkill = (id: string | null) => store.setActiveSkill(id);

// 流式状态完全按"当前会话"的消息状态判定
const isStreaming = computed(() => {
  if (!currentSessionId.value) return false;
  const list = messages.value[currentSessionId.value];
  return !!list?.some((m) => m.status === 'streaming');
});

const activeSkill = computed<SkillMeta>(() => SKILLS.find((s) => s.id === (activeSkillId.value || 'default')) || SKILLS[0]);

const text = ref('');
const attachments = ref<Attachment[]>([]);
const showSkillMenu = ref(false);
const taRef = ref<any>(null);
const panelRef = ref<HTMLDivElement | null>(null);

const insertMarkdown = (snippet: string, offset = 0) => {
  const ta = taRef.value?.resizableTextArea?.textArea as HTMLTextAreaElement | undefined;
  if (!ta) {
    text.value += snippet;
    return;
  }
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const before = text.value.slice(0, start);
  const after = text.value.slice(end);
  text.value = before + snippet + after;
  nextTick(() => {
    ta.focus();
    ta.setSelectionRange(start + offset, start + snippet.length - offset);
  });
};

const onSend = () => {
  const trimmed = text.value.trim();
  if (!trimmed && attachments.value.length === 0) {
    antdMsg.warning('说点什么再发送吧');
    return;
  }
  sendMessage(trimmed, {
    images: attachments.value
      .filter((a) => a.kind === 'image')
      .map((a) => ({ url: a.url, alt: a.name })),
    files: attachments.value
      .filter((a) => a.kind === 'file')
      .map((a) => ({ name: a.name, size: a.size, url: a.url, mime: a.mime })),
  });
  text.value = '';
  attachments.value = [];
};

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
};

const onTextChange = (next: string) => {
  text.value = next;
  if (next.endsWith('@') && !next.slice(0, -1).endsWith('@')) {
    showSkillMenu.value = true;
  }
};

const onPickSkill = (s: SkillMeta) => {
  setActiveSkill(s.id === 'default' ? null : s.id);
  showSkillMenu.value = false;
  text.value = text.value.replace(/@$/, '');
  antdMsg.success(`已切换到 ${s.name}`);
};

// 点击外部关闭 Skill 弹窗
const onDocClick = (e: MouseEvent) => {
  if (panelRef.value && !panelRef.value.contains(e.target as Node)) {
    showSkillMenu.value = false;
  }
};

const fileToDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const onUpload = async (file: File, kind: 'image' | 'file') => {
  const url = await fileToDataURL(file);
  attachments.value.push({
    kind,
    url,
    name: file.name,
    size: file.size,
    mime: file.type,
  });
  return false; // 阻止 Upload 自动上传
};

const removeAttachment = (idx: number) => {
  attachments.value = attachments.value.filter((_, i) => i !== idx);
};

const onClear = () => {
  text.value = '';
  attachments.value = [];
};

const placeholder = computed(() =>
  isStreaming.value
    ? 'AI 正在回复中…（继续输入会打断当前回复；输入 @ 唤起 Skill）'
    : '请输入消息，回车发送，Shift+回车换行，输入 @ 唤起 Skill',
);

const hint = computed(() =>
  isStreaming.value
    ? 'Enter 发送（打断当前）· Shift+Enter 换行 · @ 唤起 Skill'
    : 'Enter 发送 · Shift+Enter 换行 · @ 唤起 Skill',
);

/** 监听"推荐追问" chip 点击事件（ChatWindow 通过 window.dispatchEvent 触发） */
const onSuggestion = (e: Event) => {
  const ce = e as CustomEvent<string>;
  const text = ce.detail;
  if (!text) return;
  sendMessage(text, { images: [], files: [] });
};
onMounted(() => {
  window.addEventListener('doubao:send-suggestion', onSuggestion as EventListener);
  document.addEventListener('mousedown', onDocClick);
});
onUnmounted(() => {
  window.removeEventListener('doubao:send-suggestion', onSuggestion as EventListener);
  document.removeEventListener('mousedown', onDocClick);
});
</script>

<template>
  <div class="input-panel" ref="panelRef">
    <!-- 当前激活 Skill 提示条 -->
    <div v-if="activeSkillId && activeSkillId !== 'default'" class="input-panel__skill-chip">
      <span class="input-panel__skill-icon">
        <component :is="SKILL_ICONS[activeSkillId] || ThunderboltOutlined" />
      </span>
      <span class="input-panel__skill-name">{{ activeSkill.name }}</span>
      <span class="input-panel__skill-hint">{{ activeSkill.description }}</span>
      <Button
        type="text"
        size="small"
        class="input-panel__skill-close"
        @click="setActiveSkill(null)"
      >
        <template #icon><CloseOutlined /></template>
      </Button>
    </div>

    <div v-if="attachments.length > 0" class="input-panel__attachments">
      <div
        v-for="(a, i) in attachments"
        :key="i"
        class="attachment-chip"
        :class="{ 'is-image': a.kind === 'image' }"
      >
        <img v-if="a.kind === 'image'" :src="a.url" :alt="a.name" class="attachment-chip__thumb" />
        <span v-else class="attachment-chip__icon">📎</span>
        <span class="attachment-chip__name">{{ a.name }}</span>
        <span class="attachment-chip__close" @click="removeAttachment(i)">×</span>
      </div>
    </div>

    <div class="input-panel__toolbar">
      <Tooltip title="加粗">
        <Button type="text" @click="insertMarkdown('**加粗文字**', 4)">
          <template #icon><BoldOutlined /></template>
        </Button>
      </Tooltip>
      <Tooltip title="代码">
        <Button type="text" @click="insertMarkdown('`code`', 1)">
          <template #icon><CodeOutlined /></template>
        </Button>
      </Tooltip>
      <Tooltip title="列表">
        <Button type="text" @click="insertMarkdown('\n- 列表项 1\n- 列表项 2\n')">
          <template #icon><UnorderedListOutlined /></template>
        </Button>
      </Tooltip>
      <Upload accept="image/*" multiple :show-upload-list="false" :before-upload="(f: any) => onUpload(f, 'image')">
        <Tooltip title="上传图片">
          <Button type="text">
            <template #icon><PictureOutlined /></template>
          </Button>
        </Tooltip>
      </Upload>
      <Upload multiple :show-upload-list="false" :before-upload="(f: any) => onUpload(f, 'file')">
        <Tooltip title="上传文件">
          <Button type="text">
            <template #icon><FileAddOutlined /></template>
          </Button>
        </Tooltip>
      </Upload>
      <!-- @ 唤起 Skill -->
      <Tooltip title="唤起 Skill（输入 @ 也可）">
        <Button
          type="text"
          :class="{ 'is-active': activeSkillId && activeSkillId !== 'default' }"
          @click="showSkillMenu = !showSkillMenu"
        >
          <template #icon><ThunderboltOutlined /></template>
        </Button>
      </Tooltip>
      <div style="flex: 1"></div>
      <Tooltip title="清空">
        <Button type="text" @click="onClear">
          <template #icon><ClearOutlined /></template>
        </Button>
      </Tooltip>
    </div>

    <!-- @ 唤起的 Skill 弹窗 -->
    <div v-if="showSkillMenu" class="skill-menu">
      <div class="skill-menu__head">选择 Skill</div>
      <div class="skill-menu__list">
        <button
          v-for="s in SKILLS"
          :key="s.id"
          class="skill-menu__item"
          :class="{ 'is-active': (activeSkillId || 'default') === s.id }"
          @click="onPickSkill(s)"
        >
          <span class="skill-menu__icon">
            <component :is="SKILL_ICONS[s.id] || ThunderboltOutlined" />
          </span>
          <span class="skill-menu__main">
            <span class="skill-menu__name">{{ s.name }}</span>
            <span class="skill-menu__desc">{{ s.description }}</span>
          </span>
        </button>
      </div>
    </div>

    <Input.TextArea
      ref="taRef"
      :value="text"
      :placeholder="placeholder"
      :auto-size="{ minRows: 2, maxRows: 8 }"
      class="input-panel__textarea"
      @input="(e: any) => onTextChange(e.target.value)"
      @keydown="onKeyDown"
    />

    <div class="input-panel__bottom">
      <div class="input-panel__hint">{{ hint }}</div>
      <Space :size="4">
        <Tooltip v-if="isStreaming" title="停止当前生成（不发送新消息）">
          <Button danger type="default" class="input-panel__stop" @click="stop">
            <template #icon><StopOutlined /></template>
            停止
          </Button>
        </Tooltip>
        <Button
          type="primary"
          class="input-panel__send"
          :disabled="!text.trim() && attachments.length === 0"
          @click="onSend"
        >
          <template #icon><SendOutlined /></template>
          发送
        </Button>
      </Space>
    </div>
  </div>
</template>
