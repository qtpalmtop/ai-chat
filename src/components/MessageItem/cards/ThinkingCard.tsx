/**
 * ThinkingCard - 思维链卡片(可折叠,带步骤拆解)
 * - 独立文件:按需加载(深度思考场景)
 */
import React, { useState } from 'react';
import { ThunderboltOutlined, CaretRightOutlined } from '@ant-design/icons';

function splitThinkingSteps(content: string): { steps: string[]; intro?: string; outro?: string } {
  const lines = content.split('\n');
  const stepRe = /^\s*(\d+)\.\s+(.+)$/;
  const steps: { idx: number; text: string }[] = [];
  let introLines: string[] = [];
  let outroLines: string[] = [];
  let inSteps = false;
  let afterSteps = false;
  for (const line of lines) {
    const m = line.match(stepRe);
    if (m && !afterSteps) {
      inSteps = true;
      steps.push({ idx: parseInt(m[1], 10), text: m[2].trim() });
    } else if (inSteps && !stepRe.test(line) && line.trim() === '') {
      continue;
    } else if (inSteps && !stepRe.test(line)) {
      inSteps = false;
      afterSteps = true;
      outroLines.push(line);
    } else if (!inSteps && !afterSteps) {
      introLines.push(line);
    } else {
      outroLines.push(line);
    }
  }
  if (steps.length < 2) {
    return { steps: [], intro: content };
  }
  return {
    steps: steps.map((s) => s.text),
    intro: introLines.join('\n').trim() || undefined,
    outro: outroLines.join('\n').trim() || undefined,
  };
}

const ThinkingCardImpl: React.FC<{ content: string; durationMs?: number }> = ({ content, durationMs }) => {
  const [open, setOpen] = useState(false);
  const sec = durationMs ? (durationMs / 1000).toFixed(1) + 's' : '';
  const { steps, intro, outro } = splitThinkingSteps(content);
  return (
    <div className={`part-thinking ${open ? 'is-open' : ''}`}>
      <button className="part-thinking__head" onClick={() => setOpen((v) => !v)}>
        <span className="part-thinking__icon">
          <ThunderboltOutlined />
        </span>
        <span className="part-thinking__label">{open ? '已展开思考过程' : '已思考'}</span>
        {sec && <span className="part-thinking__meta">用时 {sec}</span>}
        {steps.length > 0 && <span className="part-thinking__count">{steps.length} 步</span>}
        <CaretRightOutlined className="part-thinking__caret" />
      </button>
      {open && (
        <div className="part-thinking__body">
          {intro && <div className="part-thinking__intro">{intro}</div>}
          {steps.length > 0 && (
            <ol className="part-thinking__steps">
              {steps.map((s, i) => (
                <li key={i} className="part-thinking__step">
                  <span className="part-thinking__step-num">{i + 1}</span>
                  <span className="part-thinking__step-text">{s}</span>
                </li>
              ))}
            </ol>
          )}
          {outro && <div className="part-thinking__outro">{outro}</div>}
        </div>
      )}
    </div>
  );
};

export default ThinkingCardImpl;
