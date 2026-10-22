// Second-pass capture: full-resolution originals of every Wix media file the
// site references, extra viewport widths, and interactive states (nav anchor
// scroll targets, hover states, chat widget, form validation, mobile menu).
import { chromium, devices } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const START = process.env.START_URL || 'https://www.unitydispatch.net/';
const OUT = path.resolve(process.env.OUT_DIR || '_capture', 'details');
const SRC = path.resolve(process.env.OUT_DIR || '_capture');
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function write(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

// ---------- 1. original media ----------
async function originals() {
  const ids = new Set();
  const shapes = new Set();
  const ufonts = new Set();
  for (const f of await walk(SRC)) {
    if (f.startsWith(OUT) || /\.(png|jpe?g|webp|avif|gif|woff2?|ttf)$/i.test(f)) continue;
    const st = await fs.stat(f);
    if (st.size > 5_000_000) continue;
    const s = (await fs.readFile(f, 'utf8')).replace(/%7E/gi, '~');
    for (const m of s.matchAll(/([0-9a-f]{6}_[0-9a-f]{32}(?:~mv2)?\.(?:png|jpe?g|gif|webp|svg))/gi)) ids.add(m[1]);
    for (const m of s.matchAll(/\b([0-9a-f]{32}\.(?:png|jpe?g|gif|webp))/gi)) ids.add(m[1]);
    for (const m of s.matchAll(/static\.wixstatic\.com\/shapes\/([0-9a-f_]+\.svg)/gi)) shapes.add(m[1]);
    for (const m of s.matchAll(/static\.wixstatic\.com\/ufonts\/([0-9a-f_]+)\//gi)) ufonts.add(m[1]);
  }
  const manifest = [];
  for (const id of ids) {
    const url = `https://static.wixstatic.com/media/${id}`;
    try {
      const r = await fetch(url, { headers: { 'user-agent': DESKTOP_UA } });
      const buf = Buffer.from(await r.arrayBuffer());
      manifest.push({ id, url, status: r.status, type: r.headers.get('content-type'), size: buf.length });
      if (r.ok) await write(path.join(OUT, 'media', id), buf);
    } catch (e) { manifest.push({ id, url, error: String(e) }); }
  }
  for (const id of shapes) {
    const url = `https://static.wixstatic.com/shapes/${id}`;
    const r = await fetch(url);
    if (r.ok) await write(path.join(OUT, 'shapes', id), Buffer.from(await r.arrayBuffer()));
    manifest.push({ id, url, status: r.status, type: r.headers.get('content-type') });
  }
  for (const id of ufonts) {
    for (const fmt of ['woff2', 'woff', 'ttf']) {
      const url = `https://static.wixstatic.com/ufonts/${id}/${fmt}/file.${fmt}`;
      const r = await fetch(url);
      if (r.ok) await write(path.join(OUT, 'ufonts', id, `file.${fmt}`), Buffer.from(await r.arrayBuffer()));
      manifest.push({ id, url, status: r.status, type: r.headers.get('content-type') });
    }
  }
  await write(path.join(OUT, 'media.json'), JSON.stringify(manifest, null, 1));
  log('media', manifest.length);
}

// ---------- helpers ----------
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2500);
}

async function clipShot(page, el, file, pad = 24) {
  const b = await el.boundingBox();
  if (!b) return;
  const vp = page.viewportSize();
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  await page.screenshot({ path: file, clip: { x, y, width: Math.min(vp.width - x, b.width + pad * 2), height: Math.min(vp.height - y, b.height + pad * 2) } });
}

async function styleOf(el) {
  return el.evaluate((e) => {
    const cs = getComputedStyle(e);
    const o = {};
    for (const k of ['color', 'background-color', 'border-color', 'border-width', 'opacity', 'box-shadow', 'text-decoration-line', 'transform', 'transition', 'cursor']) o[k] = cs.getPropertyValue(k);
    return o;
  });
}

// ---------- 2. extra widths ----------
async function widths(browser) {
  for (const [w, h] of [[1920, 1080], [1280, 800], [1024, 768], [1366, 768]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, userAgent: DESKTOP_UA });
    const page = await ctx.newPage();
    for (const p of ['', 'privacy-policy']) {
      await page.goto(START + p, { waitUntil: 'load', timeout: 90000 });
      await settle(page);
      const key = p || 'home';
      await page.screenshot({ path: path.join(OUT, 'widths', `${key}-${w}-full.png`), fullPage: true });
      const boxes = await page.evaluate(() => [...document.querySelectorAll('[id^="comp-"], header, footer, section')].map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.id, tag: e.tagName, x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height), text: (e.innerText || '').slice(0, 50).replace(/\s+/g, ' ') };
      }).filter((b) => b.w > 0));
      await write(path.join(OUT, 'widths', `${key}-${w}.boxes.json`), JSON.stringify(boxes));
    }
    await ctx.close();
  }
  log('widths done');
}

// ---------- 3. desktop interactions ----------
async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: DESKTOP_UA });
  const page = await ctx.newPage();
  await page.goto(START, { waitUntil: 'load', timeout: 90000 });
  await settle(page);
  const out = { nav: [], hovers: {} };
  const dir = path.join(OUT, 'desktop');

  // Header/nav details.
  out.header = await page.evaluate(() => {
    const h = document.querySelector('header');
    const cs = h && getComputedStyle(h);
    return h && { position: cs.position, top: cs.top, height: h.getBoundingClientRect().height, zIndex: cs.zIndex, html: h.outerHTML.slice(0, 30000) };
  });

  // Anchor scroll targets.
  const navLinks = await page.$$('header nav a, header [data-testid="linkElement"]');
  const labels = [];
  for (const a of navLinks) labels.push((await a.innerText()).trim());
  for (let i = 0; i < navLinks.length; i++) {
    if (!labels[i]) continue;
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(800);
    const samples = [];
    await navLinks[i].click();
    for (let t = 0; t < 20; t++) { samples.push(await page.evaluate(() => Math.round(scrollY))); await page.waitForTimeout(100); }
    await page.waitForTimeout(1000);
    out.nav.push({ label: labels[i], url: page.url(), scrollY: await page.evaluate(() => scrollY), samples });
    await page.screenshot({ path: path.join(dir, `nav-${i}-${labels[i].replace(/\W+/g, '_')}.png`) });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);

  // Hover states.
  const targets = {
    navItem: 'header nav li:nth-child(2) a, header [data-testid="linkElement"] >> nth=2',
    ctaButton: 'text=Get the Unity Dispatch App',
    submit: 'button:has-text("Submit")',
    twitter: 'a[href*="x.com"]',
    linkedin: 'a[href*="linkedin"]',
    email: 'a[href^="mailto:info@unitydispatch.net"] >> nth=-1',
    logo: 'header a >> nth=0',
  };
  for (const [name, sel] of Object.entries(targets)) {
    try {
      const el = page.locator(sel).first();
      await el.scrollIntoViewIfNeeded();
      await page.mouse.move(2, 600);
      await page.waitForTimeout(600);
      const h = await el.elementHandle();
      const before = await styleOf(h);
      const inner = await h.$('span, p, div');
      const beforeInner = inner ? await styleOf(inner) : null;
      await clipShot(page, h, path.join(dir, `hover-${name}-before.png`));
      await el.hover();
      await page.waitForTimeout(700);
      const after = await styleOf(h);
      const afterInner = inner ? await styleOf(inner) : null;
      await clipShot(page, h, path.join(dir, `hover-${name}-after.png`));
      out.hovers[name] = { before, after, beforeInner, afterInner };
    } catch (e) { out.hovers[name] = { error: e.message }; }
  }

  // Form: focus + empty submit validation.
  try {
    const form = page.locator('form').first();
    await form.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const fh = await form.elementHandle();
    await clipShot(page, fh, path.join(dir, 'form-initial.png'), 10);
    const first = form.locator('input').first();
    await first.click();
    await page.waitForTimeout(500);
    out.focusStyle = await styleOf(await first.elementHandle());
    await clipShot(page, fh, path.join(dir, 'form-focus.png'), 10);
    await form.locator('button[type=submit], button:has-text("Submit")').first().click();
    await page.waitForTimeout(1500);
    await clipShot(page, fh, path.join(dir, 'form-empty-submit.png'), 10);
    out.formAfterEmptySubmit = await fh.evaluate((f) => ({ html: f.outerHTML, text: f.innerText }));
    // Phone country picker.
    const picker = form.locator('[aria-haspopup], [role=combobox], button').filter({ hasNotText: 'Submit' }).first();
    if (await picker.count()) {
      await picker.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(dir, 'form-phone-picker.png') });
      out.phonePicker = await page.evaluate(() => {
        const lb = document.querySelector('[role=listbox], [role=dialog], [data-hook*="country"]');
        return lb ? { html: lb.outerHTML.slice(0, 40000), text: lb.innerText.slice(0, 3000) } : null;
      });
      await page.keyboard.press('Escape');
    }
  } catch (e) { out.formError = e.message; }

  // Chat widget.
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    const frame = page.frameLocator('iframe[title="Wix Chat"]');
    const iframeEl = await page.$('iframe[title="Wix Chat"]');
    out.chatIframeBox = iframeEl && await iframeEl.boundingBox();
    await page.screenshot({ path: path.join(dir, 'chat-closed.png') });
    const btn = frame.locator('button, [role=button], [data-hook]').first();
    await btn.click({ timeout: 10000 });
    await page.waitForTimeout(4000);
    out.chatIframeBoxOpen = iframeEl && await iframeEl.boundingBox();
    await page.screenshot({ path: path.join(dir, 'chat-open.png') });
    const f = page.frame({ url: /chat-widget-server/ });
    if (f) out.chatOpenText = await f.evaluate(() => document.body.innerText.slice(0, 3000));
    if (f) await write(path.join(dir, 'chat-open.html'), await f.content());
  } catch (e) { out.chatError = e.message; }

  await write(path.join(dir, 'interactions.json'), JSON.stringify(out, null, 1));
  await ctx.close();
  log('desktop done');
}

// ---------- 4. mobile interactions ----------
async function mobile(browser) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const dir = path.join(OUT, 'mobile');
  await page.goto(START, { waitUntil: 'load', timeout: 90000 });
  await settle(page);
  const out = { nav: [] };
  out.viewportMeta = await page.evaluate(() => document.querySelector('meta[name=viewport]')?.content);
  out.header = await page.evaluate(() => {
    const h = document.querySelector('header');
    const cs = h && getComputedStyle(h);
    return h && { position: cs.position, height: h.getBoundingClientRect().height, html: h.outerHTML.slice(0, 30000) };
  });
  const burger = page.locator('[aria-label*="menu" i], [data-testid*="hamburger" i], [class*="hamburger" i]').first();
  try {
    await page.screenshot({ path: path.join(dir, 'menu-closed.png') });
    await burger.click();
    for (const t of [0, 100, 200, 300, 450, 700]) {
      await page.screenshot({ path: path.join(dir, `menu-open-${String(t).padStart(3, '0')}ms.png`) });
      await page.waitForTimeout(t === 0 ? 100 : t === 100 ? 100 : t === 200 ? 100 : t === 300 ? 150 : 250);
    }
    out.menuHtml = await page.evaluate(() => {
      const m = document.querySelector('[data-testid="menuContainer"], #MENU_AS_CONTAINER, [id*="MENU_AS_CONTAINER"]');
      return m && m.outerHTML.slice(0, 40000);
    });
    // Close button then reopen and click each item.
    const close = page.locator('[aria-label*="close" i]').first();
    await close.click().catch(() => {});
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(dir, 'menu-after-close.png') });
    for (const label of ['The App', 'Features', 'About Us', 'Reviews', 'Contact', 'Home']) {
      await burger.click();
      await page.waitForTimeout(900);
      await page.locator(`[id*="MENU_AS_CONTAINER"] >> text="${label}"`).first().click().catch(async () => {
        await page.getByText(label, { exact: true }).last().click();
      });
      await page.waitForTimeout(2000);
      out.nav.push({ label, scrollY: await page.evaluate(() => scrollY), url: page.url() });
      await page.screenshot({ path: path.join(dir, `nav-${label.replace(/\W+/g, '_')}.png`) });
    }
  } catch (e) { out.menuError = e.message; }
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    const frame = page.frameLocator('iframe[title="Wix Chat"]');
    await frame.locator('button, [role=button], [data-hook]').first().click({ timeout: 10000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(dir, 'chat-open.png') });
  } catch (e) { out.chatError = e.message; }
  await write(path.join(dir, 'interactions.json'), JSON.stringify(out, null, 1));
  await ctx.close();
  log('mobile done');
}

const browser = await chromium.launch();
for (const [name, fn] of [['originals', originals], ['widths', () => widths(browser)], ['desktop', () => desktop(browser)], ['mobile', () => mobile(browser)]]) {
  try { await fn(); } catch (e) { log('FAILED', name, e.stack); }
}
await browser.close();
