// Crawls the live site and records everything needed to rebuild it as static
// files: raw + rendered HTML, every network asset, screenshots at three
// viewports, a computed-style layout dump per page, and performance numbers.
import { chromium, devices } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const START = process.env.START_URL || 'https://www.unitydispatch.net/';
const OUT = path.resolve(process.env.OUT_DIR || '_capture');
const MAX_PAGES = Number(process.env.MAX_PAGES || 150);
const MAX_ASSET_BYTES = 60 * 1024 * 1024;

const startUrl = new URL(START);
const bare = startUrl.hostname.replace(/^www\./, '');
const siteHosts = new Set([bare, `www.${bare}`]);

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: DESKTOP_UA },
  tablet: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: devices['iPad Mini'].userAgent },
  mobile: { ...devices['iPhone 13'], deviceScaleFactor: 1 },
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

async function write(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

function pageKey(u) {
  const x = new URL(u);
  let p = x.pathname.replace(/\/+$/, '');
  if (!p) p = 'home';
  let key = p.replace(/^\//, '').replace(/[^a-zA-Z0-9._-]+/g, '__');
  if (x.search) key += `__q${sha(x.search)}`;
  return key;
}

function normalizePageUrl(u) {
  const x = new URL(u);
  x.hash = '';
  if (siteHosts.has(x.hostname)) x.hostname = startUrl.hostname;
  x.protocol = startUrl.protocol;
  return x.href;
}

function isSitePage(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol) || !siteHosts.has(x.hostname)) return false;
    return !/\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|mp4|webm|mov|mp3|css|js|json|xml|txt|woff2?|ttf|otf|eot)$/i.test(x.pathname);
  } catch { return false; }
}

function assetPath(u) {
  const x = new URL(u);
  let p = decodeURIComponent(x.pathname);
  if (p.endsWith('/')) p += 'index';
  p = p.split('/').map((s) => s.replace(/[^a-zA-Z0-9._~-]+/g, '_').slice(0, 120)).join('/');
  if (x.search) {
    const ext = path.extname(p);
    p = `${ext ? p.slice(0, -ext.length) : p}__q${sha(x.search)}${ext}`;
  }
  return path.join('assets', x.hostname, p);
}

// ---------- network asset recorder ----------
const assets = new Map(); // url -> record
function attachRecorder(context, pageLabel) {
  context.on('response', async (res) => {
    const url = res.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    const req = res.request();
    const rec = assets.get(url) || { url, pages: [] };
    if (!rec.pages.includes(pageLabel.current)) rec.pages.push(pageLabel.current);
    assets.set(url, rec);
    if (rec.file || rec.pending) return;
    rec.status = res.status();
    rec.type = req.resourceType();
    rec.method = req.method();
    rec.contentType = res.headers()['content-type'] || '';
    if (rec.status >= 300 && rec.status < 400) return;
    rec.pending = true;
    try {
      const body = await res.body();
      rec.size = body.length;
      if (body.length <= MAX_ASSET_BYTES) {
        rec.file = assetPath(url);
        await write(path.join(OUT, rec.file), body);
      }
    } catch (e) {
      rec.error = String(e.message || e).slice(0, 200);
    } finally {
      delete rec.pending;
    }
  });
}

// ---------- in-page helpers ----------
async function autoScroll(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
    let last = -1;
    for (let i = 0; i < 400; i++) {
      window.scrollBy(0, step);
      await new Promise((r) => setTimeout(r, 180));
      const y = window.scrollY;
      if (y === last) break;
      last = y;
    }
    await new Promise((r) => setTimeout(r, 800));
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
}

function layoutDump() {
  const KEEP = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'text-transform', 'text-decoration-line', 'text-align', 'color', 'background-color', 'background-image',
    'background-size', 'background-position', 'background-repeat', 'background-attachment', 'border-top',
    'border-right', 'border-bottom', 'border-left', 'border-radius', 'box-shadow', 'opacity', 'padding',
    'margin', 'display', 'position', 'z-index', 'flex-direction', 'justify-content', 'align-items', 'gap',
    'grid-template-columns', 'object-fit', 'object-position', 'transform', 'filter', 'mix-blend-mode',
    'overflow', 'max-width', 'width', 'height', 'cursor', 'transition', 'animation-name', 'white-space'];
  const out = [];
  const sx = window.scrollX, sy = window.scrollY;
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of all) {
    if (out.length >= 6000) break;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'link', 'meta', 'br', 'template'].includes(tag)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
    text = text.replace(/\s+/g, ' ').trim();
    const media = ['img', 'svg', 'video', 'iframe', 'input', 'textarea', 'select', 'button', 'a', 'picture', 'canvas', 'form', 'label', 'nav', 'header', 'footer', 'section', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'li'].includes(tag);
    const bg = cs.backgroundImage !== 'none' || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
    const border = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0;
    if (!text && !media && !bg && !border) continue;
    const styles = {};
    for (const k of KEEP) styles[k] = cs.getPropertyValue(k);
    const rec = {
      tag, id: el.id || undefined,
      cls: (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '').slice(0, 200) || undefined,
      text: text ? text.slice(0, 400) : undefined,
      box: [Math.round(r.left + sx), Math.round(r.top + sy), Math.round(r.width), Math.round(r.height)],
      styles,
    };
    for (const a of ['href', 'src', 'srcset', 'alt', 'title', 'aria-label', 'role', 'type', 'name', 'placeholder', 'action', 'method', 'target', 'data-src', 'poster', 'value', 'for']) {
      const v = el.getAttribute(a);
      if (v) rec[a] = v.slice(0, 600);
    }
    if (tag === 'img') rec.currentSrc = el.currentSrc;
    if (tag === 'svg') rec.svg = el.outerHTML.slice(0, 4000);
    out.push(rec);
  }
  return {
    url: location.href,
    title: document.title,
    docSize: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    viewport: [window.innerWidth, window.innerHeight],
    fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family}|${f.weight}|${f.style}`),
    bodyStyles: (() => { const cs = getComputedStyle(document.body); return { bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily, size: cs.fontSize }; })(),
    elements: out,
  };
}

function pageInfo() {
  const meta = {};
  for (const m of document.querySelectorAll('meta')) {
    const k = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || m.getAttribute('charset') && 'charset';
    if (k) meta[k] = m.getAttribute('content') || m.getAttribute('charset');
  }
  const links = [...document.querySelectorAll('link')].map((l) => ({ rel: l.rel, href: l.href, type: l.type, sizes: l.getAttribute('sizes'), media: l.media }));
  const anchors = [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.href, raw: a.getAttribute('href'), text: a.textContent.replace(/\s+/g, ' ').trim().slice(0, 200), target: a.target, inHeader: !!a.closest('header,nav,[role=navigation]'), inFooter: !!a.closest('footer') }));
  const scripts = [...document.querySelectorAll('script')].map((s) => ({ src: s.src || undefined, type: s.type || undefined, inlineBytes: s.src ? undefined : s.textContent.length, inlineHead: s.src ? undefined : s.textContent.slice(0, 300) }));
  const iframes = [...document.querySelectorAll('iframe')].map((f) => ({ src: f.src, title: f.title, w: f.width, h: f.height }));
  const forms = [...document.querySelectorAll('form')].map((f) => ({ action: f.action, method: f.method, html: f.outerHTML.slice(0, 20000) }));
  const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent);
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource');
  const perf = {
    domContentLoaded: nav && Math.round(nav.domContentLoadedEventEnd),
    load: nav && Math.round(nav.loadEventEnd),
    requests: res.length + 1,
    transferBytes: (nav ? nav.transferSize : 0) + res.reduce((s, r) => s + (r.transferSize || 0), 0),
    decodedBytes: (nav ? nav.decodedBodySize : 0) + res.reduce((s, r) => s + (r.decodedBodySize || 0), 0),
    byType: res.reduce((m, r) => { m[r.initiatorType] = (m[r.initiatorType] || 0) + (r.transferSize || 0); return m; }, {}),
    fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime,
  };
  return { title: document.title, lang: document.documentElement.lang, htmlAttrs: [...document.documentElement.attributes].map((a) => [a.name, a.value]), meta, links, anchors, scripts, iframes, forms, jsonld, perf };
}

// ---------- interactions ----------
async function tryOpenMenu(page, dir) {
  const handle = await page.evaluateHandle(() => {
    const cands = [...document.querySelectorAll('button, [role=button], a, div, span, label')];
    const re = /(hamburger|burger|menu-?toggle|nav-?toggle|mobile-?menu|menu-?button|menu-?icon|navbar-toggler|open-?menu|header-?menu-?toggle)/i;
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.top > 200) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const label = `${el.getAttribute('aria-label') || ''} ${el.className && el.className.baseVal === undefined ? el.className : ''} ${el.id} ${el.getAttribute('data-testid') || ''} ${el.getAttribute('data-hook') || ''}`;
      if (re.test(label) || /^\s*(open )?(site )?(navigation )?menu\s*$/i.test(el.getAttribute('aria-label') || '')) return el;
    }
    return null;
  });
  const el = handle.asElement();
  if (!el) return false;
  try {
    await el.click({ timeout: 3000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(dir, 'menu-open.png') });
    await write(path.join(dir, 'menu-open.html'), await page.content());
    await write(path.join(dir, 'menu-open.layout.json'), JSON.stringify(await page.evaluate(layoutDump)));
    return true;
  } catch (e) {
    log('menu click failed', e.message);
    return false;
  }
}

async function hoverNav(page, dir) {
  const items = await page.$$('header a, nav a, [role=navigation] a, header [role=button], nav button');
  const seen = new Set();
  let n = 0;
  for (const it of items) {
    if (n >= 14) break;
    try {
      const box = await it.boundingBox();
      if (!box || box.y > 300 || box.width < 4) continue;
      const k = `${Math.round(box.x)}:${Math.round(box.y)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      await it.hover({ timeout: 2000 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(dir, `hover-nav-${String(n).padStart(2, '0')}.png`), clip: { x: 0, y: 0, width: 1440, height: 700 } });
      n++;
    } catch { /* ignore */ }
  }
  await page.mouse.move(5, 895);
}

// ---------- main ----------
async function fetchText(url, ua) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': ua }, redirect: 'follow' });
    return { status: r.status, url: r.url, headers: Object.fromEntries(r.headers), body: await r.text() };
  } catch (e) { return { error: String(e) }; }
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const queue = [normalizePageUrl(START)];
  const done = new Set();
  const pages = [];

  // Seed from sitemap/robots.
  for (const f of ['robots.txt', 'sitemap.xml', 'sitemap_index.xml', 'favicon.ico', 'manifest.json', 'site.webmanifest']) {
    const r = await fetchText(new URL(`/${f}`, START).href, DESKTOP_UA);
    await write(path.join(OUT, 'root', `${f}.json`), JSON.stringify({ ...r, body: r.body && r.body.slice(0, 500000) }, null, 1));
    if (f.startsWith('sitemap') && r.status === 200 && r.body) {
      const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
      for (const l of locs) {
        if (/\.xml($|\?)/.test(l)) {
          const sub = await fetchText(l, 'Mozilla/5.0');
          await write(path.join(OUT, 'root', `sitemap-${sha(l)}.xml.json`), JSON.stringify({ ...sub, url: l }, null, 1));
          for (const m of (sub.body || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) if (isSitePage(m[1])) queue.push(normalizePageUrl(m[1].replace(/&amp;/g, '&')));
        } else if (isSitePage(l)) queue.push(normalizePageUrl(l));
      }
    }
  }

  const contexts = {};
  const labels = {};
  for (const [name, opts] of Object.entries(VIEWPORTS)) {
    labels[name] = { current: '' };
    contexts[name] = await browser.newContext({ ...opts, ignoreHTTPSErrors: true });
    attachRecorder(contexts[name], labels[name]);
  }

  while (queue.length && done.size < MAX_PAGES) {
    const url = queue.shift();
    if (done.has(url)) continue;
    done.add(url);
    const key = pageKey(url);
    const dir = path.join(OUT, 'pages', key);
    await fs.mkdir(dir, { recursive: true });
    log('PAGE', url, '->', key);
    const record = { url, key, viewports: {} };

    for (const vp of ['desktop', 'mobile']) {
      const ua = VIEWPORTS[vp].userAgent;
      const raw = await fetchText(url, ua);
      await write(path.join(dir, `raw-${vp}.html`), raw.body || '');
      record[`raw_${vp}`] = { status: raw.status, finalUrl: raw.url, headers: raw.headers, error: raw.error };
    }

    for (const [vp] of Object.entries(VIEWPORTS)) {
      labels[vp].current = key;
      const page = await contexts[vp].newPage();
      const consoleMsgs = [];
      page.on('console', (m) => consoleMsgs.push(`${m.type()}: ${m.text()}`.slice(0, 500)));
      page.on('pageerror', (e) => consoleMsgs.push(`pageerror: ${e.message}`.slice(0, 500)));
      const info = { };
      try {
        const resp = await page.goto(url, { waitUntil: 'load', timeout: 90000 });
        info.status = resp && resp.status();
        info.finalUrl = page.url();
        if (vp === 'desktop' && key === 'home') {
          // Snapshot the load sequence to see entrance animations.
          for (const t of [0, 400, 1000, 2000, 3500]) {
            await page.screenshot({ path: path.join(dir, `load-seq-${String(t).padStart(4, '0')}ms.png`) });
            await page.waitForTimeout(t === 0 ? 400 : 600);
          }
        }
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        await page.screenshot({ path: path.join(dir, `${vp}-fold.png`) });
        await autoScroll(page);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.screenshot({ path: path.join(dir, `${vp}-full.png`), fullPage: true });
        await write(path.join(dir, `${vp}.rendered.html`), await page.content());
        await write(path.join(dir, `${vp}.layout.json`), JSON.stringify(await page.evaluate(layoutDump)));
        const pi = await page.evaluate(pageInfo);
        await write(path.join(dir, `${vp}.info.json`), JSON.stringify(pi, null, 1));
        info.perf = pi.perf;
        info.title = pi.title;
        if (vp === 'desktop') {
          for (const a of pi.anchors) if (isSitePage(a.href)) {
            const n = normalizePageUrl(a.href);
            if (!done.has(n) && !queue.includes(n)) queue.push(n);
          }
          await hoverNav(page, dir);
          // Scroll state screenshots (sticky headers etc).
          await page.evaluate(() => window.scrollTo(0, 1200));
          await page.waitForTimeout(1200);
          await page.screenshot({ path: path.join(dir, 'desktop-scrolled-1200.png') });
        }
        if (vp === 'mobile') {
          await page.evaluate(() => window.scrollTo(0, 0));
          info.menuOpened = await tryOpenMenu(page, dir);
        }
        if (vp === 'tablet' && key === 'home') info.menuOpened = await tryOpenMenu(page, path.join(dir, 'tablet-menu'));
      } catch (e) {
        info.error = String(e.message || e).slice(0, 500);
        log('ERR', vp, url, info.error);
      }
      info.console = consoleMsgs.slice(0, 200);
      record.viewports[vp] = info;
      await page.close();
    }
    pages.push(record);
    await write(path.join(OUT, 'pages.json'), JSON.stringify(pages, null, 1));
  }

  // Let pending body writes finish.
  await new Promise((r) => setTimeout(r, 3000));
  await write(path.join(OUT, 'assets.json'), JSON.stringify([...assets.values()], null, 1));
  await write(path.join(OUT, 'pages.json'), JSON.stringify(pages, null, 1));
  await browser.close();
  log('DONE', pages.length, 'pages', assets.size, 'assets');
}

main().catch((e) => { console.error(e); process.exit(1); });
