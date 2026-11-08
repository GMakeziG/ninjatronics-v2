// Tests for the encrypted diagnostic capture. No network: Cloudflare is a
// stub, and every key pair is generated in memory per test run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Decrypter, armor, generateX25519Identity, generateHybridIdentity, identityToRecipient } from "age-encryption";
import {
  captureDenial, checkRecipient, buildPayload, isCaptureTarget, sha256, readDefaultConfig,
  RECIPIENT_SHA256, CAPTURE_PAIR, type CaptureInput, type CaptureConfig,
} from "./denial-capture.ts";
import { checkTokenScope } from "./token-scope.ts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "test-token-value-SECRET";
const MESSAGE = "SECRET-CF-MESSAGE observed denial text";
const identity = await generateX25519Identity();
const recipient = await identityToRecipient(identity);
const config = (over: Partial<CaptureConfig> = {}): CaptureConfig =>
  ({ recipientText: `${recipient}\n`, expectedSha256: sha256(recipient), ...over });
const observedBody = (message: unknown = MESSAGE) => ({ success: false, errors: [{ message }], messages: [], result: null });
const input = (over: Partial<CaptureInput> = {}): CaptureInput => ({
  allowed: CAPTURE_PAIR.allowed, denied: CAPTURE_PAIR.denied, status: 403, mediaType: "application/json",
  body: observedBody(), token: TOKEN, account: ACCOUNT, ...over,
});
const decrypt = async (lines: string[], id = identity) => {
  const d = new Decrypter();
  d.addIdentity(id);
  return JSON.parse(await d.decrypt(armor.decode(lines.slice(1).join("\n") + "\n"), "text"));
};
const noPlaintext = (out: string) => {
  for (const s of [MESSAGE, "SECRET-CF-MESSAGE", TOKEN, ACCOUNT, identity]) assert.ok(!out.includes(s), `leaked "${s}":\n${out}`);
};

// ---- the committed defaults ---------------------------------------------------

test("capture: the committed recipient is a valid X25519 key matching the pinned fingerprint", () => {
  assert.match(RECIPIENT_SHA256, /^[0-9a-f]{64}$/);
  const c = readDefaultConfig();
  assert.ok(c.recipientText !== undefined, "scripts/release/diagnostic-recipient.txt exists");
  assert.equal(c.recipientText, `${c.recipientText!.trim()}\n`, "exactly one line, newline-terminated");
  const r = checkRecipient(c.recipientText, c.expectedSha256);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!c.recipientText!.includes("AGE-SECRET-KEY"), "never a private key");
});

// ---- successful encryption ------------------------------------------------------

test("capture: encrypts the error entries; only the private key reveals them", async () => {
  const lines = await captureDenial(input(), config());
  assert.match(lines[0], /^INFO capture: age-encrypted to recipient sha256:[0-9a-f]{16};/);
  assert.equal(lines[1], "-----BEGIN AGE ENCRYPTED FILE-----");
  assert.equal(lines.at(-1), "-----END AGE ENCRYPTED FILE-----");
  noPlaintext(lines.join("\n"));
  assert.deepEqual(await decrypt(lines), {
    v: 1, errorCount: 1,
    errors: [{ fields: ["message"], codeType: "absent", hasDocumentationUrl: false, message: MESSAGE }],
  });
  const other = await generateX25519Identity();
  await assert.rejects(decrypt(lines, other), "another key cannot decrypt");
});

test("capture: the token and account ID are removed before encryption", async () => {
  const lines = await captureDenial(input({ body: observedBody(`denied for ${ACCOUNT} using ${TOKEN}`) }), config());
  const p = await decrypt(lines);
  assert.equal(p.errors[0].message, "denied for <account-id> using <token>");
});

test("capture: short stand-in values do not mangle the message", async () => {
  const p = await decrypt(await captureDenial(input({ token: "t", account: "a", body: observedBody("a test message") }), config()));
  assert.equal(p.errors[0].message, "a test message");
});

test("capture: only error entries are captured, at most 3, messages truncated", async () => {
  const body = {
    success: false, result: { secret: "WORKER-CONFIG" }, messages: [{ message: "OTHER-API-DATA" }], extra: "UNRELATED",
    errors: [{ code: 7, message: "x".repeat(2000), documentation_url: "https://d", detail: "y" }, null, [1], { message: 5 }, { message: "fifth" }],
  };
  const p = await decrypt(await captureDenial(input({ body }), config()));
  assert.equal(p.errorCount, 5);
  assert.equal(p.errors.length, 3);
  assert.deepEqual(p.errors[0].fields, ["code", "detail", "documentation_url", "message"]);
  assert.equal(p.errors[0].codeType, "number");
  assert.equal(p.errors[0].hasDocumentationUrl, true);
  assert.equal(p.errors[0].message, "x".repeat(1000) + "<truncated>");
  assert.deepEqual(p.errors[1], { entryType: "null" });
  assert.deepEqual(p.errors[2], { entryType: "array" });
  const raw = JSON.stringify(p);
  for (const s of ["WORKER-CONFIG", "OTHER-API-DATA", "UNRELATED", "https://d", "fifth"]) assert.ok(!raw.includes(s), s);
});

test("capture: output decrypts with the age CLI (skipped where age is not installed)",
  { skip: spawnSync("age", ["--version"]).status !== 0 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-test-"));
    try {
      writeFileSync(join(dir, "key.txt"), `${identity}\n`, { mode: 0o600 });
      const lines = await captureDenial(input(), config());
      const r = spawnSync("age", ["-d", "-i", join(dir, "key.txt")], { input: lines.slice(1).join("\n") + "\n", encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).errors[0].message, MESSAGE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

// ---- missing or invalid public keys -----------------------------------------------

for (const [label, over, reason] of [
  ["no pinned fingerprint", { expectedSha256: "" }, /not configured/],
  ["a malformed pinned fingerprint", { expectedSha256: "abc" }, /not configured/],
  ["a missing recipient file", { recipientText: undefined }, /recipient file missing/],
  ["an empty recipient file", { recipientText: "\n" }, /exactly one line/],
  ["two recipients", { recipientText: `${recipient}\n${recipient}\n` }, /exactly one line/],
  ["a private key in the file", { recipientText: `${identity}\n` }, /not a native X25519/],
  ["a non-age string", { recipientText: "ssh-ed25519 AAAA\n" }, /not a native X25519/],
  ["a truncated recipient", { recipientText: recipient.slice(0, -1) }, /not a native X25519/],
  ["an uppercase recipient", { recipientText: recipient.toUpperCase() }, /not a native X25519/],
  ["a valid key with the wrong fingerprint", { expectedSha256: sha256("age1other") }, /fingerprint mismatch/],
] as [string, Partial<CaptureConfig>, RegExp][]) {
  test(`capture: nothing captured with ${label}`, async () => {
    let called = false;
    const lines = await captureDenial(input(), config({ ...over, encrypt: async () => { called = true; return "x"; } }));
    assert.equal(called, false, "the encrypter is never reached");
    assert.equal(lines.length, 1);
    assert.match(lines[0], reason);
    assert.match(lines[0], /nothing captured/);
    noPlaintext(lines.join("\n"));
  });
}

test("capture: a post-quantum or tag recipient is refused (X25519 only)", async () => {
  const pq = await identityToRecipient(await generateHybridIdentity());
  const r = checkRecipient(pq, sha256(pq));
  assert.equal(r.ok, false);
});

// ---- encryption failures: never plaintext -------------------------------------------

for (const [label, encrypt] of [
  ["the encrypter throws", async () => { throw new TypeError(`boom ${MESSAGE}`); }],
  ["the encrypter throws a non-Error", async () => { throw `${MESSAGE}`; }],
  ["the encrypter throws an error with a hostile name", async () => { const e = new Error("x"); e.name = MESSAGE; throw e; }],
  ["the encrypter returns the plaintext", async (p: string) => p],
  ["the encrypter returns fake armor around plaintext", async (p: string) => `-----BEGIN AGE ENCRYPTED FILE-----\n${p}\n-----END AGE ENCRYPTED FILE-----`],
  ["the encrypter returns empty armor", async () => "-----BEGIN AGE ENCRYPTED FILE-----\n-----END AGE ENCRYPTED FILE-----"],
] as [string, (p: string, r: string) => Promise<string>][]) {
  test(`capture: no plaintext when ${label}`, async () => {
    const lines = await captureDenial(input(), config({ encrypt }));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /encryption failed .*nothing captured/);
    noPlaintext(lines.join("\n"));
  });
}

// ---- scope: only the expected staging denial ----------------------------------------

test("capture: never runs for any other Worker pair (e.g. the production check)", async () => {
  let called = false;
  const spy = config({ encrypt: async () => { called = true; return "x"; } });
  for (const [allowed, denied] of [["ninjatronics-v2-production", "ninjatronics-v2"], ["a", "b"], ["ninjatronics-v2", "other"]]) {
    assert.deepEqual(await captureDenial(input({ allowed, denied }), spy), []);
  }
  assert.equal(called, false);
});

for (const [label, over] of [
  ["HTTP 401", { status: 401 }],
  ["HTTP 404", { status: 404 }],
  ["HTTP 500", { status: 500 }],
  ["a non-JSON media type", { mediaType: "text/html" }],
  ["a missing media type", { mediaType: undefined }],
  ["a null body", { body: null }],
  ["an array body", { body: [observedBody()] }],
  ["success true", { body: { ...observedBody(), success: true } }],
  ["success missing", { body: { errors: [{ message: MESSAGE }] } }],
  ["errors not an array", { body: { success: false, errors: { message: MESSAGE } } }],
] as [string, Partial<CaptureInput>][]) {
  test(`capture: skipped for ${label}`, async () => {
    let called = false;
    const lines = await captureDenial(input(over), config({ encrypt: async () => { called = true; return "x"; } }));
    assert.equal(called, false);
    assert.deepEqual(lines, ["INFO capture: skipped (not the expected staging-token denial)"]);
  });
}

test("capture: the target predicate and payload builder agree", () => {
  assert.equal(isCaptureTarget(input()), true);
  assert.equal(isCaptureTarget(input({ status: 403, body: { success: false } })), false);
  assert.equal(JSON.parse(buildPayload(input())).errors[0].message, MESSAGE);
});

// ---- integration with the guard: outcome unchanged ------------------------------------

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const cf = (other: () => Response): typeof fetch => (async (u: RequestInfo | URL) =>
  String(u).endsWith("/ninjatronics-v2") ? json(200, { success: true, result: { name: "ninjatronics-v2" }, errors: [] }) : other()) as typeof fetch;
const run = (other: () => Response, capture: CaptureConfig = config()) => checkTokenScope({
  fetch: cf(other), account: ACCOUNT, token: TOKEN, allowed: "ninjatronics-v2", denied: "ninjatronics-v2-production", timeoutMs: 200, capture,
});

test("guard + capture: the observed 403 still FAILS, with ciphertext before the INFO and FAIL lines", async () => {
  const r = await run(() => json(403, observedBody()));
  assert.equal(r.ok, false);
  assert.match(r.lines.at(-1)!, /^FAIL .*without the expected denial/);
  assert.match(r.lines.at(-2)!, /^INFO response: /);
  assert.ok(r.lines.includes("-----BEGIN AGE ENCRYPTED FILE-----"));
  noPlaintext(r.lines.join("\n"));
  const start = r.lines.findIndex((l) => l === "-----BEGIN AGE ENCRYPTED FILE-----");
  const end = r.lines.indexOf("-----END AGE ENCRYPTED FILE-----");
  assert.equal((await decrypt(r.lines.slice(start - 1, end + 1))).errors[0].message, MESSAGE);
});

test("guard + capture: the guard fails even when encryption fails", async () => {
  const r = await run(() => json(403, observedBody()), config({ encrypt: async () => { throw new Error("x"); } }));
  assert.equal(r.ok, false);
  assert.match(r.lines.at(-1)!, /^FAIL /);
  assert.ok(r.lines.some((l) => /encryption failed/.test(l)));
  noPlaintext(r.lines.join("\n"));
});

test("guard + capture: the documented 10000 denial passes and captures nothing", async () => {
  let called = false;
  const r = await run(() => json(403, { success: false, errors: [{ code: 10000, message: MESSAGE }], messages: [], result: null }),
    config({ encrypt: async () => { called = true; return "x"; } }));
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.equal(called, false);
  noPlaintext(r.lines.join("\n"));
});

for (const [label, status] of [["401", 401], ["404", 404], ["429", 429], ["500", 500]] as [string, number][]) {
  test(`guard + capture: HTTP ${label} fails without any capture`, async () => {
    let called = false;
    const r = await run(() => json(status, observedBody()), config({ encrypt: async () => { called = true; return "x"; } }));
    assert.equal(r.ok, false);
    assert.equal(called, false);
    assert.ok(!r.lines.some((l) => l.startsWith("INFO capture")));
    noPlaintext(r.lines.join("\n"));
  });
}

test("guard + capture: a 200 on the denied Worker fails without any capture", async () => {
  let called = false;
  const r = await run(() => json(200, { success: true, result: { name: "ninjatronics-v2-production" } }), config({ encrypt: async () => { called = true; return "x"; } }));
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

test("guard + capture: the production check (reverse pair) never captures, even with the committed key", async () => {
  const r = await checkTokenScope({
    fetch: (async (u: RequestInfo | URL) => String(u).endsWith("/ninjatronics-v2-production")
      ? json(200, { success: true, result: { name: "ninjatronics-v2-production" }, errors: [] })
      : json(403, observedBody())) as typeof fetch,
    account: ACCOUNT, token: TOKEN, allowed: "ninjatronics-v2-production", denied: "ninjatronics-v2", timeoutMs: 200,
  });
  assert.equal(r.ok, false);
  assert.ok(!r.lines.some((l) => l.startsWith("INFO capture") || l.includes("AGE ENCRYPTED")), r.lines.join("\n"));
  noPlaintext(r.lines.join("\n"));
});

test("guard + capture: a capture that throws cannot change the decision", async () => {
  const hostile = { get recipientText(): string { throw new Error(MESSAGE); }, expectedSha256: sha256(recipient) } as CaptureConfig;
  const r = await run(() => json(403, observedBody()), hostile);
  assert.equal(r.ok, false);
  assert.match(r.lines.at(-1)!, /^FAIL .*without the expected denial/);
  assert.ok(r.lines.includes("INFO capture: failed unexpectedly; nothing captured"));
  noPlaintext(r.lines.join("\n"));
});

test("guard + capture: the code 10000 denial passes with the committed key and captures nothing", async () => {
  const r = await checkTokenScope({
    fetch: cf(() => json(403, { success: false, errors: [{ code: 10000, message: MESSAGE }], messages: [], result: null })),
    account: ACCOUNT, token: TOKEN, allowed: "ninjatronics-v2", denied: "ninjatronics-v2-production", timeoutMs: 200,
  });
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.ok(!r.lines.some((l) => l.startsWith("INFO capture")));
});
