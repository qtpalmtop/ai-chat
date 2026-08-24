/**
 * 端到端验证脚本：vue 用户端会话聊天页
 * 验证项：
 *   1. 页面加载无控制台报错
 *   2. InputPanel 渲染、显示"转人工"按钮
 *   3. agentStore 已初始化（clientId / clientSession.status === 'idle'）
 *   4. useAgentSocket 已连接（store.connection === 'open'）
 *   5. 点击"转人工"按钮，触发后 clientSession.status 变 'queued'
 */
const puppeteer = require('puppeteer');

const APP_URL = 'http://localhost:3003/';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);

    // 收集 console 错误
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });

    console.log('>>> 1) 打开页面:', APP_URL);
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });

    // 等待 InputPanel 渲染（"转人工"按钮出现）
    console.log('>>> 2) 等待"转人工"按钮...');
    await page.waitForSelector('.input-panel__transfer', { timeout: 10000 });
    console.log('    转人工按钮存在');

    // 检查"转人工"按钮文本
    const transferBtnText = await page.evaluate(() => {
      const btn = document.querySelector('.input-panel__transfer');
      return btn ? btn.textContent.trim() : null;
    });
    console.log('    转人工按钮文本:', transferBtnText);

    // 通过 page 拿 Pinia store（pinia 暴露在 window 上）
    const storeState = await page.evaluate(() => {
      // Pinia store 实例通过 __VUE_DEVTOOLS_PLUGIN__ 或直接拿
      // 我们通过 Vue app instance 拿
      const app = document.getElementById('app');
      if (!app) return { error: 'no app' };
      const vueApp = app.__vue_app__;
      if (!vueApp) return { error: 'no vue app' };
      const pinia = vueApp.config.globalProperties.$pinia;
      if (!pinia) return { error: 'no pinia' };
      const agent = pinia.state.value.agent;
      if (!agent) return { error: 'no agent store' };
      return {
        clientId: agent.clientId,
        userName: agent.userName,
        mode: agent.mode,
        connection: agent.connection,
        clientSession: agent.clientSession
          ? {
              status: agent.clientSession.status,
              messagesCount: agent.clientSession.messages?.length || 0,
            }
          : null,
      };
    });
    console.log('>>> 3) agentStore 状态:', JSON.stringify(storeState, null, 2));

    // 验证关键字段
    const checks = [];
    if (storeState.clientId) checks.push('OK clientId 已生成');
    else checks.push('FAIL clientId 缺失');
    if (storeState.clientSession?.status === 'idle')
      checks.push('OK clientSession.status = idle（正常）');
    else checks.push(`FAIL clientSession.status = ${storeState.clientSession?.status}`);
    if (storeState.connection === 'open') checks.push('OK WS 已连接 (connection=open)');
    else checks.push(`WARN WS 未连接 (connection=${storeState.connection})`);
    if (storeState.mode === 'client') checks.push('OK mode = client');
    else checks.push(`WARN mode = ${storeState.mode}`);

    console.log('>>> 4) 验证结果:');
    checks.forEach((c) => console.log('   ', c));

    // ===== 测试点击"转人工"按钮 =====
    console.log('>>> 5) 点击"转人工"按钮...');
    const beforeClick = await page.evaluate(() => {
      const vueApp = document.getElementById('app').__vue_app__;
      const agent = vueApp.config.globalProperties.$pinia.state.value.agent;
      return { status: agent.clientSession?.status, connection: agent.connection };
    });
    console.log('    点击前状态:', beforeClick);

    await page.click('.input-panel__transfer');
    await new Promise((r) => setTimeout(r, 1500));

    const afterClick = await page.evaluate(() => {
      const vueApp = document.getElementById('app').__vue_app__;
      const agent = vueApp.config.globalProperties.$pinia.state.value.agent;
      return {
        status: agent.clientSession?.status,
        queuePosition: agent.clientSession?.queuePosition,
        connection: agent.connection,
      };
    });
    console.log('    点击后状态:', afterClick);

    if (afterClick.status === 'queued' || afterClick.status === 'inSession') {
      console.log('    OK 点击转人工后状态已变:', afterClick.status);
    } else {
      console.log(`    WARN 点击后状态: ${afterClick.status}（可能是 WS 没连上）`);
    }

    // 检查是否出现排队卡片或客服输入区
    const ui = await page.evaluate(() => {
      return {
        hasAgentQueue: !!document.querySelector('.agent-queue'),
        hasAgentBanner: !!document.querySelector('.agent-banner'),
        hasAgentEnded: !!document.querySelector('.agent-ended-hint'),
        hasWelcome: !!document.querySelector('.welcome'),
        headerTitle: document.querySelector('.main__title')?.textContent?.trim(),
      };
    });
    console.log('>>> 6) UI 状态:', ui);

    // 截图保存
    await page.screenshot({ path: '/Users/li/Desktop/vue-client-test.png', fullPage: true });
    console.log('>>> 截图已保存到 /Users/li/Desktop/vue-client-test.png');

    if (consoleErrors.length > 0) {
      console.log('>>> 控制台错误:');
      consoleErrors.forEach((e) => console.log('  ', e));
    } else {
      console.log('>>> OK 无控制台错误');
    }
  } catch (err) {
    console.error('FAIL 测试失败:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
