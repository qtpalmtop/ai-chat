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

    // 在 textarea 自己的 keydown 监听上**覆盖** addEventListener，
    // 看 antd 在它前面/后面做了什么
    await page.evaluate(() => {
      const t = document.querySelector('textarea');
      window.__events = [];
      // 1) capture 阶段
      t.addEventListener(
        'keydown',
        (e) => {
          window.__events.push({
            phase: 'textarea-capture',
            key: e.key,
            meta: e.metaKey,
            ctrl: e.ctrlKey,
            defaultPrevented: e.defaultPrevented,
          });
        },
        true,
      );
      // 2) bubble 阶段
      t.addEventListener('keydown', (e) => {
        window.__events.push({
          phase: 'textarea-bubble',
          key: e.key,
          meta: e.metaKey,
          ctrl: e.ctrlKey,
          defaultPrevented: e.defaultPrevented,
        });
      });
      // 3) keypress 阶段（Cmd+A 也会触发 keydown 但不触发 keypress）
      t.addEventListener('keypress', (e) => {
        window.__events.push({ phase: 'textarea-keypress', key: e.key, meta: e.metaKey });
      });
      // 4) beforeinput
      t.addEventListener('beforeinput', (e) => {
        window.__events.push({ phase: 'textarea-beforeinput', inputType: e.inputType });
      });
      // 5) input
      t.addEventListener('input', (e) => {
        window.__events.push({ phase: 'textarea-input', data: e.data });
      });
    });

    const ta = await page.$('textarea');
    await ta.click();
    await page.keyboard.type('hello world 12345', { delay: 10 });
    await new Promise((r) => setTimeout(r, 200));

    // Cmd+A
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await new Promise((r) => setTimeout(r, 300));

    // 看最终 selection 和 events
    const result = await page.evaluate(() => {
      const t = document.querySelector('textarea');
      return {
        selection: { start: t.selectionStart, end: t.selectionEnd, value: t.value },
        events: window.__events.filter((e) => e.key === 'a' || e.phase.includes('input') || e.phase.includes('keypress')),
      };
    });
    console.log('最终 selection:', JSON.stringify(result.selection));
    console.log('a 键 + beforeinput/input/keypress 事件:');
    result.events.forEach((e) => console.log('  ', JSON.stringify(e)));

    // 看 textarea 自己的 onkeydown 属性（antd 用 Vue 模板编译的 _withDirectives 注入的）
    const handlers = await page.evaluate(() => {
      const t = document.querySelector('textarea');
      return {
        onkeydownAttr: t.getAttribute('onkeydown'),
        hasVOnKeydown: t.onkeydown !== null,
        // 列出 textarea 上所有 listener（用 chrome devtools API 不可达，简化处理）
        parentChain: (() => {
          const arr = [];
          let cur = t.parentElement;
          while (cur && cur !== document.body) {
            arr.push({ tag: cur.tagName, class: cur.className });
            cur = cur.parentElement;
          }
          return arr;
        })(),
      };
    });
    console.log('handlers:', JSON.stringify(handlers, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
