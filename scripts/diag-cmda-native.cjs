const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<textarea id="t" style="font-size:32px">Hello World 12345</textarea>');
    await page.focus('#t');
    await new Promise((r) => setTimeout(r, 200));

    // 直接 select() 看
    await page.evaluate(() => {
      document.getElementById('t').setSelectionRange(0, document.getElementById('t').value.length);
    });
    let sel = await page.evaluate(() => {
      const t = document.getElementById('t');
      return { start: t.selectionStart, end: t.selectionEnd };
    });
    console.log('JS 设 setSelectionRange:', JSON.stringify(sel));

    // 再 focus 一下试 Cmd+A
    await page.focus('#t');
    await page.keyboard.down('Meta');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Meta');
    await new Promise((r) => setTimeout(r, 200));
    sel = await page.evaluate(() => {
      const t = document.getElementById('t');
      return { start: t.selectionStart, end: t.selectionEnd, value: t.value };
    });
    console.log('原生 textarea Cmd+A:', JSON.stringify(sel));

    // 改用 page.keyboard.press('a')
    await page.focus('#t');
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await new Promise((r) => setTimeout(r, 200));
    sel = await page.evaluate(() => {
      const t = document.getElementById('t');
      return { start: t.selectionStart, end: t.selectionEnd };
    });
    console.log('原生 textarea Cmd+a:', JSON.stringify(sel));

    // 试 Control+a
    await page.focus('#t');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await new Promise((r) => setTimeout(r, 200));
    sel = await page.evaluate(() => {
      const t = document.getElementById('t');
      return { start: t.selectionStart, end: t.selectionEnd };
    });
    console.log('原生 textarea Ctrl+a:', JSON.stringify(sel));

    // 用 CDP 派发真实键盘事件
    const cdp = await page.target().createCDPSession();
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', modifiers: 8, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', modifiers: 8, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65,
    });
    await new Promise((r) => setTimeout(r, 200));
    sel = await page.evaluate(() => {
      const t = document.getElementById('t');
      return { start: t.selectionStart, end: t.selectionEnd };
    });
    console.log('原生 textarea CDP rawKeyDown Cmd+A:', JSON.stringify(sel));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
