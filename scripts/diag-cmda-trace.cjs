/**
 * 监听 keydown 看 Cmd+A 路径上哪一层 preventDefault 了
 */
const puppeteer = require('puppeteer-core');

const URL = process.argv[2] || 'http://localhost:3003/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2000));

    // 在 window/document/body/textarea 上挂监听，记录 preventDefault 谁
    await page.evaluate(() => {
      const log = [];
      const tap = (target, label) => {
        target.addEventListener(
          'keydown',
          (e) => {
            const t = e.target?.tagName;
            const v = e.key;
            const m = `${e.metaKey ? 'M' : ''}${e.ctrlKey ? 'C' : ''}`;
            log.push(`[${label}] key=${v} mod=${m} target=${t} defaultPrevented=${e.defaultPrevented} preventDefaultCalled=${false}`);
            setTimeout(() => {
              log.push(`  -> after bubble defaultPrevented=${e.defaultPrevented}`);
            }, 0);
          },
          true,
        );
      };
      tap(window, 'window-capture');
      tap(document, 'document-capture');
      tap(document.body, 'body-capture');
      window.__keylog = log;
    });

    const ta = await page.$('textarea');
    if (!ta) throw new Error('找不到 textarea');
    await ta.click();
    await page.keyboard.type('hello world 12345', { delay: 10 });
    await new Promise((r) => setTimeout(r, 200));

    // 触发 Cmd+A
    await page.keyboard.down('Meta');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Meta');
    await new Promise((r) => setTimeout(r, 300));

    // 触发 Ctrl+A
    await ta.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await new Promise((r) => setTimeout(r, 300));

    // 看 selection
    const sel = await page.evaluate(() => {
      const t = document.querySelector('textarea');
      return { start: t.selectionStart, end: t.selectionEnd, value: t.value };
    });
    console.log('selection after Ctrl+A:', JSON.stringify(sel));

    // 看 keylog
    const log = await page.evaluate(() => window.__keylog);
    console.log('keylog:');
    log.forEach((l) => console.log('  ', l));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
