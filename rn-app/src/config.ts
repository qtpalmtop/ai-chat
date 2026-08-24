/**
 * 运行时配置
 * - 通过 expo-constants 读取 app.json / .env 中的变量
 * - 真机调试时必须把 localhost 换成 Mac 的 LAN IP
 */
import Constants from 'expo-constants';

function readEnv(key: string, fallback = ''): string {
  // Expo SDK 50+ 自动把 EXPO_PUBLIC_* 注入到 process.env
  const fromProcess = (process.env as Record<string, string | undefined>)[key];
  if (fromProcess && fromProcess.length > 0) return fromProcess;

  // 兜底：从 expo extra 读（兼容旧版）
  const fromExtra = (Constants.expoConfig?.extra as Record<string, string> | undefined)?.[
    key
  ];
  if (fromExtra && fromExtra.length > 0) return fromExtra;

  return fallback;
}

export const config = {
  apiBaseUrl: readEnv('EXPO_PUBLIC_API_BASE_URL', 'http://localhost:3003'),
  webviewUrl: readEnv('EXPO_PUBLIC_WEBVIEW_URL', 'http://localhost:3003/'),
} as const;

export type AppConfig = typeof config;
