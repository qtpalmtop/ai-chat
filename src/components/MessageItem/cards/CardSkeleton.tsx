/**
 * CardSkeleton - 卡片加载占位
 * - 用于 React.lazy 加载卡片时的占位 UI
 * - 高度 60-100px,与典型卡片视觉重量相近,避免布局抖动
 * - 用 CSS 渐变动画,不依赖 JS,SSR 友好
 */
import React from 'react';

export const CardSkeleton: React.FC<{ height?: number }> = ({ height = 80 }) => (
  <div
    className="part-skeleton"
    style={{
      height,
      background: 'linear-gradient(90deg, #f3f4f6 0%, #e5e7eb 50%, #f3f4f6 100%)',
      backgroundSize: '200% 100%',
      borderRadius: 8,
    }}
  />
);
