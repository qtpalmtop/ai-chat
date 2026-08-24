/**
 * CitationCard - 引用来源卡片
 * - 独立文件:按需加载(联网搜索场景)
 */
import React from 'react';
import { GlobalOutlined, LinkOutlined } from '@ant-design/icons';
import type { CitationSource } from '@/types/message';

const CitationCardImpl: React.FC<{ sources: CitationSource[] }> = ({ sources }) => {
  if (!sources?.length) return null;
  return (
    <div className="part-citation">
      <div className="part-citation__head">
        <GlobalOutlined /> <span>{sources.length} 个来源</span>
      </div>
      <div className="part-citation__list">
        {sources.map((s) => (
          <a
            key={s.index}
            className="part-citation__item"
            href={s.url || '#'}
            target="_blank"
            rel="noreferrer"
          >
            <span className="part-citation__num">[{s.index}]</span>
            <span className="part-citation__title">{s.title}</span>
            {s.source && <span className="part-citation__src">{s.source}</span>}
            {s.url && <LinkOutlined className="part-citation__link" />}
          </a>
        ))}
      </div>
    </div>
  );
};

export default CitationCardImpl;
