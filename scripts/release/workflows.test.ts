// Static safety checks for the GitHub Actions workflows that touch the
// production environment. Text-based on purpose (no YAML dependency): each
// assertion names the exact property it protects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const DIR = ".github/workflows";
const read = (f: string) => readFileSync(`${DIR}/${f}`, "utf8");
const DIAG = "diagnose-production-token.yml";
const diag = read(DIAG);
const code = (s: string) => s.split("\n").filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, "")).join("\n");
const diagCode = code(diag);
const steps = diagCode.split(/\n {6}- name: /).slice(1).map((s) => ({ name: s.split("\n")[0].trim(), body: s }));

// ---- diagnostic workflow ---------------------------------------------------------

test("diagnostic: manual dispatch only, with a typed confirmation", () => {
  assert.match(diagCode, /^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}confirm:\n/m);
  for (const t of ["push:", "pull_request", "workflow_call", "workflow_run", "schedule:", "repository_dispatch", "issue_comment"]) {
    assert.ok(!diagCode.includes(t), `unexpected trigger ${t}`);
  }
  assert.ok(diagCode.includes("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.confirm == 'diagnose-production-token'"));
});

test("diagnostic: production environment, approval-gated, no deployment record", () => {
  assert.match(diagCode, /\n {4}environment:\n {6}name: production\n {6}deployment: false\n/);
});

test("diagnostic: shares the production deployment concurrency group, never cancels", () => {
  assert.match(diagCode, /\nconcurrency:\n {2}group: deploy-production\n {2}cancel-in-progress: false\n/);
  assert.match(code(read("deploy-production.yml")), /\nconcurrency:\n {2}group: deploy-production\n/);
});

test("diagnostic: token permissions are contents: read only", () => {
  assert.match(diagCode, /\npermissions:\n {2}contents: read\n\n/);
  assert.equal((diagCode.match(/permissions:/g) ?? []).length, 1, "no job-level permission overrides");
  assert.ok(!/:\s*write\b/.test(diagCode));
});

test("diagnostic: no deploy, Wrangler, write request, or configuration change", () => {
  for (const bad of [/wrangler/i, /\bdeploy\b(?!-production)/i, /\bcurl\b/, /\bwget\b/, /\bgh\s/, /-X\s*(POST|PUT|PATCH|DELETE)/,
    /method:\s*["']?(POST|PUT|PATCH|DELETE)/i, /npm run (build|smoke)/, /\bsudo\b/, /GITHUB_TOKEN|github\.token/]) {
    assert.ok(!bad.test(diagCode), `forbidden: ${bad}`);
  }
  assert.deepEqual(steps.map((s) => s.name), [
    "Check out",
    "Set up Node.js (version from .nvmrc)",
    "Install dependencies (no install scripts)",
    "Check the production token is scoped to ninjatronics-v2-production only",
  ]);
});

test("diagnostic: production secrets only in the token-check step", () => {
  const withSecrets = steps.filter((s) => s.body.includes("secrets."));
  assert.deepEqual(withSecrets.map((s) => s.name), ["Check the production token is scoped to ninjatronics-v2-production only"]);
  const head = diagCode.slice(0, diagCode.indexOf("\n    steps:"));
  assert.ok(!head.includes("secrets."), "no workflow- or job-level secrets");
  assert.deepEqual([...diagCode.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort(), ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
});

test("diagnostic: the token step runs exactly the existing read-only check, production -> staging", () => {
  const s = steps.at(-1)!.body;
  assert.match(s, /run: node scripts\/release\/token-scope\.ts --allowed "\$EXPECTED_WORKER" --denied ninjatronics-v2\n/);
  assert.match(diagCode, /\n {6}EXPECTED_WORKER: ninjatronics-v2-production\n/);
  assert.equal((diagCode.match(/run:/g) ?? []).length, 2, "only npm ci and the token check run commands");
});

test("diagnostic: dependencies install without scripts, without npm cache, before any secret", () => {
  const install = steps.find((s) => s.name.startsWith("Install dependencies"))!;
  assert.match(install.body, /run: npm ci --ignore-scripts\n/);
  assert.ok(!install.body.includes("secrets."));
  assert.ok(!/\bcache:/.test(diagCode), "no actions/setup-node cache in a job with production secrets");
});

test("diagnostic: checkout does not persist credentials", () => {
  assert.match(steps[0].body, /uses: actions\/checkout@[0-9a-f]{40}\n {8}with:\n {10}persist-credentials: false/);
});

// ---- all workflows: third-party actions pinned ----------------------------------------

for (const f of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))) {
  test(`${f}: every action is pinned to a full commit SHA`, () => {
    const uses = [...code(read(f)).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/, `${f}: ${u}`);
  });
}

test("diagnostic: uses the same pinned actions as deploy-production.yml", () => {
  const pins = (s: string) => new Set([...code(s).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]));
  const prod = pins(read("deploy-production.yml"));
  for (const u of pins(diag)) assert.ok(prod.has(u), `${u} is not used by deploy-production.yml`);
});

// ---- isolation between the workflows ------------------------------------------------

test("no workflow can invoke the diagnostic (or be invoked by it)", () => {
  for (const f of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const c = code(read(f));
    assert.ok(!c.includes(DIAG) || f === DIAG, `${f} references ${DIAG}`);
    assert.ok(!/workflow_run:/.test(c), `${f} uses workflow_run`);
    assert.ok(!/uses:\s*\.\/\.github\/workflows\//.test(c), `${f} calls a reusable workflow`);
    assert.ok(!/gh workflow run|actions\/workflows\/.*dispatches/.test(c), `${f} dispatches workflows`);
  }
  assert.ok(!code(read("deploy-production.yml")).includes("Diagnose production token"));
});

test("deploy-production.yml is unchanged in its gates (still approval + main + confirmation + promotion gate)", () => {
  const p = code(read("deploy-production.yml"));
  assert.ok(p.includes("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.confirm_worker == 'ninjatronics-v2-production'"));
  assert.match(p, /\n {4}environment: production\n/);
  assert.match(p, /node scripts\/release\/staging-promotion\.ts/);
  assert.match(p, /node scripts\/release\/token-scope\.ts --allowed "\$EXPECTED_WORKER" --denied ninjatronics-v2\n/);
});
