// Deployment-target validation for the Wrangler configs
// (docs/production-cutover-runbook.md §9.3).
//
//   node scripts/release/wrangler-target.ts --config wrangler.production.jsonc \
//        --name ninjatronics-v2-production --workers-dev false
//
// Fails unless the config can only upload static assets to the named Worker:
// no routes, no custom domains (both are `routes` entries in Wrangler), no
// env sections, no cron triggers, no bindings or vars, no account_id, and
// workers_dev / preview_urls set EXPLICITLY (Wrangler 4.153.0 turns
// workers.dev on by default when a config has no routes).
// Also fails if .wrangler/deploy/config.json exists: Wrangler can follow that
// file to a different config (the workflows pass --config, which ignores it,
// but its presence means something generated a deploy redirect).
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { unstable_readConfig, experimental_readRawConfig } from "wrangler";

export interface TargetExpectation {
  name: string;
  workersDev: boolean;
}

const BINDING_LISTS = ["kv_namespaces", "r2_buckets", "d1_databases", "services", "analytics_engine_datasets",
  "vectorize", "hyperdrive", "dispatch_namespaces", "workflows", "send_email", "mtls_certificates",
  "secrets_store_secrets", "pipelines", "tail_consumers", "containers"];

export function validateTarget(c: any, raw: any, want: TargetExpectation): string[] {
  const errors: string[] = [];
  if (c.name !== want.name) errors.push(`name is "${c.name}", expected "${want.name}"`);
  const routes = [...(c.routes ?? []), ...(c.route ? [c.route] : [])];
  if (routes.some((r: any) => typeof r === "object" && r?.custom_domain)) errors.push("custom domains are configured (route entry with custom_domain: true)");
  else if (routes.length > 0) errors.push("routes are configured");
  if ("routes" in raw || "route" in raw) errors.push("the config must not mention routes at all");
  if (Object.keys(raw.env ?? {}).length > 0) errors.push("environment sections are not allowed (they can define routes or custom domains)");
  if (raw.workers_dev !== want.workersDev) errors.push(`workers_dev must be set explicitly to ${want.workersDev} (found ${raw.workers_dev})`);
  if (raw.preview_urls !== false) errors.push(`preview_urls must be set explicitly to false (found ${raw.preview_urls})`);
  if ((c.triggers?.crons ?? []).length > 0) errors.push("cron triggers are configured");
  if (c.main) errors.push("a Worker script is configured; expected static assets only");
  if (c.assets?.directory !== "./dist") errors.push(`assets.directory is "${c.assets?.directory}", expected "./dist"`);
  if (c.account_id) errors.push("account_id must not be committed; it comes from CLOUDFLARE_ACCOUNT_ID");
  for (const k of BINDING_LISTS) if ((c[k] ?? []).length > 0) errors.push(`unexpected binding: ${k}`);
  if ((c.durable_objects?.bindings ?? []).length > 0) errors.push("unexpected Durable Object bindings");
  if ((c.queues?.producers ?? []).length + (c.queues?.consumers ?? []).length > 0) errors.push("unexpected queues");
  if (Object.keys(c.unsafe ?? {}).length > 0) errors.push("unexpected unsafe configuration");
  for (const k of ["ai", "browser", "images", "version_metadata"]) if (c[k]) errors.push(`unexpected binding: ${k}`);
  if (Object.keys(c.vars ?? {}).length > 0) errors.push("unexpected runtime vars");
  return errors;
}

export function readTarget(config: string) {
  return {
    config: unstable_readConfig({ config }),
    raw: experimental_readRawConfig({ config }).rawConfig,
  };
}

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  return i > 0 ? (process.argv[i + 1] ?? "") : "";
}

// Run as a script (not when imported by tests). Explicit path comparison
// instead of import.meta.main, which older Node versions lack: there it would
// be undefined and the check would silently not run.
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const config = arg("--config");
  const workersDev = arg("--workers-dev");
  const errors: string[] = [];
  if (!config) errors.push("--config is required");
  if (workersDev !== "true" && workersDev !== "false") errors.push("--workers-dev must be true or false");
  if (!errors.length) {
    const t = readTarget(config);
    errors.push(...validateTarget(t.config, t.raw, { name: arg("--name"), workersDev: workersDev === "true" }));
    if (existsSync(".wrangler/deploy/config.json")) errors.push(".wrangler/deploy/config.json exists (a Wrangler deploy redirect); remove it and find out what created it");
    for (const f of ["dist/index.html", "dist/404.html", "dist/_headers", "dist/_redirects"])
      if (!existsSync(f)) errors.push(`missing build output: ${f}`);
  }
  for (const e of errors) console.log(`::error::${e}`);
  if (errors.length) process.exit(1);
  console.log(`OK: ${config} → Worker "${arg("--name")}", static assets only, workers_dev=${workersDev}, preview_urls=false, no routes, no custom domains, no bindings`);
}
