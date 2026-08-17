/**
 * TimelineCard - 时间线卡片
 * - 独立文件:按需加载
 */
import React from 'react';
import { ClockCircleOutlined, CheckOutlined } from '@ant-design/icons';
import type { TimelineEvent } from '@/types/message';

const TimelineCardImpl: React.FC<{ title?: string; events: TimelineEvent[] }> = ({ title, events }) => {
  if (!events?.length) return null;
  return (
    <div className="part-timeline">
      {title && <div className="part-timeline__title">{title}</div>}
      <div className="part-timeline__list">
        {events.map((e, i) => (
          <div key={i} className={`part-timeline__item part-timeline__item--${e.status || 'done'}`}>
            <div className="part-timeline__dot">
              {e.status === 'current' ? <ClockCircleOutlined /> : <CheckOutlined />}
            </div>
            <div className="part-timeline__content">
              <div className="part-timeline__time">{e.time}</div>
              <div className="part-timeline__name">{e.title}</div>
              {e.description && <div className="part-timeline__desc">{e.description}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TimelineCardImpl;
