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
if (failures.length) {
  console.error(`Site check failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`Site check: ${pages.length} pages OK`);
