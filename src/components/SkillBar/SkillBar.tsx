/**
 * SkillBar - 顶部 Skill/人设 切换器
 * - 对齐豆包：可点击切换"默认 / 深度思考 / 联网搜索 / 翻译 / 写作助手 / 编程助手 / 数据分析"
 * - 当前激活的 Skill 在 store 中持久化
 * - 切换后下条消息的请求会带上 ?skill=xxx 提示服务端注入 system 片段
 */

import React, { useMemo } from 'react';
import { Tooltip } from 'antd';
import { useChatStore } from '@/store/chatStore';
import { SKILLS } from './skills';

export { SKILLS };

export const SkillBar: React.FC = () => {
  const active = useChatStore((s) => s.activeSkillId) || 'default';
  const setActive = useChatStore((s) => s.setActiveSkill);
  const list = useMemo(() => SKILLS, []);

  return (
    <div className="skill-bar">
      {list.map((s) => {
        const isActive = active === s.id;
        return (
          <Tooltip key={s.id} title={s.description} placement="bottom">
            <button
              className={`skill-bar__item ${isActive ? 'is-active' : ''}`}
              onClick={() => setActive(isActive && s.id !== 'default' ? null : s.id)}
            >
              <span className="skill-bar__icon">{s.icon}</span>
              <span className="skill-bar__name">{s.name}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
};
