# Deployment, staging, and rollback

Ninjatronics v2 deploys as a **separate, static-assets-only Cloudflare
Worker** named `ninjatronics-v2`. The legacy site keeps running on its own
Worker (`ninjatronics`) until an approved cutover, and stays deployed
afterwards as the rollback target.

```
GitHub GMakeziG/ninjatronics-v2 ──(Workers Builds)──▶ Worker "ninjatronics-v2"
   main                          → production version   (workers.dev today, behind Cloudflare Access; ninjatronics.io after cutover)
   any other branch              → not built yet         (pull-request previews are deferred; see §3)
```

Nothing in this repository can attach a hostname: `wrangler.jsonc` has no
`routes` and no custom domains. The production domain is moved by hand, in
the dashboard, only during an approved cutover.

---

## 1. What gets deployed

- `npm run build` produces `dist/`: HTML, CSS, JS, fonts, images, `rss.xml`,
  sitemaps, `robots.txt`, plus two Cloudflare config files:
  - `_redirects`: generated from `src/config/redirects.ts` and each published
    article's `legacyUrls` (validated at build: duplicates, loops, missing
    pages, and missing `#anchors` fail the build).
  - `_headers`: copied from `public/_headers` (security headers, caching).
  Neither config file is served publicly.
- There is no Worker script, no bindings, no environment variables, and no
  secrets. Drafts are never built.

**Asset handling** (`wrangler.jsonc`):

| Setting | Value | Effect |
|---|---|---|
| `not_found_handling` | `404-page` | Unknown paths return `404.html` with HTTP 404 |
| `html_handling` | `auto-trailing-slash` | `/about` serves `about.html`; `/about/`, `/about.html`, and `/index` redirect (307) to the slash-less URL (see below) |

### URL normalization (307) and redirects (301)

Two different mechanisms answer with a redirect:

| Request | Status | Comes from | Example |
|---|---|---|---|
| A legacy URL in `_redirects` | **301** (permanent) | `src/config/redirects.ts`, article `legacyUrls` | `/brief` → `/about`, `/valley/` → `/` |
| A trailing slash or `.html` form of a real page | **307** (temporary) | Workers asset handling (`html_handling: "auto-trailing-slash"`) | `/about/`, `/about.html` → `/about`; `/index`, `/index.html` → `/` |

Verified locally with `wrangler dev` (Wrangler 4.153.0). Query strings are
kept (`/about/?ref=x` → `/about?ref=x`). The 307 is built into Cloudflare's
asset handling and isn't configurable.

**Why 307 is acceptable at launch:**
- Every internal link, the sitemap, RSS, and every canonical tag already use
  the slash-less form, so normal traffic never hits a 307.
- Search engines follow the canonical tag, so a 307 hop doesn't split ranking
  between `/about` and `/about/`.
- The cost is one extra round trip for the few visitors arriving through an
  old trailing-slash link (mostly WordPress-era URLs such as `/contact/`).

**When to reconsider permanent (301/308) normalization:** if, after launch,
Search Console or Cloudflare analytics show meaningful traffic or indexed
URLs on trailing-slash or `.html` forms. Options, in order of preference:
1. Generate a 301 rule in `_redirects` for each page's `/<page>/` form (the
   generator already emits slash variants for legacy rules; `_redirects` is
   applied before asset handling). Watch the 2,000 static-rule limit.
2. A Cloudflare Single Redirect Rule that strips trailing slashes, scoped to
   the `ninjatronics.io` hostname only, so the homelab subdomains are never
   affected. This is a zone change and needs its own approval.

Don't switch `html_handling` to `"none"` to avoid the 307: slash-less URLs
would then stop resolving to their `.html` files.

**Content-Security-Policy** allows no inline scripts or styles and no
third-party origins. Keep it that way:
- Astro emits CSS/JS as files (`inlineStylesheets: "never"`,
  `assetsInlineLimit: 0` in `astro.config.mjs`).
- Code highlighting uses classes (`src/lib/shiki.ts`). After changing
  `shiki.ts`, rebuild with `npx astro build --force`: Astro caches rendered
  Markdown and won't re-highlight otherwise. (Workers Builds always starts
  clean.)
- Anything that injects scripts (Cloudflare Web Analytics, Rocket Loader,
  Email Obfuscation, Zaraz) would be blocked. Enabling one means updating
  the CSP in the same change.

---

## 2. Local checks before any push

```bash
npm run check && npm test && npm run build
npm run preview:worker      # wrangler dev at http://127.0.0.1:8787 — real _headers, _redirects, 404s
npm run deploy:check        # wrangler deploy --dry-run: validates config, uploads nothing
```

`npm run preview` (Astro) ignores `_headers`, `_redirects`, and 404
handling; use `preview:worker` to test those.

Pull requests run the same checks in GitHub Actions (`.github/workflows/ci.yml`,
read-only, no secrets).

---

## 3. One-time setup (staging)

Each step needs explicit approval. None of them touch the legacy Worker, DNS,
or email.

1. **GitHub:** create public repository `GMakeziG/ninjatronics-v2`, push `main`,
   protect `main` (require the CI check, no force pushes).
2. **Worker:** Cloudflare dashboard → Workers & Pages → Create → Import a
   repository → `ninjatronics-v2`.
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Non-production branch builds: **off** (pull-request previews are
     deferred). When separately approved, use the deploy command
     `npx wrangler versions upload`, never `npx wrangler deploy`, so a
     branch can't replace the production version.
   - Build variable: `NODE_VERSION=24`
3. **Cloudflare Access:** Worker → Settings → Domains & Routes → enable
   Cloudflare Access for the **workers.dev** route. Policy: allow only the
   owner's email (one-time PIN). Verify the Access application's exact
   hostname and its email-only Allow policy before trusting it.
4. **No staging DNS record.** Staging lives only on `workers.dev`.
5. **Preview URLs are disabled** (`"preview_urls": false` in `wrangler.jsonc`).
   Every deploy applies that value, so they stay off even if toggled in the
   dashboard. Enabling pull-request previews later is a separate, approved
   change: set the value to `true` in a pull request, protect Preview URLs
   with Access and verify it, then turn on non-production branch builds.

### Staging smoke test

Against the Access-protected URL (authenticate first):

- Every page 200; an unknown path returns the branded 404 with HTTP 404.
- Every line of `dist/_redirects` returns 301 with the exact `Location`,
  including `#fragment` targets and trailing-slash variants.
- Security and cache headers match `public/_headers`; the browser console
  shows no CSP violations.
- `robots.txt`, `sitemap-index.xml`, `rss.xml`, canonical URLs, and
  `og:url` all use `https://ninjatronics.io`.
- No draft content, and (after logo approval) no `/brand-preview`.

---

## 4. Never touched by this project

- The legacy Worker `ninjatronics`: code, settings, Git connection, versions.
- DNS: apex and `www` records (until the approved cutover), the Proton Mail
  MX/SPF/DKIM/verification records, the homelab tunnel CNAMEs, and CAA records.
- Zone-wide settings (SSL mode, Always Use HTTPS, HSTS, cache, redirect, and
  transform rules) — only in an approved cutover step.
- Hostinger, WordPress, and the homelab Kubernetes/Flux cluster.

---

## 5. Production cutover (separate approval)

**Before:**
- [ ] All six legacy articles published in v2 with `legacyUrls` (the five
      Hall of Knowledge notes and the WordPress "Error Budgets" post).
- [ ] Logo approved, `/brand-preview` removed, default social image added.
- [ ] Staging smoke test passed on the commit being promoted.
- [ ] Recorded: legacy Worker version ID, screenshot of its Domains & Routes,
      DNS zone export (DNS → Records → Export).
- [ ] Dashboard checked: how `ninjatronics.io` is attached (Custom Domain or
      Route), Email Address Obfuscation off, no script-injecting features,
      existing cache/redirect rules reviewed, Cloudflare Email Routing off.

**Cutover** (about 15 minutes, low-traffic window):
1. Worker `ninjatronics` → Domains & Routes → remove `ninjatronics.io`.
2. Worker `ninjatronics-v2` → Domains & Routes → add custom domain `ninjatronics.io`.
3. `www`: Redirect Rule `www.ninjatronics.io/*` → `https://ninjatronics.io/${path}`
   (301, preserve query). Repoint the `www` record away from Hostinger to a
   proxied placeholder.
4. SSL/TLS → Edge Certificates → Always Use HTTPS: on.
5. Caching → Purge Everything.
6. Verify from outside: pages, every legacy URL, `www`, `http://`, a 404,
   headers; homelab subdomains still resolve; send a test email to the
   public address.

**After:** submit `/sitemap-index.xml` in Search Console; watch 404s for a
week; enable HSTS with a short `max-age` first. Keep the legacy Worker
deployed for at least 30 days.

---

## 6. Rollback

**Bad content or a bad build (v2 stays on the domain):**
- Dashboard → `ninjatronics-v2` → Deployments → roll back to the previous
  version (instant, no rebuild), **or**
- `git revert <commit>` and push to `main`.

**Back to the legacy site (under 5 minutes, no rebuild):**
1. Worker `ninjatronics-v2` → Domains & Routes → remove `ninjatronics.io`.
2. Worker `ninjatronics` → Domains & Routes → add `ninjatronics.io` back.
3. Purge cache, then verify `/` serves the legacy site.
The `www` redirect rule can stay: `www` → apex works either way.

**Unpublishing one article:** see `docs/authoring.md` §4.
