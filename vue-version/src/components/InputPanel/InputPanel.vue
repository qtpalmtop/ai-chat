<script setup lang="ts">
/**
 * 输入区 - 多模态输入
 * - 文本 + 富文本工具栏 + 图片 + 文件
 * - Enter 发送 / Shift+Enter 换行
 * - 允许在 AI 生成中继续输入：
 *   - 输入框始终可写
 *   - 按 Enter 发送时若正在 streaming，先 stop 旧流（标 'interrupted'），再发新消息
 *
 * 客服会话状态分支（与 React 端 InputPanel.tsx 对齐）：
 *   - idle:     显示普通 AI 输入框 + "转人工"按钮
 *   - queued:   显示排队卡片（位置/等待时长/取消按钮）
 *   - inSession:显示客服对话输入框（顶部 banner + 结束对话按钮）
 *   - ended:    显示轻量"已结束"提示（不可发消息）
 *
 * 与 React 端的关键差异：
 *   - 用 ref + reactive 替代 React useState
 *   - store 变化自动驱动组件（storeToRefs 派生）
 *   - ant-design-vue 提供 v-model:value 等双向绑定
 */

import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
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
  CustomerServiceOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons-vue';
import { storeToRefs } from 'pinia';
import { useChat } from '@/composables/useChat';
import { useChatStore } from '@/stores/chatStore';
import { useAgentStore } from '@/stores/agentStore';
import { useAgentSocket } from '@/composables/useAgentSocket';
import { SKILLS } from '@/components/SkillBar/skills';
import type { MessagePart } from '@/types/message';
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
const chatStore = useChatStore();
const { currentSessionId, messages, activeSkillId } = storeToRefs(chatStore);
const setActiveSkill = (id: string | null) => chatStore.setActiveSkill(id);

// ===== 客服会话状态 =====
const agentStore = useAgentStore();
const { clientSession, connection } = storeToRefs(agentStore);
const setMode = agentStore.setMode;
const setClientIdentity = agentStore.setClientIdentity.bind(agentStore);
const requestTransferHuman = agentStore.requestTransferHuman.bind(agentStore);
const cancelQueue = agentStore.cancelQueue.bind(agentStore);
const sendClientMessage = agentStore.sendClientMessage.bind(agentStore);
const endClientSession = agentStore.endClientSession.bind(agentStore);
const onSystemEvent = agentStore.onSystemEvent.bind(agentStore);

// 首次挂载：进入 client 模式 + 自动生成/恢复 clientId
// （与 React 端 useEffect 行为一致）
onMounted(() => {
  setMode('client');
  // clientId 已经在 store state 初始化时从 persisted.localStorage / nanoid 生成
  // 这里不再覆盖（与 React 端 `if (!clientUserId) ...` 语义一致——已有就保留）
  if (!agentStore.clientId) {
    setClientIdentity(`client-${Date.now().toString(36)}`);
  }
  // 立即连接 WS（用 watch 监听 id 变化重连也可以，但这里我们一次连接即可）
  connect();
});

// 监听 sessionId 变化清空本地输入态（避免切会话残留旧输入）
const prevSessionIdRef = ref<string | null>(currentSessionId.value);
watch(currentSessionId, (next) => {
  if (prevSessionIdRef.value !== next) {
    prevSessionIdRef.value = next;
    text.value = '';
    attachments.value = [];
  }
});

// 流式状态完全按"当前会话"的消息状态判定
const isStreaming = computed(() => {
  if (!currentSessionId.value) return false;
  const list = messages.value[currentSessionId.value];
  return !!list?.some((m) => m.status === 'streaming');
});

const activeSkill = computed<SkillMeta>(
  () => SKILLS.find((s) => s.id === (activeSkillId.value || 'default')) || SKILLS[0],
);

// 客服连接 WS（ref 模式：只在 mount 时连接一次）
// 注意：useAgentSocket 内部在 onBeforeUnmount 自动 disconnect，无需手动管理
const { send: wsSend, isOpen: wsOpen, connect } = useAgentSocket({
  mode: 'client',
  onEvent: onSystemEvent,
});

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

/**
 * 构造消息 parts（与 React 端一致）：
 *   - 纯文本/带换行 → markdown
 *   - 图片 → image part
 *   - 文件 → file part
 */
const buildParts = (trimmed: string): MessagePart[] => {
  const parts: MessagePart[] = [];
  if (trimmed) {
    parts.push({ type: trimmed.includes('\n') ? 'markdown' : 'text', content: trimmed });
  }
  for (const a of attachments.value) {
    if (a.kind === 'image') {
      parts.push({ type: 'image', url: a.url, alt: a.name });
    } else {
      parts.push({
        type: 'file',
        name: a.name,
        size: a.size,
        url: a.url,
        mime: a.mime,
      });
    }
  }
  return parts;
};

const onSend = () => {
  const trimmed = text.value.trim();
  if (!trimmed && attachments.value.length === 0) {
    antdMsg.warning('说点什么再发送吧');
    return;
  }

  // ===== 客服对话模式：发到客服（WS）=====
  // 与 React 端 onSend 完全对齐：走 store.sendClientMessage 乐观追加 + wsSend 发到服务端
  if (clientSession.value?.status === 'inSession' && wsOpen.value) {
    const parts = buildParts(trimmed);
    const messageId = sendClientMessage(parts);
    if (messageId) {
      wsSend({ type: 'client.send', sessionId: clientSession.value.sessionId || '', parts });
      text.value = '';
      attachments.value = [];
    }
    return;
  }

  // ===== 普通 AI 对话模式 =====
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

/** 点击 "转人工"：向 server 发起转人工请求 */
const onTransferHuman = () => {
  if (!wsOpen.value) {
    antdMsg.warning('连接尚未就绪，请稍后再试');
    return;
  }
  requestTransferHuman('normal');
  wsSend({ type: 'client.transfer_human', reason: 'normal' });
};

/** 取消排队 */
const onCancelQueue = () => {
  cancelQueue();
  wsSend({ type: 'client.cancel_queue' });
};

/** 结束客服对话 */
const onEndSession = () => {
  endClientSession();
  const sid = clientSession.value?.sessionId;
  if (sid) {
    wsSend({ type: 'client.end_session', sessionId: sid });
  }
};

const onKeyDown = (e: KeyboardEvent) => {
  // 兜底：Cmd/Ctrl + A 全选。
  // antd-vue Input.TextArea 在 controlled value 模式下，
  // macOS Chrome/Safari 的 Cmd+A 浏览器默认 select-all 行为不可靠
  // （puppeteer 模拟 + 真实浏览器均可复现：selection 仍停在光标处）。
  // 手动 select() 兜底，不 preventDefault 让浏览器先尝试默认行为。
  if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
    const t = e.target as HTMLTextAreaElement | null;
    if (t && typeof t.select === 'function') {
      // 延后到 keydown 同步代码执行完后再 select，避免 antd-vue 内部 onKeydown
      // 链路上有 setSelectionRange 之类的覆盖
      requestAnimationFrame(() => {
        try {
          t.focus();
          t.select();
        } catch {
          /* noop */
        }
      });
    }
  }
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

const placeholder = computed(() => {
  if (clientSession.value?.status === 'inSession') {
    return `正在和 ${clientSession.value.agentName || '客服'} 对话…`;
  }
  return isStreaming.value
    ? 'AI 正在回复中…（继续输入会打断当前回复；输入 @ 唤起 Skill）'
    : '请输入消息，回车发送，Shift+回车换行，输入 @ 唤起 Skill';
});

const hint = computed(() => {
  if (clientSession.value?.status === 'inSession') {
    return connection.value === 'open' ? 'Enter 发送 · Shift+Enter 换行' : '连接已断开，正在重连…';
  }
  return isStreaming.value
    ? 'Enter 发送（打断当前）· Shift+Enter 换行 · @ 唤起 Skill'
    : 'Enter 发送 · Shift+Enter 换行 · @ 唤起 Skill';
});

/** 监听"推荐追问" chip 点击事件（ChatWindow 通过 window.dispatchEvent 触发） */
const onSuggestion = (e: Event) => {
  const ce = e as CustomEvent<string>;
  const t = ce.detail;
  if (!t) return;
  sendMessage(t, { images: [], files: [] });
};

// 排队等待文案（与 React 端一致）
const waitMin = computed(() => {
  const cs = clientSession.value;
  if (!cs?.estimatedWaitSec) return 1;
  return Math.max(1, Math.ceil(cs.estimatedWaitSec / 60));
});

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
  <!-- ===== 状态分支：排队中 ===== -->
  <div
    v-if="clientSession?.status === 'queued'"
    class="input-panel input-panel--agent"
    ref="panelRef"
  >
    <div class="agent-queue">
      <div class="agent-queue__icon">
        <ClockCircleOutlined spin />
      </div>
      <div class="agent-queue__title">正在为您接入客服…</div>
      <div class="agent-queue__sub">
        当前排队位置：<b>第 {{ clientSession.queuePosition || 1 }} 位</b>，预计等待约
        <b>{{ waitMin }} 分钟</b>
      </div>
      <div class="agent-queue__tip">客服接入后将自动开始对话，请稍候</div>
      <Button @click="onCancelQueue" class="agent-queue__cancel">取消排队</Button>
    </div>
  </div>

  <!-- ===== 状态分支：客服对话中 ===== -->
  <div
    v-else-if="clientSession?.status === 'inSession'"
    class="input-panel input-panel--agent"
    ref="panelRef"
  >
    <div class="agent-banner">
      <CustomerServiceOutlined class="agent-banner__icon" />
      <span class="agent-banner__label">客服对话中</span>
      <span class="agent-banner__name">
        {{ clientSession.agentName || '客服' }}
        <CheckCircleOutlined class="agent-banner__verified" />
      </span>
      <div style="flex: 1"></div>
      <Button size="small" type="text" danger @click="onEndSession">结束对话</Button>
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

  <!-- ===== 状态分支：客服会话已结束 ===== -->
  <div
    v-else-if="clientSession.status === 'ended'"
    class="input-panel input-panel--agent input-panel--ended"
    ref="panelRef"
  >
    <div class="agent-ended-hint">
      <CheckCircleOutlined style="color: #52c41a; margin-right: 6px" />
      <span>本次客服对话已结束</span>
      <span class="agent-ended-hint__sub">
        如需继续咨询，请点击聊天区上方"再次转人工"
      </span>
    </div>
  </div>

  <!-- ===== 状态分支：idle（普通 AI 对话，可选转人工）===== -->
  <div v-else class="input-panel" ref="panelRef">
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
      <Upload
        accept="image/*"
        multiple
        :show-upload-list="false"
        :before-upload="(f: any) => onUpload(f, 'image')"
      >
        <Tooltip title="上传图片">
          <Button type="text">
            <template #icon><PictureOutlined /></template>
          </Button>
        </Tooltip>
      </Upload>
      <Upload
        multiple
        :show-upload-list="false"
        :before-upload="(f: any) => onUpload(f, 'file')"
      >
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
        <!-- 转人工按钮：仅在 idle 状态显示 -->
        <Tooltip title="转人工客服">
          <Button
            class="input-panel__transfer"
            :disabled="!wsOpen"
            @click="onTransferHuman"
          >
            <template #icon><CustomerServiceOutlined /></template>
            转人工
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
