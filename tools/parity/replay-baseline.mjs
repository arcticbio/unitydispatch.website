// Re-renders the captured Wix pages offline (JavaScript disabled, every
// request answered from _capture/) so the original and the rebuild can be
// screenshotted by the same local browser. Text rasterisation differs between
// machines, so comparing against screenshots taken on another machine shows
// spurious line-break differences; this removes that noise.
//
//   node tools/parity/replay-baseline.mjs --capture _capture --out <dir>
//
// Output mirrors _capture/pages/<key>/<vp>-full.png so parity.mjs can use it
// via --capture <dir>.
import { chromium, devices } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]]);
  return a;
}, []));
const CAP = path.resolve(args.capture || '_capture');
const OUT = path.resolve(args.out || 'replay');
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const VIEWPORTS = {
  desktop: { file: 'desktop', ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: DESKTOP_UA } },
  mobile: { file: 'mobile', ctx: { ...devices['iPhone 13'], deviceScaleFactor: 1 } },
};

// Wix-only overlays that need JavaScript (chat iframe, back-to-top, quick-action bar).
const HIDE = 'iframe, #BACK_TO_TOP_BUTTON, #QUICK_ACTION_BAR { visibility: hidden !important; }';

const assets = JSON.parse(await fs.readFile(path.join(CAP, 'assets.json'), 'utf8'));
const byUrl = new Map(assets.filter((a) => a.file).map((a) => [a.url, a]));
const pages = JSON.parse(await fs.readFile(path.join(CAP, 'pages.json'), 'utf8'));

const browser = await chromium.launch();
for (const [vp, conf] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ ...conf.ctx, javaScriptEnabled: false });
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    const m = url.match(/^https:\/\/www\.unitydispatch\.net\/__replay\/(.+)$/);
    if (m) {
      const html = (await fs.readFile(path.join(CAP, 'pages', m[1], `${conf.file}.rendered.html`), 'utf8')).replace('</head>', `<style>${HIDE}</style></head>`);
      return route.fulfill({ body: html, contentType: 'text/html' });
    }
    const a = byUrl.get(url);
    if (a) return route.fulfill({ body: await fs.readFile(path.join(CAP, a.file)), contentType: a.contentType || undefined });
    return route.abort();
  });
  for (const p of pages) {
    const page = await ctx.newPage();
    await page.goto(`https://www.unitydispatch.net/__replay/${p.key}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => console.log('load timeout', p.key));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const dir = path.join(OUT, 'pages', p.key);
    await fs.mkdir(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${vp}-full.png`), fullPage: true });
    await page.screenshot({ path: path.join(dir, `${vp}-fold.png`) });
    await page.close();
    console.log('baseline', p.key, vp);
  }
  await ctx.close();
}
await browser.close();
await fs.writeFile(path.join(OUT, 'pages.json'), JSON.stringify(pages));
