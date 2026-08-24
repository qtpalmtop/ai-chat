/**
 * 检查 antd Input.TextArea 的真实 DOM 结构
 */
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

    const info = await page.evaluate(() => {
      const t = document.querySelector('textarea');
      if (!t) return { found: false };
      return {
        found: true,
        tag: t.tagName,
        type: t.type,
        contentEditable: t.contentEditable,
        readOnly: t.readOnly,
        disabled: t.disabled,
        // 看 textarea 父链上有没有 contenteditable=true 的祖先
        ancestorsWithCE: (() => {
          const arr = [];
          let cur = t.parentElement;
          while (cur && cur !== document.body) {
            if (cur.contentEditable === 'true' || cur.contentEditable === 'plaintext-only') {
              arr.push({ tag: cur.tagName, class: cur.className, ce: cur.contentEditable });
            }
            cur = cur.parentElement;
          }
          return arr;
        })(),
        // 看外层 input-panel
        inputPanelClass: t.closest('.input-panel')?.className,
        // 看有没有隐藏的 contenteditable（antd 某些版本用 RCE 替换 textarea）
        hiddenCE: (() => {
          const all = document.querySelectorAll('[contenteditable=true], [contenteditable=""]');
          return Array.from(all).map((el) => ({ tag: el.tagName, class: el.className, pe: getComputedStyle(el).display }));
        })(),
      };
    });
    console.log('textarea DOM:', JSON.stringify(info, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
