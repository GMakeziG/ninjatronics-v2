# Legacy React site: URL inventory and redirect recommendations

Status: **for owner review**. Nothing below is implemented except the two
rules marked *implemented (provisional)*.

Source: `GMakeziG/ninjatronics` at `origin/main` `28ef8c0` (2026-08-03),
read through the GitHub API on 2026-11-01. This is the code currently
serving ninjatronics.io, a client-side React SPA behind Cloudflare.

## Key findings

1. **The production sitemap doesn't match the app's routes.**
   `public/sitemap.xml` lists `/valley`, `/mission-brief`, `/git-forest`,
   `/floating-citadel`, and `/hall-of-knowledge`. The app's router serves
   `/brief` and `/valley/<district>`. The four root-level sitemap paths
   render the app's NotFound view, even though Cloudflare returns HTTP 200.
   Search engines may have indexed either form, so both need a decision.
2. **The five knowledge notes are publicly live.** Hall of Knowledge has
   `status: "open"` and all five notes have `published: true`, so they're
   reachable at `/valley/hall-of-knowledge/<slug>` today. Importing them into
   v2 as drafts would make five public URLs stop resolving at cutover.
3. **The two approved provisional redirects cover the sitemap paths only.**
   `/mission-brief` and `/git-forest` are sitemap-only paths. The real routes
   for the same pages, `/brief` and `/valley/git-forest`, aren't covered yet.
4. **Production loads Google Tag Manager/Analytics** (allowed by its
   `_headers` CSP). Per the M2 decision, v2 won't include it; Cloudflare
   Web Analytics is deferred to Milestone 5.

## Inventory

| Legacy URL | In sitemap | Real route | What it shows today |
|---|---|---|---|
| `/` | yes | yes | "Dojo Gate" cinematic landing page |
| `/valley` | yes | yes | "Explore the World": cards linking the districts |
| `/brief` | no | yes | Mission Brief: profile, experience timeline, skills, certifications |
| `/mission-brief` | yes | **no** (NotFound) | — |
| `/valley/git-forest` | no | yes | Repository explorer (8 GitHub repositories) |
| `/valley/git-forest/<repo>` | no | yes | One repository: `cpp-practice`, `devops-devpod`, `devpod-dotfiles`, `go-practice`, `javascript-practice`, `lab`, `signalnode`, `skills-introduction-to-git` |
| `/git-forest` | yes | **no** (NotFound) | — |
| `/valley/floating-citadel` | no | yes | Certification vault: AZ-104, CompTIA Security+, GH-900, with verification links |
| `/valley/floating-citadel/<cert>` | no | yes | One certification: `azure-administrator-associate`, `comptia-security-plus`, `github-foundations` |
| `/floating-citadel` | yes | **no** (NotFound) | — |
| `/valley/hall-of-knowledge` | no | yes | Knowledge index (5 published notes) |
| `/valley/hall-of-knowledge/<slug>` | no | yes | One note: `systemd-service-troubleshooting`, `powershell-automation-principles`, `documentation-before-change-philosophy`, `gitops-homelab-lessons`, `active-directory-troubleshooting-workflow` |
| `/hall-of-knowledge` | yes | **no** (NotFound) | — |
| `/og-image.svg`, `/favicon.svg`, `/favicon.ico` | — | static | Social image and icons (v2 ships its own favicons) |

## Recommendations (each needs approval)

| Legacy URL(s) | Recommended v2 destination | Reasoning | Status |
|---|---|---|---|
| `/mission-brief` | `/about` | Approved provisional mapping | **Implemented (provisional)** |
| `/git-forest` | `/projects` | Approved provisional mapping | **Implemented (provisional)** |
| `/brief` | `/about` | Real route for the same Mission Brief page | Recommended |
| `/valley/git-forest` | `/projects` | Real route for the same Git Forest page | Recommended |
| `/valley/git-forest/<repo>` (8) | `/projects` | v2 has no per-repository pages. Alternative: 301 each to its GitHub repository. | Recommended |
| `/valley/floating-citadel`, `/floating-citadel` | `/about#certifications` | You want certifications on About. Requires an About section with that anchor (Milestone 3). | Recommended, after M3 |
| `/valley/floating-citadel/<cert>` (3) | `/about#certifications` | Same section; per-certificate pages aren't planned | Recommended, after M3 |
| `/valley/hall-of-knowledge`, `/hall-of-knowledge` | `/blog` | The notes' new home is the blog | Recommended |
| `/valley/hall-of-knowledge/<slug>` (5) | `/blog/<slug>` **if** the article is published in v2; otherwise `/blog` | These are live public URLs today. See decision below. | **Decision needed** |
| `/valley` | `/` | A hub page with no single successor; the homepage is the new overview. Alternatives: `/blog`, or let it 404. | Recommended, your call |

### Decision needed: the five live notes

They're public now. At cutover, the options are:

1. **Publish them in v2** (after your review in Milestone 3), keeping their
   content and their `2026-07-22` date, with each old URL listed in the
   article's `legacyUrls`. Old links land on the same article.
2. **Keep them as v2 drafts** and redirect the five old URLs to `/blog`
   until each is published. Old links still land somewhere relevant.
3. **Keep them as v2 drafts with no redirect.** The old URLs return 404.

Option 1 or 2 avoids broken links. Adding redirects is a one-line
change: `legacyUrls` in the article frontmatter for option 1, or
`src/config/redirects.ts` for option 2.
