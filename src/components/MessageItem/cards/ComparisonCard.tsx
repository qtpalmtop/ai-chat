/**
 * ComparisonCard - 对比卡片(多列对照)
 * - 独立文件:按需加载
 */
import React from 'react';
import type { ComparisonItem } from '@/types/message';

const ComparisonCardImpl: React.FC<{ title?: string; items: ComparisonItem[] }> = ({ title, items }) => {
  if (!items?.length) return null;
  return (
    <div className="part-comparison">
      {title && <div className="part-comparison__title">{title}</div>}
      <div className={`part-comparison__grid part-comparison__grid--${items.length}`}>
        {items.map((it, i) => (
          <div
            key={i}
            className={`part-comparison__item ${it.highlight ? 'is-highlight' : ''}`}
          >
            {it.icon && <div className="part-comparison__icon">{it.icon}</div>}
            <div className="part-comparison__name">{it.name}</div>
            {it.value && <div className="part-comparison__value">{it.value}</div>}
            {it.description && <div className="part-comparison__desc">{it.description}</div>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ComparisonCardImpl;
