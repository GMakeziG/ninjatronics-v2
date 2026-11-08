# Production cutover and rollback runbook

Moves `ninjatronics.io` from the legacy Worker `ninjatronics` (React app) to
the v2 production Worker `ninjatronics-v2-production` (Astro, static assets),
and back if needed. The staging Worker `ninjatronics-v2` never receives the
production domain (§9).

This runbook is the step-by-step procedure. `docs/deployment.md` remains the
reference for how the Worker, the staging workflow, and containment work.

**Every step that changes Cloudflare or GitHub configuration needs your
explicit approval at the time it runs.** Nothing in this repository can
attach a hostname: the Wrangler configs have no routes and no custom
domains, and the deploy tokens can't change domains, routes, DNS, or Access.

**Deployment-safety requirements (§9):** staging and production are separate
Workers, deployed by separate workflows, from separate GitHub environments,
with separate Cloudflare tokens that can each reach only their own Worker.
The staging workflow must be technically unable to change production, before
and after the cutover. The legacy branch is frozen (§2.4) before the cutover.

> Public repository: don't add account IDs, the staging hostname, the Access
> team domain, tokens, or zone exports to this file. Keep evidence privately
> (for example in a gitignored `.release-prep/` folder of a local checkout).

---

## 0. What is known, and what isn't

Observed read-only on 2026-11-06 and 2026-11-08 (anonymous HTTP and DNS,
the GitHub API, and the pinned Wrangler source). Nothing below was observed
in the Cloudflare dashboard: the machine that ran the checks has no
Cloudflare credentials.

| Fact | Status | Evidence |
|---|---|---|
| The legacy Worker `ninjatronics` is built and deployed by **Cloudflare Workers Builds** from `GMakeziG/ninjatronics`, branch `main` | ✅ verified | Every recent `main` commit has a "Workers Builds: ninjatronics" check run (GitHub app `cloudflare-workers-and-pages`) |
| Current production build: commit `28ef8c0` ("polish index.html"), built 2026-08-03 | ✅ verified (inferred from the last successful check run; confirm the version ID in the dashboard) | GitHub check runs; production ETag unchanged since 2026-11-02 |
| `GMakeziG/ninjatronics` `main` has **no branch protection or ruleset** | ✅ verified | GitHub API: "Branch not protected", no rulesets |
| How `ninjatronics.io` is attached to the legacy Worker (Custom Domain or Route) | ❓ **unknown** | Not visible externally. Dashboard check D2 |
| Legacy Worker's active version ID | ❓ unknown | Dashboard check D1 |
| Apex serves the legacy SPA: every path returns 200 with the same HTML shell, ETag `"ed45e5af4a3e87d6efc70aa08f6890ce"` | ✅ verified | `curl` |
| `http://ninjatronics.io/` returns 200 (Always Use HTTPS is **off**) | ✅ verified | `curl` |
| No HSTS header on the apex | ✅ verified | `curl` |
| `www` is a proxied record whose origin is Hostinger (WordPress); WordPress issues `301 → https://ninjatronics.io/` | ✅ verified | `x-hcdn-*`, `x-redirect-by: WordPress` headers |
| Apex HTML responses show `cf-cache-status: HIT` | ✅ observed | Suggests a Cache Rule or similar; dashboard check D13/D15 |
| Cloudflare managed `robots.txt` (AI Crawl Control "Content-Signal" block) is active | ✅ observed | `/robots.txt` starts with Cloudflare's block |
| Mail: Proton MX (2), SPF `include:_spf.protonmail.ch ~all`, DMARC `p=quarantine`, three Proton DKIM CNAMEs, Proton verification TXT | ✅ verified | `dig` |
| CAA allows Let's Encrypt, Google Trust Services, SSL.com (the CAs Cloudflare uses), among others | ✅ verified | `dig CAA` |
| DNSSEC: no DS record at the registry | ✅ observed | `dig DS` |
| Legacy site loads Google Analytics (gtag) | ✅ observed | Home page HTML. **v2 has no analytics** (strict CSP) |
| Staging (`ninjatronics-v2` on workers.dev) is behind Cloudflare Access: anonymous 302 to the Access login, XHR 401, no site HTML | ✅ verified | `curl` |
| Staging's deployed commit: `a4ab296` (2026-11-02), **older than the release candidate** | ✅ verified | GitHub Actions run history |
| `wrangler deploy` (4.153.0) with no `routes` in the config does **not** add, change, or remove Routes or Custom Domains | ✅ verified in source | `triggersDeploy`: routes and custom domains are published only when the config lists them |
| Deploy token is Workers Editor scoped to `ninjatronics-v2` only | ❓ by design, not re-verified | Dashboard check D17 |
| `GMakeziG/ninjatronics` has no GitHub Actions workflows, no webhooks, no deploy keys, Dependabot security updates off, one collaborator (owner, admin), default workflow token read-only, only the `main` branch | ✅ verified 2026-11-08 | GitHub API |
| The production Worker `ninjatronics-v2-production`, its token, the `production` GitHub environment, and the production workflow | ❌ **don't exist yet** | Proposed in §9 |

**Consequence of the first three rows:** a push to `GMakeziG/ninjatronics`
`main` deploys a new production version of the legacy Worker today, and
during the rollback window would replace the rollback target. Freeze that
branch before the cutover (precondition P3).

---

## 1. Preconditions and approvals

All must be true, in this order. Record each with a date and who approved it.

| # | Precondition | How to verify |
|---|---|---|
| P1 | The release candidate is a commit on `main` with CI green | `gh run list --workflow ci.yml --branch main --limit 1` |
| P2 | Staging deployed **from that exact commit** and the staging smoke test (§4) passed | Deploy run log; §4 results recorded |
| P3 | **Legacy branch frozen:** a ruleset on `GMakeziG/ninjatronics` blocks updates to `main` (see §2.4) | `gh api repos/GMakeziG/ninjatronics/rulesets` |
| P4 | Dashboard checklist D1–D18 (§3) completed, observed values recorded privately, ≤ 24 h before cutover | Your notes and screenshots |
| P5 | The attachment method (D2) is known. **No cutover without it** | D2 |
| P6 | Script injectors off (D9–D12) and no rule rewrites HTML or headers for the apex (D13) | D9–D13 |
| P7 | Activation timeout written down (maximum wait for the v2 Custom Domain to become Active), and the rollback decision owner named | Your approval |
| P8 | Maintenance window chosen (low traffic) and you're available for the whole window plus 1 hour | — |
| P10 | **Staging and production separated (§9):** Cloudflare changes C1–C3 and GitHub changes G1–G3 done, the production workflow merged, and the separation checks in §9.6 passed | §9.6 results recorded |
| P11 | The production Worker runs the promoted commit: "Deploy production" succeeded for the same commit as P2, and its settings check shows workers.dev **off** and Preview URLs **off** | Production run log |
| P9 | Explicit approval: "start cutover" (asked last, after P10 and P11) | — |

Error Budgets is **not** a launch requirement (decision 2026-11-06). While it
stays a draft, its WordPress URL
`/benefits-of-aerobic-exercise-for-the-mind-and-body/` returns 404 after the
`www` redirect. That's accepted until it's published.

---

## 2. Backup and evidence capture (read-only)

Do this within 24 hours before the cutover. Store everything privately.

### 2.1 External snapshot (any terminal)

```bash
D=~/src/ninjatronics-v2/.release-prep/baseline/$(date -u +%F)-cutover; mkdir -p "$D"; cd "$D"
date -u +%FT%TZ > TIMESTAMP
for u in https://ninjatronics.io/ http://ninjatronics.io/ https://www.ninjatronics.io/ http://www.ninjatronics.io/; do
  echo "== $u"; curl -sS -o /dev/null -D - --max-time 15 "$u"; done > headers.txt
curl -s https://ninjatronics.io/ > home.html; sha256sum home.html >> TIMESTAMP
curl -s https://ninjatronics.io/robots.txt > robots.txt
for q in "A ninjatronics.io" "AAAA ninjatronics.io" "A www.ninjatronics.io" "AAAA www.ninjatronics.io" \
         "NS ninjatronics.io" "MX ninjatronics.io" "TXT ninjatronics.io" "TXT _dmarc.ninjatronics.io" "CAA ninjatronics.io" \
         "CNAME protonmail._domainkey.ninjatronics.io" "CNAME protonmail2._domainkey.ninjatronics.io" "CNAME protonmail3._domainkey.ninjatronics.io"; do
  set -- $q; echo "== $1 $2"; dig +short "$1" "$2" @1.1.1.1; done > dns.txt
for p in / /valley/ /brief /valley/hall-of-knowledge/obsidian-syncthing-headless-linux /blog/does-not-exist; do
  printf '%s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://ninjatronics.io$p)"; done > legacy-statuses.txt
```

Expected today: apex 200 with ETag `"ed45e5af4a3e87d6efc70aa08f6890ce"`
(confirm it matches; if it changed, find out why before continuing), `www`
301 from WordPress, every legacy path 200.

### 2.2 Dashboard evidence

Complete §3 (D1–D18). Export the zone: DNS → Records → Export, and keep the
file with the snapshot.

### 2.3 Repository state

```bash
gh api repos/GMakeziG/ninjatronics/commits/main --jq '.sha'      # expect 28ef8c0… unless D1 says otherwise
gh api repos/GMakeziG/ninjatronics-v2/commits/main --jq '.sha'   # the commit being promoted
```

### 2.4 Freeze the legacy branch (approved GitHub change, precondition P3)

**Why:** Cloudflare Workers Builds rebuilds and deploys the legacy Worker on
every push to `GMakeziG/ninjatronics` `main`. That branch has no protection,
so one push (by hand, from a merged pull request, or by any app with write
access) changes production today, and during the rollback window would
replace the rollback target. The freeze doesn't touch the Worker itself.

**What can write to the repository today** (GitHub API, 2026-11-08): the
owner (only collaborator, admin) and GitHub Apps installed with contents
write. There are no Actions workflows, webhooks, or deploy keys; Dependabot
security updates are off; the default workflow token is read-only. The
ruleset below applies to all of them, apps included, because it has **no
bypass actors**.

**Proposal: one repository ruleset that freezes every branch.** `main` is
the only branch. Blocking branch creation too stops a new branch from
producing non-production builds (see D3) or being merged later.

```bash
gh api -X POST repos/GMakeziG/ninjatronics/rulesets --input - <<'JSON'
{
  "name": "Freeze: legacy production rollback target",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~ALL"], "exclude": [] } },
  "rules": [
    { "type": "creation" },
    { "type": "update" },
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
JSON
```

| Rule | Blocks |
|---|---|
| `update` | Every push or merge to an existing branch, including `main` (so no Workers Build is triggered) |
| `non_fast_forward` | Force pushes |
| `deletion` | Deleting `main` (and with it the source of the rollback target) |
| `creation` | New branches |

**Verify** (read-only):
```bash
gh api repos/GMakeziG/ninjatronics/rulesets --jq '.[]|"\(.id) \(.name) \(.enforcement)"'   # one active ruleset
gh api repos/GMakeziG/ninjatronics/rules/branches/main --jq '[.[].type]|sort'               # creation, deletion, non_fast_forward, update
gh api repos/GMakeziG/ninjatronics/commits/main --jq .sha                                   # unchanged (28ef8c0… or the D1 commit)
```
Don't test it with a real push: if the rule were wrong, that push would
deploy production.

**Also, in the Cloudflare dashboard** (D3; read-only unless separately
approved): record whether non-production branch builds are enabled, and
don't use "Retry build" or "Deploy" on the legacy Worker during the window.
Disconnecting the Git integration is **not** proposed: it's a Cloudflare
change whose effect on the deployed version hasn't been verified.

**What it doesn't cover:** someone with admin rights can disable the
ruleset (that's deliberate: an audited escape hatch), and a dashboard user
can deploy or roll back the legacy Worker directly.

**Undo:** `gh api -X DELETE repos/GMakeziG/ninjatronics/rulesets/<id>` (or
set `"enforcement": "disabled"`). Do that only when the rollback window
closes, or for an approved legacy hotfix, and remember that the next push
deploys production. After the window, archiving the repository is an
option (separate decision).

---

## 3. Cloudflare dashboard checklist (you; read-only)

Record observed values, not expected ones. Screenshots help.

**Legacy Worker `ninjatronics`**
- D1. Deployments: active version ID, its date, and its source commit (expect `28ef8c0`).
- D2. Settings → Domains & Routes: is `ninjatronics.io` a **Custom Domain** or a **Route**? If a Route, record its exact pattern (e.g. `ninjatronics.io/*`) and zone. List any other hostnames or routes (they must survive unchanged).
- D3. Settings → Build: confirm the Git connection (`GMakeziG/ninjatronics`, production branch `main`), and whether non-production branch builds are enabled.

**Worker `ninjatronics-v2` (staging)**
- D4. Domains & Routes: workers.dev enabled **with Cloudflare Access**; Preview URLs disabled; no custom domains or routes.
- D5. Deployments: the active version came from the latest approved staging run.

**Worker `ninjatronics-v2-production` (after C1, §9.4)**
- D19. Domains & Routes: workers.dev **disabled**, Preview URLs **disabled**, no custom domains or routes (until cutover step 2). Not connected to Git (Settings → Build shows no repository).
- D20. Deployments: the active version came from the "Deploy production" run for the promoted commit (P11).

**Zero Trust → Access**
- D6. The staging application's destination is exactly the workers.dev hostname of `ninjatronics-v2`; one Allow policy (your email only); One-time PIN; Policy Tester denies another email. **No Access application covers `ninjatronics.io`.**

**DNS → Records**
- D7. Export the zone. Record: apex and `www` records (type, target, proxied), every MX, SPF TXT, DMARC TXT, the three DKIM CNAMEs, the Proton verification TXT, CAA, and every other record (homelab tunnel CNAMEs). If D2 is a Route, note whether an apex record exists that would conflict with adding a Custom Domain.

**SSL/TLS**
- D8. Encryption mode; Edge Certificates: Always Use HTTPS (expected off), HSTS (**must be off**), Minimum TLS version, the edge certificate's covered hostnames.

**Features that inject scripts or rewrite HTML** (all must be off for `ninjatronics.io`; each one breaks or weakens v2's strict CSP)
- D9. Scrape Shield → Email Address Obfuscation.
- D10. Speed → Rocket Loader (and any HTML minification or other HTML rewriting).
- D11. Zaraz.
- D12. Web Analytics: automatic injection for this hostname.

**Rules**
- D13. Every Redirect, Page, Transform (request/response header), URL Rewrite, Cache, Configuration, Origin, and Snippet rule. Note each that matches the apex or `www`.
- D14. Email Routing (expected off: Proton handles mail).
- D15. Caching → Cache Rules / Page Rules: anything like "Cache Everything" on the apex (the legacy HTML shows `cf-cache-status: HIT`). Browser Cache TTL: expected "Respect existing headers".
- D16. Security → Bots / AI Crawl Control: whether managed `robots.txt` and AI-bot blocking stay as they are for v2 (they're compatible).

**Credentials**
- D17. The staging deploy token: account-owned, Workers Editor on `ninjatronics-v2` only (**not** `ninjatronics-v2-production`, not "all Workers"), expiry date (expected ~2027-01-31).
- D21. The production deploy token (C2): account-owned, Workers Editor on `ninjatronics-v2-production` only (not `ninjatronics-v2`, not "all Workers"), no zone, DNS, or Access permissions, expiry date recorded.
- D18. Your dashboard user can manage: Workers (domains and routes of `ninjatronics` and `ninjatronics-v2-production`), DNS, zone settings, and rules, and can purge cache.

---

## 4. Deploy and verify the release on staging

1. Confirm P1: the promoted commit is `main`'s head and CI is green.
2. Dispatch **Actions → Deploy staging → Run workflow** (branch `main`, type
   `ninjatronics-v2`) and approve the `staging` environment. **Approval
   required.**
3. The run must show: verify:dist OK, target validation OK, dry run, deploy,
   both verifications OK, **containment skipped**. Record the run ID and the
   Worker version ID from the deploy log.
4. Smoke test through Access, from a checkout of the same commit:
   ```bash
   cd ~/src/<checkout-of-the-promoted-commit> && npm ci && npm run build
   cloudflared access login https://<staging-host>          # one-time PIN, in your browser
   CF_ACCESS_TOKEN=$(cloudflared access token -app=https://<staging-host>) npm run smoke -- https://<staging-host>
   ```
   Expect `ALL SMOKE CHECKS PASSED`. Then in a browser (logged in): home,
   one article, the 404 page; DevTools console shows no CSP violations.
5. Production is untouched: `curl -sI https://ninjatronics.io/ | grep -i etag`
   still shows the legacy ETag.
6. **Promote the same commit to the production Worker** (P11; needs §9 in
   place): dispatch **Actions → Deploy production** (branch `main`, type
   `ninjatronics-v2-production`) and approve the `production` environment.
   **Approval required.** The workflow refuses unless "Deploy staging"
   succeeded for this exact commit. Before cutover the production Worker has
   no public URL, so the run checks its settings only; content was verified
   on staging from the same commit.

---

## 5. Cutover (≈ 15 minutes; approval required for each change)

The v2 attachment is always a **Custom Domain** on `ninjatronics-v2-production`
(Cloudflare creates and manages its DNS record and certificate). **Never**
attach `ninjatronics.io` to the staging Worker `ninjatronics-v2`.

**Step 0. Pre-check (no changes).** Compare the live dashboard with your §3
records: D2 attachment, D7 DNS, D9–D13. Stop if anything differs
unexpectedly. If D2 is a Route and D7 shows an apex record that blocks a
Custom Domain, stop: removing it is a separate approved step.

**Step 1. Detach the apex from the legacy Worker** (the site is unavailable
from here until step 2 is Active):
- **Custom Domain (D2):** `ninjatronics` → Settings → Domains & Routes →
  remove `ninjatronics.io`. Cloudflare also removes its managed DNS record.
- **Route (D2):** `ninjatronics` → Settings → Domains & Routes → remove the
  exact route recorded in D2. The proxied apex DNS record stays.

**Step 2. Attach the apex to v2:** `ninjatronics-v2-production` → Settings →
Domains & Routes → Add → Custom Domain → `ninjatronics.io`. Wait for **Active** with
its certificate issued.
- **Decision point:** not Active within the approved activation timeout
  (P7), or it can't be added → stop and run §8 "Back to the legacy site"
  now. Don't continue.
- Check immediately: `curl -sI https://ninjatronics.io/` shows v2 headers
  (`x-frame-options: DENY`, the strict `content-security-policy`).

**Step 3. `www` → apex.** Rules → Redirect Rules → create:
- When: hostname equals `www.ninjatronics.io`.
- Then: dynamic redirect to `concat("https://ninjatronics.io", http.request.uri.path)`,
  status **301**, preserve query string.

The `www` record must stay proxied (it is today); the rule answers before
the request reaches Hostinger, so the record's Hostinger target can stay
until you decide to retire WordPress. Verify:
```bash
curl -sI https://www.ninjatronics.io/about-me/ | grep -iE '^HTTP|^location'   # 301 → https://ninjatronics.io/about-me/
```
(Then v2's own `_redirects` sends `/about-me/` → `/about`.)

**Step 4. Always Use HTTPS: on** (SSL/TLS → Edge Certificates). **Leave HSTS
off** for the whole rollback window.

**Step 5. Purge cache:** Caching → Configuration → Purge Everything (clears
any cached legacy HTML; see D15).

**Step 6. Verify (§6).** Any failure that can't be fixed in minutes → §8.

**Step 7. Record:** time of each step, the v2 version ID, and smoke results.

---

## 6. Post-cutover verification

From a checkout of the promoted commit (with `dist/` built):

```bash
npm run smoke -- https://ninjatronics.io      # expect ALL SMOKE CHECKS PASSED
```

It checks every page, static asset, security header, cache header, every
`_redirects` rule, 307 normalization, 404s, drafts, RSS, sitemap, and
`robots.txt`. Cloudflare's managed `robots.txt` block (D16) may be prepended;
that's expected. If only `[cache]` checks fail, compare with D15 (Browser
Cache TTL or a Cache Rule overriding headers) before deciding anything.

Then:
```bash
curl -sI http://ninjatronics.io/ | grep -iE '^HTTP|^location'            # 301 → https (Always Use HTTPS)
curl -sI https://www.ninjatronics.io/ | grep -iE '^HTTP|^location'       # 301 → https://ninjatronics.io/
curl -s https://ninjatronics.io/ | grep -c 'googletagmanager'           # 0
curl -sI https://ninjatronics.io/ | grep -ic strict-transport-security  # 0 (HSTS stays off)
curl -s -o /dev/null -w '%{http_code}\n' https://ninjatronics.io/valley/hall-of-knowledge/gitops-homelab-lessons   # 301
dig +short MX ninjatronics.io @1.1.1.1; dig +short TXT ninjatronics.io @1.1.1.1; dig +short TXT _dmarc.ninjatronics.io @1.1.1.1
```
- Mail records match §2.1's `dns.txt` exactly; send one test message to
  the Proton mailbox and confirm it arrives.
- Homelab hostnames (from D7) still resolve and respond as before.
- Browser: home, an article, a tag page, the 404 page, mobile width; DevTools
  console has no CSP violations; the favicon and social preview look right
  (e.g. paste the URL into a private message to yourself).

**Security and SEO:**
- Headers match `public/_headers` (smoke covers this). Optionally run an
  external header scan (e.g. securityheaders.com) and record the grade.
- Search Console: confirm the property, submit `https://ninjatronics.io/sitemap-index.xml`,
  inspect `/` and one article (canonical = the URL itself).
- Analytics: v2 has none. Google Analytics data stops at cutover (accepted
  unless you decide otherwise; adding analytics means a CSP change).

---

## 7. Monitoring and incident response

| When | What | Who |
|---|---|---|
| Cutover + 15 min | Smoke passes; mail test arrived; `www` and `http` redirect | You (Claude can run the read-only commands) |
| + 1 hour | Cloudflare analytics for the zone: 5xx near zero; 4xx not spiking. `npm run smoke` again | You |
| + 24 hours | Search Console coverage and crawl errors; 404s on legacy paths not in `_redirects` (add rules by PR if warranted) | You |
| Daily for 7 days | Smoke once; Search Console; production ETag/version unchanged except approved deploys | You |
| Day 30 | Close the rollback window: decide on HSTS (short max-age first), retiring WordPress on Hostinger, unfreezing the legacy branch | You (separate approvals) |

**After cutover, every production change goes through "Deploy production"**
(§9), only for a commit that "Deploy staging" already deployed successfully.
"Deploy staging" keeps deploying only `ninjatronics-v2`, behind Access, and
its token can't reach the production Worker. After each production deploy
the workflow runs `npm run smoke -- https://ninjatronics.io`; also check
once, on the first post-cutover deploy, that the `ninjatronics.io` Custom
Domain is still attached (Wrangler 4.153.0 doesn't touch domains it isn't
configured with).

**Incident:** if the site is down or wrong and the cause isn't obvious within
10 minutes, roll back (§8) first and investigate after.

---

## 8. Rollback

### 8.1 Decision criteria (roll back if any is true)

- The v2 Custom Domain isn't Active within the activation timeout (P7), or fails.
- `https://ninjatronics.io/` returns 5xx or a wrong site for more than 5 minutes.
- TLS errors for visitors.
- Mail records changed or the test message doesn't arrive (fix the record
  from the zone export first; roll back only if mail can't be restored).
- A security header or CSP regression that can't be fixed by an approved
  deploy within 30 minutes.
- The decision owner (P7) calls it.

Not a reason to roll back: a single missing legacy redirect (add it by PR),
or `[cache]`-only smoke failures (investigate D15).

### 8.2 Bad content or a bad build (v2 stays on the domain)

`ninjatronics-v2-production` → Deployments → roll back to the previous
version (instant), or revert through a PR to `main`, deploy it to staging,
verify, then dispatch "Deploy production". Staging never deploys production.

### 8.3 Back to the legacy site

Requirements: the legacy Worker still deployed at the D1 version (the branch
freeze guarantees no rebuild); dashboard permissions from D18.

1. `ninjatronics-v2-production` → Domains & Routes → remove the
   `ninjatronics.io` Custom Domain, in whatever state it is. Confirm it's gone, including its managed
   DNS record. **If removal fails or stays pending, stop and escalate**:
   don't create a second attachment.
2. Restore the legacy attachment exactly as D2 recorded:
   - **Custom Domain:** `ninjatronics` → Domains & Routes → add Custom Domain
     `ninjatronics.io`; wait for Active.
   - **Route:** re-add the exact route pattern to `ninjatronics`; confirm the
     apex DNS record matches the zone export (restore it from the export if not).
3. Leave the `www` Redirect Rule and Always Use HTTPS in place (both work with
   the legacy site). HSTS stays off.
4. Purge Everything.
5. Verify (all must pass):
   ```bash
   curl -sI https://ninjatronics.io/ | grep -iE '^HTTP|etag'     # 200, the baseline ETag (a mismatch alone isn't failure: compare D1 version)
   curl -s https://ninjatronics.io/ | sha256sum                  # compare with §2.1 home.html
   for p in / /valley/ /valley/hall-of-knowledge/obsidian-syncthing-headless-linux; do curl -s -o /dev/null -w "$p %{http_code}\n" https://ninjatronics.io$p; done   # all 200
   npm run smoke -- https://ninjatronics.io                      # must now FAIL broadly (the legacy SPA): confirms v2 is no longer served
   ```
   Open one Hall of Knowledge note in a browser (rendered client-side). Mail
   records still match §2.1.

**Expected impact:** from step 1 to the legacy attachment being Active, the
apex is unavailable (typically minutes; certificate issuance can add more).
Visitors who received a 301 from v2's `_redirects` (cached by browsers) keep
following it; those target URLs don't exist on the legacy SPA, which serves
its shell for every path anyway, so they still get a page. Search engines may
have recrawled some v2 URLs; harmless for a short rollback.

**Limitations:** a rollback restores what's attached, not what's built. If the
legacy branch was pushed to (P3 violated), the rollback target is that new
build. HSTS, if it had been enabled, couldn't be undone for visitors who
received it; that's why it stays off.

### 8.4 Permissions

Dashboard user with: Workers (edit both Workers' domains and routes), DNS
edit (only if a Route-based restore needs the apex record), zone settings,
Rules edit, and cache purge. The GitHub deploy token can do none of this, by
design.

---

## 9. Deployment safety: staging and production stay separate

**Status: proposal. Nothing in this section exists yet.** It's a cutover
precondition (P10). Each Cloudflare (C) and GitHub (G) change needs its own
approval; the repository changes (R) arrive by a separate pull request.

### 9.1 The problem

Today staging is the Worker `ninjatronics-v2`, deployed by "Deploy staging"
with a token scoped to that Worker. If the production domain were attached
to that same Worker, the staging workflow, its token, and its approval
would become a production deploy path. A staging experiment would then go
straight to visitors, with no separate approval and no way to test a change
before production.

### 9.2 Design

The production domain goes to a **new** Worker. Staging stays exactly as it
is today (same Worker, workers.dev hostname, Access application, token, and
workflow), so the verified staging setup isn't rebuilt.

| | Staging | Production |
|---|---|---|
| Worker | `ninjatronics-v2` (exists) | `ninjatronics-v2-production` (new, C1) |
| Public URL | workers.dev, behind Cloudflare Access | `ninjatronics.io` Custom Domain only (attached at cutover); workers.dev **off**, Preview URLs **off** |
| Wrangler config | `wrangler.jsonc` | `wrangler.production.jsonc` (new, R1) |
| Workflow | `deploy-staging.yml` | `deploy-production.yml` (new, R2) |
| GitHub environment | `staging` (exists) | `production` (new, G1) |
| Cloudflare token | Workers Editor on `ninjatronics-v2` only | Workers Editor on `ninjatronics-v2-production` only (C2) |
| Can deploy | Any `main` commit | Only a `main` commit that "Deploy staging" already deployed successfully |

**Alternative considered:** keep the name `ninjatronics-v2` for production
and create a new staging Worker. Rejected: it changes the staging hostname,
needs a new Access application and token, and leaves production with an
Access-protected workers.dev URL to disable. The proposal changes nothing
that already works.

### 9.3 Layers that keep staging away from production

Each layer works on its own; together they need two independent failures.

1. **Cloudflare token scope (the hard boundary).** The staging token can
   act only on `ninjatronics-v2`; the production token only on
   `ninjatronics-v2-production`. Even a modified workflow or config can't
   deploy to the other Worker with the wrong token. Neither token can change
   DNS, routes, zone settings, or Access.
2. **GitHub environment secrets.** Each token is a secret of its own
   environment. A job sees a secret only after that environment's reviewer
   approves, and only on `main`. The `staging` job can't read the
   `production` secret, and the reverse.
3. **Workflow target checks.** Each workflow validates its config before any
   credential is used: the exact Worker name, no routes or custom domains,
   no environment sections, no bindings, and the expected workers.dev and
   Preview URL settings.
4. **Separation check in the staging workflow (R3).** Before deploying, the
   staging job asks the Cloudflare API for `ninjatronics-v2-production`
   using the staging token, and **fails if it succeeds**. A token that's
   wrongly scoped is caught on every run, not only at setup.
5. **Promotion gate (R2).** "Deploy production" refuses a commit unless a
   "Deploy staging" run for the same commit SHA succeeded.
6. **Branch protection.** Workflow files and Wrangler configs change only
   through a pull request to protected `main`, and both environments accept
   only `main`.

### 9.4 Cloudflare changes (dashboard; each needs approval)

| # | Change | Notes |
|---|---|---|
| C1 | Create the Worker `ninjatronics-v2-production`: Workers & Pages → Create → Worker → "Hello World" → Deploy. Then Settings → Domains & Routes: **disable** workers.dev and Preview URLs | Don't import a repository or connect Git. The placeholder is public on workers.dev only until it's disabled, a minute or two |
| C2 | Create an account-owned API token: Workers Editor scoped to `ninjatronics-v2-production` only, the same token type as staging (deployment.md §3.1), 90-day expiry | No zone, DNS, or Access permissions |
| C3 | Re-check the staging token (D17): `ninjatronics-v2` only | If it covers more, replace it before G2 |
| C4 | **No** Access application for `ninjatronics.io` or the production Worker | Production is public by design; D6 confirms |
| C5 | At cutover only (§5 step 2): Custom Domain `ninjatronics.io` on `ninjatronics-v2-production` | Already part of the cutover approval |

Nothing changes on the legacy Worker, DNS, mail, or the staging Worker's
domains and Access application.

### 9.5 GitHub changes (each needs approval)

**G1. Create the `production` environment** with a required reviewer,
admins not allowed to bypass, and deployments from `main` only:

```bash
R=GMakeziG/ninjatronics-v2
OWNER_ID=$(gh api users/GMakeziG --jq .id)
gh api -X PUT repos/$R/environments/production --input - <<JSON
{
  "reviewers": [ { "type": "User", "id": $OWNER_ID } ],
  "prevent_self_review": false,
  "can_admins_bypass": false,
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
JSON
gh api -X POST repos/$R/environments/production/deployment-branch-policies -f name=main -f type=branch
```

`prevent_self_review` stays `false` because you're the only reviewer; with
`true`, nobody could approve a run you started.

**G2. Production secrets**, entered interactively so they don't land in the
shell history:
```bash
gh secret set CLOUDFLARE_API_TOKEN  --env production --repo $R   # the C2 token
gh secret set CLOUDFLARE_ACCOUNT_ID --env production --repo $R
```
Don't add repository-level Cloudflare secrets: they'd be visible to every
job, both environments included.

**G3. Production URL variable, set at cutover** (after §5 step 2 is Active):
```bash
gh variable set PRODUCTION_URL --env production --repo $R --body https://ninjatronics.io
```
While it's unset, "Deploy production" skips the public smoke test, because
the production Worker has no public URL yet.

**Verify G1–G3** (read-only):
```bash
gh api repos/$R/environments/production --jq '{reviewers: [.protection_rules[]?.reviewers[]?.reviewer.login], admins_bypass: .can_admins_bypass, policy: .deployment_branch_policy}'
gh api repos/$R/environments/production/deployment-branch-policies --jq '[.branch_policies[].name]'   # ["main"]
gh secret list --env production --repo $R      # names only
gh secret list --repo $R                       # no repository-level Cloudflare secrets
```

### 9.6 Repository changes (separate pull request, after approval)

| # | File | Change |
|---|---|---|
| R1 | `wrangler.production.jsonc` (new) | Same assets settings as `wrangler.jsonc`; `name: "ninjatronics-v2-production"`, `workers_dev: false`, `preview_urls: false`, no routes, no custom domains, no `env` sections, no `account_id` |
| R2 | `.github/workflows/deploy-production.yml` (new) | Manual dispatch from `main` only; type-to-confirm `ninjatronics-v2-production`; `environment: production`; `concurrency: deploy-production`. Build and verify **without credentials**, validate R1, then the **promotion gate** (a successful "Deploy staging" run for this SHA, through the GitHub API with `actions: read`), dry run, deploy with `--config wrangler.production.jsonc`, verify through the per-Worker API that workers.dev and Preview URLs are **off**, and if `PRODUCTION_URL` is set run `npm run smoke -- "$PRODUCTION_URL"`. **No automatic rollback or containment**: a failed check fails the run and prints the rollback steps (§8.2) for a person to decide |
| R3 | `.github/workflows/deploy-staging.yml` | One new step before the deploy: with the staging token, GET `ninjatronics-v2-production` through the per-Worker API; fail the job if the response is a success. The existing exact-name check keeps staging on `ninjatronics-v2` |
| R4 | `docs/deployment.md` | Describe both workflows, both tokens, token rotation for each |

**Separation checks to run once, after C1–C3, G1–G2, and R1–R4** (record
the results privately):
1. "Deploy staging" passes, including R3. That proves the staging token
   can't reach the production Worker.
2. "Deploy production" for a commit **without** a successful staging run
   fails at the promotion gate, before any credential is used.
3. "Deploy production" for the commit staging just deployed passes; the
   settings check reports workers.dev off and Preview URLs off (D19, D20).
4. `curl -sI https://ninjatronics.io/ | grep -i etag` still shows the legacy
   ETag: nothing so far touches production.

**To confirm when R3 first runs:** the exact status Cloudflare returns for a
Worker outside the token's scope (403 or 404) hasn't been observed. R3
therefore treats any non-success as the expected outcome and fails only on
a success.
R3 proves the separation only once C1 exists (before that, the lookup fails
for every token), so check 1 counts only when run after C1.
