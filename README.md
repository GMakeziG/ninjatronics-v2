# Ninjatronics v2

A minimalist technical blog for platform engineering, Linux, automation,
GitOps, and security. Built with Astro and TypeScript as static output.

This project is independent of the legacy React site (`~/src/ninjatronics`),
which stays untouched and keeps serving ninjatronics.io until a production
cutover is approved.

**Articles are written in Obsidian and imported. See [docs/authoring.md](docs/authoring.md).**

## Commands

| Command           | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `npm run dev`     | Dev server at http://localhost:4321 (runs as a daemon in Astro 7; `npx astro dev stop` / `status` / `logs`). Shows drafts. |
| `npm run check`   | `astro check`: type-checks `.astro`, `.ts`, and content |
| `npm run build`   | Production build to `dist/` (drafts excluded)       |
| `npm run preview` | Serve the built `dist/` locally (ignores `_headers`, `_redirects`, 404 handling) |
| `npm run preview:worker` | Serve `dist/` with `wrangler dev` at http://127.0.0.1:8787: real headers, redirects, and 404s |
| `npm run deploy:check` | `wrangler deploy --dry-run`: validate the Worker config; uploads nothing |
| `npm run import:check` | Preview an Obsidian import (read-only)          |
| `npm run import`  | Import approved vault notes into `src/content/blog/` (`-- --prune` to remove unpublished ones, with confirmation) |
| `npm test`        | Importer test suite                                 |
| `npm run verify:dist` | Static release checks on `dist/` (canonicals, CSP-safe markup, links and anchors, redirects, sitemap, RSS, no drafts). Run after `build` |

The vault path lives in `obsidian.local.json` (gitignored; see
`obsidian.local.example.json`). No command here commits, pushes, or deploys.
Deployment, staging, and rollback: see [docs/deployment.md](docs/deployment.md).

Requires Node 22.23.4 or later (`.nvmrc`: 24).

## Structure

```
docs/design/                 Approved brand and layout references (source of truth)
docs/authoring.md            Obsidian writing, import, publishing, and rollback workflow
docs/obsidian/               Article template for the vault
docs/migration/              Legacy URL inventory and redirect recommendations
scripts/obsidian/            Vault importer: cli, importer (plan/apply), markdown, frontmatter, tests
public/brand/                Logo marks and favicon sources (PROPOSED, pending approval)
src/content/blog/<slug>/     Articles: index.md(x) + co-located images
src/content.config.ts        Article schema (validated at build; fails closed)
src/config/                  site.ts (identity, nav, author), categories.ts, redirects.ts,
                             content-rules.ts (shared by the site schema and the importer)
src/lib/                     posts.ts (draft rule + queries), shiki.ts (theme + code blocks),
                             reading-time.ts, format.ts
src/integrations/            prune-unreferenced-assets (keeps draft images out of dist/),
                             validate-redirect-anchors (fails on redirects to missing #anchors)
src/styles/                  tokens.css, global.css, prose.css (article body)
src/layouts/                 BaseLayout (meta/SEO), ArticleLayout
src/components/              Header, Footer, Logo, Button, PageHeader, SectionHeading, ChipList,
                             ArticleCard, PostList, CategoryFilter, TagList, TableOfContents,
                             Callout, CopyCode, BranchLines; about/ and projects/ page parts
src/pages/                   index, blog/ (index, [slug], category/, tags/), rss.xml, robots.txt,
                             [redirects] (→ dist/_redirects), about, projects, now, contact
                             (content in src/data/)
```

## Generated files

| Output | Source |
|---|---|
| `/rss.xml` | Published articles |
| `/sitemap-index.xml` | All built, indexable pages |
| `/robots.txt` | `src/pages/robots.txt.ts` |
| `/_redirects` | `src/config/redirects.ts` + each published article's `legacyUrls` (Cloudflare 301s) |
| `/_headers` | `public/_headers` (security headers and caching; strict CSP) |
| `/404.html` | `src/pages/404.astro` (served with HTTP 404 by the Worker) |

## Design rules (from docs/design/)

- Palette: Ink Black #101214, Graphite #1C2124, Warm Paper #F0EDE6,
  Vermilion #E15A3B, Muted Sage #A8B6AE, Signal Teal #2FD3C6.
- Vermilion signals change and action; teal is an accent only.
- Glow appears only on the logo's `>_` prompt. Everything else stays flat.
- Type: Space Grotesk (display), Inter (body), JetBrains Mono (code/metadata),
  self-hosted via Fontsource.
- Dark first. Light reading mode = one future block remapping semantic tokens.

## Milestone status

- [x] M1 Foundation and homepage
- [x] M2 Blog engine and Obsidian importer
- [x] M3 Public pages (About, Projects, Now, Contact)
- [ ] Content migration: five legacy notes and the WordPress "Error Budgets" post
- [ ] Deployment: CP1 local readiness done; staging, then cutover (docs/deployment.md)

## Open items

- Legacy React URL decisions: see docs/migration/legacy-react-urls.md.
- Missing assets: WordPress uploads.
- Deferred: heading anchor links (would need a custom plugin for Astro 7's
  new Markdown processor). Obsidian callouts are handled by the importer.

## License

The MIT License applies to the **application code only**.

- **Application code** (the Astro site, components, layouts, styles,
  configuration, scripts, the Obsidian importer, and tests): MIT. See
  [LICENSE](LICENSE).
- **Everything else is excluded and all rights reserved:** articles, personal
  and editorial content, logos, brand assets, and original graphics
  (© Gerso Robayo-Guillen). See [CONTENT-LICENSE.md](CONTENT-LICENSE.md) for
  the exact list of excluded files and folders.
