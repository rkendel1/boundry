// Checks the built site (run after `node src/build.mjs`): every page carries the
// shared Boundry header and footer, the theme control and the pre-paint theme
// script, links every product, and has no leftovers of the old theme system.
// Zero dependencies. Usage: node src/check.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const { PORTFOLIO } = await import(pathToFileURL(join(root, "vendor/stack-ui/esm/brand.js")).href);
const { THEME_INIT_SCRIPT } = await import(pathToFileURL(join(root, "vendor/stack-ui/esm/theme.js")).href);

const pages = [];
const walk = (dir) => readdirSync(dir).forEach((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) walk(path);
  else if (name.endsWith(".html")) pages.push(path);
});
walk(dist);

const failures = [];
// Every published package listed in content/products.json is linked on the Ecosystem page.
const { products } = JSON.parse(readFileSync(join(root, "content/products.json"), "utf8"));
const ecosystem = readFileSync(join(dist, "ecosystem/index.html"), "utf8");
for (const p of products) for (const pkg of p.packages ?? []) {
  if (!ecosystem.includes(`href="https://www.npmjs.com/package/${pkg.name}"`)) failures.push(`/ecosystem/: npm link to ${pkg.name} (${p.name})`);
}
for (const file of pages) {
  const html = readFileSync(file, "utf8");
  const page = file.slice(dist.length) || "/";
  const need = (cond, what) => { if (!cond) failures.push(`${page}: ${what}`); };
  need(html.includes(`<script>${THEME_INIT_SCRIPT}</script>`), "pre-paint theme script");
  need(html.indexOf(THEME_INIT_SCRIPT) < html.indexOf('<link rel="stylesheet"'), "theme script before the stylesheet");
  need(/<header class="stack-site-header"/.test(html), "shared site header");
  need(/class="stack-brand-mark stack-site-header__logo"/.test(html), "Boundry mark in the header");
  need(html.includes("data-stack-theme-control"), "theme control");
  need(/<footer class="stack-site-footer"/.test(html), "shared site footer");
  need(html.includes(`href="${PORTFOLIO.company.href}"`), "link to boundry.company");
  for (const p of PORTFOLIO.products) need(html.includes(`href="${p.href}"`), `footer link to ${p.name}`);
  need(!/data-theme=|localStorage\.getItem\('theme'\)/.test(html), "no leftovers of the old theme system");
  need((html.match(/<h1[\s>]/g) || []).length === 1, "exactly one h1");
  need(/<main id="main"/.test(html), "main landmark the skip link targets");
}
// Every internal link resolves to a built page, and every #fragment to an id on it.
const idsOf = new Map(pages.map((f) => [f, new Set([...readFileSync(f, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
const resolve = (path) => {
  const file = path.endsWith("/") ? join(dist, path, "index.html") : join(dist, path);
  try { return statSync(file).isFile() ? file : null; } catch { return null; }
};
for (const file of pages) {
  const page = file.slice(dist.length);
  for (const [, href] of readFileSync(file, "utf8").matchAll(/href="([^"]+)"/g)) {
    if (/^(https?:|mailto:)/.test(href)) continue;
    const [path, frag] = href.replace(/&amp;/g, "&").split("#");
    const target = path === "" ? file : path.startsWith("/") ? resolve(path.split("?")[0]) : null;
    if (!target) { failures.push(`${page}: broken link ${href}`); continue; }
    if (frag && !idsOf.get(target)?.has(frag)) failures.push(`${page}: link ${href} points to a missing #${frag}`);
  }
}
// Every npm package in content/stack.json is linked from its stack map page.
const stackContent = JSON.parse(readFileSync(join(root, "content/stack.json"), "utf8"));
const npmOn = (page, name) => readFileSync(join(dist, page, "index.html"), "utf8").includes(`href="https://www.npmjs.com/package/${name}"`);
for (const c of stackContent.components) for (const pkg of c.packages ?? []) if (!npmOn(`stack/${c.id}`, pkg.name)) failures.push(`/stack/${c.id}/: npm link to ${pkg.name}`);
for (const a of stackContent.agents.parts) if (a.package && !npmOn("stack/agents", a.package)) failures.push(`/stack/agents/: npm link to ${a.package}`);
// Every stack map page carries breadcrumbs and the stack map navigation, and is in it.
const stackPages = pages.filter((f) => f.slice(dist.length).startsWith("/stack/"));
for (const file of stackPages) {
  const html = readFileSync(file, "utf8");
  const page = file.slice(dist.length).replace(/index\.html$/, "");
  if (!html.includes('class="stack-breadcrumbs"')) failures.push(`${page}: stack map breadcrumbs`);
  if (!html.includes(`<a href="${page}" aria-current="page">`)) failures.push(`${page}: not marked current in the stack map navigation`);
}
if (failures.length) {
  console.error(`Site check failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`Site check: ${pages.length} pages OK`);
