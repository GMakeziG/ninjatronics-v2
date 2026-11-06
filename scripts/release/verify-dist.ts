// npm run verify:dist   Static release checks on the built site in dist/.
//
// Run after `npm run build`. Reads dist/ and src/content/blog/ only; writes
// nothing and makes no network requests. Exits 1 if any check fails.
//
// What it checks (each one is a launch requirement in docs/deployment.md):
//   - Every page: <html lang>, one <title>, a meta description, and (except
//     the 404 page) exactly one canonical URL on https://ninjatronics.io with
//     no trailing slash, matching og:url.
//   - CSP compatibility: no inline <script> (JSON-LD data blocks excepted),
//     no <style> elements, no style="" attributes, no third-party origins in
//     src/href attributes that the browser would load.
//   - Every <img> has an alt attribute.
//   - Every internal link and #fragment resolves to a built page, asset, or
//     _redirects rule (fragments are checked against the target page's ids).
//   - _redirects: every target exists; no source shadows a built page.
//   - Drafts: no draft article has a page, a listing link, an RSS item, a
//     sitemap entry, or a redirect.
//   - sitemap: every <loc> is a built, indexable page; every indexable page is
//     listed; noindex pages are not.
//   - RSS: every item links to a built article.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://ninjatronics.io";
const root = fileURLToPath(new URL("../../", import.meta.url));
// --dist <path> checks another build output (used to test this script).
const distFlag = process.argv.indexOf("--dist");
const dist = distFlag > 0 ? process.argv[distFlag + 1] : join(root, "dist");
const contentDir = join(root, "src/content/blog");

const failures: string[] = [];
const fail = (where: string, message: string) => failures.push(`${where}: ${message}`);

if (!existsSync(join(dist, "index.html"))) {
  console.error(`${dist}/index.html not found. Run \`npm run build\` first.`);
  process.exit(1);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? walk(abs) : [abs];
  });
}

const files = walk(dist).map((abs) => relative(dist, abs).split(sep).join("/"));
const fileSet = new Set(files);
const htmlFiles = files.filter((f) => f.endsWith(".html"));

/** URL path a built HTML file is served at (build.format "file", slash-less). */
function pagePath(file: string): string {
  if (file === "index.html") return "/";
  return "/" + file.replace(/\.html$/, "").replace(/\/index$/, "");
}

/** The built file that serves a URL path, if any. */
function resolvePath(path: string): string | undefined {
  const clean = decodeURIComponent(path.replace(/\/+$/, "")) || "/";
  if (clean === "/") return "index.html";
  const candidates = [clean.slice(1), `${clean.slice(1)}.html`, `${clean.slice(1)}/index.html`];
  return candidates.find((c) => fileSet.has(c));
}

const attr = (tag: string, name: string): string | undefined =>
  tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1];
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// ---- Redirects -------------------------------------------------------------
const redirects = new Map<string, string>();
for (const line of readFileSync(join(dist, "_redirects"), "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [from, to, status] = line.trim().split(/\s+/);
  if (status !== "301") fail("_redirects", `${from} uses status ${status}, expected 301`);
  if (redirects.has(from)) fail("_redirects", `duplicate source ${from}`);
  redirects.set(from, to);
}

// ---- Drafts (from source frontmatter) -------------------------------------
const draftSlugs = readdirSync(contentDir).filter((slug) => {
  const md = ["index.md", "index.mdx"].map((f) => join(contentDir, slug, f)).find(existsSync);
  if (!md) return false;
  const fm = readFileSync(md, "utf8").split(/^---$/m)[1] ?? "";
  return /^draft:\s*true\s*$/m.test(fm);
});

// ---- Pages -----------------------------------------------------------------
interface Page {
  file: string;
  path: string;
  html: string;
  ids: Set<string>;
  noindex: boolean;
}
const pages = new Map<string, Page>();
for (const file of htmlFiles) {
  const html = readFileSync(join(dist, file), "utf8");
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decode(m[1])));
  const noindex = /<meta name="robots" content="[^"]*noindex/.test(html);
  pages.set(file, { file, path: pagePath(file), html, ids, noindex });
}

for (const page of pages.values()) {
  const { file, html } = page;
  const is404 = file === "404.html";

  if (!/<html lang="[a-z]{2}(-[A-Z]{2})?"/.test(html)) fail(file, "missing <html lang>");
  if ((html.match(/<title>/g) ?? []).length !== 1) fail(file, "expected exactly one <title>");
  if (!/<meta name="description" content="[^"]+"/.test(html)) fail(file, "missing meta description");

  const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);
  const ogUrl = html.match(/<meta property="og:url" content="([^"]*)"/)?.[1];
  if (is404) {
    if (canonicals.length || ogUrl) fail(file, "the 404 page must not declare a canonical URL or og:url");
  } else if (canonicals.length !== 1) {
    fail(file, `expected one canonical link, found ${canonicals.length}`);
  } else {
    const expected = page.path === "/" ? `${SITE}/` : `${SITE}${page.path}`;
    if (canonicals[0] !== expected) fail(file, `canonical is ${canonicals[0]}, expected ${expected}`);
    if (ogUrl !== canonicals[0]) fail(file, `og:url (${ogUrl}) differs from canonical`);
  }

  // Social image (when present): absolute, on this site, built, and described.
  const ogImage = html.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
  if (ogImage) {
    if (!ogImage.startsWith(`${SITE}/`)) fail(file, `og:image must be an absolute ${SITE} URL: ${ogImage}`);
    else if (!resolvePath(ogImage.slice(SITE.length))) fail(file, `og:image ${ogImage} is not in dist/`);
    if (!/<meta property="og:image:alt" content="[^"]+"/.test(html)) fail(file, "og:image without og:image:alt");
  }

  // CSP: script-src 'self' and style-src 'self' allow no inline code.
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const type = attr(m[0], "type");
    if (!attr(m[0], "src") && type !== "application/ld+json" && m[2].trim()) fail(file, "inline <script> (blocked by CSP)");
  }
  if (/<style[\s>]/.test(html)) fail(file, "<style> element (blocked by CSP)");
  if (/\sstyle="/.test(html)) fail(file, 'style="" attribute (blocked by CSP)');
  for (const m of html.matchAll(/<(?:script|img|source|link|iframe|video|audio)\b[^>]*>/g)) {
    const rel = attr(m[0], "rel");
    if (rel === "canonical" || rel === "alternate" || rel === "sitemap") continue;
    const url = attr(m[0], "src") ?? attr(m[0], "href") ?? "";
    if (/^(https?:)?\/\//.test(url)) fail(file, `loads a third-party resource ${url} (blocked by CSP)`);
  }

  checkAccessibility(file, html);
}

/**
 * Accessibility basics that can be checked statically, without a browser.
 * Not a substitute for an axe/Lighthouse audit (no contrast, focus order, or
 * computed accessible names); a browser-based audit is a separate follow-up.
 */
function checkAccessibility(file: string, html: string) {
  const text = (s: string) => decode(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (attr(m[0], "alt") === undefined) fail(file, `<img> without alt: ${attr(m[0], "src")}`);
  }

  // Exactly one <h1>, and heading levels never skip downwards (h2 → h4).
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  const h1s = levels.filter((l) => l === 1).length;
  if (h1s !== 1) fail(file, `expected one <h1>, found ${h1s}`);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) fail(file, `heading level skips from h${levels[i - 1]} to h${levels[i]}`);
  }

  // Duplicate ids break fragment links, labels, and aria references.
  const seen = new Set<string>();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
    if (seen.has(m[1])) fail(file, `duplicate id "${m[1]}"`);
    seen.add(m[1]);
  }

  // aria-labelledby / aria-describedby / label[for] must point at real ids.
  for (const m of html.matchAll(/\s(?:aria-labelledby|aria-describedby|for)="([^"]+)"/g)) {
    for (const id of m[1].split(/\s+/)) if (!seen.has(id)) fail(file, `reference to missing id "${id}"`);
  }

  // Links and buttons need a discernible name: text, aria-label, or an image alt.
  for (const m of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const [, tag, attrs, inner] = m;
    if (/\saria-hidden="true"/.test(attrs)) continue;
    const named =
      text(inner) ||
      /\saria-label="[^"]+"/.test(attrs) ||
      /\saria-labelledby="[^"]+"/.test(attrs) ||
      /<img\b[^>]*\salt="[^"]+"/.test(inner) ||
      /<svg\b[\s\S]*?<title>[^<]+<\/title>/.test(inner);
    if (!named) fail(file, `<${tag}> without an accessible name: ${m[0].slice(0, 80)}`);
  }

  // Form controls need a label (none exist today; guards future pages).
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    if (/\stype="(hidden|submit|button)"/.test(m[0])) continue;
    const id = attr(m[0], "id");
    const labelled = /\saria-label(ledby)?="/.test(m[0]) || (id && html.includes(`for="${id}"`));
    if (!labelled) fail(file, `<${m[1]}> without a label`);
  }

  if (!/<main\b/.test(html)) fail(file, "no <main> landmark");
  if (!/class="skip-link" href="#main"/.test(html)) fail(file, "no skip link to #main");
}

// ---- Internal links and fragments -----------------------------------------
function checkTarget(from: string, href: string) {
  const url = new URL(decode(href), `${SITE}${pagePath(from)}`);
  if (url.origin !== SITE) return;
  const path = url.pathname;
  let targetFile = resolvePath(path);
  if (!targetFile) {
    const redirect = redirects.get(path);
    if (!redirect) return fail(from, `broken link ${href}`);
    return checkTarget(from, redirect + url.hash);
  }
  const slug = path.match(/^\/blog\/([^/]+)$/)?.[1];
  if (slug && draftSlugs.includes(slug)) fail(from, `links to draft article ${path}`);
  if (url.hash && targetFile.endsWith(".html")) {
    const id = decodeURIComponent(url.hash.slice(1));
    if (!pages.get(targetFile)?.ids.has(id)) fail(from, `link ${href}: #${id} not found on ${path}`);
  }
}
for (const page of pages.values()) {
  for (const m of page.html.matchAll(/<(?:a|link|img|script|source)\b[^>]*>/g)) {
    for (const name of ["href", "src"]) {
      const value = attr(m[0], name);
      if (!value || /^(mailto:|tel:|data:|javascript:)/.test(value)) continue;
      if (/^https?:\/\//.test(value) && !value.startsWith(SITE)) continue;
      checkTarget(page.file, value);
    }
  }
}

// ---- Redirect targets ------------------------------------------------------
for (const [from, to] of redirects) {
  const [path, hash] = to.split("#");
  const target = resolvePath(path);
  if (!target) fail("_redirects", `${from} → ${to}: target does not exist`);
  else if (hash && !pages.get(target)?.ids.has(hash)) fail("_redirects", `${from} → ${to}: #${hash} not found`);
  if (resolvePath(from) && !from.endsWith("/")) fail("_redirects", `${from} shadows a built page`);
  const slug = path.match(/^\/blog\/([^/]+)$/)?.[1];
  if (slug && draftSlugs.includes(slug)) fail("_redirects", `${from} redirects to draft ${to}`);
}

// ---- Drafts ----------------------------------------------------------------
for (const slug of draftSlugs) {
  if (resolvePath(`/blog/${slug}`)) fail("drafts", `draft "${slug}" has a built page`);
}

// ---- Sitemap ---------------------------------------------------------------
const sitemapFiles = files.filter((f) => /^sitemap-\d+\.xml$/.test(f));
if (!sitemapFiles.length) fail("sitemap", "no sitemap-N.xml generated");
const sitemapPaths = new Set<string>();
for (const f of sitemapFiles) {
  for (const m of readFileSync(join(dist, f), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const loc = m[1];
    if (!loc.startsWith(`${SITE}/`)) { fail(f, `<loc> outside ${SITE}: ${loc}`); continue; }
    const path = loc.slice(SITE.length) || "/";
    sitemapPaths.add(path);
    const target = resolvePath(path);
    if (!target) fail(f, `${loc} is not a built page`);
    else if (pages.get(target)?.noindex) fail(f, `${loc} is noindex but listed`);
  }
}
for (const page of pages.values()) {
  if (!page.noindex && !sitemapPaths.has(page.path)) fail("sitemap", `indexable page ${page.path} is not listed`);
}
const sitemapIndex = readFileSync(join(dist, "sitemap-index.xml"), "utf8");
for (const f of sitemapFiles) {
  if (!sitemapIndex.includes(`${SITE}/${f}`)) fail("sitemap-index.xml", `does not list ${f}`);
}

// ---- RSS -------------------------------------------------------------------
const rss = readFileSync(join(dist, "rss.xml"), "utf8");
const items = [...rss.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)].map((m) => m[1]);
if (!items.length) fail("rss.xml", "no items");
for (const link of items) {
  if (!link.startsWith(`${SITE}/blog/`)) { fail("rss.xml", `item link outside ${SITE}/blog/: ${link}`); continue; }
  const path = link.slice(SITE.length);
  if (!resolvePath(path)) fail("rss.xml", `item ${link} has no built page`);
  if (draftSlugs.includes(path.replace("/blog/", ""))) fail("rss.xml", `draft in feed: ${link}`);
}

// ---- robots.txt ------------------------------------------------------------
const robots = readFileSync(join(dist, "robots.txt"), "utf8");
if (!robots.includes(`Sitemap: ${SITE}/sitemap-index.xml`)) fail("robots.txt", "missing Sitemap line");

// ---- Report ----------------------------------------------------------------
const published = pages.size;
console.log(
  `verify:dist: ${published} HTML pages, ${redirects.size} redirects, ${items.length} RSS items, ` +
    `${sitemapPaths.size} sitemap URLs, ${draftSlugs.length} drafts excluded (${draftSlugs.join(", ") || "none"})`,
);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("All dist checks passed.");
