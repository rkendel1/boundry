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
  ["/about/", "About"],
  ["/investors/", "Investors"],
  ["/contact/", "Contact"],
];

function layout({ path, title, description, body }) {
  const fullTitle = path === "/" ? `${site.name} — ${site.tagline.replace(/\.$/, "")}` : `${title} — ${site.name}`;
  const url = site.origin + path;
  const navigation = NAV.map(([href, label]) => ({ label, href, current: href === path }));
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
    { title: "Company", links: [["/ecosystem/", "Ecosystem"], ["/architecture/", "Architecture"], ["/about/", "About"], ["/investors/", "Investors"]].map(([href, label]) => ({ label, href })) },
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
    <span>Conceptual view. Top: Boundry's two products. Middle: the ecosystem they are built on (AppPort includes AppPort Services and its Resolver capability). Bottom: AuthBoundry, a separate product. Select a block for details.</span>
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

// ---------------------------------------------------------------- thesis fragments
// The company thesis: infrastructure for applications that people and AI agents use,
// operate, and evolve. Three dimensions of one problem, two separations that
// differentiate it, and maturity stated as working / demonstrated / planned.
const thesisCols = `
<div class="cols">
  <div class="col"><span class="tag">01 · Use</span><h3>How applications are used</h3><p>How an application exposes what it does to people, to other software, and to AI agents: capabilities as contracts, reachable over AppPort and MCP, under one authority model.</p><span class="tag">FeltKit · AppPort</span></div>
  <div class="col"><span class="tag">02 · Operate</span><h3>How applications are operated</h3><p>How an application manages its state, its authority, its execution, and the evidence of what happened: durable state with a contract, enforced roles, verified execution, recorded decisions.</p><span class="tag">FeltKit · AppBoundry · FeltDB</span></div>
  <div class="col"><span class="tag">03 · Evolve</span><h3>How applications change</h3><p>How an application changes without every change requiring a new release: the artifact is the deployment unit, and dependencies are references resolved at runtime.</p><span class="tag">AppBoundry · AppPort Services</span></div>
</div>`;

const separations = `
<div class="cols two">
  <div class="col" ${productAttr(byId.appboundry)}>
    <span class="tag">AppBoundry</span>
    <h3>Separates the application from its source repository</h3>
    <p>The repository produces the artifact. The artifact is the deployment unit. The runtime verifies it and operates it, with no source and no build tooling beside it.</p>
    <code class="install">npx feltkit deploy --target appboundry</code>
  </div>
  <div class="col">
    <span class="tag">Resolver</span>
    <h3>Separates the application from the implementations of its dependencies</h3>
    <p>The application declares what it needs, as a reference. Resolver decides what satisfies it, now and after every change, and each use records which revision it got.</p>
    <code class="install">resolver set ref://prod/chat/model …</code>
  </div>
</div>
<p class="lede" style="margin-top:28px">Together, an application is coupled neither to the environment that produced it nor to the infrastructure currently supporting it.</p>`;

// The company structure: Boundry controls the stack; two products on top; the ecosystem underneath.
const companyStructure = `
<div class="cols two">
  <div class="col" ${productAttr(byId.feltkit)}><span class="tag">Product 1 · ${esc(byId.feltkit.name)}</span><h3>Build and operate applications</h3><p>Applications that people and agents use, with state, capabilities, agent access and Studio preassembled. The commercial entry point.</p><a class="textlink ext" href="${byId.feltkit.url}" rel="noopener">${host(byId.feltkit.url)}</a></div>
  <div class="col" ${productAttr(byId.appboundry)}><span class="tag">Product 2 · ${esc(byId.appboundry.name)}</span><h3>The platform that runs artifacts</h3><p>The repository produces a verified artifact; AppBoundry checks it and runs it, independent of the source and the build that produced it.</p><a class="textlink ext" href="${byId.appboundry.url}" rel="noopener">${host(byId.appboundry.url)}</a></div>
</div>
<div class="cols" style="margin-top:1px;border-top:0">
  <div class="col">${mark(byId.feltdb, "sm")}<span class="tag">Ecosystem · FeltDB</span><p>Durable state and the control plane, under both products.</p></div>
  <div class="col">${mark(byId.appport, "sm")}<span class="tag">Ecosystem · AppPort</span><p>Capability discovery and authority: every capability a contract, over AppPort and MCP.</p></div>
  <div class="col"><span class="pmark sm" ${productAttr(byId.appport)} aria-hidden="true"><img src="/images/appport-services.png" alt="" width="96" height="96" loading="lazy" decoding="async"></span><span class="tag">Ecosystem · AppPort Services</span><p>Reusable operational capabilities (files, notifications, configuration, jobs, webhooks), Resolver among them.</p></div>
</div>
<p class="lede" style="margin-top:28px">Every layer is built and controlled by Boundry. No third-party database or capability platform sits under either product. AuthBoundry, authority and delegation for people and agents, is a separate product.</p>`;

// What an application artifact carries, and how much of it works today.
const OBJECT_ATTRS = [
  ["Identity", "Content-addressed SHA-256 over the manifest and module", "working"],
  ["Version", "A new version must satisfy the data already stored", "working"],
  ["Verification record", "Every file hashed and checked before anything runs", "working"],
  ["Deployment history", "Artifact registration exists; managed deployment records are designed", "partial"],
  ["Runtime", "Runs from the artifact alone", "working"],
  ["Dependencies", "References resolved at runtime; model references today", "partial"],
  ["State boundary", "A state contract the host installs and enforces, with migrations", "working"],
  ["Authority boundary", "Roles, permissions and host grants checked before code runs", "working"],
  ["Operational evidence", "Health reports the running module; decisions carry receipts", "working"],
];
const MATURITY = { working: "Working", partial: "Partial", demonstrated: "Demonstrated", planned: "Planned" };
const objectTable = `
<div class="table-wrap"><table>
  <thead><tr><th scope="col">An artifact has</th><th scope="col">Today</th></tr></thead>
  <tbody>${OBJECT_ATTRS.map(([a, b, s]) => `<tr><td><strong>${esc(a)}</strong><br><span class="status" style="margin-top:6px">${MATURITY[s]}</span></td><td class="dim">${esc(b)}</td></tr>`).join("")}</tbody>
</table></div>`;

// The products and the ecosystem, and their strategic contribution. AppPort Services belongs to AppPort, and
// Resolver is a capability of AppPort Services (its own repository, rkendel1/resolver), so
// neither has a portfolio entry of its own.
const TECHNOLOGY = [
  ["FeltKit", "feltkit", "Product 1", "Application development and operation"],
  ["AppBoundry", "appboundry", "Product 2", "Artifact deployment and execution"],
  ["FeltDB", "feltdb", "Ecosystem", "Durable application state and control plane"],
  ["AppPort", "appport", "Ecosystem", "Capability discovery and authority"],
  ["AppPort Services", null, "Ecosystem", "Reusable operational capabilities, Resolver among them (part of AppPort)"],
  ["AuthBoundry", "authboundry", "Separate product", "Authority and delegation for people and agents (early)"],
];
const technologyTable = `
<div class="table-wrap"><table>
  <thead><tr><th scope="col">Technology</th><th scope="col">Role</th><th scope="col">Strategic contribution</th></tr></thead>
  <tbody>${TECHNOLOGY.map(([n, id, r, c]) => `<tr><td><span class="pname">${id ? mark(byId[id], "sm") : ""}${id ? `<a href="/ecosystem/#${id}">${esc(n)}</a>` : esc(n)}</span></td><td class="dim">${esc(r)}</td><td>${esc(c)}</td></tr>`).join("")}</tbody>
</table></div>`;

const maturityCols = `
<div class="cols">
  <div class="col"><span class="tag">Working · in published packages, under test</span><ul>
    <li>FeltKit (<span class="mono">@feltdb/feltkit</span> 0.3.14): starter, developer workflow, Studio, agent access over AppPort and MCP</li>
    <li>FeltDB, AppPort and AppPort Services on npm</li>
    <li>AppBoundry (<span class="mono">@appport/appboundry</span> 1.7.3): verified artifacts, state contracts, migrations, enforced authority, backups</li>
    <li>Resolver (<span class="mono">@appport/resolver</span> 0.2.0): runtime model references with receipts</li>
  </ul></div>
  <div class="col"><span class="tag">Demonstrated · deployed and measured</span><ul>
    <li>AppBoundry's managed-hosting foundation: artifacts uploaded, verified independently, deployed by a pull-based host agent, and Running only on the runtime's own evidence; all 12 acceptance criteria passed with a real FeltKit app on our server (staging)</li>
    <li>A FeltKit application run from its artifact on Fly and on our own server; the runtime reported the expected module identity on both</li>
    <li>A deployed application's model switched in Resolver with no rebuild, redeploy or restart (end-to-end test)</li>
    <li>FeltKit's runtime and AppBoundry agree on every state-contract step (parity test)</li>
  </ul></div>
  <div class="col"><span class="tag">Planned · designed or next, not built</span><ul>
    <li>Deploying from the FeltKit CLI through AppBoundry: FeltKit's side is built; AppBoundry's deploy tokens are next</li>
    <li>Hardening gates and public routing for managed hosting</li>
    <li>Shared, per-call execution and metering: pay for work, not servers</li>
    <li>Tenant isolation beyond containers</li>
    <li>Resolver for endpoints, credentials and configuration values</li>
  </ul></div>
</div>`;

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
    <h1>Infrastructure for applications that people and AI agents use, operate, and evolve.</h1>
    <p class="lede">Boundry controls the whole stack. FeltKit, product one, builds and operates applications; AppBoundry, product two, deploys and runs them as verified artifacts; and the ecosystem underneath gives them durable state, authority and dependencies resolved at runtime.</p>
    <div class="actions">
      <a class="btn" href="${byId.feltkit.url}" rel="noopener">Start with FeltKit <span class="arrow">→</span></a>
      <a class="btn secondary" href="/architecture/">How it works</a>
    </div>
  </div>
  <div class="hero-figure">${heroFigure}</div>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">The thesis</div>
    <h2>Use, operate, evolve: one infrastructure problem</h2>
    <p class="lede">Today an application is its repository, deployed to a hosting provider, with its dependencies compiled in. Deploying means rebuilding, changing a dependency means a release, and operating it means reconstructing what ran. Boundry works on the three dimensions of that problem.</p>
  </div>
  ${thesisCols}
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">The company</div>
    <h2>Boundry controls the stack. Two products sit on top.</h2>
  </div>
  ${companyStructure}
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">The bigger idea</div>
    <h2>Applications become managed infrastructure objects.</h2>
    <p class="lede">Not a repository deployed to a host, but an independently addressable, identifiable, deployable and evolvable unit of software. The artifact, its identity, its authority and its evidence matter more than the repository or the model output that produced it.</p>
  </div>
  ${objectTable}
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Where to start</div>
    <h2>Start with FeltKit: build the application, deploy the artifact, evolve it at runtime.</h2>
    <p class="lede">Developers do not adopt the ecosystem piece by piece. FeltKit is one experience: an application with state, capabilities, agent access and Studio preassembled, compiled by one command into an artifact AppBoundry runs, with dependencies an AppPort Services capability, Resolver, can change at runtime.</p>
  </div>
  <div class="cols">
    <div class="col"><span class="tag">1 · Build</span><code class="install">npm create feltkit@latest my-app</code><p>Data, functions, roles and capabilities in TypeScript.</p></div>
    <div class="col"><span class="tag">2 · Deploy</span><code class="install">npx feltkit deploy --target appboundry</code><p>FeltKit builds a verified artifact; AppBoundry deploys and operates it. No servers to manage.</p></div>
    <div class="col"><span class="tag">3 · Evolve</span><code class="install">resolver set ref://prod/chat/model …</code><p>Retarget a dependency; the running application picks it up, with a receipt.</p></div>
  </div>
  <p style="margin-top:24px"><a class="textlink ext" href="${byId.feltkit.url}" rel="noopener">${host(byId.feltkit.url)}</a></p>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Products</div>
    <h2>Independently useful. Designed to work together.</h2>
    <p class="lede">Two products, FeltKit and AppBoundry, on an ecosystem of the founder's other products. Each does one job and is consumed through its published contract. AuthBoundry is a separate, earlier-stage product.</p>
  </div>
  <div class="products">${products.map(productCard).join("")}${products.length % 3 ? `
    <article class="product-card product-card--more">
      <div class="cat">How they fit together</div>
      <h3>One architecture, independent products</h3>
      <p>FeltKit and AppBoundry on top; FeltDB and AppPort (with AppPort Services) underneath; AuthBoundry alongside.</p>
      <div></div>
      <footer><a href="/architecture/">Architecture</a><a href="/ecosystem/">Ecosystem</a></footer>
    </article>` : ""}</div>
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">Architecture</div>
    <h2>Distinct responsibilities, not overlapping products.</h2>
    <p class="lede">FeltKit builds and operates applications; AppBoundry deploys and runs them. Underneath, state lives in FeltDB, capabilities in AppPort, and operational capabilities (Resolver among them) in AppPort Services. AuthBoundry, authority and delegation, is a separate product.</p>
    <p><a class="textlink" href="/architecture/">See the architecture →</a></p>
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
  description: "The Boundry ecosystem: FeltKit, AppBoundry, FeltDB, AppPort (with AppPort Services and its Resolver capability), and the separate product AuthBoundry — independently useful infrastructure for applications that people and agents use, operate, and evolve.",
  body: `
<section class="page-head"><div class="wrap">
  <div class="eyebrow">Ecosystem</div>
  <h1>Two products, and the ecosystem under them.</h1>
  <p class="lede">FeltKit is product one and AppBoundry product two. FeltDB and AppPort (with AppPort Services and its Resolver capability) form the ecosystem both are built on. AuthBoundry, authority and delegation for people and agents, is a separate product. Each keeps its own identity and its own home.</p>
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
    <p>Boundry's products and its ecosystem are organized by responsibility rather than by feature. FeltKit builds and operates applications; AppBoundry deploys and runs them. Underneath, FeltDB owns application state and records what the platform decided and did. AppPort owns capabilities and authority; AppPort Services provides reusable operational capabilities, among them Resolver, which resolves an application's dependencies at runtime. AuthBoundry, a separate product, covers authority and delegation.</p>
    <p>That separation is what lets a team adopt a single component without taking on the whole platform — and what lets the ecosystem grow by adding new responsibilities rather than by enlarging existing products.</p>
    <p style="margin-top:1.4em"><a class="textlink" href="/architecture/">Explore the architecture →</a></p>
  </div>
</div></section>

${ctaBand("Interested in a specific product?", "Reach out about evaluation, integration, or technical partnership.")}
`,
});

// Architecture
pages.push({
  path: "/architecture/",
  title: "Architecture",
  description: "How Boundry's technologies relate: durable state, capability discovery and authority, artifact deployment and execution, runtime dependency resolution, and FeltKit, the integrated developer experience.",
  body: `
<section class="page-head"><div class="wrap">
  <div class="eyebrow">Architecture</div>
  <h1>Distinct responsibilities. A coherent foundation.</h1>
  <p class="lede">Boundry's technologies are not a collection of overlapping tools. Each owns a single architectural responsibility, and together they let an application be used, operated and evolved independently of the repository that produced it and the infrastructure that supports it.</p>
</div></section>

<section class="section" style="padding-top:0;border-top:0"><div class="wrap">
  ${archDiagram()}
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Products and ecosystem</div>
    <h2>Two products on a stack Boundry controls.</h2>
  </div>
  ${companyStructure}
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">What the stack separates</div>
    <h2>Independent of its source. Independent of its dependencies.</h2>
  </div>
  ${separations}
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">The artifact</div>
    <h2>An application as a managed object.</h2>
    <p class="lede"><span class="mono">feltkit build --target appboundry</span> produces <span class="mono">my-app.app</span>: a manifest describing every function, schema, role, collection, state contract, migration and host permission, with the SHA-256 of every file; a WebAssembly module that imports nothing; and the built frontend. AppBoundry verifies all of it before anything runs.</p>
  </div>
  ${objectTable}
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">The technologies</div>
    <h2>Two products, one ecosystem.</h2>
    <p class="lede">Each contributes one part of using, operating and evolving applications. A customer adopts FeltKit or AppBoundry without separately adopting the ecosystem underneath.</p>
  </div>
  ${technologyTable}
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
    <div class="col"><span class="tag">Integration</span><h3>An integrated path when you want it</h3><p>FeltKit brings the technologies together as one experience: build the application, deploy it as an AppBoundry artifact (or to Vercel, containers, Managed FeltDB or your own FeltDB server), and evolve it at runtime.</p></div>
  </div>
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">Reading the diagram</div>
    <h2>From state to agents.</h2>
  </div>
  <div class="prose">
    <p><strong>FeltDB</strong> is application state and the control plane: durable, atomic and reactive, with state contracts the host enforces, and one API wherever state lives.</p>
    <p><strong>AppPort</strong> is capability discovery and authority: each capability a contract that applications and agents can discover and reuse across technologies. <strong>AppPort Services</strong> provides reusable operational capabilities (files, notifications, configuration, jobs, webhooks). One of them, <strong>Resolver</strong>, resolves an application's declared dependencies at runtime, with history, rollback and a receipt for each use.</p>
    <p><strong>AppBoundry</strong> (product two) deploys and runs application artifacts: it verifies them, enforces their state and authority boundaries, and reports which module it is running.</p>
    <p><strong>FeltKit</strong>, product one, is the entry point: build the application, deploy the artifact, evolve it at runtime. <strong>AppBoundry</strong>, product two, runs the artifact. <strong>AuthBoundry</strong> governs authority and delegation for people and agents, and is early.</p>
    <p><strong>AuthBoundry</strong> governs authority and delegation for people and agents.</p>
  </div>
</div></section>

${ctaBand("Discuss the architecture with our team.", "")}
`,
});

// About
pages.push({
  path: "/about/",
  title: "About",
  description: "About Boundry: a technology company building infrastructure for applications that people and AI agents use, operate, and evolve, founded by Randy Kendel.",
  body: `
<section class="page-head"><div class="wrap">
  <div class="eyebrow">About Boundry</div>
  <h1>Software is changing.</h1>
  <p class="lede">Applications are increasingly produced, used and operated by both people and agents. Boundry builds the infrastructure that lets those applications be deployed, operated and changed on their own terms.</p>
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">The company</div>
    <h2>More than increasingly capable models.</h2>
  </div>
  <div class="prose">
    <p>Boundry is a technology company, founded in 2026, building infrastructure for applications that people and AI agents use, operate, and evolve.</p>
    <p>We believe the future of software requires more than increasingly capable AI models. It requires applications that are independently deployable, operable and adaptable: an artifact with its own identity, durable state, explicit authority, dependencies resolved at runtime, and evidence of what ran.</p>
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
  description: "Boundry for investors: infrastructure for applications that people and AI agents use, operate, and evolve. Thesis, differentiators, maturity, commercial path, and direction.",
  body: `
<section class="page-head"><div class="wrap">
  <div class="eyebrow">Investors</div>
  <h1>One company, two products, a stack it controls.</h1>
  <p class="lede">Boundry builds infrastructure for applications that people and AI agents use, operate, and evolve. FeltKit is product one and the commercial entry point; AppBoundry is product two; the founder's other products form the ecosystem under both.</p>
  <ul class="toc" aria-label="On this page">
    <li><a href="#overview">Overview</a></li>
    <li><a href="#company">Company</a></li>
    <li><a href="#portfolio">Portfolio</a></li>
    <li><a href="#economics">Economics</a></li>
    <li><a href="#progress">Technology &amp; progress</a></li>
    <li><a href="#opportunity">Commercial opportunity</a></li>
    <li><a href="#direction">Direction</a></li>
    <li><a href="#contact">Contact</a></li>
  </ul>
</div></section>

<section class="section" id="overview"><div class="wrap split">
  <div style="display:grid;gap:18px"><div class="eyebrow">Overview &amp; thesis</div><h2>Not an easier way to build applications. Infrastructure for running and changing them.</h2></div>
  <div class="prose">
    <p>Today an application is coupled to the repository that produced it and to the infrastructure that supports it. Deploying means rebuilding; changing a dependency means a new release; operating it means reconstructing what ran. As more software is produced and operated by agents, that coupling becomes more expensive.</p>
    <p>Boundry's thesis is that applications should be <strong>independently deployable, operable, and adaptable</strong>, and that this is an infrastructure problem with three dimensions: how applications are <strong>used</strong> by people, software and agents; how they are <strong>operated</strong>, with state, authority, execution and evidence; and how they <strong>evolve</strong> without a release for every change.</p>
    <p>Underneath is a bigger idea: applications become managed infrastructure objects, each with an identity, a version, a verification record, a runtime, dependencies, a state boundary, an authority boundary and operational evidence.</p>
  </div>
</div></section>

<section class="section"><div class="wrap">
  ${thesisCols}
</div></section>

<section class="section" id="company"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">The company</div>
    <h2>Boundry controls the stack. Two products sit on top.</h2>
  </div>
  ${companyStructure}
</div></section>

<section class="section" id="portfolio"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Portfolio &amp; shared architecture</div>
    <h2>Two products. The ecosystem underneath.</h2>
    <p class="lede">FeltKit and AppBoundry are what customers adopt. The ecosystem underneath provides the differentiation, and each part is consumed through its published contract.</p>
  </div>
  ${technologyTable}
  <div style="margin-top:40px">${archDiagram()}</div>
</div></section>

<section class="section" id="progress"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Technology &amp; development progress</div>
    <h2>Working, demonstrated, planned.</h2>
    <p class="lede">We distinguish working capabilities, demonstrated deployments, and planned managed-platform capabilities. The architecture does not need inflated maturity claims.</p>
  </div>
  ${maturityCols}
  <div class="section-head" style="margin-top:clamp(48px,6vw,72px);margin-bottom:24px"><h3>By product</h3><p class="muted" style="font-size:15px">Product status${anyStatus ? " reflects the overall product, not individual capabilities" : ""}.</p></div>
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
  <p class="note" style="margin-top:24px">Detailed technical status, demonstrations, and evidence of working functionality for each product are provided directly in investment discussions. This page intentionally contains no customer, revenue, funding, partnership, or market-size claims.</p>
</div></section>

<section class="section" id="economics"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Direction · not yet built</div>
    <h2>From servers to work.</h2>
    <p class="lede">Today every application pays for its own running server, whether anyone uses it or not. Because a Boundry application is an immutable artifact whose state lives in FeltDB, execution can be shared: idle applications cost mainly their stored state, and customers pay for the work their applications perform. Today each deployment still runs in its own always-on container; shared, per-call execution is the architectural direction.</p>
  </div>
  <div class="cols">
    <div class="col"><span class="tag">Development</span><h3>FeltKit</h3><p>The developer experience: build, configure and operate the application.</p></div>
    <div class="col"><span class="tag">Persistence</span><h3>FeltDB</h3><p>Durable state and operations, independent of where the application executes.</p></div>
    <div class="col"><span class="tag">Execution</span><h3>AppBoundry</h3><p>Application work, metered by use rather than by provisioned servers, once shared execution exists.</p></div>
  </div>
</div></section>

<section class="section" id="opportunity"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Commercial opportunity</div>
    <h2>Product 1 brings the customer. Product 2 and the ecosystem follow.</h2>
    <p class="lede">The opportunities below describe the potential of the model, not current commercial results.</p>
  </div>
  <div class="cols">
    <div class="col"><span class="tag">Potential · Product 1</span><h3>FeltKit</h3><p>One experience for developers and small teams building applications that people and agents operate: build the application, deploy the artifact, evolve it at runtime. The nearest route to revenue.</p></div>
    <div class="col"><span class="tag">Potential · Product 2</span><h3>AppBoundry, managed</h3><p>Applications leave the repository as verified artifacts. Running them, with their state, on Boundry-operated infrastructure is the natural next step for a FeltKit team. Designed, not yet built.</p></div>
    <div class="col"><span class="tag">Potential · Ecosystem</span><h3>Beyond the products</h3><p>FeltDB, AppPort capabilities and AppPort Services, Resolver included, are contracts, so applications not built with FeltKit can use them too, including existing systems.</p></div>
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
      <li><span class="num">01</span><span class="over">Commercialize FeltKit (product 1)</span><span class="over-not" style="font-size:15.5px">From design partners to paying teams.</span></li>
      <li><span class="num">02</span><span class="over">Managed AppBoundry (product 2)</span><span class="over-not" style="font-size:15.5px">Upload, deploy and observe AppBoundry artifacts, after the backup-restore fix.</span></li>
      <li><span class="num">03</span><span class="over">Grow the ecosystem</span><span class="over-not" style="font-size:15.5px">Resolver beyond model references; FeltDB and AppPort toward 1.0.</span></li>
      <li><span class="num">04</span><span class="over">Harden toward 1.0</span><span class="over-not" style="font-size:15.5px">Stability, security review and documentation across the stack.</span></li>
    </ol>
    <p class="muted" style="font-size:15px">This describes direction, not dated commitments. A detailed product roadmap is available in investment discussions.</p>
  </div>
</div></section>
<style>#direction .over-not::before{content:none}</style>

<section class="section" id="contact"><div class="wrap cta">
  <div style="display:grid;gap:16px">
    <div class="eyebrow">Investment discussions</div>
    <h2>Talk with Boundry.</h2>
    <p class="lede">For investment discussions, the deck, or a technical walkthrough of FeltKit, AppBoundry and the ecosystem.</p>
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
