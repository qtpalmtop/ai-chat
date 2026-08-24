/**
 * 模拟浏览器加载 3001 页面，抓取 5 秒内的 console.log
 * 用来诊断"页面循环刷新"问题
 */
import puppeteer from 'puppeteer-core';

const URL = 'http://localhost:3001/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    const t = new Date().toISOString().slice(11, 23);
    logs.push(`[${t}] ${msg.type()}: ${text}`);
  });
  page.on('pageerror', (err) => {
    const t = new Date().toISOString().slice(11, 23);
    logs.push(`[${t}] PAGE_ERROR: ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    const t = new Date().toISOString().slice(11, 23);
    logs.push(`[${t}] REQ_FAILED: ${req.url()} - ${req.failure()?.errorText}`);
  });
  // 监听 page 自身的资源加载
  page.on('load', () => logs.push(`[${new Date().toISOString().slice(11, 23)}] PAGE_LOAD_EVENT`));
  page.on('domcontentloaded', () => logs.push(`[${new Date().toISOString().slice(11, 23)}] DOM_LOADED`));
  page.on('framenavigated', (frame) => logs.push(`[${new Date().toISOString().slice(11, 23)}] FRAME_NAV: ${frame.url()}`));
  // 拦截所有请求，看是谁加载了 @vite/client
  page.on('request', (req) => {
    if (req.url().includes('vite')) {
      logs.push(`[${new Date().toISOString().slice(11, 23)}] REQ ${req.method()} ${req.url()} (initiator=${req.frame()?.url() || 'unknown'})`);
    }
  });
  page.on('response', (res) => {
    if (res.url().includes('vite')) {
      logs.push(`[${new Date().toISOString().slice(11, 23)}] RES ${res.status()} ${res.url()}`);
    }
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  console.log('=== page loaded, waiting 8s ===');
  await new Promise((r) => setTimeout(r, 8000));
  await browser.close();

  console.log('\n=== captured logs ===');
  for (const line of logs) console.log(line);
  console.log(`\n=== total: ${logs.length} log lines ===`);
})();
