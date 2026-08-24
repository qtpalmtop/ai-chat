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
    page.setDefaultTimeout(30000);
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 3000));

    // 看 textarea 的 computed style
    const css = await page.evaluate(() => {
      const t = document.querySelector('textarea');
      if (!t) return { found: false };
      const cs = getComputedStyle(t);
      const data = {
        found: true,
        class: t.className,
        value: t.value,
        cs: {
          userSelect: cs.userSelect,
          webkitUserSelect: cs.webkitUserSelect,
          pointerEvents: cs.pointerEvents,
          tabIndex: cs.tabIndex,
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
        },
      };
      // 看祖先链上 user-select
      const chain = [];
      let cur = t.parentElement;
      while (cur && cur !== document.documentElement) {
        const c = getComputedStyle(cur);
        chain.push({
          tag: cur.tagName,
          class: cur.className,
          userSelect: c.userSelect,
          webkitUserSelect: c.webkitUserSelect,
        });
        cur = cur.parentElement;
      }
      data.ancestors = chain;
      return data;
    });
    console.log('textarea info:', JSON.stringify(css, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
