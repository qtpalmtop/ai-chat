/**
 * 业务 API 端点
 */
import { api } from './client';
import type { DeviceRegisterPayload, DeviceRegisterResponse, Tool } from '../types';

export const toolApi = {
  /** 获取工具列表（带缓存策略：内存 +5min） */
  list: () => api.get<Tool[]>('/api/tools'),

  /** 获取单个工具详情 */
  detail: (id: string) => api.get<Tool>(`/api/tools/${encodeURIComponent(id)}`),
};

export const deviceApi = {
  /** 注册/更新设备信息，返回 deviceId + 工具列表 + webview 域名 */
  register: (payload: DeviceRegisterPayload) =>
    api.post<DeviceRegisterResponse>('/api/devices', payload),

  /** 上报位置（仅在用户同意后调用） */
  reportLocation: (location: { latitude: number; longitude: number }) =>
    api.post<{ ok: true }>('/api/devices/location', location),
};
