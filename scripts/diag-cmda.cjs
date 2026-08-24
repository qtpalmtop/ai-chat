/**
 * 实测 vue / react 用户端聊天输入框的 Cmd+A 全选
 * - 输入一段文字
 * - 模拟 Cmd+A 键盘事件
 * - 检查 textarea.selectionStart / selectionEnd
 * - 期望：start=0, end=text.length（全选了）
 */
const puppeteer = require('puppeteer-core');

const URL = process.argv[2] || 'http://localhost:3003/';
const LABEL = process.argv[3] || 'vue';

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

    // 在 textarea 输入
    const ta = await page.$('textarea');
    if (!ta) throw new Error('找不到 textarea');
    await ta.click();
    await page.keyboard.type('测试全选文字一二三四五六七八九十', { delay: 10 });
    await new Promise((r) => setTimeout(r, 200));

    // 试 1：按住 Meta(=Cmd) + A
    await page.keyboard.down('Meta');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Meta');
    await new Promise((r) => setTimeout(r, 200));
    let sel = await page.evaluate(() => {
      const t = document.querySelector('textarea');
      return {
        start: t.selectionStart,
        end: t.selectionEnd,
        text: t.value,
        focused: document.activeElement === t,
      };
    });
    console.log(`[${LABEL}] Cmd+A 之后 selection:`, JSON.stringify(sel));

    // 试 2：Ctrl+A（部分 Windows 用户习惯）
    await ta.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await new Promise((r) => setTimeout(r, 200));
    sel = await page.evaluate(() => {
      const t = document.querySelector('textarea');
      return { start: t.selectionStart, end: t.selectionEnd, text: t.value };
    });
    console.log(`[${LABEL}] Ctrl+A 之后 selection:`, JSON.stringify(sel));

    // 试 3：直接调 textarea.select()
    await ta.click();
    await page.evaluate(() => {
      const t = document.querySelector('textarea');
      t.focus();
      t.select();
    });
    await new Promise((r) => setTimeout(r, 200));
    sel = await page.evaluate(() => {
      const t = document.querySelector('textarea');
      return { start: t.selectionStart, end: t.selectionEnd, text: t.value };
    });
    console.log(`[${LABEL}] t.select() 之后 selection:`, JSON.stringify(sel));

    // 试 4：检查 user-select 样式
    const css = await page.evaluate(() => {
      const t = document.querySelector('textarea');
      const cs = getComputedStyle(t);
      return {
        userSelect: cs.userSelect,
        webkitUserSelect: cs.webkitUserSelect,
        className: t.className,
        parentUserSelect: t.parentElement ? getComputedStyle(t.parentElement).userSelect : 'no parent',
      };
    });
    console.log(`[${LABEL}] textarea 样式:`, JSON.stringify(css, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
