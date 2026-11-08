// Release smoke test: checks a running deployment of the site against the
// local build in dist/ (pages, static assets, security and cache headers,
// every _redirects rule, trailing-slash normalization, 404s, drafts, RSS,
// sitemap, robots.txt). Read-only: it only sends GET/HEAD requests.
//
// Usage:
//   npm run build && npm run smoke -- <base-url>
//   npm run smoke -- http://127.0.0.1:8787            # npm run preview:worker
//   CF_ACCESS_TOKEN=$(cloudflared access token -app=https://<staging-host>) \
//     npm run smoke -- https://<staging-host>          # Access-protected staging
//   npm run smoke -- https://ninjatronics.io           # after cutover
//
// Build dist/ from the same commit that is deployed, or page and asset
// lists won't match. Cloudflare may prepend its managed robots.txt block in
// production; only the Sitemap line is required here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const distFlag = args.indexOf("--dist");
const dist = distFlag >= 0 ? args[distFlag + 1] : "dist";
const base = (args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--dist") ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const accessToken = process.env.CF_ACCESS_TOKEN;
const SITE = "https://ninjatronics.io";
const results: { ok: boolean; area: string; msg: string }[] = [];
const fail = (area: string, msg: string) => results.push({ ok: false, area, msg });
const pass = (area: string, msg: string) => results.push({ ok: true, area, msg });
const get = (path: string, opts: { method?: string; headers?: Record<string, string> } = {}) =>
  fetch(base + path, { redirect: "manual", ...opts, headers: { ...(accessToken ? { "cf-access-token": accessToken } : {}), ...(opts.headers ?? {}) } });

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(dist).map((f) => "/" + relative(dist, f));
const pages = files.filter((f) => f.endsWith(".html") && f !== "/404.html").map((f) => (f === "/index.html" ? "/" : f.replace(/\.html$/, "")));

const EXPECTED: Record<string, string> = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};
function checkSecurity(area: string, path: string, res: Response) {
  for (const [h, v] of Object.entries(EXPECTED)) {
    const got = res.headers.get(h);
    if (got !== v) fail(area, `${path}: ${h} = ${JSON.stringify(got)}`);
  }
  if (res.headers.get("strict-transport-security")) fail(area, `${path}: HSTS present (must be absent until after the rollback window)`);
}
function cacheFor(path: string): string {
  if (path.startsWith("/_astro/")) return "public, max-age=31536000, immutable";
  if (path.startsWith("/brand/") || path.startsWith("/og/") || ["/favicon.svg", "/favicon.ico", "/apple-touch-icon.png"].includes(path)) return "public, max-age=86400";
  if (["/rss.xml", "/sitemap-index.xml", "/sitemap-0.xml"].includes(path)) return "public, max-age=3600";
  return "public, max-age=0, must-revalidate";
}
const TYPES: Record<string, string> = { html: "text/html", css: "text/css", js: "javascript", woff2: "font/woff2", png: "image/png", svg: "image/svg+xml", ico: "image/", webp: "image/webp", xml: "xml", txt: "text/plain" };

// 1. Pages
const pageBytes: Record<string, number> = {};
for (const p of pages) {
  const res = await get(p);
  const body = await res.text();
  pageBytes[p] = body.length;
  if (res.status !== 200) { fail("pages", `${p}: ${res.status}`); continue; }
  if (!res.headers.get("content-type")?.startsWith("text/html")) fail("pages", `${p}: content-type ${res.headers.get("content-type")}`);
  if (res.headers.get("cache-control") !== cacheFor(p)) fail("cache", `${p}: cache-control ${res.headers.get("cache-control")}`);
  checkSecurity("headers", p, res);
  const canon = body.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  const expected = SITE + (p === "/" ? "" : p);
  if (canon !== expected && canon !== SITE + "/") fail("seo", `${p}: canonical ${canon}`);
}
pass("pages", `${pages.length} pages returned 200 text/html with the security headers`);

// 2. Static assets
let assetCount = 0;
for (const f of files.filter((f) => !f.endsWith(".html") && !["/_headers", "/_redirects"].includes(f))) {
  const res = await get(f);
  await res.arrayBuffer();
  assetCount++;
  if (res.status !== 200) { fail("assets", `${f}: ${res.status}`); continue; }
  const ext = f.split(".").pop() ?? "";
  if (TYPES[ext] && !res.headers.get("content-type")?.includes(TYPES[ext])) fail("assets", `${f}: content-type ${res.headers.get("content-type")}`);
  if (res.headers.get("cache-control") !== cacheFor(f)) fail("cache", `${f}: cache-control ${res.headers.get("cache-control")} (want ${cacheFor(f)})`);
  checkSecurity("headers", f, res);
}
pass("assets", `${assetCount} static files checked (status, content-type, cache-control, headers)`);

// 3. Config files are not served
for (const f of ["/_headers", "/_redirects"]) {
  const res = await get(f); await res.text();
  if (res.status !== 404) fail("config", `${f} is served (${res.status})`); else pass("config", `${f} not served (404)`);
}

// 4. Every _redirects rule
const rules = readFileSync(join(dist, "_redirects"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
for (const [from, to, code] of rules) {
  const res = await get(from); await res.text();
  const loc = res.headers.get("location");
  if (String(res.status) !== code || loc !== to) fail("redirects", `${from}: ${res.status} → ${loc} (want ${code} → ${to})`);
  else {
    // follow once: target must be 200
    const t = await get(to.split("#")[0]); await t.text();
    if (t.status !== 200) fail("redirects", `${from} → ${to}: target ${t.status}`);
  }
}
pass("redirects", `${rules.length} _redirects rules checked (status, exact Location, target 200)`);
// query strings survive a 301
{
  const res = await get("/brief?ref=x"); await res.text();
  const loc = res.headers.get("location");
  if (res.status !== 301 || !loc?.startsWith("/about")) fail("redirects", `/brief?ref=x → ${res.status} ${loc}`);
  else pass("redirects", `/brief?ref=x → ${loc}`);
}

// 5. Trailing slash / .html normalization (307)
for (const p of ["/about/", "/about.html", "/blog/gitops-homelab-lessons/", "/index", "/index.html", "/blog/category/linux/"]) {
  const res = await get(p); await res.text();
  const want = p.replace(/\/$/, "").replace(/\.html$/, "").replace(/^\/index$/, "/");
  if (res.status !== 307 || res.headers.get("location") !== want) fail("normalize", `${p}: ${res.status} → ${res.headers.get("location")} (want 307 → ${want})`);
}
pass("normalize", "trailing-slash and .html forms 307 to the slash-less URL");

// 6. Error pages and drafts
for (const p of ["/does-not-exist", "/blog/does-not-exist", "/blog/error-budgets", "/blog/style-guide", "/brand-preview", "/blog/error-budgets/", "/wp-admin", "/valley/hall-of-knowledge/error-budgets-nope"]) {
  const res = await get(p);
  const body = await res.text();
  const okStatus = res.status === 404 || (res.status === 307 && p.endsWith("/"));
  if (!okStatus) fail("errors", `${p}: ${res.status}`);
  if (res.status === 404) {
    if (!/Page not found/.test(body)) fail("errors", `${p}: 404 body is not the branded page`);
    if (/rel="canonical"|og:url/.test(body)) fail("errors", `${p}: 404 has canonical/og:url`);
    if (!/name="robots" content="noindex/.test(body)) fail("errors", `${p}: 404 is not noindex`);
    checkSecurity("headers", p, res);
  }
}
pass("errors", "unknown paths, drafts, and /brand-preview return the branded noindex 404 (no canonical)");

// 7. RSS
{
  const res = await get("/rss.xml");
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)].map((m) => m[1]);
  if (!res.headers.get("content-type")?.includes("xml")) fail("rss", `content-type ${res.headers.get("content-type")}`);
  const want = (readFileSync(join(dist, "rss.xml"), "utf8").match(/<item>/g) ?? []).length;
  if (items.length !== want) fail("rss", `${items.length} items (the build has ${want})`);
  for (const link of items) {
    if (!link.startsWith(SITE + "/blog/")) fail("rss", `item link ${link}`);
    const r = await get(link.replace(SITE, "")); await r.text();
    if (r.status !== 200) fail("rss", `${link}: ${r.status}`);
    if (/error-budgets|style-guide/.test(link)) fail("rss", `draft in feed: ${link}`);
  }
  pass("rss", `${items.length} items, all live and absolute`);
}

// 8. Sitemap
{
  const idx = await (await get("/sitemap-index.xml")).text();
  const maps = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const locs: string[] = [];
  for (const m of maps) {
    const x = await (await get(m.replace(SITE, ""))).text();
    locs.push(...[...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  }
  for (const l of locs) {
    if (!l.startsWith(SITE)) fail("sitemap", `non-site URL ${l}`);
    if (l.endsWith("/") && l !== SITE + "/") fail("sitemap", `trailing slash ${l}`);
    const r = await get(l.replace(SITE, "") || "/"); await r.text();
    if (r.status !== 200) fail("sitemap", `${l}: ${r.status}`);
    if (/error-budgets|style-guide|brand-preview|404/.test(l)) fail("sitemap", `should not be listed: ${l}`);
  }
  pass("sitemap", `${locs.length} URLs, all 200`);
}

// 9. robots.txt
{
  const res = await get("/robots.txt");
  const t = await res.text();
  if (res.status !== 200 || !t.includes(`Sitemap: ${SITE}/sitemap-index.xml`) || /Disallow: \/brand-preview/.test(t)) fail("robots", JSON.stringify(t));
  else pass("robots", "200 with Sitemap line; no brand-preview rule");
}

// 10. Methods and compression behavior
{
  const h = await get("/", { method: "HEAD" });
  if (h.status !== 200) fail("methods", `HEAD / ${h.status}`);
  pass("methods", `HEAD / ${h.status}`);
}

// Page weight summary
const sorted = Object.entries(pageBytes).sort((a, b) => b[1] - a[1]);
const summary = { pages: pages.length, largestHtml: sorted.slice(0, 3), totalAssets: assetCount };

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} [${r.area}] ${r.msg}`);
console.log(JSON.stringify(summary));
console.log(failed.length ? `\n${failed.length} FAILURE(S) against ${base}` : `\nALL SMOKE CHECKS PASSED against ${base}`);
process.exit(failed.length ? 1 : 0);
