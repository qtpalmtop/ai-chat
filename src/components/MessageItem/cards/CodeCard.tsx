/**
 * CodeCard - 独立代码块卡片
 * - 独立文件:按需加载(编程助手场景)
 */
import React, { useState } from 'react';
import { CodeOutlined, PlayCircleOutlined } from '@ant-design/icons';

const CodeCardImpl: React.FC<{ language: string; content: string; filename?: string }> = ({
  language,
  content,
  filename,
}) => {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="part-code">
      <div className="part-code__head">
        <span className="part-code__lang">
          <CodeOutlined /> {filename || language || 'code'}
        </span>
        <div className="part-code__actions">
          <button className="part-code__btn" onClick={onCopy} title="运行(演示)">
            <PlayCircleOutlined /> 运行
          </button>
          <button className="part-code__btn" onClick={onCopy} title="复制">
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
      <pre className="part-code__pre">
        <code>{content}</code>
      </pre>
    </div>
  );
};

export default CodeCardImpl;
