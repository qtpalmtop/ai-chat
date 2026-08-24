/**
 * 网络诊断
 * - 启动时 ping 一下 API base URL
 * - 失败时给用户清晰的排查提示
 */
import { config } from '../config';

export interface DiagResult {
  ok: boolean;
  url: string;
  status?: number;
  error?: string;
  hint?: string;
}

export async function diagnoseApi(): Promise<DiagResult> {
  const url = `${config.apiBaseUrl}/api/tools-config`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return {
      ok: res.ok,
      url,
      status: res.status,
      hint: res.ok
        ? undefined
        : `后端返回 ${res.status}，检查 NestJS 是否启动、路由是否注册`,
    };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return {
      ok: false,
      url,
      error: msg,
      hint: buildHint(msg, config.apiBaseUrl),
    };
  }
}

function buildHint(errMsg: string, baseUrl: string): string {
  if (errMsg.includes('Network request failed') || errMsg.includes('timeout')) {
    return (
      '连接后端失败。排查：\n' +
      '1) 后端是否启动：`lsof -nP -iTCP:3001 -sTCP:LISTEN`\n' +
      `2) 当前 baseUrl: ${baseUrl}\n` +
      '3) iPhone 和 Mac 必须在同一 Wi-Fi\n' +
      '4) 真机/模拟器地址不同：真机用 Mac LAN IP；iOS 模拟器用 localhost；Android 模拟器用 10.0.2.2\n' +
      '5) 改了 .env 必须重启 Metro：`npx expo start -c`\n' +
      '6) 在 iPhone Safari 打开 ' +
      baseUrl +
      '/api/tools 验证'
    );
  }
  return errMsg;
}
