import React from 'react';
import { Tag, Image as AntdImage } from 'antd';
import { FileOutlined, FileImageOutlined, FilePdfOutlined, FileTextOutlined } from '@ant-design/icons';
import type { MessagePart } from '@/types/message';

interface Props {
  part: MessagePart;
}

function formatSize(size: number) {
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / 1024 / 1024).toFixed(2) + ' MB';
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return <FileImageOutlined />;
  if (ext === 'pdf') return <FilePdfOutlined />;
  if (['txt', 'md', 'doc', 'docx'].includes(ext)) return <FileTextOutlined />;
  return <FileOutlined />;
}

export const PartRenderer: React.FC<Props> = ({ part }) => {
  switch (part.type) {
    case 'text':
      return <div className="part-text">{part.content}</div>;
    case 'markdown':
      // Markdown 由 MarkdownStream 在外层处理
      return null;
    case 'rich':
      return <div className="part-rich" dangerouslySetInnerHTML={{ __html: part.html }} />;
    case 'image':
      return (
        <div className="part-image">
          <AntdImage src={part.url} alt={part.alt} width={180} style={{ borderRadius: 8 }} />
        </div>
      );
    case 'file':
      return (
        <a className="part-file" href={part.url} target="_blank" rel="noreferrer">
          <span className="part-file__icon">{getFileIcon(part.name)}</span>
          <div className="part-file__meta">
            <div className="part-file__name">{part.name}</div>
            <div className="part-file__size">{formatSize(part.size)}</div>
          </div>
        </a>
      );
    default:
      return null;
  }
};
