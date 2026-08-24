/**
 * 通用类型定义
 */
export interface Tool {
  id: string;
  name: string;
  description?: string;
  icon: string; // emoji 或 icon URL
  /** 工具类型：webview 走 WebViewScreen；deeplink 走 Linking.openURL */
  type: 'webview' | 'deeplink' | 'native';
  /** webview 类型时必填，加载的 URL */
  url?: string;
  /** deeplink 类型时必填 */
  deeplink?: string;
  /** 排序（越小越靠前） */
  sortOrder: number;
  /** 是否启用 */
  enabled: boolean;
  /** 标签：用于"附近工具"等筛选 */
  tags?: string[];
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

export interface DeviceRegisterPayload {
  /** expo push token（可选：用户拒绝推送时为空） */
  pushToken?: string;
  /** 平台：ios | android */
  platform: 'ios' | 'android';
  /** 应用版本号 */
  appVersion: string;
  /** 设备型号 */
  model?: string;
  /** 系统版本 */
  osVersion?: string;
  /** 时区 */
  timezone?: string;
  /** 语言 */
  locale?: string;
  /** 粗略位置（用户同意后才上报） */
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface DeviceRegisterResponse {
  deviceId: string;
  tools: Tool[]; // 注册成功同时下发工具列表，省一次请求
  webviewBaseUrl: string; // dev/prod 不同的 webview 域名
}
