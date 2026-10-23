# Site capture

Development tooling used to rebuild the site. `capture.mjs` crawls the
original Wix site with Playwright and stores raw/rendered HTML, every network
asset, screenshots (desktop 1440, tablet 768, mobile 390) and a computed-style
layout dump for each page; `capture-details.mjs` adds full-resolution media,
extra viewport widths and interaction states (menus, hovers, form errors,
chat).

The output goes to `_capture/`, which is git-ignored on purpose: it contains
third-party files (Wix's JavaScript and licensed fonts) that must not be
committed to this public repository.

    cd tools/capture && npm install
    START_URL=https://www.unitydispatch.net/ OUT_DIR=../../_capture node capture.mjs
    OUT_DIR=../../_capture node capture-details.mjs

`tools/parity/` compares the rebuild against that snapshot (see the main
README).
