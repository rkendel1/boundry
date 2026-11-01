# Guidance for coding agents

boundry.company is built on the Boundry design foundation (`rkendel1/stack-ui`), vendored in
`vendor/stack-ui/`. Every change keeps it that way:

- Use the shared `SiteHeader` and `SiteFooter` (rendered by `vendor/stack-ui/esm/html.js` in
  `src/build.mjs`), the foundation tokens (`--stack-*`) and its theme handling. Never redefine
  `--stack-*` tokens or restyle `.stack-*` state classes in `src/styles.css`.
- Product accents, names and links come from the foundation (`brand/brand.json`, `esm/brand.js`). Change
  them in stack-ui and re-vendor; never change them here.
- Never edit `vendor/stack-ui/`. Upgrade it by replacing the directory with a newer static release.
- Before committing, run the build, `node src/check.mjs` and the conformance command in `README.md`. They
  are the same commands Vercel and CI run.
- Do not invent credentials, customers, funding, partnerships or traction in site copy.
