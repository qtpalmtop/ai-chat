/**
 * ID 生成器
 * - 替代 nanoid 依赖，自己实现 base36 时间戳 + 随机后缀
 * - 格式：{prefix}_{ts36}_{rand6}
 */
export function newId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}
