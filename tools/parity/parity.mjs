// Screenshots the rebuilt static site with the same viewports used by
// tools/capture and diffs each page against the captured original.
//
//   node parity.mjs --base http://localhost:4280 --capture ../../_capture --out ./out [--pages home,about]
//
// For every page/viewport it writes original.png, rebuild.png, diff.png and a
// side-by-side compare.png, plus a summary.json with mismatch percentages.
import { chromium, devices } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const BASE = args.base || 'http://localhost:4280';
const CAPTURE = path.resolve(args.capture || '../../_capture');
const OUT = path.resolve(args.out || './out');
const ONLY = args.pages ? String(args.pages).split(',') : null;
const VPS = args.viewports ? String(args.viewports).split(',') : ['desktop', 'tablet', 'mobile'];
const FOLD = !!args.fold;

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: DESKTOP_UA },
  tablet: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['iPad Mini'].userAgent },
  mobile: { ...devices['iPhone 13'], deviceScaleFactor: 1 },
};

const pages = JSON.parse(await fs.readFile(path.join(CAPTURE, 'pages.json'), 'utf8'));

function readPng(buf) { return PNG.sync.read(buf); }

function pad(png, w, h) {
  if (png.width === w && png.height === h) return png;
  const out = new PNG({ width: w, height: h });
  out.data.fill(255);
  PNG.bitblt(png, out, 0, 0, Math.min(png.width, w), Math.min(png.height, h), 0, 0);
  return out;
}

function sideBySide(a, b, d) {
  const gap = 12;
  const w = a.width + b.width + d.width + gap * 2;
  const h = Math.max(a.height, b.height, d.height);
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 255; out.data[i + 3] = 255; }
  PNG.bitblt(a, out, 0, 0, a.width, a.height, 0, 0);
  PNG.bitblt(b, out, 0, 0, b.width, b.height, a.width + gap, 0);
  PNG.bitblt(d, out, 0, 0, d.width, d.height, a.width + b.width + gap * 2, 0);
  return out;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
    let last = -1;
    for (let i = 0; i < 400; i++) {
      window.scrollBy(0, step);
      await new Promise((r) => setTimeout(r, 60));
      if (window.scrollY === last) break;
      last = window.scrollY;
    }
    await new Promise((r) => setTimeout(r, 300));
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(600);
}

const browser = await chromium.launch();
const summary = [];
for (const vp of VPS) {
  const ctx = await browser.newContext(VIEWPORTS[vp]);
  for (const p of pages) {
    if (ONLY && !ONLY.includes(p.key)) continue;
    const kind = FOLD ? `${vp}-fold` : `${vp}-full`;
    const origFile = path.join(CAPTURE, 'pages', p.key, `${kind}.png`);
    let orig;
    try { orig = readPng(await fs.readFile(origFile)); } catch { continue; }
    const u = new URL(p.url);
    const target = BASE.replace(/\/$/, '') + u.pathname + u.search;
    const page = await ctx.newPage();
    let status;
    try {
      const r = await page.goto(target, { waitUntil: 'load', timeout: 30000 });
      status = r && r.status();
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      if (!FOLD) await autoScroll(page);
      await page.evaluate(() => document.fonts.ready);
    } catch (e) { status = String(e.message); }
    const shot = readPng(await page.screenshot({ fullPage: !FOLD }));
    await page.close();
    const w = Math.max(orig.width, shot.width);
    const h = Math.max(orig.height, shot.height);
    const a = pad(orig, w, h);
    const b = pad(shot, w, h);
    const diff = new PNG({ width: w, height: h });
    const n = pixelmatch(a.data, b.data, diff.data, w, h, { threshold: 0.12, includeAA: false });
    const dir = path.join(OUT, p.key, kind);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'original.png'), PNG.sync.write(a));
    await fs.writeFile(path.join(dir, 'rebuild.png'), PNG.sync.write(b));
    await fs.writeFile(path.join(dir, 'diff.png'), PNG.sync.write(diff));
    await fs.writeFile(path.join(dir, 'compare.png'), PNG.sync.write(sideBySide(a, b, diff)));
    const rec = { page: p.key, vp: kind, status, origSize: [orig.width, orig.height], rebuildSize: [shot.width, shot.height], mismatchPct: +(100 * n / (w * h)).toFixed(2) };
    summary.push(rec);
    console.log(JSON.stringify(rec));
  }
  await ctx.close();
}
await browser.close();
await fs.writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
