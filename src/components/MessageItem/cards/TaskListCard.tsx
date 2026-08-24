/**
 * TaskListCard - 任务清单卡片(含进度)
 * - 独立文件:按需加载
 */
import React from 'react';
import { CheckCircleFilled } from '@ant-design/icons';
import type { TaskItem } from '@/types/message';

const TaskListCardImpl: React.FC<{ title?: string; tasks: TaskItem[] }> = ({ title, tasks }) => {
  if (!tasks?.length) return null;
  const doneCount = tasks.filter((t) => t.done).length;
  const total = tasks.length;
  const pct = Math.round((doneCount / total) * 100);
  return (
    <div className="part-tasks">
      {title && <div className="part-tasks__title">{title}</div>}
      <div className="part-tasks__progress">
        <div className="part-tasks__bar">
          <div className="part-tasks__bar-fill" style={{ width: pct + '%' }} />
        </div>
        <div className="part-tasks__pct">
          {doneCount} / {total} · {pct}%
        </div>
      </div>
      <ul className="part-tasks__list">
        {tasks.map((t, i) => (
          <li key={i} className={`part-tasks__item ${t.done ? 'is-done' : ''}`}>
            <span className="part-tasks__check">
              {t.done ? (
                <CheckCircleFilled style={{ color: '#22c55e' }} />
              ) : (
                <span className="part-tasks__empty" />
              )}
            </span>
            <span className="part-tasks__label">{t.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default TaskListCardImpl;
