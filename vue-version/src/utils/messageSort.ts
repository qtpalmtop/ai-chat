/**
 * 消息重排：按 createdAt 升序（Vue 版 - 与 React 端 src/utils/messageSort.ts 对齐）
 *
 * 为什么需要重排：
 *   1. 客户端时区变更、时钟漂移 → 本地 Date.now() 顺序与消息实际到达顺序可能错位
 *   2. WS 批量转发：服务端可能同时推多条消息，多条消息的 createdAt 可能出现乱序
 *   3. 断网重连增量同步：since 边界处的消息顺序需稳定
 *   4. 客户端 + 客服端同会话内交错发消息：双方本地时钟不同步，createdAt 顺序乱
 *
 * 排序策略：
 *   - 主键：createdAt 升序
 *   - 次键：id 字典序（保证稳定 + 可预测）
 *
 * 不可变性：
 *   - 不修改入参数组
 *   - 不修改入参 message 对象（保持引用稳定，下游 computed 能复用）
 *   - 返回新数组
 */
export function sortMessagesByServerTime<T extends { id: string; createdAt: number }>(
  messages: readonly T[],
): T[] {
  if (messages.length < 2) return messages.slice();
  return messages.slice().sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    // 同 createdAt：按 id 字典序，保证稳定
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

/**
 * 按 id 合并两个消息列表：去重 + 排序
 * - 用于"客户端乐观追加 + 服务端 WS 转发回来"的合并场景
 * - 同 id 时优先保留 base 列表中的版本（更新状态的部分）
 */
export function mergeMessagesById<T extends { id: string; createdAt: number }>(
  base: readonly T[],
  additions: readonly T[],
): T[] {
  if (additions.length === 0) return base.slice();
  if (base.length === 0) return sortMessagesByServerTime(additions);
  const map = new Map<string, T>();
  for (const m of base) map.set(m.id, m);
  for (const m of additions) {
    // 保留 base 中已存在的（更新状态的部分），避免被旧数据覆盖
    if (!map.has(m.id)) map.set(m.id, m);
  }
  return sortMessagesByServerTime(Array.from(map.values()));
}
