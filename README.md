# boundry.company

Corporate website for Boundry. Static HTML/CSS, zero npm dependencies, built by one Node script on the
Boundry design foundation ([rkendel1/stack-ui](https://github.com/rkendel1/stack-ui)), vendored in
`vendor/stack-ui/` as a checksummed static release.

## Build and preview

```bash
node src/build.mjs                 # writes ./dist (fails if vendor/stack-ui does not match SHA256SUMS)
node src/check.mjs                 # every page has the shared header, footer, theme control and product links
node vendor/stack-ui/conformance.mjs --company --html dist --css src/styles.css   # design-foundation conformance
python3 -m http.server 8000 -d dist
```

Requires Node 18+.

## Deploying (Vercel)

`vercel.json` holds the whole deployment config: no framework, no install step, build `node src/build.mjs` followed by the site check and design-foundation conformance (a non-conforming build does not deploy), output `dist`. Import `rkendel1/boundry` in Vercel and leave the project settings at their defaults; `vercel.json` overrides them.

The config also:
- redirects `/about` → `/about/` (`trailingSlash: true`), matching the canonical URLs and sitemap;
- serves `404.html` for unknown paths;
- sets `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` and `Permissions-Policy` headers;
- caches `styles.css` for a year (pages reference it with a content-hash query, so changes bust the cache).

Add `boundry.company` (and `www.boundry.company` redirecting to it) under Project → Settings → Domains.

## Where things live

| What | File |
|---|---|
| Product directory (name, description, URL, status, npm packages) | `content/products.json` |
| Product accents, the Boundry mark, the shared portfolio, header, footer, tokens | `vendor/stack-ui/` (upgrade by replacing the directory with a newer release) |
| Company settings, contact email, inquiry types, architecture layout | `content/site.json` |
| Page templates and copy | `src/build.mjs` |
| Site styles (local names mapped to foundation tokens at the top) | `src/styles.css` |
| Vercel deployment config | `vercel.json` |
| Extra static files copied verbatim (e.g. og images) | `static/` |

## Adding a product

1. Add the product to the design foundation first (accent in `brand.json`, entry in `brand.js`; see stack-ui `docs/release.md`) and vendor that release.
1. Add its logo as `static/images/products/<id>.png` (square, from the product's own repository).
1. Add an entry to `content/products.json` (`id`, `name`, `category`, `summary`, `responsibility` required; `url` may be `null`). The build fails if it is not in the shared portfolio or its name differs. List its published npm packages in `packages` (`{ name, purpose }`) and the card's command in `install`; the build checks the names, and `src/check.mjs` checks each is linked on Ecosystem.
2. Optionally place its `id` in `site.json → architecture.rows` (or as `side`).
3. Run the build. The product appears on Home, Ecosystem, Architecture, Investors, Contact and the footer.

The build fails on missing fields, duplicate ids, non-https URLs, unknown statuses, or architecture references to unknown products. It prints notes for products with no status or no diagram placement.

## Before launch — needs confirmation

- **Contact email.** `hello@boundry.company` is a placeholder in `site.json`; every mailto link uses it.
- **Development status.** Set to match the investor deck: FeltKit, FeltDB and AppPort `preview` (working beta), AppBoundry and AuthBoundry `in-development` (early). Every product now has packages on npm (`packages` in `content/products.json`, checked against registry.npmjs.org on 2026-11-03); whether that moves AppBoundry or AuthBoundry to `preview` is the owner's call. Change them in `content/products.json` as products move.
- **Founder portrait.** None is published. To add one, put the supplied photo in `static/images/` and set `founder.portrait` in `site.json` (e.g. `"/images/randy-kendel.jpg"`, ideally 4:5). The build fails if the file is missing. Do not substitute a generated image.
- **Positioning (2026-11-04).** The site is positioned on the company thesis: infrastructure for applications that people and AI agents use, operate, and evolve. Boundry controls the stack: FeltKit is product 1, AppBoundry product 2, and FeltDB, AppPort (with AppPort Services) and AuthBoundry form the ecosystem underneath. AppPort Services is part of AppPort, and Resolver is one of its capabilities (its own repository, `rkendel1/resolver`); their packages are listed under AppPort, and neither has a portfolio entry. Maturity on the Investors page is stated as working / demonstrated / planned and must stay in step with the investor deck.
- **AppPort** will not have a website (owner, 2026-11-03; `url: null`). Its card shows "No separate website" and links to its Ecosystem entry and its npm packages.
- **Logo master file.** The mark in `vendor/stack-ui/brand/` is a vector redraw of the supplied logo; commit the master artwork to stack-ui to replace it.
- **Theme preference key changed** from `theme` to `stack-ui.theme` (shared by every Boundry site). A visitor's earlier manual choice is not carried over; the default is still the system theme.
