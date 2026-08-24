/**
 * 配置 schema：所有环境变量的强类型访问点
 * 通过 @nestjs/config 注入到各 Module
 */
export interface AppConfig {
  port: number;
  isProd: boolean;
  env: string;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
  };
  business: {
    userInactivityTimeoutMs: number;
    historyRetentionMs: number;
    historyMaxPerAgent: number;
    suggestionDelayMs: number;
    heartbeatIntervalMs: number;
  };
  /**
   * WebView 容器内嵌的 H5 页面地址
   * - dev 默认 http://localhost:3001/（模拟器内 localhost 指代宿主机）
   * - 真机调试需改成 http://<Mac-LAN-IP>:3001/
   * - prod 走线上域名
   * 通过环境变量 WEBVIEW_BASE_URL 覆盖
   */
  webview: {
    baseUrl: string;
  };
  corsOrigin: string;
}

export default (): AppConfig => ({
  port: Number(process.env.PORT) || 3001,
  isProd: process.env.NODE_ENV === 'production',
  env: process.env.APP_ENV || process.env.NODE_ENV || 'development',
  database: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'doubao',
    password: process.env.DB_PASSWORD || 'doubao_pwd',
    name: process.env.DB_NAME || 'doubao_ai',
  },
  business: {
    userInactivityTimeoutMs: Number(process.env.USER_INACTIVITY_TIMEOUT_MS) || 30_000,
    historyRetentionMs: Number(process.env.HISTORY_RETENTION_MS) || 86_400_000,
    historyMaxPerAgent: Number(process.env.HISTORY_MAX_PER_AGENT) || 200,
    suggestionDelayMs: Number(process.env.SUGGESTION_DELAY_MS) || 1500,
    heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS) || 25_000,
  },
  webview: {
    baseUrl: process.env.WEBVIEW_BASE_URL || 'http://localhost:3003/',
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
});
