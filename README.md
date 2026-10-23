# Unity Dispatch website

A static rebuild of [www.unitydispatch.net](https://www.unitydispatch.net), which was built on Wix.
It looks and behaves like the original: same pages, copy, images, layout at every screen size,
navigation, animations, contact form and chat button. The Wix runtime is gone: no framework,
no third-party scripts, and about 16 KB of JavaScript instead of ~850 KB. It is ready for
[Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/).

| Home page | Wix (captured) | This site |
|---|---|---|
| Requests | 151 | 13 |
| Transferred | ~1.5 MB | ~220 KB desktop / ~420 KB phone (sharper retina images) |
| JavaScript | ~843 KB transferred | 16 KB |
| DOM ready (lab) | ~280 ms | ~60 ms |

## Repository layout

```
site/        The deployable website (what Azure serves). Generated HTML + hand-written assets.
  assets/css/site.css     All styles (hand-written)
  assets/js/site.js       All behaviour (hand-written, no dependencies)
  assets/img, fonts       Optimised images (WebP/PNG) and the Jost font (SIL OFL)
  staticwebapp.config.json  Routing, 404 page, security headers, caching (generated)
src/         Sources for the HTML pages
  layout.html, partials/  Shared page frame: head, header/menu, contact form + footer, chat
  pages/*.html            One file per page (front matter + main content)
  staticwebapp.config.json  Template for site/staticwebapp.config.json
api/         Azure Functions endpoint behind the contact form and chat (POST /api/contact)
scripts/     build.mjs (assemble pages), serve.mjs (local server), images.mjs, chat-pattern.py
tests/       e2e.mjs: browser checks for navigation, menu, form, chat, 404
tools/       capture/ and parity/: tooling used to measure the original and compare the rebuild
```

## Working on the site

Requires Node.js 20 or newer.

```sh
npm ci                 # dev tooling (Playwright, sharp)
npm run build          # src/ -> site/*.html, sitemap.xml, staticwebapp.config.json
npm run serve          # http://localhost:4280 (contact form answered by a mock)
npm run test:e2e       # with the server running
(cd api && npm ci && npm test)
```

- **Change text or a page:** edit `src/pages/*.html` or `src/partials/*.html`, run `npm run build`,
  commit both `src/` and `site/`. CI fails if `site/` is out of date.
- **Change styles or behaviour:** edit `site/assets/css/site.css` or `site/assets/js/site.js`
  directly, then run `npm run build` so the cache-busting `?v=` hashes in the HTML update.
- **Add a page:** add `src/pages/<name>.html` with front matter (`title`, `path`, `bodyClass`)
  and a rewrite for its path in `src/staticwebapp.config.json`.
- **Images:** the processed images are committed. `scripts/images.mjs` documents how they were
  made from the originals. Browsers cache images and fonts for a week, so when you replace one,
  give the new file a new name rather than overwriting the old one.
- **Inline scripts:** the Content-Security-Policy allows only the one inline script in
  `src/partials/head.html`, by hash. The build recomputes the hash. Adding analytics or another
  third-party script means adding its origin to `script-src`/`connect-src` in
  `src/staticwebapp.config.json`.

## Deploying to Azure Static Web Apps

Deployment runs from GitHub Actions (`.github/workflows/azure-static-web-apps.yml`): every push to
`main` deploys production, and every pull request into `main` gets its own preview URL. CI
(build check, API tests, browser tests) runs first, and nothing deploys unless it passes. Until
the secret in step 3 exists, the workflow skips deployment with a notice and doesn't fail.

1. **Create `main`.** Merge this work into a `main` branch (for example, open a pull request from
   this branch, or create `main` from it). In GitHub *Settings → General*, make `main` the default
   branch.
2. **Create the Static Web App.** In the Azure portal: *Create a resource → Static Web App*.
   - Plan: **Free** is enough (managed API functions, 2 custom domains, free SSL).
     Choose **Standard** if you want an SLA or more custom domains.
   - Deployment details / source: **Other** (this repository already has its workflow;
     choosing GitHub would make Azure commit a second one).
   - Region: any. It only affects where the contact API runs.
3. **Connect GitHub.** In the new resource open *Overview → Manage deployment token*, copy it,
   then in GitHub *Settings → Secrets and variables → Actions* add a repository secret named
   `AZURE_STATIC_WEB_APPS_API_TOKEN`. Run the workflow (*Actions → Deploy to Azure Static Web Apps
   → Run workflow*) or push to `main`. The site appears at the `*.azurestaticapps.net` address
   shown on the Overview page.
4. **Configure where form and chat messages go.** In *Settings → Environment variables*
   (production), set **one or both** of the following:
   - **Webhook (simplest):** `CONTACT_WEBHOOK_URL` = the URL of a Power Automate flow
     ("When an HTTP request is received" → "Send an email" to info@unitydispatch.net), a Logic App,
     a Microsoft Teams workflow, Zapier, etc. The endpoint receives JSON with `subject`, `text`,
     `replyTo`, `source` (`contact-form` or `chat`) and the individual fields
     (`firstName`, `lastName`, `email`, `phone`, `company`, `message`, `name`, `page`, `submittedAt`).
   - **Azure Communication Services Email:** create an *Email Communication Service* with an
     Azure-managed domain (or verify unitydispatch.net), connect it to a *Communication Service*,
     then set `ACS_CONNECTION_STRING` (Communication Service → Keys), `CONTACT_FROM_EMAIL`
     (e.g. `DoNotReply@<id>.azurecomm.net`) and `CONTACT_TO_EMAIL` (`info@unitydispatch.net`,
     comma-separate several). Replies go straight to the visitor (Reply-To).
   - Optional: `ALLOWED_ORIGINS` = `https://www.unitydispatch.net,https://unitydispatch.net` to
     reject posts from other sites.

   Until one of these is set, the form shows "Sorry, your message could not be sent. Please email
   info@unitydispatch.net." instead of losing the message silently.

   Spam protection: a hidden honeypot field and a per-visitor rate limit (5 messages per
   10 minutes). If spam still gets through, add Cloudflare Turnstile or a similar CAPTCHA to the
   form and verify its token in `api/src/lib/contact.js`.
5. **Test** the `*.azurestaticapps.net` site: submit the form and a chat message, and check they
   arrive.
6. **Move the domain.** DNS for unitydispatch.net is on Cloudflare, currently pointing at Wix. In
   the Static Web App, *Custom domains → Add*:
   - `www.unitydispatch.net`: Cloudflare `CNAME www → <your-app>.azurestaticapps.net`
     (DNS only, grey cloud, while Azure validates).
   - `unitydispatch.net` (apex): Azure asks for a TXT validation record; then point the apex at
     the app with a Cloudflare `CNAME @ → <your-app>.azurestaticapps.net` (Cloudflare flattens it).
   - To send the bare domain to `www` like today, add a Cloudflare *Redirect Rule*:
     `unitydispatch.net/*` → `https://www.unitydispatch.net/${1}` (301), with the apex record proxied.
   - Once Azure shows both domains as *Ready*, you can turn the Cloudflare proxy (orange cloud) back
     on for `www` if you want Cloudflare in front, with SSL/TLS mode **Full (strict)**.
7. **Retire Wix** after checking the live site: remove the domain from the Wix site so Wix stops
   serving it, then downgrade or cancel the Wix plan.

The old URLs (`/`, `/privacy-policy`, `/refund-policy`, `/terms-and-conditions`,
`/shipping-policy`, `/accessibility`) are unchanged, so search rankings and existing links carry over.

## What changed from the Wix site, and why

Everything visible matches the original unless listed here.

- **Fonts.** Wix served *Futura LT* (Monotype) and the logo font *Avenir Next LT Pro Bold*
  (Linotype) under Wix's own licence, which doesn't cover hosting them elsewhere. The site uses
  **Jost** (free, SIL Open Font License), a close Futura revival. Its metrics, weights and
  letter-spacing are tuned so line breaks and spacing match the original. The "Unity Dispatch"
  wordmark is drawn as vector artwork (the logo), so it is pixel-identical. To use licensed
  Futura instead (e.g. *Futura PT* from Adobe Fonts), change the `@font-face` rules in `site.css`.
- **Chat.** Wix Chat only works inside Wix. The chat button and panel look the same, but messages
  are delivered like the contact form (with the visitor's email for a reply), not as live chat.
  For true live chat, embed a service such as Crisp or Tawk.to and allow it in the CSP.
- **Contact form.** Same fields, validation messages and "Thanks, we received your submission."
  confirmation. Submissions go to `/api/contact` (see step 4) instead of Wix's inbox.
- **Phone country picker.** A native country list (with flags once chosen) replaces Wix's custom
  dropdown.
- **Without JavaScript** the pages still show all content, and the contact form still submits:
  the API redirects back with a confirmation message.
- **Tablets (768–979 px wide).** Wix showed the desktop layout with sideways scrolling; this site
  scales the desktop layout to fit.

### Content to review

These are carried over from the live site as-is, because the brief was parity, but you'll
probably want to fix them:

- The privacy, refund, terms, shipping and accessibility pages still contain **Wix's placeholder
  template text** ("The explanations and information provided on this page are only general…",
  "[2.0 / 2.1 / 2.2]", "[only add if relevant]"), and two link to Wix help articles.
- The chat panel's title is "**Go On**" (the business name set in Wix Chat).
- On phones, **About Us** in the menu jumps to "How Unity Dispatch Works" (on desktop it goes
  to "Our Vision"). To change it, remove `data-nav-mobile="how-it-works"` in
  `src/partials/header.html`.
- The footer says **© 2025**. The Twitter icon links to `x.com/ChiasticChaos`.
- On screens narrower than about 1300 px (small laptops, tablets), the hero screenshots overlap
  the end of the headline's longest line, exactly as they do on the Wix site.
- "Get the Unity Dispatch App" opens an email to info@unitydispatch.net (subject "App Demo Request").

## How parity was checked

`tools/capture` crawled the live site with Playwright from GitHub Actions. It recorded HTML,
every asset, screenshots at several widths, computed styles, Wix's layout and animation data,
and interaction states. `tools/parity` replays the captured Wix pages offline and compares them
with the rebuild in the same browser:

- Every text block on every page lines up within 1–3 px on desktop (1440 px) and phone (320 px
  layout), and page heights match within a pixel.
- Pixel difference is 1.6–2.4% on desktop and 3–4% on phone, almost all of it glyph shapes (Jost vs
  Futura) and image re-compression.
- In-page navigation lands on the same scroll positions as the original, and the entrance
  animations use Wix's own timing (1.2 s fade, `cubic-bezier(.445,.05,.55,.95)`).

The captured snapshot (`_capture/`) is deliberately not committed: it contains Wix's JavaScript
and licensed fonts.
