/**
 * 导航类型
 */
import type { Tool } from '../types';

export type RootStackParamList = {
  Home: undefined;
  WebView: {
    tool: Tool;
  };
};
