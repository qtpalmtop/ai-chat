/**
 * 工具 URL 解析
 * - 优先用 tool.url 中的相对路径 + 当前 baseUrl 拼
 * - 如果 tool.url 已经是完整 http(s) URL：
 *   - 同 host / localhost / 127.0.0.1 / 私有 IP：替换 protocol+host（dev/prod 切换、地址变更）
 *   - 其他（外站）：保留
 * - 这样历史 seed 的 http://localhost:3001/ 数据也自动跟新 base 走
 * - 同时新 seed 只需存相对路径 '/'
 *
 * @example
 *   resolveToolUrl('/', 'http://192.168.0.105:3001/')
 *   // => 'http://192.168.0.105:3001/'
 *
 *   resolveToolUrl('http://localhost:3001/', 'http://192.168.0.105:3001/')
 *   // => 'http://192.168.0.105:3001/'
 *
 *   resolveToolUrl('https://other.com/x', 'http://localhost:3001/')
 *   // => 'https://other.com/x'（外站保留）
 */
export function resolveToolUrl(
  toolUrl: string | null | undefined,
  baseUrl: string,
): string | null {
  if (!toolUrl) return null;

  // 完整 URL
  if (/^https?:\/\//i.test(toolUrl)) {
    try {
      const u = new URL(toolUrl);
      const b = new URL(baseUrl);
      if (isLocalishHost(u.hostname) || u.hostname === b.hostname) {
        u.protocol = b.protocol;
        u.host = b.host;
        return u.toString();
      }
      return toolUrl;
    } catch {
      return toolUrl;
    }
  }

  // 相对路径
  const base = baseUrl.replace(/\/+$/, '');
  const path = toolUrl.startsWith('/') ? toolUrl : `/${toolUrl}`;
  return `${base}${path}`;
}

/**
 * 是否是 loopback / 私有 IP —— 这些 host 在 dev/prod 切换时都应该被覆盖
 */
function isLocalishHost(host: string): boolean {
  if (host === 'localhost') return true;
  if (host === '127.0.0.1' || host === '::1') return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

