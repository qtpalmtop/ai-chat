import type { SkillMeta } from '@/types/message';

/** 全局 Skill 列表（React / Vue 共用） */
export const SKILLS: SkillMeta[] = [
  { id: 'default', name: '默认', icon: '💬', description: '通用对话模式' },
  { id: 'thinking', name: '深度思考', icon: '🧠', description: '启用 CoT，展示思维链卡片' },
  { id: 'web', name: '联网搜索', icon: '🌐', description: '基于真实搜索结果回答，附带引用' },
  { id: 'translate', name: '翻译', icon: '🌍', description: '多语种互译 + 上下文理解' },
  { id: 'writer', name: '写作助手', icon: '✍️', description: '文案、报告、创意写作' },
  { id: 'coder', name: '编程助手', icon: '💻', description: '代码生成、解释、Bug 修复' },
  { id: 'analyst', name: '数据分析', icon: '📊', description: '图表化呈现数据洞察' },
];
