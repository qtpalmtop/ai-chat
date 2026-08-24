// 第二次回归：MOBILE_MAX_WIDTH 768→1024，验证 iPhone 12 横屏 (844x390) 弹 modal
import puppeteer from '/Users/li/Desktop/AI对话助手/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:3003/';

const consoleLogs = [];
const pageErrors = [];
const results = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dumpState(page, tag) {
  return await page.evaluate((tag) => {
    const wraps = Array.from(document.querySelectorAll('.rotate-hint-modal'));
    const antModals = Array.from(document.querySelectorAll('.ant-modal'));
    const titles = Array.from(document.querySelectorAll('.rotate-hint__title'));
    const descs = Array.from(document.querySelectorAll('.rotate-hint__desc'));
    const modalWraps = Array.from(document.querySelectorAll('.ant-modal-wrap'));
    const modalContents = Array.from(document.querySelectorAll('.ant-modal-content'));
    return {
      tag,
      rotateHintModalCount: wraps.length,
      antModalCount: antModals.length,
      antModalWrapCount: modalWraps.length,
      antModalContentCount: modalContents.length,
      antModalWrapDisplay: modalWraps[0] ? getComputedStyle(modalWraps[0]).display : null,
      antModalContentDisplay: modalContents[0] ? getComputedStyle(modalContents[0]).display : null,
      firstModalDisplay: antModals[0] ? getComputedStyle(antModals[0]).display : null,
      firstModalInlineDisplay: antModals[0] ? antModals[0].style.display : null,
      titleText: titles[0] ? titles[0].textContent.trim() : null,
      descText: descs[0] ? descs[0].textContent.trim() : null,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      isMobileMatch768: window.matchMedia('(max-width: 768px)').matches,
      isMobileMatch1024: window.matchMedia('(max-width: 1024px)').matches,
      orientationMatch: window.matchMedia('(orientation: landscape)').matches,
    };
  }, tag);
}

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--headless=new',
    ],
    defaultViewport: null,
  });

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    // ============ 1. iPhone 12 竖屏 (390x844) ============
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    // ============ 2. 打开页面 ============
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(1500);

    // ============ 3. 截图 竖屏 ============
    await page.screenshot({ path: '/tmp/rot-v2-1-portrait.png', fullPage: false });

    // ============ 4. 验证 - 竖屏移动端 modal 不应该出现 ============
    results.step4_portrait = await dumpState(page, 'portrait-initial');

    // ============ 5. 改横屏 844x390 ============
    await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('orientationchange'));
    });
    await sleep(400);

    // ============ 7. 截图 横屏 ============
    await page.screenshot({ path: '/tmp/rot-v2-2-landscape.png', fullPage: false });

    // ============ 8. 关键验证 - 横屏移动端 modal 应该出现 ============
    results.step8_landscape = await dumpState(page, 'landscape-after-rotate');
    // 额外探测：组件内部实际 isMobile/isLandscape（读 Vue 实例）
    results.step8_debug = await page.evaluate(() => {
      const root = document.querySelector('#app')?.__vue_app__;
      // 通过组件树找 RotateHint
      const el = document.querySelector('.rotate-hint') || document.querySelector('.ant-modal');
      return {
        appExists: !!root,
        hasRotateHintEl: !!document.querySelector('.rotate-hint'),
        hasAntModalEl: !!document.querySelector('.ant-modal'),
      };
    });

    // ============ 9. 改回竖屏 390x844 ============
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('orientationchange'));
    });
    await sleep(400);

    // ============ 11. 截图 切回竖屏 ============
    await page.screenshot({ path: '/tmp/rot-v2-3-portrait-again.png', fullPage: false });

    // ============ 12. 验证 - 切回竖屏 modal 应该消失 ============
    results.step12_portraitAgain = await dumpState(page, 'portrait-again');

    // ============ 13. 桌面端 1280x720 ============
    await page.setViewport({ width: 1280, height: 720, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await sleep(400);

    results.step13_desktop = await dumpState(page, 'desktop-1280x720');

  } catch (e) {
    results.exception = e.message + '\n' + e.stack;
  } finally {
    await browser.close();
  }

  results.consoleLogs = consoleLogs;
  results.pageErrors = pageErrors;
  console.log(JSON.stringify(results, null, 2));
}

run().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
