# Ninjatronics v2

A minimalist technical blog for platform engineering, Linux, automation,
GitOps, and security. Built with Astro and TypeScript as static output.

This project is independent of the legacy React site (`~/src/ninjatronics`),
which stays untouched and keeps serving ninjatronics.io until a production
cutover is approved.

## Commands

| Command           | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `npm run dev`     | Dev server at http://localhost:4321 (runs as a daemon in Astro 7; `npx astro dev stop` / `status` / `logs`) |
| `npm run check`   | Generate Astro types, then TypeScript `--noEmit`    |
| `npm run build`   | Production build to `dist/`                         |
| `npm run preview` | Serve the built `dist/` locally                     |

Requires Node 22.23.4 or later (`.nvmrc`: 24).

## Structure

```
docs/design/          Approved brand and layout references (source of truth)
public/brand/         Logo marks and favicon sources (PROPOSED, pending approval)
src/config/site.ts    Site identity, navigation, approved copy
src/styles/tokens.css Design tokens: brand primitives → semantic roles → scales
src/layouts/          BaseLayout (head/meta, header, footer)
src/components/       Header, Footer, Logo, Button, SectionHeading, ArticleCard, BranchLines,
                      PendingContent (temporary "in preparation" page body)
src/pages/            index, blog, projects, about, now, contact (placeholders until M2–M3);
                      brand-preview is temporary
```

## Design rules (from docs/design/)

- Palette: Ink Black #101214, Graphite #1C2124, Warm Paper #F0EDE6,
  Vermilion #E15A3B, Muted Sage #A8B6AE, Signal Teal #2FD3C6.
- Vermilion signals change and action; teal is an accent only.
- Glow appears only on the logo's `>_` prompt. Everything else stays flat.
- Type: Space Grotesk (display), Inter (body), JetBrains Mono (code/metadata),
  self-hosted via Fontsource.
- Dark first. Light reading mode = one future block remapping semantic tokens.

## Milestone status

- [x] M1 Foundation and homepage (pending visual review)
- [ ] M2 Blog engine
- [ ] M3 Content migration and pages
- [ ] M4 Quality assurance
- [ ] M5 Cloudflare preview deployment

## Open items

- Logo: SVG reconstruction of reference 4 is a proposal. Replace with an
  exported original if one is available.
- Delete `src/pages/brand-preview.astro` before launch.
- `og:image` is deferred until the logo is approved.
- Missing assets: WordPress uploads, hero/article imagery.
