// Assembles the static site from src/ into site/.
//
// Each file in src/pages/ starts with a front-matter comment:
//
//   <!--
//   title: Privacy Policy | Unity Dispatch
//   path: /privacy-policy
//   -->
//
// and is wrapped in src/layout.html. `{{name}}` placeholders are filled from
// front matter (plus `content`), and `{{> partial}}` pulls in
// src/partials/partial.html. No dependencies: run with `node scripts/build.mjs`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'site');
const ORIGIN = 'https://www.unitydispatch.net';

const partials = {};
for (const f of await fs.readdir(path.join(SRC, 'partials'))) {
  partials[path.basename(f, '.html')] = (await fs.readFile(path.join(SRC, 'partials', f), 'utf8')).trimEnd();
}
const layout = await fs.readFile(path.join(SRC, 'layout.html'), 'utf8');

function render(tpl, vars, depth = 0) {
  if (depth > 5) throw new Error('partial nesting too deep');
  return tpl
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => {
      if (!(name in partials)) throw new Error(`unknown partial: ${name}`);
      return render(partials[name], vars, depth + 1);
    })
    .replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key) => {
      if (!(key in vars)) throw new Error(`missing value for {{${key}}}`);
      return vars[key];
    });
}

function parse(src, file) {
  const m = src.match(/^<!--\n([\s\S]*?)\n-->\n/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: src.slice(m[0].length).trim() };
}

const built = [];
for (const f of (await fs.readdir(path.join(SRC, 'pages'))).sort()) {
  if (!f.endsWith('.html')) continue;
  const { meta, body } = parse(await fs.readFile(path.join(SRC, 'pages', f), 'utf8'), f);
  const urlPath = meta.path;
  const vars = {
    description: '',
    bodyClass: '',
    homeCurrent: '',
    ...meta,
    canonical: ORIGIN + (urlPath === '/' ? '/' : urlPath),
  };
  // Home is the only page whose nav item is highlighted, as on the original.
  if (urlPath === '/') vars.homeCurrent = ' aria-current="page"';
  vars.content = render(body, vars);
  const html = render(layout, vars);
  const outFile = urlPath === '/' ? path.join(OUT, 'index.html')
    : meta.file ? path.join(OUT, meta.file)
    : path.join(OUT, urlPath.replace(/^\//, ''), 'index.html');
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, html);
  if (meta.sitemap !== 'no') built.push(urlPath);
  console.log('built', path.relative(ROOT, outFile));
}

const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${built.map((p) => `  <url>\n    <loc>${ORIGIN}${p === '/' ? '' : p}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join('\n')}
</urlset>
`;
await fs.writeFile(path.join(OUT, 'sitemap.xml'), sitemap);
console.log('built site/sitemap.xml');
