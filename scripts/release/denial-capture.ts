// Encrypted diagnostic capture for the token-isolation checks
// (scripts/release/token-scope.ts). Temporary: remove once the code-less 403
// responses for both directions are verified (cleanup: docs/deployment.md,
// "Production token diagnostic").
//
// Why: run 42520021640 showed that Cloudflare denies the staging token on
// ninjatronics-v2-production with HTTP 403 and one error that has a message
// but no code. The public log must never contain that message, so this
// module encrypts it with age (age-encryption, X25519) to a public key whose
// private half exists only on the maintainer's machine. The log then shows
// only ASCII-armored ciphertext.
//
// Scope, all enforced here:
//   - only the two token-isolation checks in CAPTURE_PAIRS (the staging
//     token: ninjatronics-v2 -> ninjatronics-v2-production; the production
//     token: ninjatronics-v2-production -> ninjatronics-v2), only for an HTTP
//     403 JSON body with success false that the guard is about to REJECT;
//   - captures only the errors entries (max 3): their field names, the type
//     of code, whether documentation_url is present, and the message with the
//     token and account ID removed. Nothing else from the response, and no
//     request data;
//   - the recipient must be a native X25519 age recipient whose SHA-256
//     matches RECIPIENT_SHA256; otherwise nothing is captured;
//   - the payload is only ever passed to the encrypter. Any failure logs the
//     error type and "nothing captured"; there is no plaintext fallback.
// Capture never changes the guard's decision.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Encrypter, armor } from "age-encryption";

export interface CapturePair { readonly allowed: string; readonly denied: string }
export const CAPTURE_PAIRS: readonly CapturePair[] = Object.freeze([
  Object.freeze({ allowed: "ninjatronics-v2", denied: "ninjatronics-v2-production" }), // staging token
  Object.freeze({ allowed: "ninjatronics-v2-production", denied: "ninjatronics-v2" }), // production token
]);
export const isCapturePair = (allowed: string, denied: string) =>
  CAPTURE_PAIRS.some((p) => p.allowed === allowed && p.denied === denied);

// The maintainer's public key (`age-keygen -y`), one line. The private key
// exists only on the maintainer's machine; nothing here or in CI needs it.
export const RECIPIENT_FILE = fileURLToPath(new URL("./diagnostic-recipient.txt", import.meta.url));
// SHA-256 (hex) of that exact recipient string (no newline). Empty = capture
// disabled. Verify: age-keygen -y <key> | tr -d '\n' | sha256sum
export const RECIPIENT_SHA256 = "d9592e361baf3af203c46967d4a8c46c4fbdbf7db2b1389394bb46215b7dca8b";

const X25519_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;
const MAX_ERRORS = 3;
const MAX_MESSAGE = 1000;

export type Encrypt = (plaintext: string, recipient: string) => Promise<string>;

export interface CaptureConfig {
  recipientText: string | undefined; // file contents, undefined if the file is absent
  expectedSha256: string;
  encrypt?: Encrypt; // tests only
}

export interface CaptureInput {
  allowed: string;
  denied: string;
  status: number;
  mediaType: string | undefined;
  body: unknown;
  token: string;
  account: string;
}

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function readDefaultConfig(): CaptureConfig {
  let recipientText: string | undefined;
  try { recipientText = readFileSync(RECIPIENT_FILE, "utf8"); } catch { recipientText = undefined; }
  return { recipientText, expectedSha256: RECIPIENT_SHA256 };
}

export type RecipientCheck = { ok: true; recipient: string } | { ok: false; reason: string };

// Format and fingerprint validation. Reasons are fixed strings (safe to log).
export function checkRecipient(text: string | undefined, expectedSha256: string): RecipientCheck {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) return { ok: false, reason: "not configured (no pinned recipient fingerprint)" };
  if (text === undefined) return { ok: false, reason: "recipient file missing" };
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length !== 1) return { ok: false, reason: "recipient file must contain exactly one line" };
  const recipient = lines[0];
  if (!X25519_RECIPIENT.test(recipient)) return { ok: false, reason: "recipient is not a native X25519 age recipient (age1...)" };
  if (sha256(recipient) !== expectedSha256) return { ok: false, reason: "recipient fingerprint mismatch" };
  return { ok: true, recipient };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

// Is this the response the capture exists for? Pair, status, JSON object
// body, success false, and errors present as an array.
export function isCaptureTarget(i: CaptureInput): boolean {
  return isCapturePair(i.allowed, i.denied) &&
    i.status === 403 && i.mediaType === "application/json" &&
    isPlainObject(i.body) && i.body.success === false && Array.isArray(i.body.errors);
}

// The plaintext. Only the errors entries; token and account ID removed.
export function buildPayload(i: CaptureInput): string {
  const scrub = (s: string) => {
    let out = s;
    for (const [secret, label] of [[i.token, "<token>"], [i.account, "<account-id>"]] as const) {
      // Real tokens and account IDs are 32+ characters; a short value would
      // only mangle ordinary words (the guard rejects such inputs anyway).
      if (secret && secret.length >= 16) out = out.split(secret).join(label);
    }
    return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE)}<truncated>` : out;
  };
  const errors = (i.body as { errors: unknown[] }).errors;
  return JSON.stringify({
    v: 1,
    errorCount: errors.length,
    errors: errors.slice(0, MAX_ERRORS).map((e) => isPlainObject(e)
      ? {
        fields: Object.keys(e).sort(),
        codeType: "code" in e ? (e.code === null ? "null" : typeof e.code) : "absent",
        hasDocumentationUrl: "documentation_url" in e,
        message: typeof e.message === "string" ? scrub(e.message) : { type: e.message === null ? "null" : typeof e.message },
      }
      : { entryType: e === null ? "null" : Array.isArray(e) ? "array" : typeof e }),
  });
}

export const ageEncrypt: Encrypt = async (plaintext, recipient) => {
  const e = new Encrypter();
  e.addRecipient(recipient);
  return armor.encode(await e.encrypt(plaintext));
};

// Returns log lines. Never throws, never returns plaintext. buildPayload
// runs inside the try, so a malformed body also ends as "nothing captured".
export async function captureDenial(i: CaptureInput, config: CaptureConfig): Promise<string[]> {
  if (!isCapturePair(i.allowed, i.denied)) return [];
  if (!isCaptureTarget(i)) return ["INFO capture: skipped (not the expected token-isolation denial)"];
  const r = checkRecipient(config.recipientText, config.expectedSha256);
  if (!r.ok) return [`INFO capture: skipped (${r.reason}); nothing captured`];
  let armored: string;
  try {
    armored = await (config.encrypt ?? ageEncrypt)(buildPayload(i), r.recipient);
  } catch (e) {
    const name = e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : "unknown error";
    return [`INFO capture: encryption failed (${name}); nothing captured`];
  }
  // Defense in depth: emit only well-formed age armor.
  const lines = armored.trim().split("\n");
  const body = lines.slice(1, -1);
  if (lines[0] !== "-----BEGIN AGE ENCRYPTED FILE-----" || lines.at(-1) !== "-----END AGE ENCRYPTED FILE-----" ||
    body.length === 0 || !body.every((l) => /^[A-Za-z0-9+/=]{1,64}$/.test(l))) {
    return ["INFO capture: encryption failed (unexpected output); nothing captured"];
  }
  return [
    `INFO capture: age-encrypted to recipient sha256:${config.expectedSha256.slice(0, 16)}; decrypt locally with age -d -i <private key>`,
    ...lines,
  ];
}
