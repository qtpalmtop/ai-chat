<script setup lang="ts">
/**
 * SkillBar - 顶部 Skill/人设 切换器（Vue 版）
 * - 对齐豆包：可点击切换"默认 / 深度思考 / 联网搜索 / 翻译 / 写作助手 / 编程助手 / 数据分析"
 * - 当前激活的 Skill 在 store 中持久化
 */

import { Tooltip } from 'ant-design-vue';
import { storeToRefs } from 'pinia';
import { useChatStore } from '@/stores/chatStore';
import { SKILLS } from './skills';

const store = useChatStore();
const { activeSkillId } = storeToRefs(store);
const active = () => activeSkillId.value || 'default';

const onPick = (id: string) => {
  const cur = active();
  // 重复点同一项则取消（默认不可关）
  if (cur === id && id !== 'default') {
    store.setActiveSkill(null);
  } else {
    store.setActiveSkill(id);
  }
};
</script>

<template>
  <div class="skill-bar">
    <Tooltip
      v-for="s in SKILLS"
      :key="s.id"
      :title="s.description"
      placement="bottom"
    >
      <button
        class="skill-bar__item"
        :class="{ 'is-active': active() === s.id }"
        @click="onPick(s.id)"
      >
        <span class="skill-bar__icon">{{ s.icon }}</span>
        <span class="skill-bar__name">{{ s.name }}</span>
      </button>
    </Tooltip>
  </div>
</template>
