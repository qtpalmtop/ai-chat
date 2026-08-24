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

    // 注入一个原生 textarea 到 input-panel 里
    await page.evaluate(() => {
      const panel = document.querySelector('.input-panel');
      const t = document.createElement('textarea');
      t.id = 'native-test';
      t.value = 'native test 12345';
      t.style.cssText = 'width:400px;height:60px;font-size:16px;display:block;margin:20px 0;';
      panel.appendChild(t);
    });

    // Cmd+A 测 antd-vue 的 textarea
    let ta = await page.$('textarea.ant-input');
    await ta.click();
    await page.keyboard.type('antd aaa', { delay: 10 });
    await new Promise((r) => setTimeout(r, 200));
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await new Promise((r) => setTimeout(r, 300));
    let sel = await page.evaluate(() => {
      const t = document.querySelector('textarea.ant-input');
      return { start: t.selectionStart, end: t.selectionEnd, value: t.value };
    });
    console.log('antd-vue textarea Cmd+A:', JSON.stringify(sel));

    // Cmd+A 测原生 textarea
    const nativeTa = await page.$('#native-test');
    await nativeTa.click();
    await new Promise((r) => setTimeout(r, 100));
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
    await new Promise((r) => setTimeout(r, 300));
    sel = await page.evaluate(() => {
      const t = document.getElementById('native-test');
      return { start: t.selectionStart, end: t.selectionEnd, value: t.value };
    });
    console.log('原生 textarea (注入) Cmd+A:', JSON.stringify(sel));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
