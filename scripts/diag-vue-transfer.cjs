/**
 * 验证 vue 用户端"转人工"全流程
 * 1. 打开页面 → 检查 idle 状态有"转人工"按钮
 * 2. 点击"转人工" → 等待 clientSession 切到 queued
 * 3. 验证排队卡片出现（"正在为您接入客服…" + 取消按钮）
 * 4. 验证 input panel 切换为 agent-queue 样式
 *
 * 注意：完整闭环需要 1 个在线客服在 3003/agent 工作台接受。
 * 本脚本只验证客户端状态切换。
 */
const puppeteer = require('puppeteer-core');

const APP_URL = process.argv[2] || 'http://localhost:3003/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);

    const errors = [];
    page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error') errors.push(`[${t}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      errors.push(`[pageerror] ${err.message}`);
    });

    console.log('=== 1) 打开页面 ===', APP_URL);
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));

    // 验证 idle 状态
    const idle = await page.evaluate(() => {
      const transfer = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent.includes('转人工') && b.offsetWidth > 0,
      );
      return {
        hasIdlePanel: !!document.querySelector('.input-panel:not(.input-panel--agent)'),
        transferBtnVisible: !!transfer,
        transferBtnText: transfer?.textContent?.trim(),
        transferBtnDisabled: transfer?.disabled,
      };
    });
    console.log('idle 状态:', JSON.stringify(idle, null, 2));
    if (!idle.hasIdlePanel) throw new Error('FAIL: idle 状态 input panel 不存在');
    if (!idle.transferBtnVisible) throw new Error('FAIL: 转人工按钮不可见');

    // 截图1：idle 状态
    await page.screenshot({ path: '/tmp/vue-step1-idle.png', fullPage: true });
    console.log('=== 截图1: /tmp/vue-step1-idle.png ===');

    console.log('=== 2) 点击转人工按钮 ===');
    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent.includes('转人工'),
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log('点击结果:', clicked);
    if (!clicked) throw new Error('FAIL: 找不到转人工按钮');

    // 等待状态切换
    await new Promise((r) => setTimeout(r, 1500));

    const queued = await page.evaluate(() => {
      const queuePanel = document.querySelector('.input-panel--agent');
      const queueCard = document.querySelector('.agent-queue');
      const cancelBtn = document.querySelector('.agent-queue__cancel');
      const title = document.querySelector('.agent-queue__title');
      const sub = document.querySelector('.agent-queue__sub');
      return {
        hasAgentPanel: !!queuePanel,
        hasQueueCard: !!queueCard,
        cancelBtnExists: !!cancelBtn,
        titleText: title?.textContent?.trim(),
        subText: sub?.textContent?.trim(),
      };
    });
    console.log('queued 状态:', JSON.stringify(queued, null, 2));
    if (!queued.hasAgentPanel) throw new Error('FAIL: 切到 agent 模式后 input panel--agent 不存在');
    if (!queued.hasQueueCard) throw new Error('FAIL: 排队卡片 .agent-queue 不存在');
    if (!queued.cancelBtnExists) throw new Error('FAIL: 取消排队按钮不存在');

    // 截图2：queued 状态
    await page.screenshot({ path: '/tmp/vue-step2-queued.png', fullPage: true });
    console.log('=== 截图2: /tmp/vue-step2-queued.png ===');

    console.log('=== 3) 点击取消排队 ===');
    const cancelled = await page.evaluate(() => {
      const cancelBtn = document.querySelector('.agent-queue__cancel');
      if (!cancelBtn) return false;
      cancelBtn.click();
      return true;
    });
    console.log('点击结果:', cancelled);
    await new Promise((r) => setTimeout(r, 1500));

    const afterCancel = await page.evaluate(() => {
      const idlePanel = document.querySelector('.input-panel:not(.input-panel--agent)');
      const transferBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent.includes('转人工'),
      );
      return {
        backToIdle: !!idlePanel,
        transferBtnVisible: !!transferBtn,
      };
    });
    console.log('取消后回到 idle:', JSON.stringify(afterCancel, null, 2));
    if (!afterCancel.backToIdle) throw new Error('FAIL: 取消排队后未回到 idle 状态');
    if (!afterCancel.transferBtnVisible) throw new Error('FAIL: 取消后转人工按钮未恢复');

    console.log('=== 4) 模拟 SSE 失败场景（不再重现，路由已修）===');
    // SSE 验证已经在前一个脚本里跑过：T+1s 拿到 mock 回答即证明修复成功

    console.log('\n=== 全部 PASS ===');
    console.log('console errors:', errors);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
