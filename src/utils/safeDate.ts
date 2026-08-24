/**
 * safeDate：iOS Safari 兼容的日期解析
 *
 * 问题：
 *   new Date('2026-08-20')  // iOS Safari 返回 Invalid Date（解析 yyyy-MM-dd 失效）
 *   new Date('2026/08/20')  // OK
 *
 * 解决：
 *   1. 解析时统一把 '-' 替换为 '/'
 *   2. 输出时统一用 ISO 字符串或 'yyyy-MM-dd' 格式
 */
export function safeDate(input: string | number | Date): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  // yyyy-MM-dd → yyyy/MM/dd
  const normalized = input.replace(/-/g, '/');
  const d = new Date(normalized);
  if (isNaN(d.getTime())) {
    // 兜底：手动解析 yyyy-MM-dd HH:mm:ss
    const m = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(
      input,
    );
    if (m) {
      const [, y, mo, da, h = '0', mi = '0', s = '0'] = m;
      return new Date(
        Number(y),
        Number(mo) - 1,
        Number(da),
        Number(h),
        Number(mi),
        Number(s),
      );
    }
    return new Date(NaN);
  }
  return d;
}

/**
 * 格式化日期 yyyy-MM-dd HH:mm（iOS Safari 安全）
 */
export function formatDateTime(d: string | number | Date): string {
  const date = safeDate(d);
  if (isNaN(date.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 相对时间（"X 秒前 / X 分钟前 / X 小时前 / X 天前"） */
export function timeAgo(d: string | number | Date, now: number = Date.now()): string {
  const date = safeDate(d);
  if (isNaN(date.getTime())) return '-';
  const diff = Math.max(0, now - date.getTime());
  if (diff < 30_000) return '刚刚';
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDateTime(date);
}
