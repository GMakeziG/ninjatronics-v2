# Ninjatronics v2

A minimalist technical blog for platform engineering, Linux, automation,
GitOps, and security. Built with Astro and TypeScript as static output.

This project is independent of the legacy React site (`~/src/ninjatronics`),
which stays untouched and keeps serving ninjatronics.io until a production
cutover is approved.

**To publish an article, see [docs/authoring.md](docs/authoring.md).**

## Commands

| Command           | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `npm run dev`     | Dev server at http://localhost:4321 (runs as a daemon in Astro 7; `npx astro dev stop` / `status` / `logs`). Shows drafts. |
| `npm run check`   | `astro check`: type-checks `.astro`, `.ts`, and content |
| `npm run build`   | Production build to `dist/` (drafts excluded)       |
| `npm run preview` | Serve the built `dist/` locally                     |

Requires Node 22.23.4 or later (`.nvmrc`: 24).

## Structure

```
docs/design/                 Approved brand and layout references (source of truth)
docs/authoring.md            How to write and publish an article
docs/migration/              Legacy URL inventory and redirect recommendations
public/brand/                Logo marks and favicon sources (PROPOSED, pending approval)
src/content/blog/<slug>/     Articles: index.md(x) + co-located images
src/content.config.ts        Article schema (validated at build; fails closed)
src/config/                  site.ts (identity, nav, author), categories.ts, redirects.ts
src/lib/                     posts.ts (draft rule + queries), shiki.ts (theme + code blocks),
                             reading-time.ts, format.ts
src/integrations/            prune-unreferenced-assets (keeps draft images out of dist/)
src/styles/                  tokens.css, global.css, prose.css (article body)
src/layouts/                 BaseLayout (meta/SEO), ArticleLayout
src/components/              Header, Footer, Logo, Button, SectionHeading, ArticleCard, PostList,
                             CategoryFilter, TagList, TableOfContents, Callout, CopyCode,
                             BranchLines, PendingContent
src/pages/                   index, blog/ (index, [slug], category/, tags/), rss.xml, robots.txt,
                             [redirects] (→ dist/_redirects), about/now/projects/contact
                             (placeholders until M3), brand-preview (temporary)
```

## Generated files

| Output | Source |
|---|---|
| `/rss.xml` | Published articles |
| `/sitemap-index.xml` | All built pages except `/brand-preview` |
| `/robots.txt` | `src/pages/robots.txt.ts` |
| `/_redirects` | `src/config/redirects.ts` + each published article's `legacyUrls` (Cloudflare 301s) |

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
- [x] M2 Blog engine (pending review)
- [ ] M3 Content migration and pages
- [ ] M4 Quality assurance
- [ ] M5 Cloudflare preview deployment

## Open items

- Logo: SVG reconstruction of reference 4 is a proposal pending approval.
- Delete `src/pages/brand-preview.astro` before launch.
- Default `og:image` deferred until the logo is approved.
- Legacy React URL decisions: see docs/migration/legacy-react-urls.md.
- Missing assets: WordPress uploads.
- Deferred: heading anchor links and Obsidian-style `> [!note]` callouts in
  plain `.md` (would need a custom Markdown plugin for Astro 7's new processor).
