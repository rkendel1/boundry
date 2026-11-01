# boundry.company

Corporate website for Boundry. Static HTML/CSS, zero dependencies, built by one Node script.

## Build and preview

```bash
node src/build.mjs                 # writes ./dist
python3 -m http.server 8000 -d dist
```

Requires Node 18+. Deploy `dist/` to any static host (Cloudflare Pages, Netlify, S3/CloudFront, GitHub Pages). Configure the host to serve `404.html` for missing paths.

## Where things live

| What | File |
|---|---|
| Product directory (name, description, URL, accent, status) | `content/products.json` |
| Company settings, contact email, inquiry types, architecture layout | `content/site.json` |
| Page templates and copy | `src/build.mjs` |
| Styles (light/dark tokens at the top) | `src/styles.css` |
| Extra static files copied verbatim (e.g. og images) | `static/` |

## Adding a product

1. Add an entry to `content/products.json` (`id`, `name`, `category`, `summary`, `responsibility` required; `url` may be `null`).
2. Optionally place its `id` in `site.json → architecture.rows` (or as `side`).
3. Run the build. The product appears on Home, Ecosystem, Architecture, Investors, Contact and the footer.

The build fails on missing fields, duplicate ids, non-https URLs, unknown statuses, or architecture references to unknown products. It prints notes for products with no status or no diagram placement.

## Before launch — needs confirmation

- **Contact email.** `hello@boundry.company` is a placeholder in `site.json`; every mailto link uses it.
- **Development status.** Every product's `status` is `null`, so the Investors page shows "Shared in discussion". Set `available`, `preview`, `in-development` or `planned` only where it reflects reality.
- **AppPort** has no public website (`url: null`); it links to its Ecosystem entry instead.
