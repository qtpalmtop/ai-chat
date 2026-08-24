/**
 * AI 工具箱 App API E2E 测试
 * - 测试 /api/tools 列表
 * - 测试 /api/tools/:id 详情
 * - 测试 /api/tools-config 配置下发
 * - 测试 /api/devices 注册设备（幂等）
 * - 测试 /api/devices/location 上报位置
 *
 * 前置：NestJS 服务跑在 3001
 */
const URL = 'http://localhost:3001';
const TIMEOUT = 5000;

let pass = 0;
let fail = 0;

function ok(name) {
  pass++;
  console.log(`  ✅ ${name}`);
}
function bad(name, e) {
  fail++;
  console.log(`  ❌ ${name}: ${e?.message ?? e}`);
}

async function http(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(`${URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const ct = res.headers.get('content-type') ?? '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  console.log('=== 1. GET /api/tools ===');
  try {
    const r = await http('GET', '/api/tools');
    if (r.status !== 200) throw new Error(`status=${r.status}`);
    if (!Array.isArray(r.data)) throw new Error('not array');
    if (r.data.length === 0) throw new Error('empty list, seed not run?');
    const doubao = r.data.find((t) => t.id === 'doubao-ai');
    if (!doubao) throw new Error('doubao-ai missing');
    if (doubao.type !== 'webview' || !doubao.url) {
      throw new Error(`bad doubao: ${JSON.stringify(doubao)}`);
    }
    ok('GET /api/tools 返回豆包 AI 助手（type=webview, url 非空）');
  } catch (e) { bad('GET /api/tools', e); }

  console.log('=== 2. GET /api/tools/:id ===');
  try {
    const r = await http('GET', '/api/tools/doubao-ai');
    if (r.status !== 200) throw new Error(`status=${r.status}`);
    if (r.data.id !== 'doubao-ai') throw new Error(`id mismatch: ${r.data.id}`);
    ok('GET /api/tools/doubao-ai 返回详情');
  } catch (e) { bad('GET /api/tools/:id', e); }

  try {
    const r = await http('GET', '/api/tools/not-exist');
    if (r.status !== 404) throw new Error(`expected 404, got ${r.status}`);
    ok('GET /api/tools/not-exist 返回 404');
  } catch (e) { bad('GET /api/tools/:id 404', e); }

  console.log('=== 3. GET /api/tools-config ===');
  try {
    const r = await http('GET', '/api/tools-config');
    if (r.status !== 200) throw new Error(`status=${r.status}`);
    if (!r.data.webviewBaseUrl) throw new Error('no webviewBaseUrl');
    ok('GET /api/tools-config 返回 webviewBaseUrl');
  } catch (e) { bad('GET /api/tools-config', e); }

  console.log('=== 4. POST /api/devices 注册 ===');
  let deviceId = null;
  try {
    const r = await http('POST', '/api/devices', {
      pushToken: 'ExponentPushToken[test_token_001]',
      platform: 'ios',
      appVersion: '1.0.0',
      model: 'iPhone15,2',
      osVersion: '17.0',
      timezone: 'Asia/Shanghai',
      locale: 'zh-CN',
      location: { latitude: 31.23, longitude: 121.47 },
    });
    if (r.status !== 200 && r.status !== 201) throw new Error(`status=${r.status}`);
    if (!r.data.deviceId) throw new Error('no deviceId');
    if (!Array.isArray(r.data.tools) || r.data.tools.length === 0) {
      throw new Error('no tools in response');
    }
    if (!r.data.webviewBaseUrl) throw new Error('no webviewBaseUrl');
    deviceId = r.data.deviceId;
    ok(`POST /api/devices 成功（status=${r.status}, deviceId=${deviceId.slice(0, 8)}..., tools=${r.data.tools.length}）`);
  } catch (e) { bad('POST /api/devices', e); }

  console.log('=== 5. POST /api/devices 幂等（同 token）===');
  try {
    const r1 = await http('POST', '/api/devices', {
      pushToken: 'ExponentPushToken[test_idempotent_002]',
      platform: 'android',
      appVersion: '1.0.0',
    });
    const r2 = await http('POST', '/api/devices', {
      pushToken: 'ExponentPushToken[test_idempotent_002]',
      platform: 'android',
      appVersion: '1.0.1',
    });
    if (r1.data.deviceId !== r2.data.deviceId) {
      throw new Error(`deviceId 不稳定: ${r1.data.deviceId} vs ${r2.data.deviceId}`);
    }
    if (r2.data.tools.length === 0) throw new Error('tools empty on second call');
    ok('POST /api/devices 同 token 返回同一 deviceId');
  } catch (e) { bad('POST /api/devices 幂等', e); }

  console.log('=== 6. POST /api/devices 校验 platform ===');
  try {
    const r = await http('POST', '/api/devices', { platform: 'windows' });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}`);
    ok('POST /api/devices 拒绝非法 platform');
  } catch (e) { bad('POST /api/devices 校验', e); }

  console.log('=== 7. POST /api/devices/location ===');
  if (deviceId) {
    try {
      const r = await http(
        'POST',
        '/api/devices/location',
        { latitude: 31.5, longitude: 121.8 },
      );
      if (r.status !== 200) throw new Error(`status=${r.status}`);
      // 注：第一个用例的 deviceId 来自上一步；header 必须传
    } catch (e) { /* first call doesn't have header, expected to fail */ }
    try {
      const r = await fetch(`${URL}/api/devices/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId },
        body: JSON.stringify({ latitude: 31.5, longitude: 121.8 }),
      });
      if (r.status !== 200) throw new Error(`status=${r.status}`);
      ok('POST /api/devices/location 带 X-Device-Id 成功');
    } catch (e) { bad('POST /api/devices/location', e); }
  }

  console.log('=== 8. POST /api/devices/location 无 X-Device-Id ===');
  try {
    const r = await http('POST', '/api/devices/location', {
      latitude: 31.5,
      longitude: 121.8,
    });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}`);
    ok('POST /api/devices/location 缺少 header 返回 400');
  } catch (e) { bad('POST /api/devices/location 缺 header', e); }

  console.log('\n=========================');
  console.log(`✅ ${pass} passed, ❌ ${fail} failed`);
  console.log('=========================');
  if (fail > 0) process.exit(1);
}

run().catch((e) => {
  console.error('fatal:', e);
  process.exit(2);
});
