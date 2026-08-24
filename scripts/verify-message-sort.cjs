/**
 * 端到端验证脚本：消息不重复 / 排序稳定 / ID 不碰撞
 *
 * 测试覆盖：
 *   1. ID 唯一性：5000 条消息不碰撞
 *   2. sortMessagesByServerTime 排序稳定性（同 createdAt / 不同 createdAt / 乱序入参）
 *   3. mergeMessagesById 去重（base + additions 同 id 保留 base，跨组不漏）
 *   4. 时钟回拨：人为把 createdAt 设成乱序（模拟时区/时钟漂移），排序后顺序稳定
 *   5. 不可变性：原数组 / 原 message 对象不被修改
 *
 * 用 Node 直接跑（不依赖 puppeteer / React / Vue 运行时）
 *   node scripts/verify-message-sort.cjs
 *
 * 实现：把两个版本的消息排序工具按 cjs 等价逻辑复制一遍验证。
 * （不 import TS 源码——避免在 Node 下用 ts-node / tsx 跑）
 */

'use strict';

const { customAlphabet } = require('nanoid');

// 模拟 nanoid(12) 生成器
const nanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-',
  12,
);

function sortMessagesByServerTime(messages) {
  if (messages.length < 2) return messages.slice();
  return messages.slice().sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

function mergeMessagesById(base, additions) {
  if (additions.length === 0) return base.slice();
  if (base.length === 0) return sortMessagesByServerTime(additions);
  const map = new Map();
  for (const m of base) map.set(m.id, m);
  for (const m of additions) {
    if (!map.has(m.id)) map.set(m.id, m);
  }
  return sortMessagesByServerTime(Array.from(map.values()));
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓', msg);
  } else {
    failed++;
    console.log('  ✗', msg);
  }
}
function section(name) {
  console.log('\n=== ' + name + ' ===');
}

// ==================== 测试 1: ID 唯一性 ====================
section('1. ID 唯一性：5000 条 nanoid(12) 不碰撞');
{
  const N = 5000;
  const ids = new Set();
  for (let i = 0; i < N; i++) ids.add('m_' + nanoid());
  assert(ids.size === N, `${N} 条 ID 全部唯一 (实际 ${ids.size})`);
}

// ==================== 测试 2: 排序稳定性 ====================
section('2. sortMessagesByServerTime 排序');
{
  // 2.1 乱序入参
  const messages = [
    { id: 'c', createdAt: 300 },
    { id: 'a', createdAt: 100 },
    { id: 'b', createdAt: 200 },
  ];
  const sorted = sortMessagesByServerTime(messages);
  assert(
    sorted.map((m) => m.id).join(',') === 'a,b,c',
    '乱序入参 → 升序输出 (a,b,c)',
  );

  // 2.2 同 createdAt 时按 id 字典序
  const sameTs = [
    { id: 'c', createdAt: 100 },
    { id: 'a', createdAt: 100 },
    { id: 'b', createdAt: 100 },
  ];
  const sortedSame = sortMessagesByServerTime(sameTs);
  assert(
    sortedSame.map((m) => m.id).join(',') === 'a,b,c',
    '同 createdAt → 按 id 字典序 (a,b,c)',
  );

  // 2.3 混合
  const mixed = [
    { id: 'm3', createdAt: 300 },
    { id: 'm1', createdAt: 100 },
    { id: 'm2', createdAt: 200 },
    { id: 'm1b', createdAt: 100 },
    { id: 'm2b', createdAt: 200 },
  ];
  const sortedMixed = sortMessagesByServerTime(mixed);
  const expected = ['m1', 'm1b', 'm2', 'm2b', 'm3'];
  assert(
    sortedMixed.map((m) => m.id).join(',') === expected.join(','),
    '混合 createdAt + 同 createdAt 字典序',
  );

  // 2.4 空数组
  const empty = sortMessagesByServerTime([]);
  assert(empty.length === 0, '空数组 → 空数组');

  // 2.5 单元素
  const one = sortMessagesByServerTime([{ id: 'x', createdAt: 1 }]);
  assert(one.length === 1 && one[0].id === 'x', '单元素 → 单元素');
}

// ==================== 测试 3: mergeMessagesById 去重 ====================
section('3. mergeMessagesById 去重');
{
  const base = [
    { id: 'a', createdAt: 100, status: 'streaming' },
    { id: 'b', createdAt: 200, status: 'done' },
  ];
  const additions = [
    { id: 'a', createdAt: 100, status: 'done' }, // 同 id：保留 base
    { id: 'c', createdAt: 150, status: 'done' }, // 新增
  ];
  const merged = mergeMessagesById(base, additions);
  // 期望：base.a（status=streaming）+ base.b + additions.c，按 createdAt 升序
  assert(merged.length === 3, `合并后 3 条 (实际 ${merged.length})`);
  assert(
    merged[0].id === 'a' && merged[0].status === 'streaming',
    'id=a 保留 base 的版本 (status=streaming)',
  );
  assert(merged[1].id === 'c', 'id=c 按 createdAt=150 排在中间');
  assert(merged[2].id === 'b', 'id=b 按 createdAt=200 排在最后');

  // 3.2 边界：additions 为空
  const m2 = mergeMessagesById(base, []);
  assert(m2.length === 2 && m2[0].id === 'a', 'additions 为空 → 返回 base 副本');

  // 3.3 边界：base 为空
  const m3 = mergeMessagesById([], additions);
  assert(m3.length === 2, 'base 为空 → 返回 sortMessagesByServerTime(additions)');
}

// ==================== 测试 4: 时钟回拨 / 乱序 ====================
section('4. 时钟回拨场景：人为让 createdAt 顺序乱序');
{
  // 模拟客户端时区变更：原本按时间追加的消息，createdAt 突然出现一个"过去时间"
  const messages = [
    { id: '1', createdAt: 1000, role: 'user' },
    { id: '2', createdAt: 1100, role: 'agent' },
    { id: '3', createdAt: 900, role: 'user' }, // 时钟回拨：createdAt=900 应该在 1 前面
    { id: '4', createdAt: 1200, role: 'agent' },
    { id: '5', createdAt: 950, role: 'user' },
  ];
  const sorted = sortMessagesByServerTime(messages);
  const expectedIds = ['3', '5', '1', '2', '4']; // 900, 950, 1000, 1100, 1200
  const actualIds = sorted.map((m) => m.id);
  assert(
    actualIds.join(',') === expectedIds.join(','),
    `乱序 createdAt 排序后稳定为 createdAt 升序: ${actualIds.join(',')}`,
  );
}

// ==================== 测试 5: 不可变性 ====================
section('5. 不可变性：原数组 / 原 message 不被修改');
{
  const original = [
    { id: 'c', createdAt: 300 },
    { id: 'a', createdAt: 100 },
  ];
  const originalRef = original.slice();
  const sorted = sortMessagesByServerTime(original);

  // 原数组顺序不变
  assert(
    original[0].id === originalRef[0].id && original[1].id === originalRef[1].id,
    '原数组顺序不变',
  );

  // 原 message 引用未被替换
  const originalC = original[0];
  const sortedC = sorted[1];
  assert(originalC === sortedC, '原 message 对象引用被保留 (c)');

  // 返回新数组（不是同一个引用）
  assert(original !== sorted, '返回新数组引用');
}

// ==================== 测试 6: 服务端 since 语义模拟 ====================
section('6. 模拟服务端 since 增量同步');
{
  // 服务端 listMessages(sessionId, since) 返回 createdAt > since 的消息
  const dbMessages = [
    { id: '1', createdAt: 100, role: 'user' },
    { id: '2', createdAt: 200, role: 'agent' },
    { id: '3', createdAt: 300, role: 'user' },
    { id: '4', createdAt: 400, role: 'agent' },
  ];
  function listMessages(since) {
    if (since === undefined) return dbMessages.slice();
    return dbMessages.filter((m) => m.createdAt > since);
  }

  // 6.1 since=undefined → 全量
  const all = listMessages(undefined);
  assert(all.length === 4, 'since=undefined → 全量 4 条');

  // 6.2 since=200 → 边界严格大于，返回 3,4
  const after200 = listMessages(200);
  assert(
    after200.length === 2 && after200[0].id === '3' && after200[1].id === '4',
    'since=200 → 返回 createdAt>200 的 2 条 (3,4)',
  );

  // 6.3 客户端用 mergeMessagesById 合并
  const clientLocal = [
    { id: '1', createdAt: 100, status: 'done' },
    { id: '2', createdAt: 200, status: 'done' },
  ];
  const synced = mergeMessagesById(clientLocal, after200);
  assert(
    synced.length === 4 &&
      synced[0].id === '1' &&
      synced[1].id === '2' &&
      synced[2].id === '3' &&
      synced[3].id === '4',
    '客户端 merge: 本地 1,2 + 增量 3,4 → 4 条不重复',
  );
}

// ==================== 总结 ====================
console.log('\n=== 总结 ===');
console.log(`通过：${passed}`);
console.log(`失败：${failed}`);
if (failed > 0) process.exit(1);
console.log('✓ 所有验证通过');
