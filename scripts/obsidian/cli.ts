// npm run import:check            preview (read-only)
// npm run import                  import approved articles (published, plus notes
//                                 marked importDraft: true, written as drafts)
// npm run import -- --prune       also delete imported articles whose note is no longer publishable
//                                 (asks you to type "prune"; --yes skips the prompt)
// Options: --vault <path>
//
// Vault path, first match wins:
//   1. --vault <path>
//   2. NINJATRONICS_VAULT environment variable
//   3. obsidian.local.json at the repo root: { "vault": "/path/to/vault" } (gitignored)
//
// This command never commits, pushes, or deploys.
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { applyPlan, planImport, type ImportPlan } from "./importer.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const contentDir = fileURLToPath(new URL("../../src/content/blog/", import.meta.url));

function parseArgs(argv: string[]) {
  const args = { check: false, prune: false, yes: false, vault: undefined as string | undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--prune") args.prune = true;
    else if (arg === "--yes") args.yes = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--vault") args.vault = argv[++i];
    else if (arg.startsWith("--vault=")) args.vault = arg.slice("--vault=".length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

async function vaultPath(flag: string | undefined): Promise<string> {
  if (flag) return flag;
  if (process.env.NINJATRONICS_VAULT) return process.env.NINJATRONICS_VAULT;
  try {
    const config = JSON.parse(await readFile(`${repoRoot}obsidian.local.json`, "utf8")) as { vault?: unknown };
    if (typeof config.vault === "string" && config.vault) return config.vault;
  } catch {
    // fall through
  }
  throw new Error(
    "No vault configured. Pass --vault <path>, set NINJATRONICS_VAULT, or create obsidian.local.json " +
      '(gitignored) at the repo root: { "vault": "/home/you/Obsidian/ninjatronics-v2" }',
  );
}

function printPlan(plan: ImportPlan, mode: string) {
  const out = console.log;
  out(`\nObsidian import: ${mode}`);
  out(`  vault:   ${plan.vaultDir}`);
  out(`  target:  src/content/blog/\n`);

  const byStatus = (s: string) => plan.articles.filter((a) => a.status === s);
  // Visibility label: imported drafts never reach production; a change in
  // either direction is called out so it can't slip through review.
  const visibility = (a: ImportPlan["articles"][number]) => {
    if (a.previousDraft !== undefined && a.previousDraft !== a.draft) return a.draft ? " [published → draft]" : " [draft → PUBLISHED]";
    return a.draft ? " [draft]" : "";
  };
  for (const a of byStatus("create")) out(`  + create     ${a.slug.padEnd(40)} ← ${a.source} (${a.files.size} file${a.files.size === 1 ? "" : "s"})${visibility(a)}`);
  for (const a of byStatus("update")) {
    const parts = [a.changed.length && `changed: ${a.changed.join(", ")}`, a.removed.length && `removed: ${a.removed.join(", ")}`, a.renamedFrom && `renamed from ${a.renamedFrom}`].filter(Boolean);
    out(`  ~ update     ${a.slug.padEnd(40)} ← ${a.source} (${parts.join("; ")})${visibility(a)}`);
  }
  const unchanged = byStatus("unchanged");
  if (unchanged.length) out(`  = unchanged  ${unchanged.map((a) => `${a.slug}${a.draft ? " [draft]" : ""}`).join(", ")}`);
  for (const d of plan.skippedDrafts) out(`  · draft      ${d} (draft: true, not imported; add importDraft: true to import it as a draft)`);
  if (plan.unmarkedCount) out(`  · ignored    ${plan.unmarkedCount} note(s) in articles/ without publish: true`);
  for (const s of plan.stale) out(`  ! stale      ${s.slug.padEnd(40)} ← ${s.source} (no longer publishable; kept unless you run --prune)`);
  if (!plan.articles.length && !plan.skippedDrafts.length && !plan.stale.length) out("  (nothing to import)");

  if (plan.warnings.length) {
    out(`\nWarnings (${plan.warnings.length}):`);
    for (const w of plan.warnings) out(`  - ${w}`);
  }
  if (plan.errors.length) {
    out(`\nErrors (${plan.errors.length}). Nothing will be written until these are fixed:`);
    for (const e of plan.errors) out(`  ✗ ${e}`);
  }
}

async function confirmPrune(plan: ImportPlan, yes: boolean): Promise<boolean> {
  if (!plan.stale.length) return true;
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.error("\n--prune needs confirmation. Re-run in a terminal, or add --yes.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nPermanently delete ${plan.stale.length} imported article folder(s) listed as stale? Type "prune" to confirm: `);
  rl.close();
  return answer.trim() === "prune";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: npm run import:check | npm run import [-- --prune [--yes]] [--vault <path>]");
    return 0;
  }
  const plan = await planImport({ vaultDir: await vaultPath(args.vault), contentDir });
  printPlan(plan, args.check ? "check only (nothing written)" : "import");
  if (plan.errors.length) return 1;
  if (args.check) {
    console.log("\nCheck passed. Run `npm run import` to write these changes.");
    return 0;
  }

  const pruneConfirmed = args.prune ? await confirmPrune(plan, args.yes) : false;
  if (args.prune && !pruneConfirmed) {
    console.log("Prune not confirmed. Nothing was written.");
    return 1;
  }
  const result = await applyPlan(plan, { prune: args.prune, pruneConfirmed });
  console.log(`\nWrote ${result.written.length} article(s)${result.pruned.length ? `, pruned ${result.pruned.length}` : ""}.`);
  console.log("Next: npm run check && npm run build, review with npm run dev and git diff, then commit.");
  console.log("Nothing has been committed, pushed, or deployed.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`\nImport failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
