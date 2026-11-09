// Boundry.company static site build.
// Usage: node src/build.mjs   → writes ./dist
// Zero dependencies. Content lives in ./content; styles in ./src/styles.css; static files in ./static.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");

// ---------------------------------------------------------------- design foundation
// The Boundry design foundation (rkendel1/stack-ui), vendored as a checksummed
// static release. Every file must match SHA256SUMS before anything is used.
const ui = join(root, "vendor/stack-ui");
for (const line of readFileSync(join(ui, "SHA256SUMS"), "utf8").trim().split("\n")) {
  const [sum, file] = line.split(/\s+/);
  const actual = createHash("sha256").update(readFileSync(join(ui, file))).digest("hex");
  if (actual !== sum) {
    console.error(`Build failed: vendor/stack-ui/${file} does not match SHA256SUMS`);
    process.exit(1);
  }
}
const { html: shared } = await import(pathToFileURL(join(ui, "esm/html.js")).href);
const { PORTFOLIO } = await import(pathToFileURL(join(ui, "esm/brand.js")).href);
const { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } = await import(pathToFileURL(join(ui, "esm/theme.js")).href);
const brand = JSON.parse(readFileSync(join(ui, "brand/brand.json"), "utf8"));
const site = JSON.parse(readFileSync(join(root, "content/site.json"), "utf8"));
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const { products } = JSON.parse(readFileSync(join(root, "content/products.json"), "utf8"));
const stack = JSON.parse(readFileSync(join(root, "content/stack.json"), "utf8"));
const { stackPages } = await import(pathToFileURL(join(root, "src/stack.mjs")).href);
const YEAR = new Date().getFullYear();

// ---------------------------------------------------------------- validation
const errors = [];
const warnings = [];
const ids = new Set();
for (const p of products) {
  for (const k of ["id", "name", "category", "summary", "responsibility"]) {
    if (!p[k] || typeof p[k] !== "string") errors.push(`product ${p.id ?? "?"}: missing "${k}"`);
  }
  if (ids.has(p.id)) errors.push(`duplicate product id "${p.id}"`);
  ids.add(p.id);
  if (p.url != null && !/^https:\/\/[^\s]+$/.test(p.url)) errors.push(`product ${p.id}: url must be https or null`);
  if (p.status != null && !(p.status in site.productStatuses)) errors.push(`product ${p.id}: unknown status "${p.status}"`);
  if (p.accent) errors.push(`product ${p.id}: "accent" now lives in the design foundation (vendor/stack-ui/brand/brand.json); remove it here`);
  if (!brand.products[p.id]) errors.push(`product ${p.id}: no accent in the design foundation's brand.json`);
  const listed = PORTFOLIO.products.find((x) => x.id === p.id);
  if (!listed) errors.push(`product ${p.id}: not in the shared Boundry portfolio (vendor/stack-ui/esm/brand.js)`);
  else if (listed.name !== p.name) errors.push(`product ${p.id}: name "${p.name}" differs from the shared portfolio ("${listed.name}")`);
  if (!existsSync(join(root, "static/images/products", `${p.id}.png`))) errors.push(`product ${p.id}: logo missing (static/images/products/${p.id}.png)`);
  if (p.packages != null) {
    if (!Array.isArray(p.packages) || !p.packages.length) errors.push(`product ${p.id}: "packages" must be a non-empty list or absent`);
    else {
      const names = new Set();
      for (const pkg of p.packages) {
        if (!pkg || !NPM_NAME.test(pkg.name ?? "")) errors.push(`product ${p.id}: invalid npm package name "${pkg?.name}"`);
        else if (names.has(pkg.name)) errors.push(`product ${p.id}: package ${pkg.name} listed twice`);
        else names.add(pkg.name);
        if (!pkg?.purpose || typeof pkg.purpose !== "string") errors.push(`product ${p.id}: package ${pkg?.name}: missing "purpose"`);
      }
      // The command shown must install (or create from) one of the listed packages.
      const target = p.install && /^npm (?:install|i|create) (\S+?)(?:@latest)?(?:\s|$)/.exec(p.install)?.[1];
      if (p.install != null && !(names.has(target) || names.has(`create-${target}`))) errors.push(`product ${p.id}: install "${p.install}" does not name a listed package`);
    }
  } else if (p.install != null) errors.push(`product ${p.id}: "install" needs "packages"`);
  if (p.status == null) warnings.push(`product ${p.id}: development status not set (Investors page shows "Shared in discussion")`);
}
for (const x of PORTFOLIO.products) if (!products.some((p) => p.id === x.id)) errors.push(`shared portfolio lists ${x.id}, missing from content/products.json`);
const archIds = [...site.architecture.rows.flat(), site.architecture.side].filter(Boolean);
for (const id of archIds) if (!ids.has(id)) errors.push(`architecture references unknown product "${id}"`);
for (const p of products) if (!archIds.includes(p.id)) warnings.push(`product ${p.id} is not placed in the architecture diagram`);
if (site.founder) {
  if (site.founder.url && !/^https:\/\//.test(site.founder.url)) errors.push("founder.url must be https");
  if (site.founder.portrait && !existsSync(join(root, "static", site.founder.portrait))) errors.push(`founder.portrait not found in static/: ${site.founder.portrait}`);
}
if (errors.length) {
  console.error("Build failed:\n  " + errors.join("\n  "));
  process.exit(1);
}

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const byId = Object.fromEntries(products.map((p) => [p.id, p]));
const host = (url) => new URL(url).host;
const mailto = (subject) => `mailto:${site.contact.email}?subject=${encodeURIComponent(subject)}`;
// Product accents come from the design foundation: an element marked
// data-stack-product gets --stack-product-accent for the current theme.
const productAttr = (p) => `data-stack-product="${esc(p.id)}"`;
// Each product's real logo (static/images/products/<id>.png), on a light tile
// so dark artwork stays visible in both themes.
const logoPath = (p) => `/images/products/${p.id}.png`;
const mark = (p, cls = "") =>
  `<span class="pmark ${cls}" ${productAttr(p)} aria-hidden="true"><img src="${logoPath(p)}" alt="" width="96" height="96" loading="lazy" decoding="async"></span>`;

const css = [
  readFileSync(join(ui, "tokens.css"), "utf8"),
  readFileSync(join(ui, "core.css"), "utf8"),
  readFileSync(join(root, "src/styles.css"), "utf8"),
].join("\n");
const cssHash = createHash("sha256").update(css).digest("hex").slice(0, 10);


const NAV = [
  ["/", "Home"],
  ["/ecosystem/", "Ecosystem"],
  ["/architecture/", "Architecture"],
  ["/stack/", "Stack map"],
  ["/about/", "About"],
  ["/investors/", "Investors"],
  ["/contact/", "Contact"],
];

function layout({ path, title, description, body }) {
  const fullTitle = path === "/" ? `${site.name} — ${site.tagline.replace(/\.$/, "")}` : `${title} — ${site.name}`;
  const url = site.origin + path;
  // A section's entry stays current on its subpages (e.g. /stack/feltdb/ under Stack map).
  const navigation = NAV.map(([href, label]) => ({ label, href, current: href === path || (href !== "/" && path.startsWith(href)) }));
  const jsonld =
    path === "/"
      ? `<script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: site.name,
          url: site.origin,
          description: site.description,
          email: site.contact.email,
          logo: `${site.origin}/boundry-mark.svg`,
          sameAs: products.filter((p) => p.url).map((p) => p.url),
          ...(site.founder && { founder: { "@type": "Person", name: site.founder.name, url: site.founder.url } }),
        })}</script>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${site.name}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#f6f7f9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1115" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>${THEME_INIT_SCRIPT}</script>
<link rel="stylesheet" href="/styles.css?v=${cssHash}">
${jsonld}
</head>
<body>
${shared.SiteHeader({ mainId: "main", navigation, navigationLabel: "Primary", theme: { preference: "system" } })}
<main id="main">
${body}
</main>
${shared.SiteFooter({
  id: "site-footer",
  tagline: site.tagline,
  year: YEAR,
  columns: [
    { title: "Company", links: [["/ecosystem/", "Ecosystem"], ["/architecture/", "Architecture"], ["/stack/", "Stack map"], ["/about/", "About"], ["/investors/", "Investors"]].map(([href, label]) => ({ label, href })) },
    { title: "Contact", links: [{ label: "Contact", href: "/contact/" }, { label: site.contact.email, href: `mailto:${site.contact.email}` }] },
  ],
})}
<script>
(function(){
  // The shared theme switch: System (default) follows the OS; Light or Dark is
  // remembered for this site, as the design foundation's theme.js does.
  var d=document.documentElement,k=${JSON.stringify(THEME_STORAGE_KEY)},s=document.querySelector('[data-stack-theme-control]');
  if(!s)return;
  try{var v=localStorage.getItem(k);if(v==='light'||v==='dark')s.value=v;}catch(e){}
  s.addEventListener('change',function(){
    var v=s.value;
    if(v==='light'||v==='dark')d.setAttribute('data-stack-theme',v);else d.removeAttribute('data-stack-theme');
    try{if(v==='light'||v==='dark')localStorage.setItem(k,v);else localStorage.removeItem(k);}catch(e){}
  });
})();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- shared fragments
// A product's packages on the public npm registry (content/products.json → packages).
const npmHref = (name) => `https://www.npmjs.com/package/${name}`;
const npmLink = (pkg) => `<a class="ext mono" href="${npmHref(pkg.name)}" rel="noopener">${esc(pkg.name)}</a>`;
const npmLinks = (p) => (p.packages?.length ? p.packages.map(npmLink).join(", ") : `<span class="muted">None published</span>`);
const productCard = (p) => `
<article class="product-card" ${productAttr(p)}>
  <header>${mark(p)}<div><div class="cat">${esc(p.category)}</div><h3>${esc(p.name)}</h3></div></header>
  <p>${esc(p.summary)}</p>
  <div>${p.install ? `<code class="install">${esc(p.install)}</code>` : ""}</div>
  <footer>
    <a href="/ecosystem/#${p.id}">Overview</a>
    ${p.url ? `<a class="ext" href="${p.url}" rel="noopener">${host(p.url)}</a>` : `<span class="nosite">No separate website</span>`}
    ${p.packages?.length ? `<a class="ext" href="${npmHref(p.packages[0].name)}" rel="noopener">npm</a>` : ""}
  </footer>
</article>`;

const archCell = (p, cls = "", extraStyle = "") => `
  <a class="arch-cell ${cls}" href="/ecosystem/#${p.id}" ${productAttr(p)}${extraStyle ? ` style="${extraStyle}"` : ""}>
    <span class="n">${esc(p.name)}</span><span class="r">${esc(p.responsibility)}</span>
  </a>`;

function archDiagram() {
  const a = site.architecture;
  // Each row shares the diagram's width (a 6-column grid): the products on top, the foundation below.
  const rows = a.rows.map((row) => row.map((id) => archCell(byId[id], "", `--span:${6 / row.length};`)).join("")).join("");
  const side = a.side ? archCell(byId[a.side], "arch-side", `--rows:${a.rows.length + 1};`) : "";
  return `
<figure style="margin:0">
  <div class="arch" role="group" aria-label="Boundry architecture: products by responsibility">
    <div class="arch-top">${esc(a.top)}</div>
    ${rows}
    ${side}
  </div>
  <figcaption class="arch-legend">
    <span>Conceptual view. Top: the products. Bottom: FeltDB and AppPort, the foundation they are built on. Select a block for details.</span>
  </figcaption>
</figure>`;
}

const heroFigure = `
<svg viewBox="0 0 480 400" role="img" aria-labelledby="hero-fig-t">
  <title id="hero-fig-t">Diagram: durable state at the center of an application boundary, with capability, authority, and execution exposed through explicit ports.</title>
  <rect class="dgm-line" x="20.5" y="20.5" width="439" height="359"/>
  <rect class="dgm-dash" x="80.5" y="80.5" width="319" height="239"/>
  <path class="dgm-line" d="M240 150V20M240 250V380M160 200H20M320 200H460"/>
  <rect class="dgm-ink" x="160.5" y="150.5" width="159" height="99"/>
  <text class="dgm-label-ink" x="240" y="196" text-anchor="middle">Durable</text>
  <text class="dgm-label-ink" x="240" y="214" text-anchor="middle">state</text>
  <rect class="dgm-port" x="234" y="74" width="12" height="12"/>
  <rect class="dgm-port" x="234" y="314" width="12" height="12"/>
  <rect class="dgm-port" x="74" y="194" width="12" height="12"/>
  <rect class="dgm-port" x="394" y="194" width="12" height="12"/>
  <rect class="dgm-end" x="236" y="16" width="8" height="8"/>
  <rect class="dgm-end" x="236" y="376" width="8" height="8"/>
  <rect class="dgm-end" x="16" y="196" width="8" height="8"/>
  <rect class="dgm-end" x="456" y="196" width="8" height="8"/>
  <text class="dgm-label" x="252" y="58">Authority</text>
  <text class="dgm-label" x="252" y="350">Boundary</text>
  <text class="dgm-label" x="32" y="186">Execution</text>
  <text class="dgm-label" x="448" y="186" text-anchor="end">Capability</text>
  <text class="dgm-label" x="92" y="104">Application</text>
</svg>`;

const ctaBand = (heading, text) => `
<section class="section"><div class="wrap cta">
  <div style="display:grid;gap:16px"><h2>${heading}</h2>${text ? `<p class="lede">${text}</p>` : ""}</div>
  <div class="actions"><a class="btn" href="/contact/">Contact Boundry <span class="arrow">→</span></a></div>
</div></section>`;

const PRINCIPLES = [
  ["Durable state", "transient representations"],
  ["Explicit authority", "implicit access"],
  ["Deterministic capabilities", "fragile discovery"],
  ["Evidence of execution", "claims of completion"],
  ["Modular architecture", "monolithic platforms"],
  ["Interoperability", "vendor lock-in"],
];
const principlesList = `<ol class="principles">${PRINCIPLES.map(
  ([a, b], i) => `<li><span class="num">${String(i + 1).padStart(2, "0")}</span><span class="over">${a}</span><span class="over-not">${b}</span></li>`
).join("")}</ol>`;

function founderSection() {
  const f = site.founder;
  if (!f) return "";
  const portrait = f.portrait
    ? `<img class="founder-portrait" src="${esc(f.portrait)}" alt="${esc(f.portraitAlt || f.name)}" width="480" height="600" loading="lazy" decoding="async">`
    : "";
  return `
<section class="section" id="founder"><div class="wrap split">
  <div style="display:grid;gap:18px;align-content:start">
    <div class="eyebrow">About the founder</div>
    ${portrait}
    <div><h2>${esc(f.name)}</h2><p class="muted mono" style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin-top:10px">${esc(f.role)}</p></div>
  </div>
  <div class="prose">
    ${f.bio.map((p) => `<p>${esc(p)}</p>`).join("")}
    ${f.url ? `<p style="margin-top:1.4em"><a class="textlink ext" href="${esc(f.url)}" rel="noopener">${esc(host(f.url).replace(/^www\./, ""))}</a></p>` : ""}
  </div>
</div></section>`;
}

// ---------------------------------------------------------------- pages
const pages = [];

// Home
pages.push({
  path: "/",
  title: "Home",
  description: site.description,
  body: `
<section class="hero"><div class="wrap">
  <div class="hero-copy">
    <div class="eyebrow">${site.name}</div>
    <h1>Infrastructure for applications that people and AI agents both use and operate.</h1>
    <p class="lede">Boundry builds and controls the technology underneath: FeltDB for application state, and AppPort for capabilities and operational services. FeltKit, our first product, turns them into a preassembled application stack that agents can operate.</p>
    <div class="actions">
      <a class="btn" href="/ecosystem/">Explore the ecosystem <span class="arrow">→</span></a>
      <a class="btn secondary" href="/about/">About Boundry</a>
    </div>
  </div>
  <div class="hero-figure">${heroFigure}</div>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">How it fits</div>
    <h2>One product, on a foundation we own</h2>
    <p class="lede">Teams still assemble a database, permissions, APIs, services, agent access and deployment before their application does anything new. FeltKit arrives preassembled, on technology Boundry built and controls.</p>
  </div>
  <div class="foundations">
    <div class="foundation"><span class="num">01</span><h3>Product</h3><p>A preassembled application stack that agents can operate. Build the application, not the pieces.</p><span class="by">FeltKit</span></div>
    <div class="foundation"><span class="num">02</span><h3>State</h3><p>Durable state for applications and agents: atomic, reactive, one API from the browser to managed.</p><span class="by">FeltDB</span></div>
    <div class="foundation"><span class="num">03</span><h3>Capabilities</h3><p>Capabilities as contracts, reusable across applications, agents and technologies, plus the services apps need.</p><span class="by">AppPort</span></div>
    <div class="foundation"><span class="num">04</span><h3>Boundaries</h3><p>Portable execution inside a controlled boundary, and authority and delegation for people and agents.</p><span class="by">AppBoundry · AuthBoundry</span></div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Products</div>
    <h2>Independently useful. Designed to work together.</h2>
    <p class="lede">FeltDB and AppPort each do one job and can be adopted on their own. FeltKit brings them together as one product. AppBoundry and AuthBoundry are earlier-stage products built on the same foundation.</p>
  </div>
  <div class="products">${products.map(productCard).join("")}${products.length % 3 ? `
    <article class="product-card product-card--more">
      <div class="cat">How they fit together</div>
      <h3>One architecture, independent products</h3>
      <p>FeltKit on top, FeltDB and AppPort underneath. See how state, capabilities, boundaries and authority connect.</p>
      <div></div>
      <footer><a href="/architecture/">Architecture</a><a href="/ecosystem/">Ecosystem</a></footer>
    </article>` : ""}</div>
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">Architecture</div>
    <h2>Distinct responsibilities, not overlapping products.</h2>
    <p class="lede">State lives in FeltDB. Capabilities and services live in AppPort. FeltKit composes them into one product; AppBoundry and AuthBoundry extend the same foundation.</p>
    <p><a class="textlink" href="/architecture/">See the architecture →</a> &nbsp; <a class="textlink" href="/stack/">Open the stack map →</a></p>
  </div>
  ${archDiagram()}
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">Approach</div>
    <h2>Agents should become more capable through better infrastructure — not simply through larger models.</h2>
    <p><a class="textlink" href="/about/">About Boundry →</a></p>
  </div>
  ${principlesList}
</div></section>

${ctaBand("Building applications or agents on serious infrastructure?", "Talk with us about the products, partnerships, or the company.")}
`,
});

// Ecosystem
pages.push({
  path: "/ecosystem/",
  title: "Ecosystem",
  description: "The Boundry product ecosystem: FeltDB, AppPort, AppBoundry, AuthBoundry, and FeltKit — independently useful infrastructure that works together.",
  body: `
<section class="page-head"><div class="wrap">
  <div class="eyebrow">Ecosystem</div>
  <h1>Independently useful technologies that work together.</h1>
  <p class="lede">FeltDB and AppPort are the foundation. FeltKit is the integrated product built on them. AppBoundry and AuthBoundry are early products on the same foundation. Each keeps its own identity and its own home.</p>
</div></section>

<section class="section" style="padding-top:0;border-top:0"><div class="wrap">
  <div class="plist">
  ${products
    .map(
      (p) => `
    <article class="prow" id="${p.id}" ${productAttr(p)}>
      <div class="id">${mark(p)}<div><h2>${esc(p.name)}</h2><div class="cat">${esc(p.category)}</div></div></div>
      <div class="desc"><p>${esc(p.summary)}</p></div>
      <dl>
        <dt>Responsibility</dt><dd>${esc(p.responsibility)}</dd>
        <dt>Stack map</dt><dd><a href="/stack/${p.id}/">${esc(p.name)} in the stack</a></dd>
        <dt>Website</dt><dd>${p.url ? `<a class="ext" href="${p.url}" rel="noopener">${host(p.url)}</a>` : `<span class="muted">No separate website</span>`}</dd>
        <dt>On npm</dt><dd>${p.packages?.length ? `<ul class="pkgs">${p.packages.map((pkg) => `<li>${npmLink(pkg)}<span>${esc(pkg.purpose)}</span></li>`).join("")}</ul>` : `<span class="muted">None published</span>`}</dd>
      </dl>
    </article>`
    )
    .join("")}
  </div>
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">How they fit</div>
    <h2>One responsibility per product.</h2>
  </div>
  <div class="prose">
    <p>The ecosystem is organized by responsibility rather than by feature. FeltDB owns application state. AppPort owns capabilities and the operational services applications need. FeltKit composes them into one product. AppBoundry and AuthBoundry extend the same foundation to portable execution, and to authority and delegation.</p>
    <p>That separation is what lets a team adopt a single component without taking on the whole platform — and what lets the ecosystem grow by adding new responsibilities rather than by enlarging existing products.</p>
    <p style="margin-top:1.4em"><a class="textlink" href="/architecture/">Explore the architecture →</a> &nbsp; <a class="textlink" href="/stack/">Open the stack map →</a></p>
  </div>
</div></section>

${ctaBand("Interested in a specific product?", "Reach out about evaluation, integration, or technical partnership.")}
`,
});

// Architecture
pages.push({
  path: "/architecture/",
  title: "Architecture",
  description: "How Boundry's products relate: durable state, capability discovery and invocation, application boundaries and execution, authority and delegation, and an integrated developer experience.",
  body: `
<section class="page-head"><div class="wrap">
  <div class="eyebrow">Architecture</div>
  <h1>Distinct responsibilities. A coherent foundation.</h1>
  <p class="lede">Boundry's products are not a collection of overlapping tools. Each owns a single architectural responsibility, and together they form a foundation on which applications and agents can be built, operated, and extended.</p>
</div></section>

<section class="section" style="padding-top:0;border-top:0"><div class="wrap">
  ${archDiagram()}
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Responsibilities</div>
    <h2>Who owns what.</h2>
    <p class="lede">Clear ownership is the point. When each concern has exactly one home, systems are easier to reason about, secure, and evolve.</p>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th scope="col">Product</th><th scope="col">Responsibility</th><th scope="col">Scope</th></tr></thead>
    <tbody>
    ${products
      .map(
        (p) =>
          `<tr><td><span class="pname">${mark(p, "sm")}${p.url ? `<a href="${p.url}" class="ext" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}</span></td><td>${esc(p.responsibility)}</td><td class="dim">${esc(p.summary)}</td></tr>`
      )
      .join("")}
    </tbody>
  </table></div>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Design properties</div>
    <h2>Modular by design.</h2>
  </div>
  <div class="cols">
    <div class="col"><span class="tag">Modularity</span><h3>Adopt one component at a time</h3><p>Each product is designed to be useful on its own. A team that needs durable state, or authority and delegation, or application boundaries can adopt that product without adopting the rest.</p></div>
    <div class="col"><span class="tag">Interoperability</span><h3>Connected through explicit contracts</h3><p>Products are designed to work together through defined interfaces rather than hidden coupling, so the relationships between them remain visible, reviewable, and replaceable.</p></div>
    <div class="col"><span class="tag">Integration</span><h3>An integrated path when you want it</h3><p>FeltKit brings FeltDB and AppPort together as one preassembled, agent-operable product that deploys to Vercel, containers, Managed FeltDB or your own FeltDB server without changing application code.</p></div>
  </div>
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">Reading the diagram</div>
    <h2>From state to agents.</h2>
  </div>
  <div class="prose">
    <p><strong>FeltDB</strong> is application state: durable, atomic and reactive, built for applications and agents, with one API wherever state lives.</p>
    <p><strong>AppPort</strong> is capabilities and operational services: each capability a contract that applications and agents can discover, and reuse across technologies.</p>
    <p><strong>FeltKit</strong> is the first integrated product: FeltDB and AppPort, preassembled into an application stack that agents can operate.</p>
    <p><strong>AppBoundry</strong> runs portable application artifacts inside a controlled boundary.</p>
    <p><strong>AuthBoundry</strong> governs authority and delegation for people and agents.</p>
  </div>
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">Go deeper</div>
    <h2>The full stack map.</h2>
  </div>
  <div class="prose">
    <p>This page shows the five products. The <a href="/stack/">stack map</a> goes a level deeper: every component of the stack, including AppPort Services, Resolver, Intent and the agent and evidence layer, with its responsibility, what it composes with, and its current implementation position.</p>
    <p style="margin-top:1.4em"><a class="textlink" href="/stack/">Open the stack map →</a> &nbsp; <a class="textlink" href="/stack/composition/">How it composes →</a> &nbsp; <a class="textlink" href="/stack/evidence/">Evidence map →</a></p>
  </div>
</div></section>

${ctaBand("Discuss the architecture with our team.", "")}
`,
});

// About
pages.push({
  path: "/about/",
  title: "About",
  description: "About Boundry: a technology company building infrastructure for the next generation of applications and agents, founded by Randy Kendel.",
  body: `
<section class="page-head"><div class="wrap">
  <div class="eyebrow">About Boundry</div>
  <h1>Software is changing.</h1>
  <p class="lede">Applications are increasingly built, extended, and operated by both people and agents. Boundry is developing the infrastructure needed to make that transition reliable.</p>
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">The company</div>
    <h2>More than increasingly capable models.</h2>
  </div>
  <div class="prose">
    <p>Boundry is a technology company, founded in 2026, building infrastructure for applications that people and AI agents both use and operate.</p>
    <p>We believe the future of software requires more than increasingly capable AI models. It requires durable state, explicit authority, discoverable capabilities, reliable execution, and systems designed to work together.</p>
    <p>Our products address these foundational challenges through an interconnected ecosystem of independently useful technologies.</p>
    <p style="margin-top:1.4em"><a class="textlink" href="/ecosystem/">Explore the ecosystem →</a></p>
  </div>
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">Approach</div>
    <h2>Our approach emphasizes</h2>
  </div>
  ${principlesList}
</div></section>

<section class="section"><div class="wrap">
  <p class="statement">We believe agents should become more capable through better infrastructure, not simply through larger models.</p>
</div></section>

${founderSection()}

${ctaBand("Work with Boundry.", "Commercial, technical, and investment conversations are welcome.")}
`,
});

// Investors
const statusCell = (p) =>
  p.status ? `<span class="status">${esc(site.productStatuses[p.status])}</span>` : `<span class="muted">Shared in discussion</span>`;
const anyStatus = products.some((p) => p.status);
pages.push({
  path: "/investors/",
  title: "Investors",
  description: "Boundry for investors: company thesis, product portfolio and shared architecture, development progress, commercial opportunity, and direction.",
  body: `
<section class="page-head"><div class="wrap">
  <div class="eyebrow">Investors</div>
  <h1>An infrastructure company. FeltKit is product one.</h1>
  <p class="lede">Boundry builds and controls the technology underneath: FeltDB for application state, and AppPort for capabilities and operational services. FeltKit, our first commercial product, brings them together; AppPort's reusable capabilities open a wider platform opportunity.</p>
  <ul class="toc" aria-label="On this page">
    <li><a href="#overview">Overview</a></li>
    <li><a href="#portfolio">Portfolio</a></li>
    <li><a href="#progress">Technology &amp; progress</a></li>
    <li><a href="#opportunity">Commercial opportunity</a></li>
    <li><a href="#direction">Direction</a></li>
    <li><a href="#contact">Contact</a></li>
  </ul>
</div></section>

<section class="section" id="overview"><div class="wrap split">
  <div style="display:grid;gap:18px"><div class="eyebrow">Overview &amp; thesis</div><h2>Applications and agents need better infrastructure.</h2></div>
  <div class="prose">
    <p>Software is increasingly built, extended, and operated by both people and agents. Models and APIs alone do not make that reliable. Applications and agents need dependable infrastructure for <strong>durable state</strong>, <strong>capabilities</strong>, <strong>authority</strong>, <strong>execution</strong>, and <strong>interoperability</strong>.</p>
    <p>Boundry's thesis is that agents become more capable through better infrastructure, not simply through larger models — and that this infrastructure is best delivered as modular products with clear responsibilities rather than as a single monolithic platform.</p>
    <p>That shapes the company in three levels: <strong>FeltKit</strong>, the product today and the beachhead; the <strong>AppPort ecosystem</strong>, the platform opportunity; and <strong>FeltDB and AppPort</strong>, the technology foundation Boundry built and controls.</p>
  </div>
</div></section>

<section class="section" id="portfolio"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Portfolio &amp; shared architecture</div>
    <h2>Five products. One foundation.</h2>
    <p class="lede">FeltDB and AppPort are the foundation. FeltKit integrates them into one product. AppBoundry and AuthBoundry are early products on the same foundation.</p>
  </div>
  ${archDiagram()}
</div></section>

<section class="section" id="progress"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Technology &amp; development progress</div>
    <h2>What exists, and what is planned.</h2>
    <p class="lede">We distinguish carefully between capabilities that exist today and development that is planned. The product scopes below describe each product's defined responsibility${anyStatus ? "; the status column reflects current development state" : ""}.</p>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th scope="col">Product</th><th scope="col">Responsibility</th><th scope="col">Public site</th><th scope="col">npm</th><th scope="col">Status</th></tr></thead>
    <tbody>
    ${products
      .map(
        (p) =>
          `<tr><td><span class="pname">${mark(p, "sm")}${esc(p.name)}</span></td><td>${esc(p.responsibility)}</td><td>${p.url ? `<a class="ext" href="${p.url}" rel="noopener">${host(p.url)}</a>` : `<span class="muted">No separate website</span>`}</td><td>${npmLinks(p)}</td><td>${statusCell(p)}</td></tr>`
      )
      .join("")}
    </tbody>
  </table></div>
  <p class="note" style="margin-top:24px">Detailed technical status, demonstrations, and evidence of working functionality for each product are provided directly in investment discussions. This page intentionally contains no customer, revenue, funding, partnership, or market-size claims. The <a href="/stack/evidence/">evidence map</a> states the known implementation position of every stack component.</p>
</div></section>

<section class="section" id="opportunity"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Commercial opportunity</div>
    <h2>A beachhead, and a platform opportunity.</h2>
    <p class="lede">The portfolio structure creates more than one path to adoption. The opportunities below describe the potential of the model, not current commercial results.</p>
  </div>
  <div class="cols">
    <div class="col"><span class="tag">Potential · Beachhead</span><h3>FeltKit</h3><p>One product for one audience — developers and small teams building applications that people and agents operate — and the nearest route to revenue.</p></div>
    <div class="col"><span class="tag">Potential · Platform</span><h3>The AppPort ecosystem</h3><p>Capabilities are contracts, so they are reusable across applications, agents and technologies, including existing systems. That is the larger platform opportunity.</p></div>
    <div class="col"><span class="tag">Potential · Foundation</span><h3>Independently useful technology</h3><p>FeltDB and AppPort are each useful on their own, giving more than one path to adoption, and new products can be built on them.</p></div>
  </div>
  <div class="section-head" style="margin-top:clamp(48px,6vw,72px);margin-bottom:24px"><h3>Potential distribution</h3></div>
  <div class="cols">
    <div class="col"><span class="tag">Developers</span><p>Direct adoption by developers through each product's own website and documentation.</p></div>
    <div class="col"><span class="tag">Teams &amp; organizations</span><p>Commercial adoption of individual products or the integrated platform by teams building and operating applications and agents.</p></div>
    <div class="col"><span class="tag">Technical partners</span><p>Integration by partners whose applications and agents benefit from explicit capabilities, authority, and execution controls.</p></div>
  </div>
</div></section>

<section class="section" id="direction"><div class="wrap split">
  <div style="display:grid;gap:18px"><div class="eyebrow">Roadmap &amp; direction</div><h2>Where the company is going.</h2></div>
  <div>
    <ol class="principles" style="margin-bottom:24px">
      <li><span class="num">01</span><span class="over">Commercialize FeltKit</span><span class="over-not" style="font-size:15.5px">From design partners to paying teams.</span></li>
      <li><span class="num">02</span><span class="over">Harden the foundation</span><span class="over-not" style="font-size:15.5px">FeltDB and AppPort, toward 1.0.</span></li>
      <li><span class="num">03</span><span class="over">Grow the AppPort ecosystem</span><span class="over-not" style="font-size:15.5px">Reusable capabilities across applications, agents and existing systems.</span></li>
      <li><span class="num">04</span><span class="over">Develop the early products</span><span class="over-not" style="font-size:15.5px">AppBoundry and AuthBoundry, as the foundation matures.</span></li>
    </ol>
    <p class="muted" style="font-size:15px">This describes direction, not dated commitments. A detailed product roadmap is available in investment discussions.</p>
  </div>
</div></section>
<style>#direction .over-not::before{content:none}</style>

<section class="section" id="contact"><div class="wrap cta">
  <div style="display:grid;gap:16px">
    <div class="eyebrow">Investment discussions</div>
    <h2>Talk with Boundry.</h2>
    <p class="lede">For investment discussions, materials, or a technical walkthrough of the portfolio.</p>
  </div>
  <div class="actions"><a class="btn" href="${mailto("Investment discussion")}">${site.contact.email} <span class="arrow">→</span></a></div>
</div></section>
`,
});

// Contact
pages.push({
  path: "/contact/",
  title: "Contact",
  description: "Contact Boundry for commercial inquiries, developer and technical partnerships, investment discussions, and general company inquiries.",
  body: `
<section class="page-head"><div class="wrap">
  <div class="eyebrow">Contact</div>
  <h1>Get in touch.</h1>
  <p class="lede">Choose the topic that fits best and we'll route your message to the right people. For product-specific questions, each product's own website is also a good place to start.</p>
</div></section>

<section class="section" style="padding-top:0;border-top:0"><div class="wrap">
  <div class="contact-grid">
  ${site.contact.inquiries
    .map(
      (q) => `
    <div class="contact-item" id="${q.id}">
      <h2 style="font-size:24px">${esc(q.title)}</h2>
      <p>${esc(q.body)}</p>
      <a class="mail" href="${mailto(q.subject)}">${site.contact.email}</a>
      <span class="muted mono" style="font-size:12.5px">Subject: ${esc(q.subject)}</span>
    </div>`
    )
    .join("")}
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head"><div class="eyebrow">Products</div><h2>Product websites and packages</h2></div>
  <div class="table-wrap"><table>
    <thead><tr><th scope="col">Product</th><th scope="col">Focus</th><th scope="col">Website</th><th scope="col">npm</th></tr></thead>
    <tbody>${products
      .map(
        (p) =>
          `<tr><td><span class="pname">${mark(p, "sm")}${esc(p.name)}</span></td><td>${esc(p.category)}</td><td>${p.url ? `<a class="ext" href="${p.url}" rel="noopener">${host(p.url)}</a>` : `<span class="muted">No separate website</span>`}</td><td>${npmLinks(p)}</td></tr>`
      )
      .join("")}</tbody>
  </table></div>
</div></section>
`,
});

// Stack map (/stack/): content/stack.json, rendered by src/stack.mjs.
{
  const result = stackPages({ stack, products, site, shared, esc, mark, productAttr, host, npmLink, ctaBand });
  if (result.errors.length) {
    console.error("Build failed:\n  " + result.errors.join("\n  "));
    process.exit(1);
  }
  pages.push(...result.pages);
}

// 404
const notFound = {
  path: "/404.html",
  title: "Page not found",
  description: "The requested page could not be found.",
  body: `
<section class="page-head"><div class="wrap">
  <div class="eyebrow">404</div>
  <h1>This page is outside the boundary.</h1>
  <p class="lede">The page you requested doesn't exist or has moved.</p>
  <div class="actions"><a class="btn" href="/">Return home</a><a class="btn secondary" href="/ecosystem/">Explore the ecosystem</a></div>
</div></section>`,
};

// ---------------------------------------------------------------- write
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
if (existsSync(join(root, "static"))) cpSync(join(root, "static"), out, { recursive: true });
writeFileSync(join(out, "styles.css"), css);

for (const pg of pages) {
  const dir = join(out, pg.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), layout(pg));
}
writeFileSync(join(out, "404.html"), layout(notFound).replace('<head>', '<head>\n<meta name="robots" content="noindex">'));

writeFileSync(
  join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${site.origin}${p.path}</loc></url>`).join("\n")}
</urlset>
`
);
writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`);
cpSync(join(ui, "brand/boundry-favicon.svg"), join(out, "favicon.svg"));
cpSync(join(ui, "brand/boundry-mark.svg"), join(out, "boundry-mark.svg"));

console.log(`Built ${pages.length + 1} pages → dist/`);
for (const w of warnings) console.log("  note: " + w);
