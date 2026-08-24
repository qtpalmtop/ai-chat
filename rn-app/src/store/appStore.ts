/**
 * App 状态（zustand）
 * - 工具列表、加载态、错误态
 * - 设备 token、webviewBaseUrl（来自后端下发）
 * - 当前用户选择的位置
 */
import { create } from 'zustand';
import { deviceApi, toolApi } from '../api';
import { deviceInfo } from '../services/deviceInfo';
import { locationService } from '../services/location';
import { pushService } from '../services/push';
import { diagnoseApi } from '../utils/diagnose';
import type { Tool } from '../types';

interface AppState {
  /** 工具列表 */
  tools: Tool[];
  /** 工具列表加载状态 */
  toolsStatus: 'idle' | 'loading' | 'success' | 'error';
  /** 工具列表错误信息 */
  toolsError: string | null;

  /** 设备 token（来自后端） */
  deviceId: string | null;
  /** WebView 基础 URL（来自后端配置下发） */
  webviewBaseUrl: string | null;

  /** 启动流程是否完成（注册 + 拉取 tools） */
  bootDone: boolean;

  /** 拉取工具列表 */
  fetchTools: () => Promise<void>;
  /** 启动：注册设备 + 拉取工具列表 */
  bootstrap: () => Promise<void>;
  /** 清空错误并重试 */
  retry: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  tools: [],
  toolsStatus: 'idle',
  toolsError: null,
  deviceId: null,
  webviewBaseUrl: null,
  bootDone: false,

  async fetchTools() {
    set({ toolsStatus: 'loading', toolsError: null });
    try {
      const tools = await toolApi.list();
      // 过滤掉 disabled 的，并按 sortOrder 升序
      const list = tools
        .filter((t) => t.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      set({ tools: list, toolsStatus: 'success' });
    } catch (e) {
      set({
        toolsStatus: 'error',
        toolsError: (e as Error).message ?? '加载工具列表失败',
      });
    }
  },

  async bootstrap() {
    set({ toolsStatus: 'loading', toolsError: null });
    // 先 ping 一下，便于失败时给出精确提示
    const diag = await diagnoseApi();
    if (!diag.ok) {
      const msg = diag.hint || diag.error || '网络诊断失败';
      console.warn('[bootstrap] diag failed:', diag);
      // 即使 ping 失败也继续尝试（可能是 /tools-config 没注册但 /devices 在）
    }
    try {
      // 1) 推送 token（异步，不阻塞）
      const pushTokenPromise = pushService.register().catch(() => null);

      // 2) 可选位置（用户拒绝时为 null）
      const locationPromise = locationService
        .getCurrent()
        .catch(() => null);

      const [pushToken, location] = await Promise.all([
        pushTokenPromise,
        locationPromise,
      ]);

      // 3) 注册设备 + 拿到工具列表
      const resp = await deviceApi.register({
        pushToken: pushToken ?? undefined,
        platform: deviceInfo.platform,
        appVersion: deviceInfo.appVersion,
        model: deviceInfo.model,
        osVersion: deviceInfo.osVersion,
        timezone: deviceInfo.timezone,
        locale: deviceInfo.locale,
        location: location ?? undefined,
      });

      const list = resp.tools
        .filter((t) => t.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      set({
        deviceId: resp.deviceId,
        webviewBaseUrl: resp.webviewBaseUrl,
        tools: list,
        toolsStatus: 'success',
        toolsError: null,
        bootDone: true,
      });
    } catch (e) {
      // 启动失败：降级到仅拉取工具列表
      console.warn('[bootstrap] failed, fallback to tools-only:', e);
      const err = e as Error;
      // 尝试只拉取工具列表
      try {
        await get().fetchTools();
      } catch {
        set({
          toolsStatus: 'error',
          toolsError: err.message ?? '启动失败',
        });
      }
      set({ bootDone: true });
    }
  },

  async retry() {
    if (get().deviceId) {
      await get().fetchTools();
    } else {
      await get().bootstrap();
    }
  },
}));
