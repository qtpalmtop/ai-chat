/**
 * FunctionCallCard - 工具调用卡片(对齐 Function Calling 协议)
 * - 独立文件:按需加载(工具调用场景)
 */
import React, { useState } from 'react';
import {
  CaretRightOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  ExperimentOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { FunctionCallPart } from '@/types/message';

const FunctionCallCardImpl: React.FC<{ call: FunctionCallPart; onRetry?: (id: string) => void }> = ({
  call,
  onRetry,
}) => {
  const [open, setOpen] = useState(true);
  const statusIcon = (() => {
    switch (call.status) {
      case 'pending':
        return <span className="part-fc__dot" />;
      case 'running':
        return <LoadingOutlined spin style={{ color: '#4d6bfe' }} />;
      case 'done':
        return <CheckCircleFilled style={{ color: '#22c55e' }} />;
      case 'error':
        return <CloseCircleFilled style={{ color: '#ef4444' }} />;
    }
  })();
  const statusText = {
    pending: '等待执行',
    running: '执行中',
    done: '已完成',
    error: '执行失败',
  }[call.status];
  const canRetry = call.status === 'error' && (call.retries ?? 0) < 3;

  return (
    <div className={`part-fc part-fc--${call.status}`}>
      <button className="part-fc__head" onClick={() => setOpen((v) => !v)}>
        <span className="part-fc__status">{statusIcon}</span>
        <span className="part-fc__name" title={call.description || call.name}>
          <ExperimentOutlined /> 调用工具 <code>{call.name}</code>
        </span>
        {call.retries != null && call.retries > 0 && (
          <span className="part-fc__retries">已重试 {call.retries} 次</span>
        )}
        <span className="part-fc__state">{statusText}</span>
        <CaretRightOutlined className="part-fc__caret" />
      </button>
      {open && (
        <div className="part-fc__body">
          <div className="part-fc__section">
            <div className="part-fc__label">参数</div>
            <pre className="part-fc__pre">
              <code>{JSON.stringify(call.args, null, 2)}</code>
            </pre>
          </div>
          {call.result !== undefined && (
            <div className="part-fc__section">
              <div className="part-fc__label">结果</div>
              <pre className="part-fc__pre">
                <code>
                  {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
                </code>
              </pre>
            </div>
          )}
          {call.errorMessage && <div className="part-fc__err">{call.errorMessage}</div>}
          {canRetry && (
            <div className="part-fc__actions">
              <button className="part-fc__retry" onClick={() => onRetry?.(call.id)}>
                <ReloadOutlined /> 重试调用
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FunctionCallCardImpl;
