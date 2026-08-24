const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:3003/', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2000));

    // 完整捕获 keydown → keyup → selection 变化
    await page.evaluate(() => {
      const t = document.querySelector('textarea');
      window.__evts = [];
      t.addEventListener('keydown', (e) => {
        // 在 keydown 时立刻记下 selectionStart
        window.__evts.push({
          phase: 'kd',
          key: e.key,
          meta: e.metaKey,
          selStart: t.selectionStart,
          selEnd: t.selectionEnd,
          defaultPrevented: e.defaultPrevented,
          time: performance.now(),
        });
        // 然后用 setTimeout(0) 在 keydown 处理完后看 selection
        Promise.resolve().then(() => {
          window.__evts.push({
            phase: 'kd-microtask',
            selStart: t.selectionStart,
            selEnd: t.selectionEnd,
            defaultPrevented: e.defaultPrevented,
            time: performance.now(),
          });
        });
      });
      t.addEventListener('keyup', (e) => {
        window.__evts.push({
          phase: 'ku',
          key: e.key,
          meta: e.metaKey,
          selStart: t.selectionStart,
          selEnd: t.selectionEnd,
          defaultPrevented: e.defaultPrevented,
          time: performance.now(),
        });
      });
      // 监听所有事件流
      t.addEventListener('beforeinput', () => {
        window.__evts.push({ phase: 'bi', selStart: t.selectionStart, selEnd: t.selectionEnd });
      });
      t.addEventListener('input', () => {
        window.__evts.push({ phase: 'input', selStart: t.selectionStart, selEnd: t.selectionEnd });
      });
    });

    const ta = await page.$('textarea');
    await ta.click();
    await page.keyboard.type('hello', { delay: 10 });
    await new Promise((r) => setTimeout(r, 200));

    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await new Promise((r) => setTimeout(r, 500));

    const result = await page.evaluate(() => {
      const t = document.querySelector('textarea');
      return {
        finalSel: { start: t.selectionStart, end: t.selectionEnd, value: t.value },
        events: window.__evts,
      };
    });

    console.log('最终:', JSON.stringify(result.finalSel));
    console.log('事件:');
    result.events.forEach((e, i) => {
      console.log(`  [${i}]`, JSON.stringify(e));
    });
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
