// Hand-maintained permanent redirects for non-article URLs. Article
// redirects come from each article's `legacyUrls` frontmatter instead, so
// migrating a WordPress post never requires editing this file.
//
// Every rule is validated at build time (src/pages/[redirects].ts): a
// duplicate source, a redirect loop, or a target that isn't a real page
// fails the build.

export interface RedirectRule {
  from: string;
  /** A site path, optionally with a #fragment (the path part is validated). */
  to: string;
  /** Why this rule exists; keeps the file self-documenting. */
  note: string;
}

export const STATIC_REDIRECTS: RedirectRule[] = [
  // Legacy React site (see docs/migration/legacy-react-urls.md). The five
  // Hall of Knowledge notes are NOT listed here: each redirects through its
  // article's `legacyUrls` once that article is published in v2.
  // Sitemap-listed paths (the legacy app rendered NotFound for these):
  { from: "/mission-brief", to: "/about", note: "Legacy React sitemap: Mission Brief → About (provisional)" },
  { from: "/git-forest", to: "/projects", note: "Legacy React sitemap: Git Forest → Projects (provisional)" },
  // Real legacy routes for the same two pages (approved 2026-11-01):
  { from: "/brief", to: "/about", note: "Legacy React route: Mission Brief → About" },
  { from: "/valley/git-forest", to: "/projects", note: "Legacy React route: Git Forest → Projects" },
  // Floating Citadel (certifications), approved 2026-11-02: the district goes
  // to About; each certification page goes to About's certifications section.
  { from: "/valley/floating-citadel", to: "/about", note: "Legacy React route: Floating Citadel → About" },
  { from: "/floating-citadel", to: "/about", note: "Legacy React sitemap: Floating Citadel → About" },
  ...["azure-administrator-associate", "comptia-security-plus", "github-foundations"].map((slug) => ({
    from: `/valley/floating-citadel/${slug}`,
    to: "/about#certifications",
    note: "Legacy React certification page → About certifications",
  })),
  // Git Forest repository pages, approved 2026-11-02: each goes to its
  // project's anchor on /projects (anchor ids are the repository names; see
  // src/data/projects.ts). Anchors are checked in the built HTML.
  ...[
    "cpp-practice",
    "devops-devpod",
    "devpod-dotfiles",
    "go-practice",
    "javascript-practice",
    "lab",
    "signalnode",
    "skills-introduction-to-git",
  ].map((repo) => ({
    from: `/valley/git-forest/${repo}`,
    to: `/projects#${repo}`,
    note: "Legacy React repository page → Projects anchor",
  })),
  // Approved 2026-11-02 (deployment readiness, CP1):
  { from: "/valley", to: "/", note: "Legacy React world overview → homepage" },
  { from: "/valley/hall-of-knowledge", to: "/blog", note: "Legacy React notes index → blog index" },
  { from: "/hall-of-knowledge", to: "/blog", note: "Legacy React sitemap: Hall of Knowledge → blog index" },
  { from: "/sitemap.xml", to: "/sitemap-index.xml", note: "Legacy sitemap location → Astro sitemap index" },
  // Legacy WordPress site (www and the old apex). The "Error Budgets" post
  // redirects through its article's `legacyUrls` once it's published in v2.
  { from: "/about-me", to: "/about", note: "WordPress About Me page → About" },
  { from: "/feed", to: "/rss.xml", note: "WordPress RSS feed → RSS" },
];
