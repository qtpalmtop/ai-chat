<script setup lang="ts">
/**
 * PartRenderer - 渲染单条 part（text / markdown / rich / image / file）
 * Markdown 由 MarkdownStream 外层处理
 */

import { computed } from 'vue';
import { Tag } from 'ant-design-vue';
import { Image as AntdImage } from 'ant-design-vue';
import {
  FileOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue';
import type { MessagePart } from '@/types/message';

interface Props {
  part: MessagePart;
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
</script>

<template>
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
</template>
