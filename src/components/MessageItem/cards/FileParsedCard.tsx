/**
 * FileParsedCard - 文件解析摘要卡片(豆包"PDF/Word 总结"场景)
 * - 独立文件:按需加载(文件解析场景)
 */
import React from 'react';
import { Tag } from 'antd';
import { FileSearchOutlined } from '@ant-design/icons';
import type { FileParsed } from '@/types/message';

const FileParsedCardImpl: React.FC<{ data: FileParsed }> = ({ data }) => {
  const sec = data.durationMs ? (data.durationMs / 1000).toFixed(1) + 's' : '';
  return (
    <div className="part-file-parsed">
      <div className="part-file-parsed__head">
        <FileSearchOutlined />
        <span className="part-file-parsed__title">{data.name}</span>
        {data.pages && <Tag color="default">{data.pages} 页</Tag>}
        {sec && <span className="part-file-parsed__meta">解析用时 {sec}</span>}
      </div>
      <div className="part-file-parsed__summary">{data.summary}</div>
      {data.keyPoints.length > 0 && (
        <div className="part-file-parsed__points">
          <div className="part-file-parsed__label">关键要点</div>
          <ul>
            {data.keyPoints.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FileParsedCardImpl;
