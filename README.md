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
| Product directory (name, description, URL, status) | `content/products.json` |
| Product accents, the Boundry mark, the shared portfolio, header, footer, tokens | `vendor/stack-ui/` (upgrade by replacing the directory with a newer release) |
| Company settings, contact email, inquiry types, architecture layout | `content/site.json` |
| Page templates and copy | `src/build.mjs` |
| Site styles (local names mapped to foundation tokens at the top) | `src/styles.css` |
| Vercel deployment config | `vercel.json` |
| Extra static files copied verbatim (e.g. og images) | `static/` |

## Adding a product

1. Add the product to the design foundation first (accent in `brand.json`, entry in `brand.js`; see stack-ui `docs/release.md`) and vendor that release.
1. Add an entry to `content/products.json` (`id`, `name`, `category`, `summary`, `responsibility` required; `url` may be `null`). The build fails if it is not in the shared portfolio or its name differs.
2. Optionally place its `id` in `site.json → architecture.rows` (or as `side`).
3. Run the build. The product appears on Home, Ecosystem, Architecture, Investors, Contact and the footer.

The build fails on missing fields, duplicate ids, non-https URLs, unknown statuses, or architecture references to unknown products. It prints notes for products with no status or no diagram placement.

## Before launch — needs confirmation

- **Contact email.** `hello@boundry.company` is a placeholder in `site.json`; every mailto link uses it.
- **Development status.** Every product's `status` is `null`, so the Investors page shows "Shared in discussion". Set `available`, `preview`, `in-development` or `planned` only where it reflects reality.
- **Founder portrait.** None is published. To add one, put the supplied photo in `static/images/` and set `founder.portrait` in `site.json` (e.g. `"/images/randy-kendel.jpg"`, ideally 4:5). The build fails if the file is missing. Do not substitute a generated image.
- **AppPort** has no public website (`url: null`); it links to its Ecosystem entry instead.
- **AgentBoundry**: agentboundry.com did not resolve on 2026-11-01, so its `url` is `null` and it links to its Ecosystem entry. Set the URL once the domain serves a site (and update the design foundation's `brand.js`).
- **Logo master file.** The mark in `vendor/stack-ui/brand/` is a vector redraw of the supplied logo; commit the master artwork to stack-ui to replace it.
- **Theme preference key changed** from `theme` to `stack-ui.theme` (shared by every Boundry site). A visitor's earlier manual choice is not carried over; the default is still the system theme.
