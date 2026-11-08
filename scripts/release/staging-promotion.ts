// Production promotion gate (docs/production-cutover-runbook.md §9.3): a
// commit may be deployed to production only if the approved staging workflow
// deployed and verified that exact commit.
//
//   node scripts/release/staging-promotion.ts
//   env: GH_TOKEN (actions: read, deployments: read), GITHUB_REPOSITORY, GITHUB_SHA
//
// Passes only if one "Deploy staging" run satisfies ALL of:
//   - workflow file .github/workflows/deploy-staging.yml, event
//     workflow_dispatch, branch main, this repository (not a fork), the exact
//     commit SHA, conclusion success;
//   - its latest attempt's job "Deploy ninjatronics-v2 (staging)" succeeded,
//     with every required step "success" (deploy, both post-deploy
//     verifications, the token-scope check) and containment "skipped";
// and a GitHub deployment to the "staging" environment exists for that SHA
// whose newest status is "success" and whose history includes "waiting",
// which GitHub records only when the environment's required reviewer had to
// approve it.
// Any API error, timeout, or unexpected shape fails the gate.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const API = "https://api.github.com";
export const STAGING = {
  workflowPath: ".github/workflows/deploy-staging.yml",
  jobName: "Deploy ninjatronics-v2 (staging)",
  environment: "staging",
  requiredSteps: [
    "Validate deployment target",
    "Verify the staging token is scoped to ninjatronics-v2 only",
    "Deploy to ninjatronics-v2",
    "Verify Worker settings (workers.dev on, preview URLs off)",
    "Verify Cloudflare Access denies anonymous requests",
  ],
  skippedSteps: ["Contain exposure (disable workers.dev on ninjatronics-v2)"],
};

export interface PromotionOptions {
  fetch: typeof fetch;
  token: string;
  repo: string;
  sha: string;
  timeoutMs?: number;
}

export interface CheckResult {
  ok: boolean;
  lines: string[];
}

class GateError extends Error {}

async function gh(o: PromotionOptions, path: string): Promise<any> {
  let res: Response;
  try {
    res = await o.fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${o.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
    });
  } catch (e) {
    throw new GateError(`GitHub API request failed (${(e as Error).name}): ${path.split("?")[0]}`);
  }
  if (res.status !== 200) throw new GateError(`GitHub API HTTP ${res.status}: ${path.split("?")[0]}`);
  try {
    return await res.json();
  } catch {
    throw new GateError(`GitHub API returned a non-JSON body: ${path.split("?")[0]}`);
  }
}

export async function checkStagingPromotion(o: PromotionOptions): Promise<CheckResult> {
  const lines: string[] = [];
  const fail = (m: string): CheckResult => ({ ok: false, lines: [...lines, `FAIL ${m}`] });
  if (!o.token) return fail("GH_TOKEN is empty");
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(o.repo)) return fail(`invalid repository "${o.repo}"`);
  if (!/^[0-9a-f]{40}$/.test(o.sha)) return fail(`invalid commit SHA "${o.sha}"`);
  const short = o.sha.slice(0, 7);

  try {
    // 1. A successful, verified staging run for this exact commit.
    const runs = await gh(o, `/repos/${o.repo}/actions/workflows/deploy-staging.yml/runs?head_sha=${o.sha}&event=workflow_dispatch&branch=main&status=success&per_page=20`);
    if (!Array.isArray(runs?.workflow_runs)) return fail("unexpected response listing staging runs");
    const candidates = runs.workflow_runs.filter((r: any) =>
      r.path === STAGING.workflowPath && r.event === "workflow_dispatch" && r.head_branch === "main" &&
      r.head_sha === o.sha && r.conclusion === "success" &&
      r.repository?.full_name === o.repo && r.head_repository?.full_name === o.repo);
    if (candidates.length === 0) return fail(`no successful "Deploy staging" run from main for ${short}. Deploy and verify it on staging first`);

    const problems: string[] = [];
    let verifiedRun: number | undefined;
    for (const run of candidates) {
      const jobs = await gh(o, `/repos/${o.repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=50`);
      const job = (jobs?.jobs ?? []).find((j: any) => j.name === STAGING.jobName);
      if (!job) { problems.push(`run ${run.id}: job "${STAGING.jobName}" not found`); continue; }
      if (job.conclusion !== "success") { problems.push(`run ${run.id}: job concluded ${job.conclusion}`); continue; }
      const steps = new Map<string, string>((job.steps ?? []).map((s: any) => [s.name, s.conclusion]));
      const bad = [
        ...STAGING.requiredSteps.filter((s) => steps.get(s) !== "success").map((s) => `"${s}" is ${steps.get(s) ?? "missing"}`),
        ...STAGING.skippedSteps.filter((s) => steps.get(s) !== "skipped").map((s) => `"${s}" is ${steps.get(s) ?? "missing"} (expected skipped)`),
      ];
      if (bad.length) { problems.push(`run ${run.id}: ${bad.join("; ")}`); continue; }
      verifiedRun = run.id;
      break;
    }
    if (verifiedRun === undefined) return fail(`no staging run for ${short} passed every check: ${problems.join(" | ")}`);
    lines.push(`OK   staging run ${verifiedRun} deployed and verified ${short} (all required steps success, containment skipped)`);

    // 2. The staging environment approved and completed a deployment of it.
    const deployments = await gh(o, `/repos/${o.repo}/deployments?sha=${o.sha}&environment=${STAGING.environment}&per_page=20`);
    if (!Array.isArray(deployments)) return fail("unexpected response listing staging deployments");
    let approved = false;
    for (const d of deployments) {
      if (d.environment !== STAGING.environment || d.sha !== o.sha) continue;
      const statuses = await gh(o, `/repos/${o.repo}/deployments/${d.id}/statuses?per_page=100`);
      if (!Array.isArray(statuses) || statuses.length === 0) continue;
      const states = statuses.map((s: any) => s.state); // newest first
      if (states[0] === "success" && states.includes("waiting")) { approved = true; break; }
    }
    if (!approved) return fail(`no approved, successful "${STAGING.environment}" deployment for ${short} (needs newest status "success" after a "waiting" approval)`);
    lines.push(`OK   "${STAGING.environment}" deployment for ${short} was approved (waiting → success)`);
  } catch (e) {
    if (e instanceof GateError) return fail(e.message);
    return fail(`unexpected error: ${(e as Error).message}`);
  }
  return { ok: true, lines };
}

// Run as a script (not when imported by tests). Explicit path comparison
// instead of import.meta.main, which older Node versions lack: there it would
// be undefined and the check would silently not run.
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = await checkStagingPromotion({
    fetch,
    token: process.env.GH_TOKEN ?? "",
    repo: process.env.GITHUB_REPOSITORY ?? "",
    sha: process.env.GITHUB_SHA ?? "",
  });
  for (const l of result.lines) console.log(l.startsWith("FAIL") ? `::error::${l}` : l);
  console.log(result.ok ? "Promotion gate passed." : "Promotion gate FAILED: this commit can't be deployed to production.");
  process.exit(result.ok ? 0 : 1);
}
