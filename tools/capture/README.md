# Site capture

Temporary tooling used during the static rebuild. `capture.mjs` crawls the
production site with Playwright and stores raw/rendered HTML, every network
asset, screenshots (desktop 1440, tablet 768, mobile 390) and a computed-style
layout dump for each page under `_capture/`. It runs in GitHub Actions via
`.github/workflows/capture-site.yml`.

    cd tools/capture && npm install && START_URL=https://www.unitydispatch.net/ node capture.mjs
