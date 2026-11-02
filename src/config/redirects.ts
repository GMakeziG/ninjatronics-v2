// Hand-maintained permanent redirects for non-article URLs. Article
// redirects come from each article's `legacyUrls` frontmatter instead, so
// migrating a WordPress post never requires editing this file.
//
// Every rule is validated at build time (src/pages/[redirects].ts): a
// duplicate source, a redirect loop, or a target that isn't a real page
// fails the build.

export interface RedirectRule {
  from: string;
  to: string;
  /** Why this rule exists; keeps the file self-documenting. */
  note: string;
}

export const STATIC_REDIRECTS: RedirectRule[] = [
  // Legacy React site (PROVISIONAL, approved 2026-11-01; see
  // docs/migration/legacy-react-urls.md). /valley, /floating-citadel, and
  // /hall-of-knowledge are deliberately NOT redirected until their
  // destinations are approved.
  // Sitemap-listed paths (the legacy app rendered NotFound for these):
  { from: "/mission-brief", to: "/about", note: "Legacy React sitemap: Mission Brief → About (provisional)" },
  { from: "/git-forest", to: "/projects", note: "Legacy React sitemap: Git Forest → Projects (provisional)" },
  // Real legacy routes for the same two pages (approved 2026-11-01):
  { from: "/brief", to: "/about", note: "Legacy React route: Mission Brief → About" },
  { from: "/valley/git-forest", to: "/projects", note: "Legacy React route: Git Forest → Projects" },
];
