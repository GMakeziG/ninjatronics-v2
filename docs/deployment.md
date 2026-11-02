# Deployment, staging, and rollback

Ninjatronics v2 deploys as a **separate, static-assets-only Cloudflare
Worker** named `ninjatronics-v2`. The legacy site keeps running on its own
Worker (`ninjatronics`) until an approved cutover, and stays deployed
afterwards as the rollback target.

```
GitHub GMakeziG/ninjatronics-v2
   main ──(manual "Deploy staging" workflow + "staging" environment approval)──▶ Worker "ninjatronics-v2"
                                    (workers.dev, behind Cloudflare Access; ninjatronics.io after cutover)
   other branches → never deployed (pull-request previews are deferred; see §3)
```

Deployments run only from the manually dispatched GitHub Actions workflow
`.github/workflows/deploy-staging.yml` (see §3.1). Pushing or merging never
deploys. Cloudflare Workers Builds is **not** connected: it accepts only
user tokens, which can't be limited to a single Worker.

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
  Markdown and won't re-highlight otherwise. (CI and the deploy workflow
  always start clean.)
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
read-only, no secrets). The deploy workflow (§3.1) repeats them before deploying.

---

## 3. One-time setup (staging)

Each step needs explicit approval. None of them touch the legacy Worker, DNS,
or email.

1. **GitHub:** public repository `GMakeziG/ninjatronics-v2`, `main` protected
   (pull request + the "Check, test, and build" CI check, no force pushes or
   deletion).
2. **Worker (placeholder first):** Cloudflare dashboard → Workers & Pages →
   Create → Worker → "Hello World" template → name exactly `ninjatronics-v2`
   → Deploy. **Don't** import a repository or connect Git: the site is
   deployed by the workflow in §3.1, not by Workers Builds.
3. **Cloudflare Access, straight after creating the Worker:** Worker →
   Settings → Domains & Routes → enable Cloudflare Access for the
   **workers.dev** route. Policy: Allow, Include Emails = the owner's address
   only, One-time PIN. Verify the Access application's exact hostname and its
   email-only Allow policy (Policy Tester) before trusting it.
4. **No staging DNS record.** Staging lives only on `workers.dev`.
5. **Preview URLs are disabled** (`"preview_urls": false` in `wrangler.jsonc`).
   Every deploy applies that value, so they stay off even if toggled in the
   dashboard. Enabling pull-request previews later is a separate, approved
   change: set the value to `true` in a pull request, protect Preview URLs
   with Access and verify it.

### 3.1 Staging deployments (GitHub Actions)

`.github/workflows/deploy-staging.yml` deploys `main` to `ninjatronics-v2`. It
runs only when dispatched by hand (**Actions → Deploy staging → Run
workflow**, branch `main`, typing `ninjatronics-v2` to confirm), and only after
the `staging` environment's reviewer approves.

**GitHub environment `staging`** (Settings → Environments):

| Setting | Value |
|---|---|
| Required reviewers | `GMakeziG` |
| Prevent self-review | Off (the only maintainer must be able to approve) |
| Allow administrators to bypass | Off |
| Deployment branches | Selected branches: `main` |
| Variable `STAGING_HOSTNAME` | The Worker's `workers.dev` hostname |
| Variable `ACCESS_TEAM_DOMAIN` | The Zero Trust team domain (`<team>.cloudflareaccess.com`) |
| Secret `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID |
| Secret `CLOUDFLARE_API_TOKEN` | The token below |

Create the environment **before** the first dispatch; GitHub would otherwise
create it unprotected (the run would still fail, without secrets). Secrets
are released to the job only after approval.

**Cloudflare token:** account-owned, restricted to this one Worker.
Manage Account → Account API Tokens → Create Token → Custom token:
- Permission: **Workers, role Editor**, scope **Specified Workers →
  `ninjatronics-v2`**. Nothing else: no zone, DNS, Workers Routes, Access,
  storage, account-settings, or user permissions.
- Expiry: 90 days. No IP filter (GitHub-hosted runners have no fixed IPs).
- Paste the value once, directly into the `CLOUDFLARE_API_TOKEN` environment
  secret. Never store it in a file or share it.
- Any additional permission needs its own approval. (If Wrangler ever needs
  the account-wide `workers.dev` subdomain lookup, the only foreseen addition
  is Account → Workers Scripts → Read.)

**What the workflow does:**
1. Install, type-check, test, and build, with no Cloudflare credentials present.
2. Validate the target: Worker name `ninjatronics-v2`, static assets only from
   `./dist`, `workers_dev: true`, `preview_urls: false`, no routes or custom
   domains, no bindings or runtime variables, no committed `account_id`.
3. Dry run, then `wrangler deploy` (a failure fails the step).
4. Verify the Worker's settings through the per-Worker API: `workers.dev`
   enabled, preview URLs disabled.
5. Verify anonymous requests are denied by Access (a redirect to
   `<team>/cdn-cgi/access/login/<hostname>`, or 401/403; never site content).
6. If the deploy step was attempted and step 4 or 5 doesn't succeed, contain
   automatically (§3.3).

Steps 4 and 5 run whenever the deploy step was **attempted**, whatever its
outcome (success, failure, or cancelled). Wrangler can activate a new version
and still exit with an error, so a failed deploy step doesn't mean nothing
changed. Containment runs when either verification doesn't end in success,
whether it failed, timed out, was cancelled, or was skipped. A deployment
whose two verifications both pass is never contained.

| Situation | Verification | Containment |
|---|---|---|
| A step before the deploy fails (install, build, target check, dry run) | skipped | skipped (nothing deployed) |
| Deploy succeeds, both verifications pass | runs, passes | skipped; `workers.dev` stays on |
| Deploy succeeds, a verification fails | runs | **runs** |
| Wrangler exits with an error, both verifications pass | runs, passes | skipped. The run is red and the new version may be live: review the deploy log and roll back if needed (§6) |
| Wrangler exits with an error, a verification fails | runs | **runs** |
| Deploy step exceeds its 10-minute timeout | runs | runs unless both pass |
| Run cancelled normally (one click) during or after the deploy | best effort: attempted, not guaranteed | best effort: attempted unless both pass; if either step didn't finish, verify manually (§3.3) |

**Timeouts:** every step has its own `timeout-minutes`. They add up to 51,
below the job's 60, so a hung step fails by itself and verification and
containment keep their time. The approval wait doesn't count toward the job
timeout.

Not covered automatically: a **job timeout**, a **forced cancellation** (a
second cancel), a **lost runner**, or a log saying **"CONTAINMENT FAILED"**.
Follow "Cancelled or interrupted runs" in §3.3.

### 3.2 Token rotation (every 90 days)

1. Create a replacement token with the same single-Worker scope (§3.1).
2. Replace the `CLOUDFLARE_API_TOKEN` environment secret.
3. Dispatch the workflow once and confirm it passes.
4. Revoke the old token (Manage Account → Account API Tokens).

Revoke immediately, rather than at expiry, if the token may have been exposed.

### 3.3 Containment and recovery

**Automatic:** when the deploy step was attempted and either verification
didn't end in success, the workflow logs the deploy outcome, the outcome of
each verification, and every recorded failure. It then disables the
`workers.dev` URL and preview URLs of `ninjatronics-v2` only, and marks the
run failed. See the table in §3.1.

**Manual, if the log says "CONTAINMENT FAILED"** (act immediately):
1. Dashboard → Workers & Pages → `ninjatronics-v2` → Settings → Domains &
   Routes → disable **workers.dev** (and Preview URLs).
2. Confirm from outside that the hostname no longer serves the site
   (`curl -sI https://<hostname>/`; expect 404).
3. If a credential problem is suspected, revoke the token and delete the
   `CLOUDFLARE_API_TOKEN` environment secret.

**Cancelled or interrupted runs** (automatic containment not guaranteed):
if the **job** timed out, the run was **force-cancelled**, the **runner was
lost**, or verification or containment didn't finish, **after** the "Deploy to
ninjatronics-v2" step started, assume a new version may be live and
unverified. After a normal single cancellation, the workflow attempts
verification and containment on a best-effort basis; this is not
guaranteed. Unless the run log shows both verification steps finished
with success, or containment finished with "Contained", treat the run as
interrupted:
1. Check the run log: did "Deploy to ninjatronics-v2" finish? If it never
   started, nothing was deployed and no action is needed.
2. Verify from outside, without credentials (any of these failing means
   contain now):
   - `curl -sI https://<hostname>/` redirects (302) to
     `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/<hostname>`;
   - `curl -s -o /dev/null -w '%{http_code}' -H 'X-Requested-With: XMLHttpRequest' https://<hostname>/`
     returns 401;
   - no response contains the site's HTML.
3. Dashboard → Workers & Pages → `ninjatronics-v2` → Settings → Domains &
   Routes: workers.dev shows Cloudflare Access; Preview URLs disabled; no
   custom domains or routes.
4. **To contain:** disable **workers.dev** (and Preview URLs) on
   `ninjatronics-v2` in the dashboard, then follow Recovery below.
5. If everything checks out, dispatch the workflow again so the full
   verification runs.

**Recovery:**
1. Investigate the Access application: destination hostname, the single
   email-only Allow policy, One-time PIN login, Policy Tester results.
2. Re-enable `workers.dev` in the dashboard only after Access is verified.
3. Check anonymously that requests are redirected to the Access login.
4. Dispatch the workflow again; it must pass every verification.

Containment never touches `ninjatronics`, `mis-hermanos-pequenitos`, other
Access applications, DNS, or `ninjatronics.io`.

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
- [ ] Production baseline captured and reviewed (§5.1), on the cutover day
      or no more than 24 hours before.
- [ ] Activation timeout and rollback decision point written down and
      approved for this cutover: the maximum time to wait in step 2 for the
      v2 Custom Domain to become Active, and who decides to roll back. No
      default applies; the cutover doesn't start without an approved value.

**Cutover** (about 15 minutes, low-traffic window). The legacy Worker's
attachment (Custom Domain or Route) is whatever §5.1 records. Don't assume
either one, and stop if §5.1 doesn't record it. The planned v2 attachment
is always a Custom Domain on `ninjatronics-v2`.
0. Pre-check (read-only, no changes; do it before detaching anything):
   - Compare the **current** Cloudflare DNS records (DNS → Records, live in
     the dashboard) with the §5.1 baseline export: the apex and `www`
     records, MX, SPF, DKIM, CAA, and the homelab CNAMEs. Also confirm that
     the legacy Worker's active version and its Domains & Routes still match
     §5.1.
   - **If §5.1 records a Route:** look in the current DNS records for an
     apex record that would block adding a Custom Domain to
     `ninjatronics-v2`.
   - **Stop here, before step 1,** if a conflicting apex record exists or
     the current configuration differs from the baseline in any unexpected
     way. Removing a conflicting record, or explaining a difference, is a
     separate, approved step followed by a fresh pre-check.
1. Detach `ninjatronics.io` from the legacy Worker `ninjatronics`:
   - **If it's a Custom Domain:** Worker `ninjatronics` → Domains & Routes →
     remove the `ninjatronics.io` Custom Domain. Cloudflare also removes the
     DNS record it manages for that Custom Domain.
   - **If it's a Route:** Worker `ninjatronics` → Domains & Routes → remove
     the exact route pattern recorded in §5.1. The proxied apex DNS record
     stays.
2. Worker `ninjatronics-v2` → Domains & Routes → add Custom Domain
   `ninjatronics.io`. Wait until it shows Active, with its certificate issued.
   **Decision point:** if the Custom Domain can't be added, or isn't Active
   within the approved activation timeout ("Before"), stop the cutover and
   immediately start §6, "Back to the legacy site". Don't continue to step 3.
3. `www`: Redirect Rule `www.ninjatronics.io/*` → `https://ninjatronics.io/${path}`
   (301, preserve query). Repoint the `www` record away from Hostinger to a
   proxied placeholder.
4. SSL/TLS → Edge Certificates → Always Use HTTPS: on. Leave HSTS **off**
   (see "After").
5. Caching → Purge Everything.
6. Verify from outside: pages, every legacy URL, `www`, `http://`, a 404,
   headers; homelab subdomains still resolve.
7. Mail: compare the MX, SPF, and DKIM records with the exact records
   recorded in §5.1 (same names, selectors, and values), then send one test
   message to the existing Proton mailbox and confirm it arrives. Any
   difference means stop and restore the record from the zone export.

**After:** submit `/sitemap-index.xml` in Search Console; watch 404s for a
week. Keep the legacy Worker deployed and unchanged for at least 30 days
(the rollback window). Keep **HSTS off** for the whole rollback window: it
can't be undone for visitors who have already received it. Enabling it
afterwards, starting with a short `max-age`, is a separate, approved change.

### 5.1 Production baseline (record before cutover)

Everything here is read-only. Store the evidence (zone exports, screenshots,
command output) **privately, outside this public repository**: it reveals
infrastructure details. Record observed values only; don't fill in expected
or guessed ones.

**Legacy Worker `ninjatronics`**
- [ ] Active version ID and its deploy date (Workers & Pages →
      `ninjatronics` → Deployments).
- [ ] Screenshot of Settings → Domains & Routes.
- [ ] How `ninjatronics.io` is attached:
  - **Custom Domain:** listed under the Worker's Custom Domains; the DNS
    record is managed by Cloudflare for the Worker.
  - **Route:** a zone route plus an ordinary proxied DNS record. Record the
    exact route pattern and the DNS record.

  Cutover steps 1–2 and the rollback depend on this.
- [ ] Git connection (Settings → Build): whether Workers Builds is connected,
      and if so, the repository and branch. If it is connected, nothing may
      be pushed to that branch until the rollback window closes: a push
      would replace the rollback target.
- [ ] Any other hostnames or routes on the legacy Worker. They must survive
      the cutover unchanged.

**DNS**
- [ ] Zone export (DNS → Records → Export), with a timestamp.
- [ ] From the export, record the exact name, type, and value of:
  - the apex and `www` records (`www` currently serves the Hostinger
    WordPress origin);
  - every MX record;
  - the SPF TXT record;
  - every DKIM record, with its selector, as it appears in the export;
  - any other mail-provider verification records;
  - CAA records;
  - the homelab tunnel CNAMEs.

**Zone settings** (screenshot or note each one)
- [ ] SSL/TLS encryption mode, Always Use HTTPS, HSTS.
- [ ] Scrape Shield → Email Address Obfuscation. It must be off: it injects
      a script that the v2 CSP blocks.
- [ ] Script injectors: Rocket Loader, Zaraz, and Web Analytics automatic
      injection for this hostname. All must be off.
- [ ] Every Redirect, Page, Transform, Cache, and Configuration rule. Note
      any that match `ninjatronics.io` or `www`.
- [ ] Email Routing (expected off: Proton handles mail).

**External snapshot** (anonymous, from any terminal)
- [ ] `curl -sI https://ninjatronics.io/`: status code and `etag`.
- [ ] A content marker from the legacy home page shell, e.g. its
      `<meta name="description">` and `<div id="root">`. Record exactly what
      `curl -s https://ninjatronics.io/` returns.
- [ ] The status code of every legacy URL in
      `docs/migration/legacy-react-urls.md`, including the five
      `/valley/hall-of-knowledge/<slug>` notes.
- [ ] `curl -sI https://www.ninjatronics.io/`: status code and `location`.
- [ ] `dig +short` for: A and AAAA (apex and `www`), NS, MX, TXT (apex, for
      SPF), and each DKIM name taken from the export (`<selector>._domainkey…`
      exactly as recorded), plus CAA.

---

## 6. Rollback

**Bad content or a bad build (v2 stays on the domain):**
- Dashboard → `ninjatronics-v2` → Deployments → roll back to the previous
  version (instant, no rebuild), **or**
- revert the change through a pull request to `main`, then dispatch the
  deploy workflow (§3.1).

**Staging exposure:** see §3.3, Containment and recovery.

**Back to the legacy site** (no rebuild; usually minutes). This also applies
when cutover step 2 failed after the legacy Worker was already detached.
It requires the legacy Worker to still be deployed at the version recorded
in §5.1, and it depends on the attachment method recorded there:
1. Worker `ninjatronics-v2` → Domains & Routes → remove the `ninjatronics.io`
   Custom Domain if it exists in any state (active, pending, or failed). If
   it was never created, skip this step.
   Then confirm it's actually gone: it no longer appears in `ninjatronics-v2`
   → Domains & Routes, and the dashboard no longer lists a Cloudflare-managed
   DNS record for it. **If removal fails or stays pending, stop and
   escalate.** Don't restore the legacy attachment while the v2 attachment
   may still exist: that would create a conflicting attachment.
2. Restore the original attachment to the legacy Worker exactly as recorded
   in §5.1:
   - **If it was a Custom Domain:** Worker `ninjatronics` → Domains &
     Routes → add Custom Domain `ninjatronics.io`. Cloudflare recreates the
     DNS record and certificate. Wait until it shows Active.
   - **If it was a Route:** re-add the exact route pattern recorded in §5.1
     to `ninjatronics`. Confirm the apex DNS record matches the zone export,
     and restore it from the export if it doesn't.
3. Caching → Purge Everything.
4. Verify from outside. Every check must pass; no single one is enough:
   - `curl -sI https://ninjatronics.io/` returns the baseline status code;
   - the home page HTML contains the legacy content markers recorded in §5.1;
   - the five `/valley/hall-of-knowledge/<slug>` notes and the other
     representative legacy URLs return their baseline status codes. Open at
     least one note in a browser: the legacy app renders it client-side, so
     its text isn't in the raw HTML;
   - the `etag` matches the baseline *where it applies*. A match supports
     the other checks; a mismatch alone doesn't mean failure, because ETags
     can vary with response encoding or caching. Investigate it, and treat
     it as a failure if the legacy Worker's active version also differs
     from §5.1;
   - MX, SPF, and DKIM still match the records recorded in §5.1.

Notes:
- The `www` redirect rule can stay: `www` → apex works either way.
  Restoring the Hostinger `www` record from the zone export is optional, and
  only if you want WordPress back.
- Always Use HTTPS can stay on. Keep HSTS disabled throughout the rollback
  window to avoid introducing additional browser-enforced HTTPS behavior
  during recovery (§5, "After").
- If §5.1 recorded a Git connection on the legacy Worker, nothing may be
  pushed to that branch of `GMakeziG/ninjatronics` during the rollback
  window.

**Unpublishing one article:** see `docs/authoring.md` §4.
