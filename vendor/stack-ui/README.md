# Vendored: Boundry design foundation (Stack UI) static release

Copied unmodified from `rkendel1/stack-ui` `release/stack-ui-static-<VERSION>/`
(`node scripts/package-static.mjs`). The build verifies every file against
`SHA256SUMS` and fails on any difference. To upgrade, replace this directory
with a newer release; never edit these files here.

Used by `src/build.mjs`:
- `esm/html.js` renders the shared `SiteHeader` and `SiteFooter` into each page.
- `tokens.css` and `core.css` are prepended to `src/styles.css`.
- `brand/brand.json` supplies the product accents; `brand/boundry-favicon.svg` is the favicon.
- `esm/theme.js` supplies `THEME_INIT_SCRIPT` and the storage key.
