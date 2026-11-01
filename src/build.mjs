// Boundry.company static site build.
// Usage: node src/build.mjs   → writes ./dist
// Zero dependencies. Content lives in ./content; styles in ./src/styles.css; static files in ./static.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
const site = JSON.parse(readFileSync(join(root, "content/site.json"), "utf8"));
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
  if (p.status == null) warnings.push(`product ${p.id}: development status not set (Investors page shows "Shared in discussion")`);
}
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
const accentVars = (p) => (p.accent ? `--al:${p.accent.light};--ad:${p.accent.dark}` : "");
const mark = (p, cls = "") =>
  `<span class="pmark ${cls}" style="${accentVars(p)}" aria-hidden="true">${esc(p.mark || p.name.slice(0, 2).toUpperCase())}</span>`;

// Product accents switch with theme via --al / --ad custom properties.
const accentCss = `
[style*="--al"] { --a: var(--al); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) [style*="--al"] { --a: var(--ad); } }
:root[data-theme="dark"] [style*="--al"] { --a: var(--ad); }`;

const css = readFileSync(join(root, "src/styles.css"), "utf8") + accentCss;
const cssHash = createHash("sha256").update(css).digest("hex").slice(0, 10);

const logo = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="21" height="21" stroke="currentColor" stroke-width="1.6"/><rect x="7" y="7" width="10" height="10" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="14" width="5" height="5" fill="currentColor"/></svg>`;

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
  const navItems = NAV.map(
    ([href, label]) => `<li><a href="${href}"${href === path ? ' aria-current="page"' : ""}>${label}</a></li>`
  ).join("");
  const jsonld =
    path === "/"
      ? `<script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: site.name,
          url: site.origin,
          description: site.description,
          email: site.contact.email,
          logo: `${site.origin}/favicon.svg`,
          sameAs: products.filter((p) => p.url).map((p) => p.url),
          ...(site.founder && { founder: { "@type": "Person", name: site.founder.name, url: site.founder.url } }),
        })}</script>`
      : "";
  const productLinks = products
    .map((p) =>
      p.url
        ? `<li><a class="ext" href="${p.url}" rel="noopener">${esc(p.name)}</a></li>`
        : `<li><a href="/ecosystem/#${p.id}">${esc(p.name)}</a></li>`
    )
    .join("");

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
<meta name="theme-color" content="#f6f6f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d0e10" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>(function(){var d=document.documentElement;d.className+=' js';try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')d.setAttribute('data-theme',t)}catch(e){}})();</script>
<link rel="stylesheet" href="/styles.css?v=${cssHash}">
${jsonld}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/" aria-label="${site.name} home">${logo}<span>${site.name}</span></a>
    <button class="icon-btn menu-btn" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6h14M3 14h14"/></svg>
    </button>
    <nav class="nav" id="site-nav" aria-label="Primary"><ul>${navItems}</ul></nav>
    <button class="icon-btn theme-btn" type="button" aria-label="Toggle color theme">
      <svg class="theme-icon-light" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="3.5"/><path d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2L16 16M4 16l1.8-1.8M14.2 5.8L16 4"/></svg>
      <svg class="theme-icon-dark" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9z"/></svg>
    </button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="brand" href="/">${logo}<span>${site.name}</span></a>
        <p>${esc(site.tagline)}</p>
      </div>
      <div><h2>Products</h2><ul>${productLinks}</ul></div>
      <div><h2>Company</h2><ul>
        <li><a href="/ecosystem/">Ecosystem</a></li>
        <li><a href="/architecture/">Architecture</a></li>
        <li><a href="/about/">About</a></li>
        <li><a href="/investors/">Investors</a></li>
      </ul></div>
      <div><h2>Contact</h2><ul>
        <li><a href="/contact/">Contact</a></li>
        <li><a href="mailto:${site.contact.email}">${site.contact.email}</a></li>
      </ul></div>
    </div>
    <div class="footer-base">
      <span>© ${YEAR} ${site.name}</span>
      <span>${site.domain}</span>
    </div>
  </div>
</footer>
<script>
(function(){
  var b=document.querySelector('.menu-btn'),n=document.getElementById('site-nav');
  b&&b.addEventListener('click',function(){var o=n.classList.toggle('open');b.setAttribute('aria-expanded',o)});
  var t=document.querySelector('.theme-btn'),d=document.documentElement;
  t&&t.addEventListener('click',function(){
    var cur=d.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
    var next=cur==='dark'?'light':'dark';d.setAttribute('data-theme',next);
    try{localStorage.setItem('theme',next)}catch(e){}
  });
})();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- shared fragments
const productCard = (p) => `
<article class="product-card" style="${accentVars(p)}">
  <header>${mark(p)}<div><div class="cat">${esc(p.category)}</div><h3>${esc(p.name)}</h3></div></header>
  <p>${esc(p.summary)}</p>
  <div></div>
  <footer>
    <a href="/ecosystem/#${p.id}">Overview</a>
    ${p.url ? `<a class="ext" href="${p.url}" rel="noopener">${host(p.url)}</a>` : `<span class="nosite">Website not yet public</span>`}
  </footer>
</article>`;

const archCell = (p, cls = "", extraStyle = "") => `
  <a class="arch-cell ${cls}" href="/ecosystem/#${p.id}" style="${extraStyle}${accentVars(p)}">
    <span class="n">${esc(p.name)}</span><span class="r">${esc(p.responsibility)}</span>
  </a>`;

function archDiagram() {
  const a = site.architecture;
  const rows = a.rows
    .map((row) => (row.length === 1 ? archCell(byId[row[0]], "full") : row.map((id) => archCell(byId[id])).join("")))
    .join("");
  const side = a.side ? archCell(byId[a.side], "arch-side", `--rows:${a.rows.length + 1};`) : "";
  return `
<figure style="margin:0">
  <div class="arch" role="group" aria-label="Boundry architecture: products by responsibility">
    <div class="arch-top">${esc(a.top)}</div>
    ${rows}
    ${side}
  </div>
  <figcaption class="arch-legend">
    <span>Conceptual view. Each block is a distinct responsibility and an independently adoptable product. Select a block for details.</span>
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
    <h1>Infrastructure for applications and agents.</h1>
    <p class="lede">We build the systems that help developers and agents create, operate, and extend applications. From durable state and application capabilities to authorization, delegation, and execution, Boundry provides the foundations for software that works.</p>
    <div class="actions">
      <a class="btn" href="/ecosystem/">Explore the ecosystem <span class="arrow">→</span></a>
      <a class="btn secondary" href="/about/">About Boundry</a>
    </div>
  </div>
  <div class="hero-figure">${heroFigure}</div>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Ecosystem</div>
    <h2>A connected technology ecosystem</h2>
    <p class="lede">Modern applications and agents need more than models and APIs. They need reliable foundations: somewhere authoritative for state to live, a dependable way to expose what an application can do, explicit rules for who may act, and controlled execution of the work itself.</p>
  </div>
  <div class="foundations">
    <div class="foundation"><span class="num">01</span><h3>State</h3><p>Durable, authoritative state that applications and agents can build on.</p><span class="by">FeltDB</span></div>
    <div class="foundation"><span class="num">02</span><h3>Capabilities</h3><p>Application functionality that is discoverable and usable, with semantic and authority metadata.</p><span class="by">AppPort · AppBoundry</span></div>
    <div class="foundation"><span class="num">03</span><h3>Authority</h3><p>Authorization, delegated authority, and controlled access across applications and agents.</p><span class="by">AuthBoundry</span></div>
    <div class="foundation"><span class="num">04</span><h3>Execution</h3><p>Agents built and operated with explicit capabilities, boundaries, and execution controls.</p><span class="by">AgentBoundry</span></div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Products</div>
    <h2>Independently useful. Designed to work together.</h2>
    <p class="lede">Each Boundry product addresses one infrastructure responsibility and can be adopted on its own. FeltKit brings them together as an integrated developer platform.</p>
  </div>
  <div class="products">${products.map(productCard).join("")}</div>
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">Architecture</div>
    <h2>Distinct responsibilities, not overlapping products.</h2>
    <p class="lede">State, capabilities, boundaries, authority, and execution are separate concerns. Boundry keeps them separate so each can be adopted, replaced, or extended independently.</p>
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
  description: "The Boundry product ecosystem: FeltDB, AppPort, AppBoundry, AuthBoundry, AgentBoundry, and FeltKit — independently useful infrastructure that works together.",
  body: `
<section class="page-head"><div class="wrap">
  <div class="eyebrow">Ecosystem</div>
  <h1>Independently useful technologies that work together.</h1>
  <p class="lede">Each product owns one infrastructure responsibility. Use one on its own, combine several, or adopt the integrated platform. Every product keeps its own identity and its own home.</p>
</div></section>

<section class="section" style="padding-top:0;border-top:0"><div class="wrap">
  <div class="plist">
  ${products
    .map(
      (p) => `
    <article class="prow" id="${p.id}" style="${accentVars(p)}">
      <div class="id">${mark(p)}<div><h2>${esc(p.name)}</h2><div class="cat">${esc(p.category)}</div></div></div>
      <div class="desc"><p>${esc(p.summary)}</p></div>
      <dl>
        <dt>Responsibility</dt><dd>${esc(p.responsibility)}</dd>
        <dt>Website</dt><dd>${p.url ? `<a class="ext" href="${p.url}" rel="noopener">${host(p.url)}</a>` : `<span class="muted">Not yet public</span>`}</dd>
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
    <p>The ecosystem is organized by responsibility rather than by feature. Durable state, capability discovery and invocation, application boundaries, authority and delegation, agent execution, and the developer experience that ties them together are each handled by a distinct product.</p>
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
  description: "How Boundry's products relate: durable state, capability discovery and invocation, application boundaries, authority and delegation, agent execution, and an integrated developer experience.",
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
    <div class="col"><span class="tag">Modularity</span><h3>Adopt one component at a time</h3><p>Each product is designed to be useful on its own. A team that needs durable state, or authority and delegation, or agent execution controls can adopt that product without adopting the rest.</p></div>
    <div class="col"><span class="tag">Interoperability</span><h3>Connected through explicit contracts</h3><p>Products are designed to work together through defined interfaces rather than hidden coupling, so the relationships between them remain visible, reviewable, and replaceable.</p></div>
    <div class="col"><span class="tag">Integration</span><h3>An integrated path when you want it</h3><p>FeltKit brings application development, durable state, capabilities, services, and deployment together for teams that prefer one integrated developer platform.</p></div>
  </div>
</div></section>

<section class="section"><div class="wrap split">
  <div style="display:grid;gap:18px">
    <div class="eyebrow">Reading the diagram</div>
    <h2>From state to agents.</h2>
  </div>
  <div class="prose">
    <p><strong>FeltDB</strong> provides durable state and the control plane — the authoritative foundation that applications and agents build on.</p>
    <p><strong>AppBoundry</strong> defines the application boundary: isolation, capability discovery, and portability.</p>
    <p><strong>AppPort</strong> makes application functionality discoverable and invocable by agents, carrying semantic and authority metadata with each capability.</p>
    <p><strong>AuthBoundry</strong> governs authority: authorization, delegated authority, and controlled access across applications and agents.</p>
    <p><strong>AgentBoundry</strong> is where agents are built and operated, with explicit capabilities, boundaries, and execution controls.</p>
    <p><strong>FeltKit</strong> spans the stack as the integrated developer experience.</p>
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
    <p>Boundry is a technology company building infrastructure for the next generation of applications and agents.</p>
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
  <h1>An infrastructure company with a portfolio of independently useful products.</h1>
  <p class="lede">Boundry is building infrastructure for applications and agents — a set of products that each address a distinct responsibility, and an integrated platform opportunity that emerges from their shared architecture.</p>
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
    <p>That shapes the company: a portfolio of products, each independently useful, sharing a coherent architectural foundation.</p>
  </div>
</div></section>

<section class="section" id="portfolio"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Portfolio &amp; shared architecture</div>
    <h2>Six products. Six responsibilities.</h2>
    <p class="lede">Products are organized by architectural responsibility. Each can be adopted independently; FeltKit integrates them into one developer platform.</p>
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
    <thead><tr><th scope="col">Product</th><th scope="col">Responsibility</th><th scope="col">Public site</th><th scope="col">Status</th></tr></thead>
    <tbody>
    ${products
      .map(
        (p) =>
          `<tr><td><span class="pname">${mark(p, "sm")}${esc(p.name)}</span></td><td>${esc(p.responsibility)}</td><td>${p.url ? `<a class="ext" href="${p.url}" rel="noopener">${host(p.url)}</a>` : `<span class="muted">Not yet public</span>`}</td><td>${statusCell(p)}</td></tr>`
      )
      .join("")}
    </tbody>
  </table></div>
  <p class="note" style="margin-top:24px">Detailed technical status, demonstrations, and evidence of working functionality for each product are provided directly in investment discussions. This page intentionally contains no customer, revenue, funding, partnership, or market-size claims.</p>
</div></section>

<section class="section" id="opportunity"><div class="wrap">
  <div class="section-head">
    <div class="eyebrow">Commercial opportunity</div>
    <h2>Independent products and an integrated platform.</h2>
    <p class="lede">The portfolio structure creates more than one path to adoption. The opportunities below describe the potential of the model, not current commercial results.</p>
  </div>
  <div class="cols">
    <div class="col"><span class="tag">Potential · Products</span><h3>Individual product adoption</h3><p>Because each product addresses one responsibility, teams can adopt a single component — durable state, authority and delegation, or agent execution — to solve a specific problem without a platform commitment.</p></div>
    <div class="col"><span class="tag">Potential · Platform</span><h3>Integrated platform</h3><p>FeltKit brings application development, durable state, capabilities, services, and deployment together. Teams that start with one product have a path to the integrated platform.</p></div>
    <div class="col"><span class="tag">Potential · Ecosystem</span><h3>Shared foundations</h3><p>Products that share an architecture reinforce one another: each additional product adopted adds value to those already in use, and new products can be added as the ecosystem evolves.</p></div>
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
      <li><span class="num">01</span><span class="over">Independently useful products</span><span class="over-not" style="font-size:15.5px">Continue developing each product so it delivers value on its own.</span></li>
      <li><span class="num">02</span><span class="over">Shared contracts</span><span class="over-not" style="font-size:15.5px">Strengthen the explicit interfaces that let products work together.</span></li>
      <li><span class="num">03</span><span class="over">Integrated platform</span><span class="over-not" style="font-size:15.5px">Bring the portfolio together through FeltKit.</span></li>
      <li><span class="num">04</span><span class="over">Ecosystem growth</span><span class="over-not" style="font-size:15.5px">Add products as new infrastructure responsibilities emerge.</span></li>
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
  <div class="section-head"><div class="eyebrow">Products</div><h2>Product websites</h2></div>
  <div class="table-wrap"><table>
    <thead><tr><th scope="col">Product</th><th scope="col">Focus</th><th scope="col">Website</th></tr></thead>
    <tbody>${products
      .map(
        (p) =>
          `<tr><td><span class="pname">${mark(p, "sm")}${esc(p.name)}</span></td><td>${esc(p.category)}</td><td>${p.url ? `<a class="ext" href="${p.url}" rel="noopener">${host(p.url)}</a>` : `<span class="muted">Not yet public</span>`}</td></tr>`
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
writeFileSync(join(out, "favicon.svg"), logo.replace('aria-hidden="true"', 'xmlns="http://www.w3.org/2000/svg"').replace(/currentColor/g, "#121315"));

console.log(`Built ${pages.length + 1} pages → dist/`);
for (const w of warnings) console.log("  note: " + w);
