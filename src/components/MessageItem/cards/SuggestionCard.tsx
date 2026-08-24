/**
 * SuggestionCard - 推荐追问 chip 列表
 * - 独立文件:按需加载
 */
import React from 'react';

const SuggestionCardImpl: React.FC<{ items: string[]; onPick?: (s: string) => void }> = ({
  items,
  onPick,
}) => {
  if (!items?.length) return null;
  return (
    <div className="part-suggestion">
      <div className="part-suggestion__head">推荐追问</div>
      <div className="part-suggestion__list">
        {items.map((s, i) => (
          <button key={i} className="part-suggestion__chip" onClick={() => onPick?.(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SuggestionCardImpl;
