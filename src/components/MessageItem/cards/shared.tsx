/**
 * 卡片共享工具函数
 * - formatSize: 文件大小格式化
 * - getFileIcon: 文件类型图标(返回 React 节点)
 */
import React from 'react';
import {
  FileOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined,
} from '@ant-design/icons';

export function formatSize(size: number): string {
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / 1024 / 1024).toFixed(2) + ' MB';
}

export function getFileIcon(name: string): React.ReactNode {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return <FileImageOutlined />;
  if (ext === 'pdf') return <FilePdfOutlined />;
  if (['txt', 'md', 'doc', 'docx'].includes(ext)) return <FileTextOutlined />;
  return <FileOutlined />;
}
