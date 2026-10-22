// Compares the position and size of every text block in the rebuild with the
// computed layout captured from the original site, and prints the deltas.
//
//   node tools/parity/boxes.mjs --base http://localhost:4280 --capture _capture --page home --vp desktop [--all]
import { chromium, devices } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const BASE = args.base || 'http://localhost:4280';
const CAP = path.resolve(args.capture || '_capture');
const PAGE = args.page || 'home';
const VP = args.vp || 'desktop';
const TOL = Number(args.tol || 2);

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const CTX = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: DESKTOP_UA },
  mobile: { ...devices['iPhone 13'], viewport: { width: 320, height: 545 }, deviceScaleFactor: 1 },
};

const norm = (s) => (s || '').replace(/[\s ]+/g, ' ').replace(/[“”"]/g, '"').trim().slice(0, 36).toLowerCase();

const pages = JSON.parse(await fs.readFile(path.join(CAP, 'pages.json'), 'utf8'));
const url = new URL(pages.find((p) => p.key === PAGE).url);
const assets = JSON.parse(await fs.readFile(path.join(CAP, 'assets.json'), 'utf8'));
const byUrl = new Map(assets.filter((a) => a.file).map((a) => [a.url, a]));

// Same measurement for both pages: union of each element's own text line boxes.
function measure() {
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'SVG', 'svg'].includes(el.tagName)) continue;
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    // Use the union of the text's line boxes, which is what the capture recorded for inline spans.
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    const r = rects.length ? rects.reduce((a, b) => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }), { left: 1e9, top: 1e9, right: -1e9, bottom: -1e9 }) : el.getBoundingClientRect();
    out.push({ text: el.textContent, box: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.right - r.left), Math.round(r.bottom - r.top)], size: cs.fontSize });
  }
  return out;
}

const browser = await chromium.launch();
// Original: the captured Wix HTML replayed offline with JavaScript disabled.
const octx = await browser.newContext({ ...CTX[VP], javaScriptEnabled: false });
await octx.route('**/*', async (route) => {
  const u = route.request().url();
  if (u === 'https://www.unitydispatch.net/__replay') return route.fulfill({ body: await fs.readFile(path.join(CAP, 'pages', PAGE, `${VP}.rendered.html`)), contentType: 'text/html' });
  const a = byUrl.get(u);
  return a ? route.fulfill({ body: await fs.readFile(path.join(CAP, a.file)), contentType: a.contentType || undefined }) : route.abort();
});
const opage = await octx.newPage();
await opage.goto('https://www.unitydispatch.net/__replay', { waitUntil: 'load' });
await opage.evaluate(() => document.fonts.ready);
const origAll = await opage.evaluate(measure);

const ctx = await browser.newContext({ ...CTX[VP], reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto(BASE + url.pathname, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const mine = await page.evaluate(measure);
await browser.close();

const orig = [];
const seen = new Set();
for (const e of origAll) {
  const k = norm(e.text);
  if (k.length < 2 || seen.has(k)) continue;
  seen.add(k);
  orig.push({ key: k, text: e.text.replace(/\s+/g, ' ').trim(), box: e.box, size: e.size });
}

const byKey = new Map();
for (const m of mine) {
  const k = (m.text || '').replace(/[\s ]+/g, ' ').replace(/[“”"]/g, '"').trim().slice(0, 36).toLowerCase();
  if (!byKey.has(k)) byKey.set(k, m);
}

let bad = 0;
for (const o of orig) {
  const m = byKey.get(o.key) || [...byKey.entries()].find(([k]) => k.startsWith(o.key.slice(0, 20)))?.[1];
  if (!m) { console.log(`MISSING  ${o.text.slice(0, 50)}`); bad++; continue; }
  const d = o.box.map((v, i) => m.box[i] - v);
  const off = d.some((v) => Math.abs(v) > TOL);
  if (off) bad++;
  if (off || args.all) console.log(`${off ? 'OFF' : 'ok '}  d=[${d.map((v) => String(v).padStart(4)).join(',')}] orig=${JSON.stringify(o.box)} ${o.size}/${m.size}  ${o.text.slice(0, 44)}`);
}
console.log(`${orig.length} text blocks, ${bad} off by more than ${TOL}px`);
