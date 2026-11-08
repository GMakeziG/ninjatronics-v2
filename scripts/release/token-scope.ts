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
//
// Diagnostics: every response this check rejects (and the accepted denial)
// is logged as a structural summary built only from allow-listed facts,
// because GitHub Actions logs of this public repository are public:
//   HTTP status; the media type; whether cf-mitigated (WAF challenge or
//   block) and www-authenticate are present; which of the known envelope
//   fields (success, errors, messages, result, result_info) are present and
//   how many other fields there are (never their names); the success value
//   if it is a boolean; for errors and messages: count, numeric codes, and
//   whether entries carry a message or documentation_url (never the text);
//   the type of result (never its contents).
// No response text, header value, URL, Worker setting, unknown field name,
// account ID, or token is ever printed. Logging never changes the outcome:
// the rules above decide pass or fail.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureDenial, readDefaultConfig, type CaptureConfig } from "./denial-capture.ts";
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
  // Encrypted diagnostic capture (scripts/release/denial-capture.ts). Tests
  // pass their own; the CLI uses the committed recipient and fingerprint.
  capture?: CaptureConfig;
}

export interface CheckResult {
  ok: boolean;
  lines: string[];
}

interface ApiResponse {
  status: number;
  body: { success?: unknown; result?: { name?: unknown } | null; errors?: { code?: unknown; message?: unknown }[] } | null;
  error?: string;
  facts?: HeaderFacts;
}

interface HeaderFacts {
  mediaType: string;
  cfMitigated: boolean;
  wwwAuthenticate: boolean;
}

const ENVELOPE_FIELDS = ["success", "errors", "messages", "result", "result_info"];
const MAX_CODES = 10;

async function getWorker(o: ScopeOptions, name: string): Promise<ApiResponse> {
  let res: Response;
  try {
    res = await o.fetch(`${API}/accounts/${o.account}/workers/workers/${name}`, {
      headers: { Authorization: `Bearer ${o.token}` },
      signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
    });
  } catch (e) {
    // Only the error type: messages can embed the request URL (account ID).
    return { status: 0, body: null, error: `request failed (${(e as Error)?.name ?? "unknown error"})` };
  }
  const text = await res.text().catch(() => "");
  const facts = headerFacts(res.headers);
  try {
    return { status: res.status, body: JSON.parse(text), facts };
  } catch {
    return { status: res.status, body: null, error: `HTTP ${res.status} with a non-JSON body`, facts };
  }
}

// Only a well-formed media type from a short list is echoed; anything else
// is reported as "other" so no header value reaches the log.
const MEDIA_TYPES = ["application/json", "text/html", "text/plain"];
function headerFacts(h: Headers): HeaderFacts {
  const mt = (h.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return {
    mediaType: mt === "" ? "none" : MEDIA_TYPES.includes(mt) ? mt : "other",
    cfMitigated: h.has("cf-mitigated"),
    wwwAuthenticate: h.has("www-authenticate"),
  };
}

// Structural summary of a response for the public log (see the header
// comment): no free-form text from the response is ever included.
export function describeResponse(r: Pick<ApiResponse, "status" | "body" | "facts">): string {
  const list = (v: unknown) => {
    if (!Array.isArray(v)) return v === undefined ? "absent" : "not-an-array";
    const objs = v.filter((e) => e !== null && typeof e === "object") as Record<string, unknown>[];
    return {
      count: v.length,
      codes: objs.map((e) => e.code).filter((c): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 999_999).slice(0, MAX_CODES),
      nonObjectEntries: v.length - objs.length,
      withMessage: objs.filter((e) => "message" in e).length,
      withDocumentationUrl: objs.filter((e) => "documentation_url" in e).length,
    };
  };
  const out: Record<string, unknown> = { status: r.status, ...(r.facts ?? {}) };
  const b = r.body as unknown;
  if (b === null || typeof b !== "object" || Array.isArray(b)) {
    out.body = b === null ? "none-or-non-JSON-or-null" : Array.isArray(b) ? "JSON array" : `JSON ${typeof b}`;
    return JSON.stringify(out);
  }
  const keys = Object.keys(b);
  const o = b as Record<string, unknown>;
  out.fields = ENVELOPE_FIELDS.filter((k) => keys.includes(k));
  out.otherFields = keys.filter((k) => !ENVELOPE_FIELDS.includes(k)).length;
  out.success = typeof o.success === "boolean" ? o.success : o.success === undefined ? "absent" : `not-a-boolean`;
  out.errors = list(o.errors);
  out.messages = list(o.messages);
  out.result = o.result === undefined ? "absent" : o.result === null ? null : Array.isArray(o.result) ? "array" : typeof o.result;
  return JSON.stringify(out);
}

// Malformed bodies (errors not an array, entries not objects) yield no codes,
// which fails the denial check rather than throwing.
const codes = (r: ApiResponse) => (Array.isArray(r.body?.errors) ? r.body.errors : [])
  .map((e) => (e !== null && typeof e === "object" ? e.code : undefined)).filter((c) => c !== undefined);

// Display-only versions of success and codes for FAIL messages: the decision
// above still uses the raw values, but only booleans and integer codes are
// printed (a string "code" or success value could carry arbitrary text).
const showSuccess = (r: ApiResponse) => {
  const v = r.body?.success;
  return typeof v === "boolean" ? String(v) : v === undefined ? "absent" : "not-a-boolean";
};
const showCodes = (r: ApiResponse) => {
  const all = codes(r);
  const ints = all.filter((c): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 999_999);
  return JSON.stringify(ints) + (ints.length < all.length ? ` (+${all.length - ints.length} non-numeric)` : "");
};

export async function checkTokenScope(o: ScopeOptions): Promise<CheckResult> {
  const lines: string[] = [];
  const fail = (m: string, r?: ApiResponse): CheckResult =>
    ({ ok: false, lines: [...lines, ...(r ? [`INFO response: ${describeResponse(r)}`] : []), `FAIL ${m}`] });

  if (!o.token) return fail("CLOUDFLARE_API_TOKEN is empty");
  if (!ACCOUNT_ID.test(o.account)) return fail("CLOUDFLARE_ACCOUNT_ID is missing or not a 32-character hex ID");
  for (const n of [o.allowed, o.denied]) if (!WORKER_NAME.test(n)) return fail(`invalid Worker name "${n}"`);
  if (o.allowed === o.denied) return fail("--allowed and --denied must be different Workers");

  // 1. Positive control: the token works for its own Worker.
  const own = await getWorker(o, o.allowed);
  if (own.error) return fail(`${o.allowed}: ${own.error}`, own.status ? own : undefined);
  if (own.status !== 200 || own.body?.success !== true) {
    return fail(`${o.allowed}: HTTP ${own.status}, success ${showSuccess(own)}, codes ${showCodes(own)}: the token can't read its own Worker (invalid, expired, or wrongly scoped token)`, own);
  }
  if (own.body.result?.name !== o.allowed) return fail(`${o.allowed}: the API returned a different Worker name`);
  lines.push(`OK   ${o.allowed}: readable with this token (HTTP 200)`);

  // 2. Negative control: an explicit authorization denial for the other Worker.
  const other = await getWorker(o, o.denied);
  if (other.error) return fail(`${o.denied}: ${other.error}`, other.status ? other : undefined);
  if (other.body?.success === true || (other.status >= 200 && other.status < 300)) {
    return fail(`${o.denied}: HTTP ${other.status}: this token CAN reach "${o.denied}". Scope it to "${o.allowed}" only`);
  }
  if (other.status !== 403) {
    const hint = other.status === 404 ? " (not found is not an authorization denial: does the Worker exist?)"
      : other.status === 401 ? " (authentication failed after step 1 succeeded)" : "";
    return fail(`${o.denied}: expected HTTP 403, got ${other.status}${hint}, codes ${showCodes(other)}`, other);
  }
  if (other.body?.success !== false || !codes(other).some((c) => DENIAL_CODES.includes(c as number))) {
    // Rejected. For the staging check only, log the error entries encrypted
    // (never in plaintext); this cannot change the outcome.
    try {
      lines.push(...await captureDenial(
        { allowed: o.allowed, denied: o.denied, status: other.status, mediaType: other.facts?.mediaType, body: other.body, token: o.token, account: o.account },
        o.capture ?? readDefaultConfig()));
    } catch {
      lines.push("INFO capture: failed unexpectedly; nothing captured");
    }
    return fail(`${o.denied}: HTTP 403 without the expected denial (success ${showSuccess(other)}, codes ${showCodes(other)}, expected one of ${JSON.stringify(DENIAL_CODES)})`, other);
  }
  lines.push(`INFO response: ${describeResponse(other)}`);
  lines.push(`OK   ${o.denied}: explicitly denied (HTTP 403, code ${showCodes(other)})`);
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
