// The Boundry stack map: a subsite at /stack/ rendered from content/stack.json.
// Organized as three maps: the product map (one page per component, plus the
// agent and evidence layer), the composition map (lifecycle, example,
// composition, boundaries) and the evidence map (implementation position).
// Products' names, sites, packages and statuses come from content/products.json.
// Every cross-reference is validated; an unknown id fails the build.

export function stackPages({ stack, products, site, shared, esc, mark, productAttr, host, npmLink, ctaBand }) {
  const byProduct = Object.fromEntries(products.map((p) => [p.id, p]));
  const errors = [];

  // ---------------------------------------------------------------- registry
  const comps = stack.components.map((c) => {
    const p = c.product ? byProduct[c.product] : null;
    if (c.product && !p) errors.push(`stack: component ${c.id}: unknown product "${c.product}"`);
    if (c.partOf && !byProduct[c.partOf]) errors.push(`stack: component ${c.id}: unknown partOf "${c.partOf}"`);
    if (!p && !c.name) errors.push(`stack: component ${c.id}: needs "product" or "name"`);
    if (p && c.name) errors.push(`stack: component ${c.id}: name comes from content/products.json; remove "name"`);
    for (const k of ["question", "tagline", "responsibility", "position"]) if (!c[k]) errors.push(`stack: component ${c.id}: missing "${k}"`);
    return { ...c, p, name: p ? p.name : c.name, href: `/stack/${c.id}/` };
  });
  const comp = Object.fromEntries(comps.map((c) => [c.id, c]));
  const AGENTS = "/stack/agents/";
  const refs = {
    ...Object.fromEntries(comps.map((c) => [c.id, { name: c.name, href: c.href, accent: c.product || c.partOf }])),
    agents: { name: "Chip / FX / PAX", href: AGENTS },
    ...Object.fromEntries(stack.agents.parts.map((a) => [a.id, { name: a.name, href: `${AGENTS}#${a.id}` }])),
  };
  const need = (id, where) => { if (!refs[id]) errors.push(`stack: ${where} references unknown id "${id}"`); };
  const layerOf = {};
  for (const l of stack.layers) for (const id of l.components ?? []) { need(id, `layer ${l.id}`); layerOf[id] = l; }
  for (const c of comps) {
    if (!layerOf[c.id]) errors.push(`stack: component ${c.id} is in no layer`);
    for (const r of c.composes ?? []) if (r.id) need(r.id, `${c.id}.composes`); else if (!r.label) errors.push(`stack: ${c.id}.composes entry needs id or label`);
  }
  if (stack.order.length !== comps.length || !comps.every((c) => stack.order.includes(c.id))) errors.push("stack: order must list every component exactly once");
  const refId = (r) => (typeof r === "string" ? r : r.id);
  for (const s of stack.lifecycle) s.refs.forEach((r) => need(r, `lifecycle "${s.step}"`));
  for (const [req, rs] of stack.example.with) rs.forEach((r) => need(refId(r), `example "${req}"`));
  for (const [rs] of stack.independence.rows) [rs].flat().forEach((r) => need(r, "independence"));
  for (const lv of stack.levels) (lv.items ?? []).forEach(([r]) => need(r, `levels "${lv.title}"`));
  for (const [a, b, label] of stack.boundaries.rows) [...a, ...b].forEach((r) => need(r, `boundary "${label}"`));
  for (const cl of stack.boundaries.classes) (cl.refs ?? []).forEach((r) => need(r, `class "${cl.title}"`));
  for (const u of stack.agents.uses) need(u.id, "agents.uses");
  const NPM = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
  for (const x of [...stack.components, ...stack.agents.parts]) {
    if (x.product && x.packages) errors.push(`stack: ${x.id}: packages of a product belong in content/products.json`);
    for (const pkg of x.packages ?? []) if (!NPM.test(pkg.name ?? "") || !pkg.purpose) errors.push(`stack: ${x.id}: invalid package entry`);
    if (x.package && !NPM.test(x.package)) errors.push(`stack: ${x.id}: invalid package "${x.package}"`);
    if (x.source && !/^https:\/\/\S+$/.test(x.source)) errors.push(`stack: ${x.id}: source must be https`);
  }
  for (const a of stack.agents.parts) for (const k of ["summary", "responsibility", "value", "position", "install"]) if (!a[k]) errors.push(`stack: agent part ${a.id}: missing "${k}"`);
  if (errors.length) return { errors, pages: [] };

  // ---------------------------------------------------------------- fragments
  const ordered = stack.order.map((id) => comp[id]);
  const accentAttr = (id) => (id ? ` data-stack-product="${esc(id)}"` : "");
  const link = (r) => {
    const id = refId(r);
    const x = refs[id];
    const label = typeof r === "string" ? x.name : r.label || x.name;
    return `<a class="sm-ref" href="${x.href}"${accentAttr(x.accent)}>${esc(label)}</a>`;
  };
  const links = (rs) => rs.map(link).join(`<span class="sm-sep" aria-hidden="true"> · </span>`);
  const cmark = (c, cls = "") =>
    c.p ? mark(c.p, cls) : `<span class="pmark tmark ${cls}"${accentAttr(c.partOf)} aria-hidden="true">${esc(c.mark || c.name.slice(0, 2))}</span>`;
  const list = (items) => `<ul class="sm-list">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
  const paras = (items) => items.map((t) => `<p>${esc(t)}</p>`).join("");
  const status = (c) =>
    c.p?.status ? `<span class="status">${esc(site.productStatuses[c.p.status])}</span>`
      : c.partOf ? `<span class="muted">Ships in <a href="/stack/${c.partOf}/">${esc(byProduct[c.partOf].name)}</a></span>`
        : `<span class="muted">Not published as a separate product</span>`;

  // Navigation: three maps, in reading order; prev/next follow it.
  const groups = [
    { title: "Overview", items: [["/stack/", "Stack map"]] },
    { title: "Product map", items: [...ordered.map((c) => [c.href, c.name]), [AGENTS, "Agents and evidence"]] },
    { title: "Composition map", items: [["/stack/composition/", "How it composes"], ["/stack/boundaries/", "Boundaries"]] },
    { title: "Evidence map", items: [["/stack/evidence/", "Implementation status"]] },
  ];
  const sequence = groups.flatMap((g) => g.items);
  const localNav = (path) => `
<nav class="sm-nav" aria-label="Stack map">
  ${groups.map((g) => `<div class="sm-nav__group"><p class="sm-nav__title">${esc(g.title)}</p><ul>${g.items
    .map(([href, label]) => `<li><a href="${href}"${href === path ? ' aria-current="page"' : ""}>${esc(label)}</a></li>`).join("")}</ul></div>`).join("")}
</nav>`;
  const pager = (path) => {
    const i = sequence.findIndex(([href]) => href === path);
    const prev = sequence[i - 1], next = sequence[i + 1];
    return `<nav class="sm-pager" aria-label="Stack map sequence">
  ${prev ? `<a class="sm-pager__prev" href="${prev[0]}"><span>Previous</span>${esc(prev[1])}</a>` : "<span></span>"}
  ${next ? `<a class="sm-pager__next" href="${next[0]}"><span>Next</span>${esc(next[1])}</a>` : ""}
</nav>`;
  };
  const sec = (id, title, inner, lede = "") =>
    `<section class="sm-sec" id="${id}"><h2>${esc(title)}</h2>${lede ? `<p class="sm-lede">${esc(lede)}</p>` : ""}${inner}</section>`;

  // The layered map. `current` highlights one component (its own page).
  const stackMap = (current = null, full = true) => `
<figure class="sm-map${full ? "" : " sm-map--mini"}">
  <div class="sm-map__frame" role="group" aria-label="Boundry stack map by layer">
    <div class="sm-map__top">Applications that people and AI agents build, use and operate</div>
    ${stack.layers.map((l) => `
    <div class="sm-layer"${full ? ` id="${l.id}"` : ""}>
      <div class="sm-layer__title">${esc(l.title)}${full && l.summary ? `<span>${esc(l.summary)}</span>` : ""}</div>
      <div class="sm-layer__cells">${l.components
        ? l.components.map((id) => { const c = comp[id]; return `<a class="sm-cell${id === current ? " is-current" : ""}" href="${c.href}"${accentAttr(c.product || c.partOf)}${id === current ? ' aria-current="page"' : ""}><span class="n">${esc(c.name)}</span><span class="r">${esc(c.question)}</span></a>`; }).join("")
        : `<div class="sm-cell sm-cell--substrate"><span class="r">${l.items.map(esc).join(" · ")}</span></div>`}</div>
    </div>`).join("")}
    <a class="sm-cross" href="${AGENTS}">Cross-cutting: ${esc(stack.crossCutting)}</a>
  </div>
  ${full ? `<figcaption class="arch-legend"><span>A responsibility map, not a dependency diagram. FeltKit uses the other capabilities but does not own them; AppPort does not become the database; AppBoundry does not become the dependency resolver. Select a block for its page.</span></figcaption>` : ""}
</figure>`;

  const layout = (path, { crumbs, eyebrow, title, titleMark = "", lede, meta = "", body }) => `
<div class="wrap sm-crumbs">${shared.Breadcrumbs({ items: [{ label: "Home", href: "/" }, ...crumbs] })}</div>
<section class="page-head sm-head"><div class="wrap">
  <div class="eyebrow">${esc(eyebrow)}</div>
  <h1 class="${titleMark ? "sm-h1-mark" : ""}">${titleMark}${esc(title)}</h1>
  ${lede ? `<p class="lede">${esc(lede)}</p>` : ""}
  ${meta}
</div></section>
<div class="wrap sm-layout">
  ${localNav(path)}
  <div class="sm-main">
    ${body}
    ${pager(path)}
  </div>
</div>
${ctaBand("Talk through the stack with Boundry.", "Evaluation, integration and technical partnership conversations are welcome.")}`;
  const stackCrumb = { label: "Stack map", href: "/stack/" };
  const pages = [];

  // ---------------------------------------------------------------- overview
  const mental = [...["feltdb", "appport", "authboundry", "appboundry", "resolver", "intent", "appport-services", "feltkit"].map((id) => comp[id]),
    { name: "Chip / FX / PAX", href: AGENTS, question: "How do agents reason, execute, recover and establish evidence?", tagline: stack.agents.lede }];
  pages.push({
    path: "/stack/",
    title: "Stack map",
    description: "The Boundry stack map: independently useful infrastructure capabilities, from durable state to developer experience, that compose into an application operating system.",
    body: layout("/stack/", {
      crumbs: [{ label: "Stack map" }],
      eyebrow: "Stack map",
      title: stack.outcome,
      lede: stack.thesis,
      meta: `<ul class="toc" aria-label="On this page"><li><a href="#at-a-glance">At a glance</a></li><li><a href="#questions">The questions</a></li><li><a href="#maps">Three maps</a></li><li><a href="#thesis">The thesis</a></li></ul>`,
      body: [
        sec("at-a-glance", "The architecture at a glance", stackMap(), "Each component owns a distinct responsibility and is useful on its own. Together they remove the need for application developers to own and integrate so much infrastructure. The outcome is reduced ownership, not only reduced development effort."),
        sec("questions", "One question per component", `<div class="sm-qgrid">${mental.map((c) => `
          <a class="sm-q" href="${c.href}"${accentAttr(c.product || c.partOf)}><span class="q">${esc(c.question)}</span><span class="n">${esc(c.name)}</span><span class="t">${esc(c.tagline)}</span></a>`).join("")}</div>`),
        sec("maps", "Three connected maps", `<div class="cols">
          <div class="col"><span class="tag">Product map</span><h3>What Boundry is</h3><p>Every component: its responsibility, capabilities, independent value and what it composes with.</p><p><a class="textlink" href="${ordered[0].href}">Start with ${esc(ordered[0].name)} →</a></p></div>
          <div class="col"><span class="tag">Composition map</span><h3>Why the architecture works</h3><p>The application lifecycle, a worked example, who composes with whom, and the boundaries that must not collapse.</p><p><a class="textlink" href="/stack/composition/">How it composes →</a></p></div>
          <div class="col"><span class="tag">Evidence map</span><h3>What is actually real</h3><p>What is designed, implemented and operationally verified, kept separate from the architecture itself.</p><p><a class="textlink" href="/stack/evidence/">Implementation status →</a></p></div>
        </div>`),
        sec("thesis", "The thesis", `<p class="statement">${esc(stack.centralThesis)}</p><p class="sm-lede" style="margin-top:24px">${esc(stack.outcomeLede)}</p>`),
      ].join(""),
    }),
  });

  // How to get a component: its install command and packages (a product's from content/products.json).
  const pkgList = (pkgs) => `<ul class="pkgs">${pkgs.map((pkg) => `<li>${npmLink(pkg)} <span class="muted">${esc(pkg.purpose)}</span></li>`).join("")}</ul>`;
  const getIt = (c) => {
    const pkgs = c.p ? c.p.packages : c.packages;
    const install = c.p ? c.p.install : c.install;
    if (c.partOf && !pkgs) return sec("get", "Get it", `<p class="sm-also">Ships in ${link(c.partOf)}; see its packages.</p>`);
    if (!pkgs?.length) return "";
    return sec("get", "Get it", `${install ? `<pre class="sm-install"><code>${esc(install)}</code></pre>` : ""}<dl class="sm-kv"><dt>On npm</dt><dd>${pkgList(pkgs)}</dd></dl>`);
  };

  // ---------------------------------------------------------------- components
  for (const c of ordered) {
    const layer = layerOf[c.id];
    const declared = new Set((c.composes ?? []).map((r) => r.id).filter(Boolean));
    const referencedBy = ordered.filter((o) => o.id !== c.id && !declared.has(o.id) && (o.composes ?? []).some((r) => r.id === c.id));
    const productLinks = c.p
      ? [`<a href="/ecosystem/#${c.p.id}">Ecosystem entry</a>`, c.p.url ? `<a class="ext" href="${c.p.url}" rel="noopener">${host(c.p.url)}</a>` : null].filter(Boolean)
      : c.partOf ? [`Part of <a href="/stack/${c.partOf}/">${esc(byProduct[c.partOf].name)}</a>`] : [];
    const capabilities = c.services
      ? `<div class="table-wrap"><table><thead><tr><th scope="col">Service</th><th scope="col">Responsibility</th></tr></thead><tbody>${c.services.map(([n, r]) => `<tr><td><strong>${esc(n)}</strong></td><td>${esc(r)}</td></tr>`).join("")}</tbody></table></div>`
      : list(c.capabilities);
    const extra = [
      c.artifact ? `<figure class="sm-code"><pre><code>${esc(c.artifact.code)}</code></pre><figcaption>${esc(c.artifact.caption)}</figcaption></figure>` : "",
      c.reference ? `<figure class="sm-code"><pre><code>${esc(c.reference.code)}</code></pre><figcaption>${esc(c.reference.text)}</figcaption></figure>` : "",
    ].join("");
    pages.push({
      path: c.href,
      title: `${c.name} — Stack map`,
      description: `${c.name} in the Boundry stack: ${c.tagline} ${c.responsibility}`,
      body: layout(c.href, {
        crumbs: [stackCrumb, { label: layer.title }, { label: c.name }],
        eyebrow: `${layer.title} · ${c.kicker}`,
        title: c.name,
        titleMark: cmark(c),
        lede: c.tagline,
        meta: `<div class="sm-meta"><span class="sm-askchip">${esc(c.question)}</span>${productLinks.map((l) => `<span>${l}</span>`).join("")}</div>`,
        body: [
          sec("where", "Where it sits", stackMap(c.id, false)),
          sec("responsibility", "Responsibility", `<div class="prose sm-prose"><p class="sm-strong">${esc(c.responsibility)}</p>${paras(c.notes ?? [])}</div>`),
          sec("capabilities", "Capabilities", capabilities + extra),
          sec("independent", "Works independently", `<div class="prose sm-prose">${paras(c.independent)}</div>`),
          sec("composes", "Composes with", `<dl class="sm-rel">${(c.composes ?? []).map((r) => `<div><dt>${r.id ? link(r.id) : `<a class="sm-ref" href="${r.href}">${esc(r.label)}</a>`}</dt><dd>${esc(r.how)}</dd></div>`).join("")}</dl>${
            referencedBy.length ? `<p class="sm-also">Also referenced by ${links(referencedBy.map((o) => o.id))}.</p>` : ""}<p class="sm-also"><a class="textlink" href="/stack/composition/#matrix">See the full composition map →</a></p>`),
          sec("value", "Value", `<div class="prose sm-prose">${paras(c.value)}</div>`),
          getIt(c),
          sec("position", "Current position", `<dl class="sm-kv"><dt>Known position</dt><dd>${esc(c.position)} <span class="muted">(as of ${esc(stack.asOfLabel)})</span></dd><dt>Published status</dt><dd>${status(c)}</dd></dl><p class="sm-also"><a class="textlink" href="/stack/evidence/">How positions are classified →</a></p>`),
        ].join(""),
      }),
    });
  }

  // ---------------------------------------------------------------- agents
  const ag = stack.agents;
  pages.push({
    path: AGENTS,
    title: "Agents and evidence — Stack map",
    description: "The Boundry agent execution and evidence layer: Chip, FX and PAX, and how agents use AppPort, AuthBoundry, FeltDB and Resolver.",
    body: layout(AGENTS, {
      crumbs: [stackCrumb, { label: "Product map" }, { label: "Agents and evidence" }],
      eyebrow: "Cross-cutting · Agent execution and evidence",
      title: "Agents and evidence",
      lede: ag.lede,
      body: [
        sec("layer", "The agent layer", `<div class="table-wrap"><table><thead><tr><th scope="col">Component</th><th scope="col">Responsibility</th><th scope="col">Value</th></tr></thead><tbody>${
          ag.parts.map((a) => `<tr><td><a href="#${a.id}"><strong>${esc(a.name)}</strong></a></td><td>${esc(a.responsibility)}</td><td>${esc(a.value)}</td></tr>`).join("")}</tbody></table></div>`),
        ...ag.parts.map((a) => sec(a.id, a.name, `<p class="sm-strong">${esc(a.summary)}</p>${a.origin ? `<p class="note">${esc(a.origin)}</p>` : ""}${list(a.facts)}
          ${/^npm /.test(a.install) ? `<pre class="sm-install"><code>${esc(a.install)}</code></pre>` : `<p>${esc(a.install)}</p>`}
          <dl class="sm-kv">${a.package ? `<dt>On npm</dt><dd>${npmLink({ name: a.package })}</dd>` : ""}${a.source ? `<dt>Source</dt><dd><a class="ext" href="${a.source}" rel="noopener">${esc(a.source.replace(/^https:\/\//, ""))}</a></dd>` : ""}${a.command ? `<dt>Command</dt><dd><code>${esc(a.command)}</code></dd>` : ""}${a.requires ? `<dt>Requires</dt><dd>${esc(a.requires)}</dd>` : ""}<dt>License</dt><dd>${esc(a.license)}</dd><dt>Position</dt><dd>${esc(a.position)}</dd></dl>`)),
        sec("uses", "What agents use from the stack", `<div class="table-wrap"><table><thead><tr><th scope="col">Component</th><th scope="col">Responsibility</th><th scope="col">Value</th></tr></thead><tbody>${
          ag.uses.map((u) => `<tr><td>${link(u.id)}</td><td>${esc(u.responsibility)}</td><td>${esc(u.value)}</td></tr>`).join("")}</tbody></table></div>`),
        sec("principle", "The principle", `<p class="statement">${esc(ag.principle)}</p><p class="sm-lede" style="margin-top:20px">${esc(ag.principleLede)}</p>
          <ol class="sm-rules">${ag.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ol><div class="prose sm-prose"><p>${esc(ag.closing)}</p></div>`),
        sec("position", "Current position", `<dl class="sm-kv"><dt>Known position</dt><dd>${esc(ag.position)} <span class="muted">(as of ${esc(stack.asOfLabel)})</span></dd><dt>Published status</dt><dd><span class="muted">Not published as separate products</span></dd></dl>`),
      ].join(""),
    }),
  });

  // ---------------------------------------------------------------- composition
  const matrix = `<div class="table-wrap"><table class="sm-matrix"><caption class="vh">Composition: each row lists what that component declares it composes with</caption>
    <thead><tr><th scope="col"><span class="vh">Component</span></th>${ordered.map((c) => `<th scope="col"><a href="${c.href}">${esc(c.name)}</a></th>`).join("")}</tr></thead>
    <tbody>${ordered.map((r) => `<tr><th scope="row"><a href="${r.href}">${esc(r.name)}</a></th>${ordered.map((col) => {
      if (col.id === r.id) return `<td class="sm-matrix__self" aria-label="Same component">·</td>`;
      const rel = (r.composes ?? []).find((x) => x.id === col.id);
      return rel ? `<td class="sm-matrix__on"><a href="${r.href}#composes" title="${esc(rel.how)}">●<span class="vh">${esc(r.name)} composes with ${esc(col.name)}: ${esc(rel.how)}</span></a></td>` : `<td></td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`;
  pages.push({
    path: "/stack/composition/",
    title: "Composition map — Stack map",
    description: "How the Boundry stack composes: the application lifecycle, a worked example, the composition matrix, independent products and the value at each level.",
    body: layout("/stack/composition/", {
      crumbs: [stackCrumb, { label: "Composition map" }],
      eyebrow: "Composition map",
      title: "How the stack composes",
      lede: "The clearest way to understand the stack is to follow an application through its lifecycle, then see which responsibilities each component carries.",
      meta: `<ul class="toc" aria-label="On this page"><li><a href="#lifecycle">Lifecycle</a></li><li><a href="#example">Example</a></li><li><a href="#matrix">Composition</a></li><li><a href="#independence">Independence</a></li><li><a href="#levels">Levels of value</a></li></ul>`,
      body: [
        sec("lifecycle", "The application lifecycle", `<ol class="sm-steps">${stack.lifecycle.map((s, i) => `<li><span class="num">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(s.step)}</h3><p class="sm-steps__by">${links(s.refs)}</p><p>${esc(s.text)}</p></div></li>`).join("")}</ol>
          <p class="note" style="margin-top:24px"><strong>The result:</strong> ${esc(stack.lifecycleResult)}</p>`),
        sec("example", `Worked example: ${stack.example.title}`, `<div class="sm-split"><div><h3>Without the stack, the developer builds or integrates</h3>${list(stack.example.without)}</div>
          <div><h3>With Boundry</h3><div class="table-wrap"><table><thead><tr><th scope="col">Requirement</th><th scope="col">Boundry responsibility</th></tr></thead><tbody>${
            stack.example.with.map(([req, rs]) => `<tr><td>${esc(req)}</td><td>${links(rs)}</td></tr>`).join("")}</tbody></table></div></div></div>
          <div class="prose sm-prose" style="margin-top:24px"><p>${esc(stack.example.owned)}</p></div>`, stack.example.lede),
        sec("matrix", "Who composes with whom", matrix + `<p class="sm-also">Read across a row: each dot is a relation that component declares on its own page. Select a dot or a name for the detail.</p>`),
        sec("independence", "Independent products, composed platform", `<div class="table-wrap"><table><thead><tr><th scope="col">Component</th><th scope="col">Useful independently?</th><th scope="col">Contributes to the whole</th></tr></thead><tbody>${
          stack.independence.rows.map(([rs, u, w]) => `<tr><td>${links([rs].flat())}</td><td>${esc(u)}</td><td>${esc(w)}</td></tr>`).join("")}</tbody></table></div>
          <h3 class="sm-h3">The products are not inseparable</h3>${list(stack.independence.examples)}<div class="prose sm-prose"><p>${esc(stack.independence.closing)}</p></div>`, stack.independence.lede),
        sec("levels", "The value at each level", `<div class="cols">${stack.levels.map((lv, i) => `<div class="col"><span class="tag">Level ${i + 1}</span><h3>${esc(lv.title)}</h3><p><strong>${esc(lv.lede)}</strong></p>${
          lv.items ? `<ul>${lv.items.map(([id, t]) => `<li>${link(id)} ${esc(t)}</li>`).join("")}</ul>` : `<p>${esc(lv.text)}</p>`}</div>`).join("")}</div>`),
      ].join(""),
    }),
  });

  // ---------------------------------------------------------------- boundaries
  const bd = stack.boundaries;
  pages.push({
    path: "/stack/boundaries/",
    title: "Boundaries — Stack map",
    description: "The architectural boundaries in the Boundry stack that must never collapse, and what is product versus infrastructure.",
    body: layout("/stack/boundaries/", {
      crumbs: [stackCrumb, { label: "Composition map", href: "/stack/composition/" }, { label: "Boundaries" }],
      eyebrow: "Composition map · Boundaries",
      title: "The boundaries that must not collapse",
      lede: bd.lede,
      body: [
        sec("separations", "Different things, kept separate", `<div class="table-wrap"><table><thead><tr><th scope="col">These are different things</th><th scope="col">Why they stay separate</th><th scope="col">See</th></tr></thead><tbody>${
          bd.rows.map(([a, b, label, why]) => { const rs = [...new Set([...a, ...b])]; return `<tr><td><strong>${esc(label)}</strong></td><td>${esc(why)}</td><td>${rs.length ? links(rs) : `<a class="sm-ref" href="#layers">Layers</a>`}</td></tr>`; }).join("")}</tbody></table></div>`),
        sec("layers", "Product, agents, presentation, substrate", `<div class="cols two">${bd.classes.map((cl) => `<div class="col"><span class="tag">${esc(cl.title)}</span><p class="sm-chips">${
          cl.refs ? links(cl.refs) : cl.items.map(esc).join(" · ")}</p>${cl.text ? `<p>${esc(cl.text)}</p>` : ""}</div>`).join("")}</div>`),
      ].join(""),
    }),
  });

  // ---------------------------------------------------------------- evidence
  const ev = stack.evidence;
  pages.push({
    path: "/stack/evidence/",
    title: "Evidence map — Stack map",
    description: "The Boundry evidence map: how each stack capability is classified as designed, implemented or operationally verified, and the known position of each component.",
    body: layout("/stack/evidence/", {
      crumbs: [stackCrumb, { label: "Evidence map" }],
      eyebrow: "Evidence map",
      title: "Implementation reality, kept separate from the vision",
      lede: ev.lede,
      body: [
        sec("classes", "Three independent classifications", `<div class="cols">${ev.classifications.map(([t, d], i) => `<div class="col"><span class="tag">${i + 1}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join("")}</div>
          <ul class="sm-list" style="margin-top:24px">${ev.caveats.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`),
        sec("positions", "Known position by component", `<p class="note" style="margin-bottom:24px">${esc(ev.notYet)}</p><div class="table-wrap"><table><thead><tr><th scope="col">Component</th><th scope="col">Layer</th><th scope="col">Known position</th><th scope="col">Published status</th></tr></thead><tbody>${
          ordered.map((c) => `<tr><td><span class="pname">${cmark(c, "sm")}<a href="${c.href}">${esc(c.name)}</a></span></td><td class="dim">${esc(layerOf[c.id].title)}</td><td>${esc(c.position)}${c.packages ? ` Published on npm as ${c.packages.map(npmLink).join(", ")}.` : ""}</td><td>${status(c)}</td></tr>`).join("")
        }${ag.parts.map((a) => `<tr><td><a href="${AGENTS}#${a.id}">${esc(a.name)}</a></td><td class="dim">Agent and evidence</td><td>${esc(a.position)}</td><td><span class="muted">Not published as a separate product</span></td></tr>`).join("")}</tbody></table></div>
          <p class="sm-also">Known positions are as of ${esc(stack.asOfLabel)}. Published statuses are the same ones shown on <a href="/ecosystem/">Ecosystem</a> and <a href="/investors/#progress">Investors</a>.</p>`),
      ].join(""),
    }),
  });

  return { errors, pages };
}
