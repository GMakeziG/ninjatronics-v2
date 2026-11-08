// Cloudflare token isolation check, run by the deploy workflows before any
// upload (docs/production-cutover-runbook.md §9.3).
//
//   node scripts/release/token-scope.ts --allowed <worker> --denied <worker>
//   env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
//
// Passes only when BOTH are true, in this order:
//   1. The token can read its own Worker (HTTP 200, success, matching name).
//      This also proves the token and account ID are valid, so the denial in
//      step 2 can't be an invalid-token error in disguise.
//   2. Cloudflare explicitly denies the same token on the other Worker:
//      HTTP 403, success false, error code 10000 ("Forbidden").
// Anything else fails: network errors, timeouts, non-JSON bodies, 401, 404
// (not found is not a denial), 5xx, or a success on the denied Worker.
// The token and account ID are never printed.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const DENIAL_CODES = [10000];

const API = "https://api.cloudflare.com/client/v4";
const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;

export interface ScopeOptions {
  fetch: typeof fetch;
  account: string;
  token: string;
  allowed: string;
  denied: string;
  timeoutMs?: number;
}

export interface CheckResult {
  ok: boolean;
  lines: string[];
}

interface ApiResponse {
  status: number;
  body: { success?: unknown; result?: { name?: unknown } | null; errors?: { code?: unknown; message?: unknown }[] } | null;
  error?: string;
}

async function getWorker(o: ScopeOptions, name: string): Promise<ApiResponse> {
  let res: Response;
  try {
    res = await o.fetch(`${API}/accounts/${o.account}/workers/workers/${name}`, {
      headers: { Authorization: `Bearer ${o.token}` },
      signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
    });
  } catch (e) {
    return { status: 0, body: null, error: `request failed (${(e as Error).name}: ${(e as Error).message})` };
  }
  const text = await res.text().catch(() => "");
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: null, error: `HTTP ${res.status} with a non-JSON body` };
  }
}

const codes = (r: ApiResponse) => (r.body?.errors ?? []).map((e) => e?.code).filter((c) => c !== undefined);

export async function checkTokenScope(o: ScopeOptions): Promise<CheckResult> {
  const lines: string[] = [];
  const fail = (m: string): CheckResult => ({ ok: false, lines: [...lines, `FAIL ${m}`] });

  if (!o.token) return fail("CLOUDFLARE_API_TOKEN is empty");
  if (!ACCOUNT_ID.test(o.account)) return fail("CLOUDFLARE_ACCOUNT_ID is missing or not a 32-character hex ID");
  for (const n of [o.allowed, o.denied]) if (!WORKER_NAME.test(n)) return fail(`invalid Worker name "${n}"`);
  if (o.allowed === o.denied) return fail("--allowed and --denied must be different Workers");

  // 1. Positive control: the token works for its own Worker.
  const own = await getWorker(o, o.allowed);
  if (own.error) return fail(`${o.allowed}: ${own.error}`);
  if (own.status !== 200 || own.body?.success !== true) {
    return fail(`${o.allowed}: HTTP ${own.status}, success ${own.body?.success}, codes ${JSON.stringify(codes(own))}: the token can't read its own Worker (invalid, expired, or wrongly scoped token)`);
  }
  if (own.body.result?.name !== o.allowed) return fail(`${o.allowed}: the API returned Worker "${own.body.result?.name}"`);
  lines.push(`OK   ${o.allowed}: readable with this token (HTTP 200)`);

  // 2. Negative control: an explicit authorization denial for the other Worker.
  const other = await getWorker(o, o.denied);
  if (other.error) return fail(`${o.denied}: ${other.error}`);
  if (other.body?.success === true || (other.status >= 200 && other.status < 300)) {
    return fail(`${o.denied}: HTTP ${other.status}: this token CAN reach "${o.denied}". Scope it to "${o.allowed}" only`);
  }
  if (other.status !== 403) {
    const hint = other.status === 404 ? " (not found is not an authorization denial: does the Worker exist?)"
      : other.status === 401 ? " (authentication failed after step 1 succeeded)" : "";
    return fail(`${o.denied}: expected HTTP 403, got ${other.status}${hint}, codes ${JSON.stringify(codes(other))}`);
  }
  if (other.body?.success !== false || !codes(other).some((c) => DENIAL_CODES.includes(c as number))) {
    return fail(`${o.denied}: HTTP 403 without the expected denial (success ${other.body?.success}, codes ${JSON.stringify(codes(other))}, expected one of ${JSON.stringify(DENIAL_CODES)})`);
  }
  lines.push(`OK   ${o.denied}: explicitly denied (HTTP 403, code ${codes(other).join(",")})`);
  return { ok: true, lines };
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
  const result = await checkTokenScope({
    fetch,
    account: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    token: process.env.CLOUDFLARE_API_TOKEN ?? "",
    allowed: arg("--allowed"),
    denied: arg("--denied"),
  });
  for (const l of result.lines) console.log(l.startsWith("FAIL") ? `::error::${l}` : l);
  console.log(result.ok ? "Token scope verified." : "Token scope check FAILED.");
  process.exit(result.ok ? 0 : 1);
}
