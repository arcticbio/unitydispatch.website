// End-to-end behaviour checks for the static site.
//
//   npm run serve            # in one terminal (mock /api/contact)
//   npm run test:e2e         # BASE_URL defaults to http://localhost:4280
//
// Exits non-zero if any check fails.
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:4280';
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { ...devices['iPhone 13'] };
const PAGES = ['/', '/privacy-policy', '/refund-policy', '/terms-and-conditions', '/shipping-policy', '/accessibility'];

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${String(err.message || err).split('\n')[0]}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
async function settle(page) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return;
    last = y;
    await page.waitForTimeout(150);
  }
  throw new Error('scrolling did not settle');
}
const targetY = (page, id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const m = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  return Math.round(Math.min(el.getBoundingClientRect().top + scrollY - m, document.documentElement.scrollHeight - innerHeight));
}, id);

const browser = await chromium.launch();

console.log('Pages');
for (const path of PAGES) {
  await check(`${path} loads without console errors`, async () => {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    assert(res.status() === 200, `status ${res.status()}`);
    assert(await page.title(), 'missing <title>');
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
}
await check('unknown path serves the 404 page', async () => {
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  const res = await page.goto(`${BASE}/no-such-page`);
  assert(res.status() === 404, `status ${res.status()}`);
  assert(await page.locator('h1', { hasText: 'Page Not Found' }).isVisible(), 'no 404 heading');
  await ctx.close();
});

console.log('Desktop navigation');
{
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  for (const [label, id] of [['Features', 'features'], ['About Us', 'about-us'], ['Reviews', 'reviews'], ['Contact', 'contact'], ['The App', 'the-app'], ['Home', 'top']]) {
    await check(`"${label}" smooth-scrolls to its section`, async () => {
      await page.locator('.site-nav a', { hasText: label }).click();
      await page.waitForTimeout(400);
      await settle(page);
      const y = await page.evaluate(() => scrollY);
      assert(near(y, await targetY(page, id)), `scrollY ${y}, expected ${await targetY(page, id)}`);
      assert(page.url() === BASE + '/', `url changed to ${page.url()}`);
    });
  }
  await check('header stays pinned while scrolling', async () => {
    await page.evaluate(() => scrollTo(0, 2000));
    const top = await page.locator('.site-header').evaluate((el) => el.getBoundingClientRect().top);
    assert(top === 0, `header top ${top}`);
  });
  await check('nav hover changes link colour', async () => {
    const link = page.locator('.site-nav a', { hasText: 'Features' });
    await link.hover();
    await page.waitForTimeout(500);
    const c = await link.evaluate((el) => getComputedStyle(el).color);
    assert(c === 'rgb(179, 218, 222)', c);
  });
  await ctx.close();
}

await check('policy page nav link lands on the home section', async () => {
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  await page.goto(BASE + '/privacy-policy', { waitUntil: 'networkidle' });
  await page.locator('.site-nav a', { hasText: 'Features' }).click();
  await page.waitForURL(`${BASE}/#features`);
  await page.waitForLoadState('networkidle');
  await settle(page);
  const y = await page.evaluate(() => scrollY);
  assert(near(y, await targetY(page, 'features')), `scrollY ${y}`);
  await ctx.close();
});

console.log('Phone');
{
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const toggle = page.locator('.menu-toggle');
  await check('hamburger opens the full-screen menu', async () => {
    await toggle.click();
    await page.waitForTimeout(600);
    assert(await page.locator('#mobile-menu').isVisible(), 'menu not visible');
    assert(await toggle.getAttribute('aria-expanded') === 'true', 'aria-expanded not true');
  });
  await check('Escape closes the menu', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    assert(!(await page.locator('#mobile-menu').isVisible()), 'menu still visible');
  });
  for (const [label, id] of [['Reviews', 'reviews'], ['About Us', 'how-it-works'], ['Contact', 'contact']]) {
    await check(`menu "${label}" closes the menu and scrolls to ${id}`, async () => {
      await page.evaluate(() => scrollTo(0, 0));
      await toggle.click();
      await page.waitForTimeout(600);
      await page.locator('#mobile-menu a', { hasText: label }).click();
      await page.waitForTimeout(400);
      await settle(page);
      assert(!(await page.locator('#mobile-menu').isVisible()), 'menu still visible');
      const y = await page.evaluate(() => scrollY);
      assert(near(y, await targetY(page, id)), `scrollY ${y}, expected ${await targetY(page, id)}`);
    });
  }
  await check('back-to-top appears after scrolling and returns to the top', async () => {
    await page.evaluate(() => scrollTo(0, 1500));
    await page.waitForTimeout(200);
    const btn = page.locator('.back-to-top');
    assert(await btn.isVisible(), 'button hidden');
    await btn.click();
    await page.waitForTimeout(300);
    await settle(page);
    assert(await page.evaluate(() => scrollY) === 0, 'not at top');
    assert(!(await btn.isVisible()), 'button still visible at top');
  });
  await ctx.close();
}

console.log('Contact form');
{
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const form = page.locator('.contact-form');
  const submit = () => form.locator('button[type="submit"]').click();
  const error = () => form.locator('.field__error').innerText();
  await check('empty submit reports the first name', async () => {
    await submit();
    assert((await error()) === 'Enter a first name.', await error());
    assert(await page.evaluate(() => document.activeElement.id) === 'cf-first', 'first name not focused');
  });
  await check('then the email address', async () => {
    await page.fill('#cf-first', 'Ada');
    await submit();
    assert((await error()) === 'Enter an email address.', await error());
  });
  await check('rejects a malformed email', async () => {
    await page.fill('#cf-email', 'ada@');
    await submit();
    assert((await error()).startsWith('Enter an email address like'), await error());
  });
  await check('then the message', async () => {
    await page.fill('#cf-email', 'ada@example.com');
    await submit();
    assert((await error()) === 'Enter an answer.', await error());
  });
  await check('country picker lists countries and shows a flag', async () => {
    const count = await form.locator('.country__select option').count();
    assert(count > 200, `${count} options`);
    await form.locator('.country__select').selectOption('US');
    assert((await form.locator('.country__flag').innerText()) === '🇺🇸', 'no US flag');
  });
  await check('valid submission posts JSON and shows the thank-you message', async () => {
    await page.fill('#cf-phone', '262 555 0100');
    await page.fill('#cf-message', 'Please send a demo.');
    const [req] = await Promise.all([page.waitForRequest('**/api/contact'), submit()]);
    const body = JSON.parse(req.postData());
    assert(body.firstName === 'Ada' && body.email === 'ada@example.com' && body.phone === '+1 262 555 0100', req.postData());
    await page.waitForSelector('.form-status:not(:empty)');
    assert((await form.locator('.form-status').innerText()) === 'Thanks, we received your submission.', 'no thank-you');
    assert((await page.inputValue('#cf-first')) === '', 'form not reset');
  });
  await ctx.close();
}

console.log('Chat');
{
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  await page.goto(BASE + '/privacy-policy', { waitUntil: 'networkidle' });
  await check('launcher opens the chat panel', async () => {
    await page.locator('.chat__launcher').click();
    assert(await page.locator('#chat-panel').isVisible(), 'panel hidden');
    assert(!(await page.locator('.chat__launcher').isVisible()), 'launcher still visible');
  });
  await check('sending a message asks for contact details', async () => {
    await page.fill('#chat-message', 'Hello there');
    await page.keyboard.press('Enter');
    assert(await page.locator('.chat__msg--me', { hasText: 'Hello there' }).isVisible(), 'message not shown');
    assert(await page.locator('.chat__details').isVisible(), 'details form hidden');
  });
  await check('details submit posts the conversation', async () => {
    await page.fill('#chat-email', 'ada@example.com');
    const [req] = await Promise.all([page.waitForRequest('**/api/contact'), page.locator('.chat__details button').click()]);
    const body = JSON.parse(req.postData());
    assert(body.source === 'chat' && body.message === 'Hello there' && body.email === 'ada@example.com', req.postData());
    await page.waitForSelector('.chat__msg--them');
  });
  await check('close button hides the panel', async () => {
    await page.locator('.chat__close').click();
    assert(!(await page.locator('#chat-panel').isVisible()), 'panel visible');
    assert(await page.locator('.chat__launcher').isVisible(), 'launcher hidden');
  });
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
