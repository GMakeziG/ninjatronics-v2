// Tests for the deployment guards. No network: every API is a stub.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTokenScope } from "./token-scope.ts";
import { checkStagingPromotion, STAGING } from "./staging-promotion.ts";
import { readTarget, validateTarget } from "./wrangler-target.ts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "test-token-value";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ---- token-scope ------------------------------------------------------------

type Route = (url: string) => Response | Promise<Response>;
const cfStub = (own: Route, other: Route): typeof fetch => (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/workers/workers/ninjatronics-v2")) return own(url);
  if (url.endsWith("/workers/workers/ninjatronics-v2-production")) return other(url);
  throw new Error(`unexpected URL ${url}`);
}) as typeof fetch;

const ownOk: Route = () => json(200, { success: true, result: { name: "ninjatronics-v2" }, errors: [] });
const denied: Route = () => json(403, { success: false, errors: [{ code: 10000, message: "Forbidden" }] });
const scope = (fetchImpl: typeof fetch, extra: Partial<Parameters<typeof checkTokenScope>[0]> = {}) =>
  checkTokenScope({ fetch: fetchImpl, account: ACCOUNT, token: TOKEN, allowed: "ninjatronics-v2", denied: "ninjatronics-v2-production", timeoutMs: 200, ...extra });

test("token scope: passes on own-Worker 200 and explicit 403/10000 for the other", async () => {
  const r = await scope(cfStub(ownOk, denied));
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.ok(!r.lines.join("\n").includes(TOKEN) && !r.lines.join("\n").includes(ACCOUNT), "never prints the token or account ID");
});

for (const [label, other, reason] of [
  ["the other Worker is readable (200)", () => json(200, { success: true, result: { name: "ninjatronics-v2-production" } }), /CAN reach/],
  ["404 is not a denial", () => json(404, { success: false, errors: [{ code: 10007, message: "not found" }] }), /expected HTTP 403, got 404/],
  ["401 is not a denial", () => json(401, { success: false, errors: [{ code: 10001, message: "Unable to authenticate" }] }), /expected HTTP 403, got 401/],
  ["403 without code 10000", () => json(403, { success: false, errors: [{ code: 9109, message: "Invalid access token" }] }), /without the expected denial/],
  ["403 with success true", () => json(403, { success: true, errors: [{ code: 10000 }] }), /CAN reach/],
  ["5xx", () => json(503, { success: false, errors: [] }), /expected HTTP 403, got 503/],
  ["non-JSON body", () => new Response("<html>gateway</html>", { status: 403 }), /non-JSON/],
  ["network error", () => { throw new TypeError("fetch failed"); }, /request failed/],
] as [string, Route, RegExp][]) {
  test(`token scope: fails when ${label}`, async () => {
    const r = await scope(cfStub(ownOk, other));
    assert.equal(r.ok, false);
    assert.match(r.lines.at(-1)!, reason);
  });
}

test("token scope: fails when the token can't read its own Worker (invalid token)", async () => {
  const r = await scope(cfStub(() => json(403, { success: false, errors: [{ code: 10000 }] }), denied));
  assert.equal(r.ok, false);
  assert.match(r.lines.at(-1)!, /can't read its own Worker/);
});

test("token scope: fails on a timeout", async () => {
  const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/ninjatronics-v2")) return ownOk(url);
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
  }) as typeof fetch;
  const r = await scope(slow);
  assert.equal(r.ok, false);
  assert.match(r.lines.at(-1)!, /request failed \(TimeoutError/);
});

test("token scope: rejects bad inputs before any request", async () => {
  const never = (() => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
  assert.match((await scope(never, { token: "" })).lines[0], /TOKEN is empty/);
  assert.match((await scope(never, { account: "abc" })).lines[0], /ACCOUNT_ID/);
  assert.match((await scope(never, { denied: "ninjatronics-v2" })).lines[0], /must be different/);
});

// ---- token-scope: the observed 403 and its diagnostics ----------------------
// Run 42518058588 (2026-11-08): the staging token got HTTP 403 with success
// false and no error codes on ninjatronics-v2-production. Until the full body
// is known, that is NOT accepted as a denial; the guard must fail and log a
// redacted summary of the response.

const html = (status: number, headers: Record<string, string> = {}) =>
  new Response("<html><body>blocked</body></html>", { status, headers: { "content-type": "text/html", ...headers } });

for (const [label, other, reason] of [
  ["403 with an empty errors array (observed 2026-11-08)", () => json(403, { success: false, errors: [], messages: [], result: null }), /without the expected denial/],
  ["403 whose errors have no code", () => json(403, { success: false, errors: [{ message: "Forbidden" }] }), /without the expected denial/],
  ["403 with code 10000 as a string", () => json(403, { success: false, errors: [{ code: "10000" }] }), /without the expected denial/],
  ["403 with errors not an array", () => json(403, { success: false, errors: { code: 10000 } }), /without the expected denial/],
  ["403 with null error entries", () => json(403, { success: false, errors: [null, 10000] }), /without the expected denial/],
  ["403 without a success field", () => json(403, { errors: [{ code: 10000 }] }), /without the expected denial/],
  ["403 with a JSON null body", () => json(403, null), /without the expected denial/],
  ["403 HTML (WAF challenge)", () => html(403, { "cf-mitigated": "challenge" }), /non-JSON/],
  ["400 authentication failure (9106)", () => json(400, { success: false, errors: [{ code: 9106, message: "Authentication failed (status: 400)" }] }), /expected HTTP 403, got 400/],
  ["401 authentication failure (10001)", () => json(401, { success: false, errors: [{ code: 10001, message: "Unable to authenticate request" }] }), /expected HTTP 403, got 401 \(authentication failed/],
  ["429 rate limit", () => json(429, { success: false, errors: [{ code: 10000, message: "rate limited" }] }), /expected HTTP 403, got 429/],
  ["302 redirect", () => new Response(null, { status: 302, headers: { location: "https://example.com/" } }), /non-JSON|expected HTTP 403, got 302/],
  ["an empty 403 body", () => new Response("", { status: 403 }), /non-JSON/],
] as [string, Route, RegExp][]) {
  test(`token scope: fails on ${label}, with a diagnostic line`, async () => {
    const r = await scope(cfStub(ownOk, other));
    assert.equal(r.ok, false, r.lines.join("\n"));
    assert.match(r.lines.at(-1)!, reason);
    assert.match(r.lines.at(-2)!, /^INFO response: \{"status":\d+/);
  });
}

test("token scope: the diagnostic for the observed body is structural only", async () => {
  const r = await scope(cfStub(ownOk, () => json(403, { success: false, errors: [], messages: [], result: null })));
  const info = JSON.parse(r.lines.at(-2)!.replace(/^INFO response: /, ""));
  assert.deepEqual(info, {
    status: 403, mediaType: "application/json", cfMitigated: false, wwwAuthenticate: false,
    fields: ["success", "errors", "messages", "result"], otherFields: 0, success: false,
    errors: { count: 0, codes: [], nonObjectEntries: 0, withMessage: 0, withDocumentationUrl: 0 },
    messages: { count: 0, codes: [], nonObjectEntries: 0, withMessage: 0, withDocumentationUrl: 0 },
    result: null,
  });
});

// Sensitive values planted everywhere a response can carry text.
const PLANTED = [TOKEN, ACCOUNT, "f".repeat(32), "SECRET-MESSAGE-TEXT", "https://leak.example/doc",
  "secret-field-name", "worker-setting-value", "planted-header-value", "SECRET-HTML-BODY", "SECRET-CODE-STRING"];
const plantedJson = (status: number) => json(status, {
  success: "SECRET-CODE-STRING",
  errors: [{ code: 1234, message: `SECRET-MESSAGE-TEXT ${TOKEN} ${ACCOUNT}`, documentation_url: "https://leak.example/doc" }, { code: "SECRET-CODE-STRING" }, "SECRET-MESSAGE-TEXT"],
  messages: [{ code: 1, message: TOKEN }],
  result: { id: "f".repeat(32), name: "ninjatronics-v2-production", setting: "worker-setting-value" },
  "secret-field-name": "worker-setting-value",
});
const plantedHeaders = { "cf-mitigated": "planted-header-value", "www-authenticate": `Bearer realm="planted-header-value"`, server: "planted-header-value", "set-cookie": "planted-header-value" };

for (const [label, other] of [
  ["a 403 JSON body", () => plantedJson(403)],
  ["a 401 JSON body", () => plantedJson(401)],
  ["a 500 JSON body", () => plantedJson(500)],
  ["a 403 HTML body", () => new Response(`<html>SECRET-HTML-BODY ${TOKEN} ${ACCOUNT}</html>`, { status: 403, headers: { "content-type": "text/html; planted-header-value", ...plantedHeaders } })],
  ["a 403 JSON body with odd headers", () => new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "SECRET-MESSAGE-TEXT" }] }), { status: 403, headers: { "content-type": "application/planted-header-value", ...plantedHeaders } })],
] as [string, Route][]) {
  test(`token scope: no sensitive value from ${label} reaches the output`, async () => {
    const r = await scope(cfStub(ownOk, other));
    const out = r.lines.join("\n");
    assert.match(out, /INFO response: /);
    for (const p of PLANTED) assert.ok(!out.includes(p), `leaked "${p}":\n${out}`);
  });
}

test("token scope: a network error prints its type, not its message", async () => {
  const r = await scope(cfStub(ownOk, () => { throw new TypeError(`fetch failed for /accounts/${ACCOUNT}/ with ${TOKEN}`); }));
  const out = r.lines.join("\n");
  assert.match(r.lines.at(-1)!, /request failed \(TypeError\)/);
  assert.ok(!out.includes(ACCOUNT) && !out.includes(TOKEN), out);
});

test("token scope: the planted body reports only counts, numeric codes, and presence flags", async () => {
  const r = await scope(cfStub(ownOk, () => plantedJson(403)));
  const info = JSON.parse(r.lines.at(-2)!.replace(/^INFO response: /, ""));
  assert.equal(info.success, "not-a-boolean");
  assert.deepEqual(info.errors, { count: 3, codes: [1234], nonObjectEntries: 1, withMessage: 1, withDocumentationUrl: 1 });
  assert.equal(info.otherFields, 1);
  assert.equal(info.result, "object");
});

test("token scope: only allow-listed media types and header presence are reported", async () => {
  const r = await scope(cfStub(ownOk, () => new Response("<html></html>", { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cf-mitigated": "challenge" } })));
  const info = JSON.parse(r.lines.at(-2)!.replace(/^INFO response: /, ""));
  assert.equal(info.mediaType, "text/html");
  assert.equal(info.cfMitigated, true);
  assert.equal(info.wwwAuthenticate, false);
  const odd = await scope(cfStub(ownOk, () => new Response("{}", { status: 403, headers: { "content-type": "application/x-odd" } })));
  assert.equal(JSON.parse(odd.lines.at(-2)!.replace(/^INFO response: /, "")).mediaType, "other");
});

test("token scope: the accepted denial is logged too, unchanged rules", async () => {
  const r = await scope(cfStub(ownOk, () => json(403, { success: false, errors: [{ code: 10000, message: "Forbidden", documentation_url: "https://developers.cloudflare.com/api/" }], messages: [], result: null })));
  assert.equal(r.ok, true, r.lines.join("\n"));
  const out = r.lines.join("\n");
  assert.match(out, /INFO response: .*"codes":\[10000\],"nonObjectEntries":0,"withMessage":1,"withDocumentationUrl":1/);
  assert.ok(!out.includes("Forbidden") && !out.includes("developers.cloudflare.com"), "no message text or URL");
});

test("token scope: an own-Worker failure is logged, a success on the denied Worker is not", async () => {
  const own = await scope(cfStub(() => json(401, { success: false, errors: [{ code: 10001 }] }), denied));
  assert.match(own.lines.at(-2)!, /^INFO response: \{"status":401/);
  const leak = await scope(cfStub(ownOk, () => json(200, { success: true, result: { name: "ninjatronics-v2-production", setting: "worker-setting-value" } })));
  assert.match(leak.lines.at(-1)!, /CAN reach/);
  assert.ok(!leak.lines.join("\n").includes("INFO"), "no Worker details are logged");
});

// ---- staging-promotion ------------------------------------------------------

const REPO = "GMakeziG/ninjatronics-v2";
const SHA = "a".repeat(40);

function ghStub(over: { run?: object; steps?: Record<string, string>; jobConclusion?: string; statuses?: string[]; runsStatus?: number; network?: boolean } = {}): typeof fetch {
  const steps = { ...Object.fromEntries(STAGING.requiredSteps.map((s) => [s, "success"])), [STAGING.skippedSteps[0]]: "skipped", ...over.steps };
  return (async (input: RequestInfo | URL) => {
    if (over.network) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    if (url.pathname.endsWith("/actions/workflows/deploy-staging.yml/runs")) {
      if (over.runsStatus) return json(over.runsStatus, { message: "error" });
      return json(200, { workflow_runs: [{ id: 1, path: STAGING.workflowPath, event: "workflow_dispatch", head_branch: "main", head_sha: SHA, conclusion: "success", repository: { full_name: REPO }, head_repository: { full_name: REPO }, ...over.run }] });
    }
    if (url.pathname.endsWith("/actions/runs/1/jobs")) {
      return json(200, { jobs: [{ name: STAGING.jobName, conclusion: over.jobConclusion ?? "success", steps: Object.entries(steps).filter(([, c]) => c !== "missing").map(([name, conclusion]) => ({ name, conclusion })) }] });
    }
    if (url.pathname.endsWith("/deployments")) return json(200, [{ id: 9, sha: SHA, environment: "staging" }]);
    if (url.pathname.endsWith("/deployments/9/statuses")) return json(200, (over.statuses ?? ["success", "in_progress", "queued", "waiting"]).map((state) => ({ state })));
    throw new Error(`unexpected URL ${url}`);
  }) as typeof fetch;
}
const promote = (f: typeof fetch, sha = SHA) => checkStagingPromotion({ fetch: f, token: "gh-test", repo: REPO, sha, timeoutMs: 200 });

test("promotion: passes for an approved, verified staging run of the same commit", async () => {
  const r = await promote(ghStub());
  assert.equal(r.ok, true, r.lines.join("\n"));
});

for (const [label, stub, reason] of [
  ["the run came from a fork", ghStub({ run: { head_repository: { full_name: "someone/fork" } } }), /no successful "Deploy staging" run/],
  ["the run used another workflow file", ghStub({ run: { path: ".github/workflows/other.yml" } }), /no successful "Deploy staging" run/],
  ["the run was not on main", ghStub({ run: { head_branch: "feature" } }), /no successful "Deploy staging" run/],
  ["the run is for another commit", ghStub({ run: { head_sha: "b".repeat(40) } }), /no successful "Deploy staging" run/],
  ["the token-scope step is missing (older workflow)", ghStub({ steps: { [STAGING.requiredSteps[1]]: "missing" } }), /is missing/],
  ["the Access verification was skipped", ghStub({ steps: { [STAGING.requiredSteps[4]]: "skipped" } }), /is skipped/],
  ["containment ran", ghStub({ steps: { [STAGING.skippedSteps[0]]: "success" } }), /expected skipped/],
  ["the job failed", ghStub({ jobConclusion: "failure" }), /job concluded failure/],
  ["the deployment was never approved (no waiting)", ghStub({ statuses: ["success", "in_progress"] }), /no approved, successful/],
  ["the deployment's newest status is failure", ghStub({ statuses: ["failure", "success", "waiting"] }), /no approved, successful/],
  ["the GitHub API errors", ghStub({ runsStatus: 500 }), /HTTP 500/],
  ["the network fails", ghStub({ network: true }), /request failed/],
] as [string, typeof fetch, RegExp][]) {
  test(`promotion: fails when ${label}`, async () => {
    const r = await promote(stub);
    assert.equal(r.ok, false);
    assert.match(r.lines.at(-1)!, reason);
  });
}

test("promotion: rejects a malformed SHA before any request", async () => {
  const r = await promote((() => { throw new Error("must not fetch"); }) as unknown as typeof fetch, "abc");
  assert.match(r.lines[0], /invalid commit SHA/);
});

// ---- wrangler-target ----------------------------------------------------------

test("wrangler: the staging config targets only ninjatronics-v2 (workers.dev on)", () => {
  const t = readTarget("wrangler.jsonc");
  assert.deepEqual(validateTarget(t.config, t.raw, { name: "ninjatronics-v2", workersDev: true }), []);
});

test("wrangler: the production config targets only ninjatronics-v2-production (workers.dev off)", () => {
  const t = readTarget("wrangler.production.jsonc");
  assert.deepEqual(validateTarget(t.config, t.raw, { name: "ninjatronics-v2-production", workersDev: false }), []);
});

test("wrangler: the two configs never share a Worker and serve the same assets", () => {
  const s = readTarget("wrangler.jsonc").config;
  const p = readTarget("wrangler.production.jsonc").config;
  assert.notEqual(s.name, p.name);
  assert.equal(s.compatibility_date, p.compatibility_date);
  assert.deepEqual(
    { d: s.assets?.directory, n: s.assets?.not_found_handling, h: s.assets?.html_handling },
    { d: p.assets?.directory, n: p.assets?.not_found_handling, h: p.assets?.html_handling });
});

test("wrangler: any publishing target in the production config is rejected", () => {
  const base = readTarget("wrangler.production.jsonc");
  const want = { name: "ninjatronics-v2-production", workersDev: false };
  const variant = (raw: object, config: object = raw) =>
    validateTarget({ ...base.config, ...config }, { ...base.raw, ...raw }, want);
  assert.match(variant({ routes: [{ pattern: "ninjatronics.io", custom_domain: true }] }).join(), /custom domains/);
  assert.match(variant({ routes: ["ninjatronics.io/*"] }).join(), /routes are configured/);
  assert.match(variant({ route: "ninjatronics.io/*" }).join(), /routes/);
  assert.match(variant({ workers_dev: true }).join(), /workers_dev must be set explicitly to false/);
  assert.match(variant({ workers_dev: undefined }).join(), /workers_dev must be set explicitly/);
  assert.match(variant({ preview_urls: true }).join(), /preview_urls/);
  assert.match(variant({ preview_urls: undefined }).join(), /preview_urls/);
  assert.match(variant({ env: { staging: {} } }).join(), /environment sections/);
  assert.match(variant({ triggers: { crons: ["* * * * *"] } }).join(), /cron/);
  assert.match(variant({ name: "ninjatronics-v2" }).join(), /expected "ninjatronics-v2-production"/);
  assert.match(variant({ account_id: "x" }).join(), /account_id/);
});

// ---- CLIs fail closed --------------------------------------------------------
// Run each guard as a process with no credentials: it must exit non-zero.
// Catches an entry-point check that silently skips the guard (exit 0).
import { spawnSync } from "node:child_process";

for (const [script, args] of [
  ["scripts/release/token-scope.ts", ["--allowed", "ninjatronics-v2", "--denied", "ninjatronics-v2-production"]],
  ["scripts/release/staging-promotion.ts", []],
  ["scripts/release/wrangler-target.ts", []],
] as [string, string[]][]) {
  test(`CLI ${script} exits non-zero without credentials or arguments`, () => {
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
    const r = spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8", timeout: 30_000 });
    assert.notEqual(r.status, 0, `${script} exited ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /::error::/);
  });
}
