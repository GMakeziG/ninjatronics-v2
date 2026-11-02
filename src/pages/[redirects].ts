// Generates dist/_redirects (Cloudflare's redirect file) at build time from:
//   1. src/config/redirects.ts           (hand-maintained, non-article URLs)
//   2. each published article's `legacyUrls` frontmatter
//
// Astro skips page files whose names start with "_", so this is a dynamic
// route whose only path is "_redirects".
//
// Fails the build (fail closed) when a rule:
//   - repeats a source path, or shadows a real page on this site
//   - points at a page that doesn't exist in this build
//   - redirects to itself
import type { APIContext } from "astro";
import { STATIC_REDIRECTS } from "../config/redirects";
import { CATEGORIES } from "../config/categories";
import { getPublishedPosts, postPath, tagCounts, categoryPath, tagPath, usedCategories } from "../lib/posts";

export function getStaticPaths() {
  return [{ params: { redirects: "_redirects" } }];
}

/** Pages that exist in a production build (drafts excluded). */
async function knownPages(): Promise<Set<string>> {
  const posts = await getPublishedPosts();
  const used = usedCategories(posts);
  return new Set([
    "/",
    "/blog",
    "/projects",
    "/about",
    "/now",
    "/contact",
    "/rss.xml",
    "/sitemap-index.xml",
    ...posts.map(postPath),
    ...CATEGORIES.filter((c) => used.has(c.slug)).map((c) => categoryPath(c.slug)),
    ...tagCounts(posts).map(({ tag }) => tagPath(tag)),
  ]);
}

const strip = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

export async function GET(_context: APIContext) {
  const pages = await knownPages();
  const posts = await getPublishedPosts();

  const rules = [
    ...STATIC_REDIRECTS.map((r) => ({ from: r.from, to: r.to, origin: `src/config/redirects.ts (${r.note})` })),
    ...posts.flatMap((post) =>
      post.data.legacyUrls.map((from) => ({ from, to: postPath(post), origin: `article "${post.id}" legacyUrls` })),
    ),
  ];

  const errors: string[] = [];
  const seen = new Map<string, string>();
  const lines: string[] = [];

  for (const rule of rules) {
    const from = strip(rule.from);
    const to = strip(rule.to);
    if (seen.has(from)) errors.push(`Duplicate redirect source ${from}: ${seen.get(from)} and ${rule.origin}`);
    seen.set(from, rule.origin);
    if (pages.has(from)) errors.push(`Redirect source ${from} would shadow an existing page (${rule.origin})`);
    // A target may carry a #fragment (e.g. /about#certifications); the page
    // part must exist. Fragments are the page's own responsibility.
    const [toPath, fragment] = to.split("#");
    if (fragment !== undefined && !/^[a-z0-9-]+$/.test(fragment)) errors.push(`Redirect ${from} → ${to} has an invalid #fragment (${rule.origin})`);
    if (from === toPath) errors.push(`Redirect ${from} points to itself (${rule.origin})`);
    if (!pages.has(toPath)) errors.push(`Redirect ${from} → ${to} targets a page that doesn't exist (${rule.origin})`);
    // Match the path with and without a trailing slash; WordPress permalinks
    // usually end in "/", and old links may use either form.
    lines.push(`${from} ${to} 301`);
    if (from !== "/") lines.push(`${from}/ ${to} 301`);
  }

  if (errors.length) {
    throw new Error(`Invalid redirects:\n  - ${errors.join("\n  - ")}`);
  }

  const header = "# Generated at build time by src/pages/[redirects].ts. Do not edit.\n";
  return new Response(header + lines.join("\n") + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
