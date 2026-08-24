/**
 * 诊断 vue 用户端：抓真实页面 DOM 看 InputPanel 实际渲染状态
 * 用 puppeteer-core 连本地 Chrome.app
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
    const logs = [];
    page.on('console', (msg) => {
      const t = msg.type();
      const text = msg.text();
      logs.push(`[${t}] ${text}`);
      if (t === 'error' || t === 'warning') errors.push(`[${t}] ${text}`);
    });
    page.on('pageerror', (err) => {
      errors.push(`[pageerror] ${err.message}`);
    });

    console.log('=== Opening', APP_URL);
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 2000));

    // 抓 .input-panel 内部 DOM
    const dom = await page.evaluate(() => {
      const panel = document.querySelector('.input-panel') || document.querySelector('[class*="input-panel"]');
      const bottom = document.querySelector('.input-panel__bottom');
      const transfer = document.querySelector('.input-panel__transfer');
      const send = document.querySelector('.input-panel__send');
      const allTransfer = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent.includes('转人工'));
      return {
        inputPanelExists: !!panel,
        inputPanelClass: panel?.className,
        inputPanelHtml: panel?.outerHTML?.slice(0, 2000),
        bottomExists: !!bottom,
        bottomHtml: bottom?.outerHTML?.slice(0, 2000),
        transferBtnExists: !!transfer,
        sendBtnExists: !!send,
        transferButtons: allTransfer.map((b) => ({
          text: b.textContent.trim(),
          class: b.className,
          visible: b.offsetWidth > 0 && b.offsetHeight > 0,
        })),
        clientSessionStatus: window.__pinia?._s?.get('agent')?.clientSession?.status,
        connectionStatus: window.__pinia?._s?.get('agent')?.connection,
      };
    });

    console.log('=== DOM 快照 ===');
    console.log('inputPanel exists:', dom.inputPanelExists, 'class:', dom.inputPanelClass);
    console.log('bottom exists:', dom.bottomExists);
    console.log('transfer btn exists:', dom.transferBtnExists);
    console.log('send btn exists:', dom.sendBtnExists);
    console.log('transfer buttons:', JSON.stringify(dom.transferButtons, null, 2));
    console.log('clientSession.status:', dom.clientSessionStatus);
    console.log('connection:', dom.connectionStatus);
    console.log('=== inputPanel 完整 outerHTML ===');
    console.log(await page.evaluate(() => {
      const panel = document.querySelector('.input-panel');
      if (!panel) return 'NO PANEL';
      // 只返回结构化的关键节点：toolbar 按钮列表 + bottom 区域
      const toolbar = panel.querySelector('.input-panel__toolbar');
      const bottom = panel.querySelector('.input-panel__bottom');
      const skills = panel.querySelector('.input-panel__skill-chip');
      return {
        skillsChip: skills ? skills.textContent.trim() : null,
        toolbarButtons: toolbar ? Array.from(toolbar.querySelectorAll('button')).map((b) => ({
          text: b.textContent.trim(),
          class: b.className,
          iconLabel: b.querySelector('span[role="img"]')?.getAttribute('aria-label'),
        })) : null,
        bottomHTML: bottom ? bottom.outerHTML : null,
      };
    }));
    console.log('=== full input-panel.html (limited) ===');
    console.log(dom.inputPanelHtml?.slice(0, 800));
    console.log('=== console errors ===');
    errors.forEach((e) => console.log(e));

    // 截图保存对比
    await page.screenshot({ path: '/tmp/vue-client-screenshot.png', fullPage: true });
    console.log('=== Screenshot saved: /tmp/vue-client-screenshot.png ===');

    // 也只截 input-panel 区域
    const panel = await page.$('.input-panel');
    if (panel) {
      await panel.screenshot({ path: '/tmp/vue-inputpanel.png' });
      console.log('=== InputPanel screenshot saved: /tmp/vue-inputpanel.png ===');
    }

    // 复现"发消息 AI 不回复"问题
    console.log('=== 复现：发消息给 AI ===');
    // 用 Ant Design Vue 内部的 textarea selector
    const ta = await page.$('.ant-input, textarea');
    if (ta) {
      await ta.click();
      await page.keyboard.type('测试一下 vue 端 AI 是否回复', { delay: 20 });
      await new Promise((r) => setTimeout(r, 300));
      await page.keyboard.press('Enter');
      console.log('  已输入并按 Enter');
    } else {
      console.log('  找不到输入框');
    }
    // 等 8 秒看流式回复
    for (let i = 1; i <= 8; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const status = await page.evaluate(() => {
        const msgs = document.querySelectorAll('.msg, [class*="msg__"]');
        return {
          msgCount: msgs.length,
          streaming: !!document.querySelector('[data-streaming-mode="sticky"], [data-streaming-mode="static"]'),
          bodyText: document.querySelector('.main__body')?.innerText?.slice(0, 500),
        };
      });
      console.log(`  T+${i}s:`, JSON.stringify(status));
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
