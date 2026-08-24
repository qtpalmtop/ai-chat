/**
 * 通用常量（颜色、间距、字号、栅格）
 */
export const colors = {
  primary: '#4d6bfe',
  primaryGradientEnd: '#7b5cff',
  bg: '#f5f7fb',
  bgCard: '#ffffff',
  text: '#1f2329',
  textSecondary: '#4e5969',
  textMuted: '#8c8c8c',
  border: '#eef0f4',
  danger: '#ff4d4f',
  success: '#52c41a',
  warning: '#faad14',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
} as const;
