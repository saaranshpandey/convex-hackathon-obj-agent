# eBay Production Mode and Account-deletion Notifications: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let real customers connect their real eBay accounts: handle eBay's marketplace account-deletion notifications (required before eBay activates a production keyset) and add a production mode so prod uses the production keyset while dev stays on sandbox.

**Architecture:** A signed-notification endpoint in Convex's HTTP layer answers eBay's handshake and, after verifying eBay's ECDSA/SHA-1 signature with WebCrypto, deletes the matching seller's stored eBay connection. `EBAY_MODE` gains a `production` value; every hard-coded `"sandbox"` takes its environment from that mode. Connect saves each seller's eBay user ID (Identity API) so deletion notices can be matched. Demo rooms never publish to real eBay.

**Tech Stack:** Convex 1.45 (V8 runtime, WebCrypto), eBay Notification, Identity, Taxonomy and Sell APIs, vitest 5 (`convex-test` for Convex functions), React 19.

**Spec:** `docs/superpowers/specs/2026-09-20-ebay-production-and-account-deletion-design.md`

## Global Constraints

- Verification of eBay notification signatures runs in Convex's V8 runtime with WebCrypto (no `"use node"` file). eBay uses only ECDSA with SHA-1; keys are P-256; the signature is DER-encoded and must be converted to raw `r||s` for WebCrypto.
- Endpoint path: `/ebay/account-deletion`. Registered URL: `<CONVEX_SITE_URL>/ebay/account-deletion` (prod: `https://adjoining-gerbil-124.convex.site/ebay/account-deletion`).
- Handshake: respond `200` JSON `{ "challengeResponse": <hex SHA-256 of challengeCode + verificationToken + endpoint URL> }`. Verification token env var: `EBAY_DELETION_VERIFICATION_TOKEN` (about 48 characters of `A-Za-z0-9_-`).
- Notification responses: valid signature `200` (also when no seller matches); missing, malformed or invalid signature `412`; eBay unreachable while fetching the public key `500` (so eBay retries); unknown key ID (eBay answers 404) `412`. Never delete anything unless the signature verified.
- Public keys are cached for one hour in the `ebayPublicKeys` table.
- A deletion removes only the matching seller's `ebayConnections` row (tokens, ZIP, seller setup IDs, eBay user ID). Rooms and listing drafts stay.
- `EBAY_MODE` values: `mock` (default), `sandbox`, `production`. In production mode a demo room's listing publishes through the mock publisher, recorded with mode `mock`.
- Consent scopes: `sell.inventory`, `sell.account`, plus `commerce.identity.readonly` at connect. Token refresh keeps requesting only `sell.inventory` and `sell.account` (a refresh may not ask for scopes the original grant lacked, and older connections lack the identity scope).
- Identity API host is `apiz.ebay.com` (sandbox `apiz.sandbox.ebay.com`); all other calls use `api.ebay.com` (sandbox `api.sandbox.ebay.com`).
- Production connections count as connected only with a ZIP and an eBay user ID; sandbox connections need a ZIP; mock needs neither.
- Codebase conventions: two-argument `ctx.db.get("table", id)`, `ctx.db.patch(...)`, `ctx.db.delete(...)`; object-form Convex functions with `args` validators; no `returns:` validators (none exist here, ignore the `convex-lint` hook nags); no code comments except a non-obvious WHY; `crypto.subtle` byte arguments cast `as BufferSource` where TypeScript demands it.
- Never run a command against prod without an explicit yes from the owner, in chat, for that step. Dev is `scrupulous-newt-316`; prod is `adjoining-gerbil-124`. The production Cert ID (client secret) is never written to a file or a command line: the owner sets it with the clipboard command.
- Stage files by name (never `git add -A` or `git add .`). Each commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (as a second `-m`). Never stage `todo.txt` or `commands.txt`.
- Convex-function tests live in `tests/convex/` with the first-line docblock `// @vitest-environment edge-runtime`. Pure-logic tests live in `tests/ebay/` and use the default node environment. Tests that change `process.env` restore it in a `finally`.

## Before you start

- [ ] Create a working branch from the current eBay branch (it is unmerged and prod runs it):

```bash
git switch -c feature/ebay-production
```

- [ ] Commit the spec and this plan:

```bash
git add docs/superpowers/specs/2026-09-20-ebay-production-and-account-deletion-design.md docs/superpowers/plans/2026-09-20-ebay-production-and-account-deletion.md
git commit -m "docs: add eBay production mode and account-deletion spec and plan" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

## File structure

**Create**
- `convex/ebay/notificationSignature.ts`: handshake hash, signature-header decoding, DER-to-raw conversion and ECDSA/SHA-1 verification, deleted-user extraction (all pure).
- `convex/ebayNotifications.ts`: `handle` (verify and delete), plus the public-key cache functions.
- `convex/ebay/identity.ts`: Identity API user-ID lookup and parser.
- `tests/ebay/notificationVector.ts`, `tests/ebay/notificationSignature.test.ts`, `tests/ebay/identity.test.ts`, `tests/ebay/mode.test.ts`, `tests/convex/ebayNotifications.test.ts`.

**Modify**
- `convex/schema.ts`, `convex/convex.config.ts`, `convex/http.ts`, `convex/ebayAuth.ts`, `convex/listingPublish.ts`.
- `convex/ebay/index.ts`, `convex/ebay/types.ts`, `convex/ebay/http.ts`, `convex/ebay/oauth.ts`.
- `src/components/EbayConnectButton.tsx`.
- `tests/ebay/fakeFetch.ts`, `tests/ebay/oauth.test.ts`, `tests/convex/ebay.test.ts`.

---

### Task 1: Signature and handshake helpers (pure)

**Files:**
- Create: `convex/ebay/notificationSignature.ts`, `tests/ebay/notificationVector.ts`, `tests/ebay/notificationSignature.test.ts`

**Interfaces:**
- Produces:
  - `challengeResponse(challengeCode: string, verificationToken: string, endpoint: string): Promise<string>`
  - `decodeSignatureHeader(header: string | null | undefined): { kid: string; signature: string } | null`
  - `verifyEbaySignature(input: { publicKeyPem: string; body: string; signature: string }): Promise<boolean>` (`signature` is base64 DER; never throws)
  - `readDeletedUserId(body: string): string | null`

- [ ] **Step 1: Create the test vector, `tests/ebay/notificationVector.ts`**

The signature was produced with Node (`crypto.sign("sha1", body, { dsaEncoding: "der" })`) over exactly `JSON.stringify` of this object. Do not change any value or the key order.

```ts
export const notificationUserId = "ebay-user-123";

export const notificationBody = JSON.stringify({
  metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0", deprecated: false },
  notification: {
    notificationId: "test-notification-1",
    eventDate: "2026-09-20T00:00:00.000Z",
    publishDate: "2026-09-20T00:00:01.000Z",
    publishAttemptCount: 1,
    data: {
      username: "test_seller",
      userId: notificationUserId,
      eiasToken: "nY+sHZ2PrBmdj6wVnY+sEZ2PrA2dj6wJnY+gCJODogudj6x9nY+seQ==",
    },
  },
});

export const notificationSignatureDer =
  "MEQCIHFAvR0hG9iGGtRaC9awbeOykKlrTEvFj16yu1X4uKu8AiA09VNK/x5vCF/3wwbO2dzxkB1sy6VpJptJTwfBK2GrZw==";

export const notificationPublicKeyPem = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEHcM4htP5EuO4axPgJgC0RJHodLjS
7ygXDnT65JAmsuDARm8dRzT9bwuucYnSiurjhXJn2+JwWDVAlHnQTL2osA==
-----END PUBLIC KEY-----`;

export const otherPublicKeyPem = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEwJm6/MpN6PlDLU06VTrRcqrFM9JX
VcRUIJ6WLVy86VP7lIy6y1lKxBlO/xVmQypS+BhddZjNTb/Zt9aDL6xSSA==
-----END PUBLIC KEY-----`;

/** SHA-256 hex of "abc" + "token123" + "https://example.convex.site/ebay/account-deletion". */
export const handshakeHash = "48e17d1b8b2f440a0d0e6b84ccc88ac7879e8d2cde5d84f07ca5be90f2281c2d";
```

- [ ] **Step 2: Write the failing test, `tests/ebay/notificationSignature.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  challengeResponse,
  decodeSignatureHeader,
  readDeletedUserId,
  verifyEbaySignature,
} from "../../convex/ebay/notificationSignature";
import {
  handshakeHash,
  notificationBody,
  notificationPublicKeyPem,
  notificationSignatureDer,
  notificationUserId,
  otherPublicKeyPem,
} from "./notificationVector";

describe("challengeResponse", () => {
  it("is the SHA-256 hex of code + token + endpoint", async () => {
    expect(
      await challengeResponse("abc", "token123", "https://example.convex.site/ebay/account-deletion"),
    ).toBe(handshakeHash);
  });
});

describe("decodeSignatureHeader", () => {
  const header = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

  it("reads the key ID and signature from the base64 JSON header", () => {
    expect(
      decodeSignatureHeader(header({ alg: "ecdsa", kid: "k1", signature: "c2ln", digest: "SHA1" })),
    ).toEqual({ kid: "k1", signature: "c2ln" });
  });

  it("returns null for anything unusable", () => {
    expect(decodeSignatureHeader(undefined)).toBeNull();
    expect(decodeSignatureHeader(null)).toBeNull();
    expect(decodeSignatureHeader("")).toBeNull();
    expect(decodeSignatureHeader("not base64!!")).toBeNull();
    expect(decodeSignatureHeader(header({ alg: "ecdsa", signature: "c2ln" }))).toBeNull();
    expect(decodeSignatureHeader(header({ kid: "k1" }))).toBeNull();
  });
});

describe("verifyEbaySignature", () => {
  it("accepts a genuine eBay-style signature", async () => {
    expect(
      await verifyEbaySignature({
        publicKeyPem: notificationPublicKeyPem,
        body: notificationBody,
        signature: notificationSignatureDer,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", async () => {
    expect(
      await verifyEbaySignature({
        publicKeyPem: notificationPublicKeyPem,
        body: `${notificationBody} `,
        signature: notificationSignatureDer,
      }),
    ).toBe(false);
  });

  it("rejects a signature checked against a different key", async () => {
    expect(
      await verifyEbaySignature({
        publicKeyPem: otherPublicKeyPem,
        body: notificationBody,
        signature: notificationSignatureDer,
      }),
    ).toBe(false);
  });

  it("returns false, without throwing, for garbage input", async () => {
    expect(
      await verifyEbaySignature({ publicKeyPem: notificationPublicKeyPem, body: notificationBody, signature: "AAAA" }),
    ).toBe(false);
    expect(
      await verifyEbaySignature({ publicKeyPem: "not a key", body: notificationBody, signature: notificationSignatureDer }),
    ).toBe(false);
  });

  it("accepts a key with no line breaks, as eBay may return it", async () => {
    const oneLine = notificationPublicKeyPem.replace(/\n/g, "");
    expect(
      await verifyEbaySignature({ publicKeyPem: oneLine, body: notificationBody, signature: notificationSignatureDer }),
    ).toBe(true);
  });
});

describe("readDeletedUserId", () => {
  it("reads the eBay user ID from a deletion notification", () => {
    expect(readDeletedUserId(notificationBody)).toBe(notificationUserId);
  });

  it("ignores other topics, missing IDs and invalid JSON", () => {
    expect(readDeletedUserId(JSON.stringify({ metadata: { topic: "OTHER" }, notification: { data: { userId: "x" } } }))).toBeNull();
    expect(readDeletedUserId(JSON.stringify({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: { data: {} } }))).toBeNull();
    expect(readDeletedUserId("{not json")).toBeNull();
  });
});
```

Run: `npx vitest run tests/ebay/notificationSignature.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `convex/ebay/notificationSignature.ts`**

```ts
function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** eBay's handshake: SHA-256 (hex) of the challenge code, verification token and endpoint URL. */
export async function challengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpoint: string,
): Promise<string> {
  const data = new TextEncoder().encode(challengeCode + verificationToken + endpoint);
  return toHex(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

/** The `X-EBAY-SIGNATURE` header is base64 JSON carrying the key ID and the signature. */
export function decodeSignatureHeader(
  header: string | null | undefined,
): { kid: string; signature: string } | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64(header))) as {
      kid?: unknown;
      signature?: unknown;
    };
    if (typeof parsed.kid !== "string" || typeof parsed.signature !== "string") return null;
    return { kid: parsed.kid, signature: parsed.signature };
  } catch {
    return null;
  }
}

function pemToDer(pem: string): Uint8Array {
  return fromBase64(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
}

/** eBay signs with DER-encoded ECDSA (SEQUENCE { INTEGER r, INTEGER s }); WebCrypto wants raw r||s. */
function derToRaw(der: Uint8Array, size: number): Uint8Array {
  let offset = 2;
  if ((der[1] & 0x80) !== 0) offset += der[1] & 0x7f;

  const readInteger = (): Uint8Array => {
    offset += 1;
    const length = der[offset];
    offset += 1;
    let value = der.slice(offset, offset + length);
    offset += length;
    while (value.length > size && value[0] === 0) value = value.slice(1);
    const padded = new Uint8Array(size);
    padded.set(value, size - value.length);
    return padded;
  };

  const r = readInteger();
  const s = readInteger();
  const raw = new Uint8Array(size * 2);
  raw.set(r, 0);
  raw.set(s, size);
  return raw;
}

/** eBay only signs with ECDSA over SHA-1, on the P-256 curve. */
export async function verifyEbaySignature(input: {
  publicKeyPem: string;
  body: string;
  signature: string;
}): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      pemToDer(input.publicKeyPem) as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const raw = derToRaw(fromBase64(input.signature), 32);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-1" },
      key,
      raw as BufferSource,
      new TextEncoder().encode(input.body) as BufferSource,
    );
  } catch {
    return false;
  }
}

export function readDeletedUserId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      metadata?: { topic?: unknown };
      notification?: { data?: { userId?: unknown } };
    };
    if (parsed.metadata?.topic !== "MARKETPLACE_ACCOUNT_DELETION") return null;
    const userId = parsed.notification?.data?.userId;
    return typeof userId === "string" && userId !== "" ? userId : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run tests/ebay/notificationSignature.test.ts
npx tsc --noEmit -p convex/tsconfig.json
```

Expected: all tests PASS; typecheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add convex/ebay/notificationSignature.ts tests/ebay/notificationVector.ts tests/ebay/notificationSignature.test.ts
git commit -m "feat: verify eBay notification signatures and the deletion handshake" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Notification processing, schema and deletion

**Files:**
- Create: `convex/ebayNotifications.ts`, `tests/convex/ebayNotifications.test.ts`
- Modify: `convex/schema.ts`, `convex/ebayAuth.ts`, `convex/ebay/index.ts`

**Interfaces:**
- Consumes: `decodeSignatureHeader`, `verifyEbaySignature`, `readDeletedUserId` (Task 1); `getAppAccessToken` (existing); `ebayRequest` (existing).
- Produces:
  - `getEbayEnv(): EbayEnv | null` in `convex/ebay/index.ts` (null in demo mode)
  - schema: `ebayConnections.ebayUserId?: string` with index `by_ebayUserId`; table `ebayPublicKeys` (`kid`, `pem`, `fetchedAt`; index `by_kid`)
  - `internal.ebayAuth.deleteByEbayUserId({ ebayUserId }): number`
  - `internal.ebayNotifications.handle({ body: string, signatureHeader?: string }): { status: number }`, `.cachedPublicKey({ kid, now }): string | null`, `.cachePublicKey({ kid, pem, fetchedAt })`

- [ ] **Step 1: Write the failing test, `tests/convex/ebayNotifications.test.ts`**

```ts
// @vitest-environment edge-runtime
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { fakeEbay, type FakeHandlers } from "../ebay/fakeFetch";
import {
  notificationBody,
  notificationPublicKeyPem,
  notificationSignatureDer,
  notificationUserId,
  otherPublicKeyPem,
} from "../ebay/notificationVector";
import { createUser, newTest, type TestConvex } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const header = (signature: string, kid = "test-kid") =>
  btoa(JSON.stringify({ alg: "ecdsa", kid, signature, digest: "SHA1" }));

const tokenHandler: FakeHandlers = {
  "POST /identity/v1/oauth2/token": () => ({
    status: 200,
    json: { access_token: "app-token", expires_in: 7200, token_type: "Application Access Token" },
  }),
};

const keyHandler = (pem: string): FakeHandlers => ({
  ...tokenHandler,
  "GET /commerce/notification/v1/public_key/test-kid": () => ({
    status: 200,
    json: { algorithm: "ECDSA", digest: "SHA1", key: pem },
  }),
});

async function withEbayEnv<T>(run: () => Promise<T>): Promise<T> {
  process.env.EBAY_MODE = "sandbox";
  process.env.EBAY_CLIENT_ID = "client-id";
  process.env.EBAY_CLIENT_SECRET = "client-secret";
  try {
    return await run();
  } finally {
    delete process.env.EBAY_MODE;
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
  }
}

async function connectionFor(t: TestConvex, email: string, ebayUserId: string) {
  const user = await createUser(t, email);
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("ebayConnections", {
      userId: user.userId,
      accessToken: "token",
      refreshToken: "refresh",
      accessTokenExpiresAt: now + 3_600_000,
      mode: "sandbox",
      connectedAt: now,
      updatedAt: now,
      shipFromPostalCode: "94105",
      ebayUserId,
    });
  });
  return user;
}

const remaining = async (t: TestConvex) =>
  await t.run(async (ctx) => (await ctx.db.query("ebayConnections").collect()).map((row) => row.ebayUserId));

describe("eBay account-deletion notifications", () => {
  it("deletes only the matching seller's connection when the signature is valid", async () => {
    const t = newTest();
    await connectionFor(t, "alice@example.com", notificationUserId);
    await connectionFor(t, "bob@example.com", "someone-else");
    fakeEbay(keyHandler(notificationPublicKeyPem));

    const result = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: notificationBody,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    expect(result).toEqual({ status: 200 });
    expect(await remaining(t)).toEqual(["someone-else"]);
  });

  it("acknowledges a valid notification for a seller we do not know", async () => {
    const t = newTest();
    await connectionFor(t, "bob@example.com", "someone-else");
    fakeEbay(keyHandler(notificationPublicKeyPem));

    const result = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: notificationBody,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    expect(result).toEqual({ status: 200 });
    expect(await remaining(t)).toEqual(["someone-else"]);
  });

  it("refuses a tampered body and deletes nothing", async () => {
    const t = newTest();
    await connectionFor(t, "alice@example.com", notificationUserId);
    fakeEbay(keyHandler(notificationPublicKeyPem));

    const result = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: `${notificationBody} `,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    expect(result).toEqual({ status: 412 });
    expect(await remaining(t)).toEqual([notificationUserId]);
  });

  it("refuses a signature that does not match eBay's key", async () => {
    const t = newTest();
    await connectionFor(t, "alice@example.com", notificationUserId);
    fakeEbay(keyHandler(otherPublicKeyPem));

    const result = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: notificationBody,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    expect(result).toEqual({ status: 412 });
    expect(await remaining(t)).toEqual([notificationUserId]);
  });

  it("refuses a missing or malformed signature header without calling eBay", async () => {
    const t = newTest();
    await connectionFor(t, "alice@example.com", notificationUserId);
    const calls = fakeEbay(keyHandler(notificationPublicKeyPem));

    const missing = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, { body: notificationBody }),
    );
    const malformed = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, { body: notificationBody, signatureHeader: "garbage!!" }),
    );

    expect(missing).toEqual({ status: 412 });
    expect(malformed).toEqual({ status: 412 });
    expect(calls).toHaveLength(0);
    expect(await remaining(t)).toEqual([notificationUserId]);
  });

  it("caches eBay's public key instead of fetching it every time", async () => {
    const t = newTest();
    const calls = fakeEbay(keyHandler(notificationPublicKeyPem));
    const args = { body: notificationBody, signatureHeader: header(notificationSignatureDer) };

    await withEbayEnv(async () => {
      await t.action(internal.ebayNotifications.handle, args);
      await t.action(internal.ebayNotifications.handle, args);
    });

    expect(calls.filter((call) => call.path.includes("/public_key/"))).toHaveLength(1);
  });

  it("asks eBay to retry when its key service is down, and refuses an unknown key ID", async () => {
    const t = newTest();
    await connectionFor(t, "alice@example.com", notificationUserId);

    fakeEbay({
      ...tokenHandler,
      "GET /commerce/notification/v1/public_key/test-kid": () => ({ status: 500, json: {} }),
    });
    const down = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: notificationBody,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    fakeEbay({
      ...tokenHandler,
      "GET /commerce/notification/v1/public_key/test-kid": () => ({ status: 404, json: {} }),
    });
    const unknown = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: notificationBody,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    expect(down).toEqual({ status: 500 });
    expect(unknown).toEqual({ status: 412 });
    expect(await remaining(t)).toEqual([notificationUserId]);
  });
});
```

Run: `npx vitest run tests/convex/ebayNotifications.test.ts`
Expected: FAIL (`ebayUserId` is not in the schema, `handle` does not exist).

- [ ] **Step 2: Extend the schema in `convex/schema.ts`**

In the `ebayConnections` table, add this field after the `sellerSetup` field and replace the closing index line so it reads:

```ts
    /** eBay's own immutable ID for this seller; lets us honor account-deletion notices. */
    ebayUserId: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_ebayUserId", ["ebayUserId"]),
```

(That replaces the existing `  }).index("by_userId", ["userId"]),` line of that table.)

Add this table directly after the `ebayOauthStates` table:

```ts
  /** eBay's notification-signing public keys, cached for an hour. */
  ebayPublicKeys: defineTable({
    kid: v.string(),
    pem: v.string(),
    fetchedAt: v.number(),
  }).index("by_kid", ["kid"]),
```

- [ ] **Step 3: Add `getEbayEnv` to `convex/ebay/index.ts`**

Add this function directly below `getEbayMode`:

```ts
/** eBay's environment for the current mode, or null in demo mode (no eBay calls). */
export function getEbayEnv(): EbayEnv | null {
  const mode = getEbayMode();
  return mode === "mock" ? null : mode;
}
```

and change the import line `import type { EbayPublisher } from "./types";` to:

```ts
import type { EbayEnv, EbayPublisher } from "./types";
```

- [ ] **Step 4: Add the deletion mutation to `convex/ebayAuth.ts`**

Append at the end of the file:

```ts
export const deleteByEbayUserId = internalMutation({
  args: { ebayUserId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("ebayConnections")
      .withIndex("by_ebayUserId", (q) => q.eq("ebayUserId", args.ebayUserId))
      .take(50);
    for (const row of rows) await ctx.db.delete("ebayConnections", row._id);
    return rows.length;
  },
});
```

- [ ] **Step 5: Create `convex/ebayNotifications.ts`**

```ts
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { env } from "./_generated/server";
import { internal } from "./_generated/api";
import { EbayError, getEbayEnv } from "./ebay";
import { ebayRequest } from "./ebay/http";
import { decodeSignatureHeader, readDeletedUserId, verifyEbaySignature } from "./ebay/notificationSignature";
import { getAppAccessToken } from "./ebay/oauth";

const KEY_TTL_MS = 60 * 60 * 1000;

export const cachedPublicKey = internalQuery({
  args: { kid: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("ebayPublicKeys")
      .withIndex("by_kid", (q) => q.eq("kid", args.kid))
      .unique();
    if (row === null || row.fetchedAt < args.now - KEY_TTL_MS) return null;
    return row.pem;
  },
});

export const cachePublicKey = internalMutation({
  args: { kid: v.string(), pem: v.string(), fetchedAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ebayPublicKeys")
      .withIndex("by_kid", (q) => q.eq("kid", args.kid))
      .unique();
    if (existing !== null) {
      await ctx.db.patch("ebayPublicKeys", existing._id, { pem: args.pem, fetchedAt: args.fetchedAt });
    } else {
      await ctx.db.insert("ebayPublicKeys", args);
    }
    return null;
  },
});

/**
 * Handles one eBay marketplace account-deletion notification: nothing is
 * deleted unless eBay's signature on the exact body verifies.
 */
export const handle = internalAction({
  args: { body: v.string(), signatureHeader: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ status: number }> => {
    const ebayEnv = getEbayEnv();
    if (ebayEnv === null) return { status: 200 };

    const decoded = decodeSignatureHeader(args.signatureHeader);
    if (decoded === null) return { status: 412 };

    const clientId = env.EBAY_CLIENT_ID?.trim();
    const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return { status: 500 };

    const now = Date.now();
    let pem: string | null = await ctx.runQuery(internal.ebayNotifications.cachedPublicKey, {
      kid: decoded.kid,
      now,
    });

    if (pem === null) {
      try {
        const appToken = await getAppAccessToken({ env: ebayEnv, clientId, clientSecret });
        const response = await ebayRequest(
          ebayEnv,
          appToken,
          "GET",
          `/commerce/notification/v1/public_key/${encodeURIComponent(decoded.kid)}`,
        );
        if (typeof response.key !== "string") return { status: 412 };
        pem = response.key;
        await ctx.runMutation(internal.ebayNotifications.cachePublicKey, {
          kid: decoded.kid,
          pem,
          fetchedAt: now,
        });
      } catch (error) {
        return { status: error instanceof EbayError && error.status === 404 ? 412 : 500 };
      }
    }

    const valid = await verifyEbaySignature({
      publicKeyPem: pem,
      body: args.body,
      signature: decoded.signature,
    });
    if (!valid) return { status: 412 };

    const ebayUserId = readDeletedUserId(args.body);
    if (ebayUserId !== null) {
      await ctx.runMutation(internal.ebayAuth.deleteByEbayUserId, { ebayUserId });
    }
    return { status: 200 };
  },
});
```

- [ ] **Step 6: Push to dev, typecheck, run the tests**

Push first: it regenerates `convex/_generated/api.d.ts`, which the typecheck needs to know about the new `internal.ebayNotifications` functions.

```bash
npx convex dev --once
npx tsc --noEmit -p convex/tsconfig.json
npx vitest run
```

Expected: the dev push succeeds (the schema change is additive); typecheck prints nothing; all tests pass (the 7 new ones included).

If the new Convex tests fail only because `crypto.subtle.verify` with ECDSA/SHA-1 is unsupported inside the edge-runtime test environment, run those tests in the node environment instead: change the first-line docblock of `tests/convex/ebayNotifications.test.ts` from `edge-runtime` to `node` and rerun. Do not change the production code for a test-environment limitation.

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts convex/ebay/index.ts convex/ebayAuth.ts convex/ebayNotifications.ts convex/_generated/api.d.ts tests/convex/ebayNotifications.test.ts
git commit -m "feat: verify and act on eBay account-deletion notifications" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: HTTP routes and end-to-end check on dev

**Files:**
- Modify: `convex/http.ts`, `convex/convex.config.ts`

**Interfaces:**
- Consumes: `challengeResponse` (Task 1), `internal.ebayNotifications.handle` (Task 2).
- Produces: `GET` and `POST` on `/ebay/account-deletion`; typed env var `EBAY_DELETION_VERIFICATION_TOKEN`.

- [ ] **Step 1: Declare the token in `convex/convex.config.ts`**

Add this line to the `env` block, directly after the `EBAY_RU_NAME` line:

```ts
    /** Proves to eBay that we own the account-deletion endpoint (32-80 chars of A-Za-z0-9_-). */
    EBAY_DELETION_VERIFICATION_TOKEN: v.optional(v.string()),
```

- [ ] **Step 2: Add the routes to `convex/http.ts`**

Add this import below the existing `./agentMail/verify` import:

```ts
import { challengeResponse } from "./ebay/notificationSignature";
```

Add these two routes directly above `registerStaticRoutes(http, components.staticHosting);`:

```ts
http.route({
  path: "/ebay/account-deletion",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const code = new URL(req.url).searchParams.get("challenge_code");
    const token = env.EBAY_DELETION_VERIFICATION_TOKEN?.trim();
    if (!code || !token) {
      return new Response("Missing challenge code or verification token", { status: 400 });
    }

    const endpoint = `${env.CONVEX_SITE_URL}/ebay/account-deletion`;
    return new Response(
      JSON.stringify({ challengeResponse: await challengeResponse(code, token, endpoint) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

http.route({
  path: "/ebay/account-deletion",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    const result: { status: number } = await ctx.runAction(internal.ebayNotifications.handle, {
      body,
      signatureHeader: req.headers.get("x-ebay-signature") ?? undefined,
    });
    return new Response(null, { status: result.status });
  }),
});
```

- [ ] **Step 3: Push to dev, then typecheck**

Push first: the typed `env` is generated from `convex.config.ts`, so `tsc` only knows about `EBAY_DELETION_VERIFICATION_TOKEN` after the push regenerates `convex/_generated/server.d.ts`.

```bash
npx convex dev --once
npx tsc --noEmit -p convex/tsconfig.json
```

Expected: push succeeds; typecheck prints nothing.

- [ ] **Step 4: Set a throwaway token on dev and check the real endpoint**

```bash
TOKEN=$(node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))")
npx convex env set "EBAY_DELETION_VERIFICATION_TOKEN=$TOKEN"
SITE=https://scrupulous-newt-316.convex.site
echo "GET handshake:"
curl -s "$SITE/ebay/account-deletion?challenge_code=abc"
echo
echo "expected:"
node -e "console.log(JSON.stringify({challengeResponse: require('crypto').createHash('sha256').update('abc' + process.argv[1] + process.argv[2]).digest('hex')}))" "$TOKEN" "$SITE/ebay/account-deletion"
echo "GET without a challenge code -> $(curl -s -o /dev/null -w '%{http_code}' $SITE/ebay/account-deletion)"
echo "POST with no signature -> $(curl -s -X POST -o /dev/null -w '%{http_code}' -d '{}' $SITE/ebay/account-deletion)"
echo "POST with a garbage signature -> $(curl -s -X POST -o /dev/null -w '%{http_code}' -H 'X-EBAY-SIGNATURE: garbage' -d '{}' $SITE/ebay/account-deletion)"
```

Expected: the two JSON lines are identical; then `400`, `412`, `412`.

- [ ] **Step 5: Commit**

```bash
git add convex/http.ts convex/convex.config.ts convex/_generated/server.d.ts
git commit -m "feat: serve eBay's account-deletion handshake and notifications" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Deploy the endpoint to prod and register it (owner-gated)

Every prod command needs an explicit yes from the owner in chat first. Prod stays on its current settings; only new code ships.

**Files:** none.

- [ ] **Step 1: Ask for the yes**

Ask the owner: "Deploy the account-deletion endpoint to prod now? It only adds a new route and table, nothing existing changes."

- [ ] **Step 2: Generate the prod token and set it**

```bash
TOKEN=$(node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))")
npx convex env set --prod "EBAY_DELETION_VERIFICATION_TOKEN=$TOKEN"
echo "$TOKEN"
```

Keep the printed token to give to the owner in step 5. It is a proof-of-ownership token for eBay's handshake, not a login secret.

- [ ] **Step 3: Deploy the backend to prod**

```bash
npx convex deploy --yes < /dev/null
```

Expected: `Deployed Convex functions to https://adjoining-gerbil-124.convex.cloud`.

- [ ] **Step 4: Check the live prod endpoint the same way as on dev**

Shell variables do not survive between separate commands, so read the token back from prod:

```bash
TOKEN=$(npx convex env get --prod EBAY_DELETION_VERIFICATION_TOKEN)
SITE=https://adjoining-gerbil-124.convex.site
echo "GET handshake:"; curl -s "$SITE/ebay/account-deletion?challenge_code=abc"; echo
echo "expected:"; node -e "console.log(JSON.stringify({challengeResponse: require('crypto').createHash('sha256').update('abc' + process.argv[1] + process.argv[2]).digest('hex')}))" "$TOKEN" "$SITE/ebay/account-deletion"
echo "POST with no signature -> $(curl -s -X POST -o /dev/null -w '%{http_code}' -d '{}' $SITE/ebay/account-deletion)"
```

Expected: identical JSON lines, then `412`.

- [ ] **Step 5: Give the owner the portal steps**

Tell the owner, in plain words:

1. Open https://developer.ebay.com, then Application Keys, and find the **Production** keyset.
2. Open **Alerts and Notifications** (link next to the keyset, or under the account menu).
3. Under **Marketplace Account Deletion** fill in: the alert email; **Notification endpoint URL** `https://adjoining-gerbil-124.convex.site/ebay/account-deletion`; **Verification token** the token from step 2. Leave the "Not persisting eBay data" exemption switched **off**.
4. Click **Save**. eBay immediately calls the endpoint and the keyset should turn active. If eBay reports a failed challenge, paste the message to the executor.
5. Optionally use **Send test notification**; the endpoint answers 412 or 200 and nothing is deleted.

- [ ] **Step 6: Wait for the owner's confirmation**

Do not continue to Task 8's prod steps until the owner confirms eBay accepted the endpoint. Tasks 5 to 7 (code) can proceed meanwhile.

---

### Task 5: Production mode

**Files:**
- Modify: `convex/ebay/index.ts`, `convex/ebay/types.ts`, `convex/http.ts`, `convex/ebayAuth.ts`, `convex/listingPublish.ts`, `convex/convex.config.ts`, `convex/schema.ts` (comments only), `tests/convex/ebay.test.ts`
- Create: `tests/ebay/mode.test.ts`

**Interfaces:**
- Consumes: `getEbayEnv` (Task 2; Step 2 below rewrites `convex/ebay/index.ts` and keeps it).
- Produces: `getEbayMode(): "mock" | "sandbox" | "production"`; `getEbayPublisher(forceMock?: boolean): EbayPublisher`; a `connect` result `{ mode: "sandbox" | "production"; authorizeUrl: string }` in real modes.

- [ ] **Step 1: Write the failing tests**

`tests/ebay/mode.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { getEbayEnv, getEbayMode } from "../../convex/ebay";

afterEach(() => {
  delete process.env.EBAY_MODE;
});

describe("getEbayMode", () => {
  it("defaults to mock so an unset mode can never block the demo", () => {
    expect(getEbayMode()).toBe("mock");
    process.env.EBAY_MODE = "nonsense";
    expect(getEbayMode()).toBe("mock");
  });

  it("reads sandbox and production, ignoring case and spaces", () => {
    process.env.EBAY_MODE = " Sandbox ";
    expect(getEbayMode()).toBe("sandbox");
    process.env.EBAY_MODE = "PRODUCTION";
    expect(getEbayMode()).toBe("production");
  });
});

describe("getEbayEnv", () => {
  it("is null in demo mode and the mode itself otherwise", () => {
    expect(getEbayEnv()).toBeNull();
    process.env.EBAY_MODE = "sandbox";
    expect(getEbayEnv()).toBe("sandbox");
    process.env.EBAY_MODE = "production";
    expect(getEbayEnv()).toBe("production");
  });
});
```

Add to `tests/convex/ebay.test.ts` (append at the end):

```ts
describe("production mode", () => {
  it("connect in production mode sends the seller to eBay's production consent page", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");

    process.env.EBAY_MODE = "production";
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_RU_NAME = "ru-name";
    try {
      const result = await alice.as.mutation(api.ebayAuth.connect, { postalCode: "94105" });

      expect(result.mode).toBe("production");
      expect(result.authorizeUrl).toContain("https://auth.ebay.com/oauth2/authorize");
      expect(result.authorizeUrl).not.toContain("sandbox");
    } finally {
      delete process.env.EBAY_MODE;
      delete process.env.EBAY_CLIENT_ID;
      delete process.env.EBAY_RU_NAME;
    }
  });
});
```

Run: `npx vitest run tests/ebay/mode.test.ts tests/convex/ebay.test.ts`
Expected: FAIL (production is treated as mock).

- [ ] **Step 2: Rewrite `convex/ebay/index.ts`** (full replacement)

```ts
import { env } from "../_generated/server";
import { createMockPublisher } from "./mock";
import { createSandboxPublisher } from "./sandbox";
import type { EbayEnv, EbayPublisher } from "./types";

export * from "./types";

export type EbayMode = "mock" | EbayEnv;

/** Defaults to "mock" — an unset EBAY_MODE must never block the demo. */
export function getEbayMode(): EbayMode {
  const value = env.EBAY_MODE?.trim().toLowerCase();
  return value === "sandbox" || value === "production" ? value : "mock";
}

/** eBay's environment for the current mode, or null in demo mode (no eBay calls). */
export function getEbayEnv(): EbayEnv | null {
  const mode = getEbayMode();
  return mode === "mock" ? null : mode;
}

/** `forceMock` is for demo rooms, which must never reach real eBay. */
export function getEbayPublisher(forceMock = false): EbayPublisher {
  const mode = getEbayMode();
  return forceMock || mode === "mock" ? createMockPublisher() : createSandboxPublisher(mode);
}
```

- [ ] **Step 3: Update the comments this change makes untrue**

`convex/ebay/types.ts`, replace:

```ts
/** This app only ever targets sandbox — "production" exists so the code
 * isn't hardcoded to one host, not because this build supports going live. */
export type EbayEnv = "sandbox" | "production";
```

with:

```ts
/** "sandbox" for development and testing, "production" for real sellers. */
export type EbayEnv = "sandbox" | "production";
```

`convex/convex.config.ts`, replace `/** "mock" | "sandbox". Defaults to "mock" if unset — the demo always works. */` with:

```ts
    /** "mock" | "sandbox" | "production". Defaults to "mock" if unset — the demo always works. */
```

`convex/schema.ts`, replace `/** "mock" | "sandbox" — which mode actually produced this result. */` with `/** "mock" | "sandbox" | "production" — which mode actually produced this result. */`, and replace `/** "mock" | "sandbox". */` (on the `ebayConnections.mode` field) with `/** "mock" | "sandbox" | "production". */`.

`convex/ebayAuth.ts`, replace the doc comment above `connect`:

```ts
/** Mock mode connects instantly (no OAuth). Sandbox mode returns the
 * consent URL for the client to open in a popup. */
```

with:

```ts
/** Mock mode connects instantly (no OAuth). Sandbox and production return the
 * consent URL for the client to open in a popup. */
```

- [ ] **Step 4: Use the mode's environment in the callback, `convex/http.ts`**

Add `getEbayEnv` to the imports (new line below the `./ebay/oauth` import):

```ts
import { getEbayEnv } from "./ebay";
```

In the `/ebay/callback` handler, insert this directly after the `pending === null` block (before the `clientId` line):

```ts
    const ebayEnv = getEbayEnv();
    if (ebayEnv === null) {
      return page(false, "eBay isn't set up for real connections on this server.");
    }
```

Change `env: "sandbox",` inside `exchangeCodeForTokens({ ... })` to `env: ebayEnv,`, and change `mode: "sandbox",` inside the `saveConnection` call to `mode: ebayEnv,`.

- [ ] **Step 5: Use the mode's environment in `convex/ebayAuth.ts`**

In `connect`, after the mock branch, change these two places. Replace:

```ts
        "eBay sandbox isn't configured yet — EBAY_CLIENT_ID and EBAY_RU_NAME must be set in the Convex environment.",
```

with:

```ts
        `eBay ${mode} isn't configured yet — EBAY_CLIENT_ID and EBAY_RU_NAME must be set in the Convex environment.`,
```

and replace:

```ts
    const authorizeUrl = buildAuthorizeUrl({ env: "sandbox", clientId, ruName, state });

    return { mode: "sandbox" as const, authorizeUrl };
```

with:

```ts
    const authorizeUrl = buildAuthorizeUrl({ env: mode, clientId, ruName, state });

    return { mode, authorizeUrl };
```

(After the `if (mode === "mock") { ... return }` block TypeScript narrows `mode` to `"sandbox" | "production"`, which is exactly `EbayEnv`.)

- [ ] **Step 6: Use the mode's environment in `convex/listingPublish.ts`**

Update the imports: change the ebay import line to

```ts
import { EbayError, getEbayEnv, getEbayMode, getEbayPublisher, type EbayEnv, type PublishInput } from "./ebay";
```

In `getValidAccessToken`, replace the mock branch:

```ts
  if (connection.mode === "mock") {
    return { accessToken: connection.accessToken, mode: "mock", connection };
  }
```

with:

```ts
  const ebayEnv = getEbayEnv();
  if (ebayEnv === null) {
    return { accessToken: connection.accessToken, mode: "mock", connection };
  }
```

(The line above it already returns null unless the connection's mode equals the configured mode, so `ebayEnv === null` is exactly the mock case, and after it `ebayEnv` is a real `EbayEnv`.) Then, in the same function, change the refresh call's `env: "sandbox",` to `env: ebayEnv,`. The `getEbayMode()` call on the line above stays.

Rename `buildSandboxInput` to `buildLiveInput` and give it the environment as a new second parameter. Replace its signature and the four `"sandbox"` uses:

```ts
async function buildLiveInput(
  ctx: ActionCtx,
  ebayEnv: EbayEnv,
  userId: Id<"users">,
  auth: { accessToken: string; connection: Doc<"ebayConnections"> },
  context: PublishContext,
  imageUrl: string,
  base: PublishBase,
): Promise<PublishInput> {
```

Inside it: `ensureSellerSetup({ env: ebayEnv, ... })`, `getAppAccessToken({ env: ebayEnv, clientId, clientSecret })`, `resolveListingSpec({ env: ebayEnv, ... })`, and the returned object's `env: ebayEnv,`.

In `publishOne`, replace the block from the `// Demo mode never looks at the image or eBay, so it stays free.` comment through the `const result = await getEbayPublisher().publish(input);` line (it currently branches on `auth.mode === "mock"` and calls `buildSandboxInput`) with:

```ts
      const liveEnv = getEbayEnv();

      // Demo mode never looks at the image or eBay, so it stays free. The mock
      // publisher ignores the input's environment.
      const input: PublishInput =
        liveEnv === null
          ? { accessToken: auth.accessToken, env: "sandbox", listing: { ...base, imageUrl } }
          : await buildLiveInput(ctx, liveEnv, args.userId, auth, context, imageUrl, base);

      const result = await getEbayPublisher().publish(input);
```

(Task 7 adds the demo-room rule on top of this.)

- [ ] **Step 7: Run everything, push to dev, commit**

```bash
npx vitest run
npx tsc --noEmit -p convex/tsconfig.json
npx convex dev --once
git add convex/ebay/index.ts convex/ebay/types.ts convex/http.ts convex/ebayAuth.ts convex/listingPublish.ts convex/convex.config.ts convex/schema.ts convex/_generated/api.d.ts tests/ebay/mode.test.ts tests/convex/ebay.test.ts
git commit -m "feat: add a production mode for real eBay sellers" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Expected: all tests pass; typecheck prints nothing; push succeeds.

---

### Task 6: eBay user ID at connect

**Files:**
- Create: `convex/ebay/identity.ts`, `tests/ebay/identity.test.ts`
- Modify: `convex/ebay/http.ts`, `convex/ebay/oauth.ts`, `convex/ebayAuth.ts`, `convex/http.ts`, `tests/ebay/fakeFetch.ts`, `tests/ebay/oauth.test.ts`, `tests/convex/ebay.test.ts`

**Interfaces:**
- Produces:
  - `apizBase(env: EbayEnv): string` and `ebayRequest(env, accessToken, method, path, body?, host?: "api" | "apiz")` (default `"api"`), from `convex/ebay/http.ts`
  - `parseEbayUserId(payload: unknown): string | null` and `fetchEbayUserId(env: EbayEnv, accessToken: string): Promise<string>` from `convex/ebay/identity.ts`
  - `internal.ebayAuth.saveConnection` gains `ebayUserId?: string`
  - `api.ebayAuth.connectionStatus` production rule: connected only with a ZIP and an `ebayUserId`

- [ ] **Step 1: Let the fake report the host, `tests/ebay/fakeFetch.ts`**

Change the `FakeCall` type and where a call is built:

```ts
export type FakeCall = { method: string; host: string; path: string; query: string; body: unknown };
```

and in the `const call: FakeCall = { ... }` object add `host: url.host,` as the second property (after `method,`).

- [ ] **Step 2: Write the failing tests**

`tests/ebay/identity.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEbayUserId, parseEbayUserId } from "../../convex/ebay/identity";
import { fakeEbay } from "./fakeFetch";

afterEach(() => vi.unstubAllGlobals());

describe("parseEbayUserId", () => {
  it("reads the immutable user ID", () => {
    expect(parseEbayUserId({ userId: "abc123", username: "seller", accountType: "INDIVIDUAL" })).toBe("abc123");
  });

  it("returns null when it is missing or not text", () => {
    expect(parseEbayUserId({})).toBeNull();
    expect(parseEbayUserId({ userId: "" })).toBeNull();
    expect(parseEbayUserId({ userId: 5 })).toBeNull();
    expect(parseEbayUserId(null)).toBeNull();
  });
});

describe("fetchEbayUserId", () => {
  it("asks the Identity API host, not the regular one", async () => {
    const calls = fakeEbay({
      "GET /commerce/identity/v1/user/": () => ({ status: 200, json: { userId: "u1", username: "seller" } }),
    });

    expect(await fetchEbayUserId("production", "seller-token")).toBe("u1");
    expect(calls[0].host).toBe("apiz.ebay.com");

    await fetchEbayUserId("sandbox", "seller-token");
    expect(calls[1].host).toBe("apiz.sandbox.ebay.com");
  });

  it("fails clearly when eBay does not return an ID", async () => {
    fakeEbay({ "GET /commerce/identity/v1/user/": () => ({ status: 200, json: {} }) });

    await expect(fetchEbayUserId("production", "seller-token")).rejects.toThrow(
      "eBay didn't return your account ID.",
    );
  });
});
```

Append to `tests/ebay/oauth.test.ts`:

```ts
describe("consent and refresh scopes", () => {
  it("asks for the identity permission at connect", () => {
    const url = buildAuthorizeUrl({ env: "production", clientId: "id", ruName: "ru", state: "s" });

    expect(url).toContain("auth.ebay.com");
    expect(decodeURIComponent(url)).toContain("commerce.identity.readonly");
  });

  it("refreshes with only the original scopes, so older connections still refresh", async () => {
    const calls = fakeEbay({
      "POST /identity/v1/oauth2/token": () => ({ status: 200, json: { access_token: "fresh", expires_in: 7200 } }),
    });

    await refreshAccessToken({ env: "production", clientId: "id", clientSecret: "secret", refreshToken: "r" });

    const sent = decodeURIComponent(String(calls[0].body));
    expect(sent).toContain("sell.inventory");
    expect(sent).toContain("sell.account");
    expect(sent).not.toContain("commerce.identity");
  });
});
```

Then change the file's existing first import from `import { getAppAccessToken } from "../../convex/ebay/oauth";` to:

```ts
import { buildAuthorizeUrl, getAppAccessToken, refreshAccessToken } from "../../convex/ebay/oauth";
```

(`fakeEbay`, `afterEach`, `describe`, `expect`, `it` and `vi` are already imported there.)

Append to `tests/convex/ebay.test.ts`:

```ts
describe("production connections need the seller's eBay ID", () => {
  const connect = async (t: ReturnType<typeof newTest>, userId: Id<"users">, extra: Record<string, string>) =>
    await t.mutation(internal.ebayAuth.saveConnection, {
      userId,
      accessToken: "token",
      refreshToken: "refresh",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      mode: "production",
      shipFromPostalCode: "94105",
      ...extra,
    });

  it("counts as connected only with a ZIP and an eBay user ID", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    await connect(t, alice.userId, { ebayUserId: "ebay-alice" });
    await connect(t, bob.userId, {});

    process.env.EBAY_MODE = "production";
    try {
      expect((await alice.as.query(api.ebayAuth.connectionStatus, {})).connected).toBe(true);
      expect((await bob.as.query(api.ebayAuth.connectionStatus, {})).connected).toBe(false);
    } finally {
      delete process.env.EBAY_MODE;
    }
  });

  it("keeps working for older sandbox connections that have no eBay ID", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    await t.mutation(internal.ebayAuth.saveConnection, {
      userId: alice.userId,
      accessToken: "token",
      refreshToken: "refresh",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      mode: "sandbox",
      shipFromPostalCode: "94105",
    });

    process.env.EBAY_MODE = "sandbox";
    try {
      expect((await alice.as.query(api.ebayAuth.connectionStatus, {})).connected).toBe(true);
    } finally {
      delete process.env.EBAY_MODE;
    }
  });
});
```

Add `import type { Id } from "../../convex/_generated/dataModel";` to the top of `tests/convex/ebay.test.ts`.

Run: `npx vitest run tests/ebay tests/convex/ebay.test.ts`
Expected: FAIL (`identity` module missing, `ebayUserId` not accepted, scopes unchanged).

- [ ] **Step 3: Let the request helper reach the Identity API host, `convex/ebay/http.ts`**

Replace the file's `apiBase` function and the start of `ebayRequest` so the file begins:

```ts
import { EbayError, type EbayEnv } from "./types";

export function apiBase(env: EbayEnv): string {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

/** The Identity API lives on its own host. */
export function apizBase(env: EbayEnv): string {
  return env === "production" ? "https://apiz.ebay.com" : "https://apiz.sandbox.ebay.com";
}

export async function ebayRequest(
  env: EbayEnv,
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
  host: "api" | "apiz" = "api",
): Promise<Record<string, unknown>> {
  const base = host === "apiz" ? apizBase(env) : apiBase(env);
  const response = await fetch(`${base}${path}`, {
```

(Everything after `const response = await fetch(` — headers, body, error handling, parsing — stays exactly as it is.)

- [ ] **Step 4: Create `convex/ebay/identity.ts`**

```ts
import { ebayRequest } from "./http";
import { EbayError, type EbayEnv } from "./types";

export function parseEbayUserId(payload: unknown): string | null {
  const userId = (payload as { userId?: unknown } | null)?.userId;
  return typeof userId === "string" && userId !== "" ? userId : null;
}

/** eBay's own immutable ID for the seller who just connected. */
export async function fetchEbayUserId(env: EbayEnv, accessToken: string): Promise<string> {
  const payload = await ebayRequest(
    env,
    accessToken,
    "GET",
    "/commerce/identity/v1/user/",
    undefined,
    "apiz",
  );
  const userId = parseEbayUserId(payload);
  if (userId === null) throw new EbayError("eBay didn't return your account ID.");
  return userId;
}
```

- [ ] **Step 5: Split the scopes in `convex/ebay/oauth.ts`**

Replace the `SCOPES` constant and its comment with:

```ts
// sell.account is needed to provision the seller's location and business
// policies; commerce.identity.readonly lets us learn their eBay user ID so we
// can honor account-deletion notices.
const CONSENT_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
].join(" ");

// A refresh may only ask for scopes the original grant had; connections made
// before the identity scope existed do not have it, and it is only needed once.
const REFRESH_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
].join(" ");
```

In `buildAuthorizeUrl` change `url.searchParams.set("scope", SCOPES);` to `url.searchParams.set("scope", CONSENT_SCOPES);`. In `refreshAccessToken` change `scope: SCOPES,` to `scope: REFRESH_SCOPES,`.

- [ ] **Step 6: Save the eBay user ID in `convex/ebayAuth.ts`**

Add `ebayUserId?: string;` to the `fields` type of `upsertConnection` (after `shipFromPostalCode?: string;`). Add this line to `saveConnection`'s `args` (after `shipFromPostalCode: v.optional(v.string()),`):

```ts
    ebayUserId: v.optional(v.string()),
```

In `connectionStatus`, replace the comment and the `usable` expression:

```ts
    // A demo connection can't publish to real eBay (or the reverse), and a real
    // one needs the seller's ZIP, so after a mode switch or for an older
    // connection the user is asked to connect again instead of failing later.
    const usable =
      connection !== null &&
      connection.mode === configuredMode &&
      (configuredMode === "mock" || connection.shipFromPostalCode !== undefined);
```

with:

```ts
    // A demo connection can't publish to real eBay (or the reverse), and a real
    // one needs the seller's ZIP (and, in production, their eBay user ID, which
    // deletion notices are matched on), so after a mode switch or for an older
    // connection the user is asked to connect again instead of failing later.
    const usable =
      connection !== null &&
      connection.mode === configuredMode &&
      (configuredMode === "mock" || connection.shipFromPostalCode !== undefined) &&
      (configuredMode !== "production" || connection.ebayUserId !== undefined);
```

- [ ] **Step 7: Look up and save the ID in the callback, `convex/http.ts`**

Add the import (below the `getEbayEnv` import):

```ts
import { fetchEbayUserId } from "./ebay/identity";
```

In the callback's `try` block, insert this directly after the `exchangeCodeForTokens` call and before `saveConnection`:

```ts
      const ebayUserId = await fetchEbayUserId(ebayEnv, tokens.accessToken);
```

and add this property to the `saveConnection` argument object (after `shipFromPostalCode: pending.postalCode ?? undefined,`):

```ts
        ebayUserId,
```

(A failed lookup throws inside the existing `try`, so the callback shows its error page and saves nothing.)

- [ ] **Step 8: Run everything, push to dev, commit**

```bash
npx vitest run
npx tsc --noEmit -p convex/tsconfig.json
npx convex dev --once
git add convex/ebay/http.ts convex/ebay/identity.ts convex/ebay/oauth.ts convex/ebayAuth.ts convex/http.ts convex/_generated/api.d.ts tests/ebay/fakeFetch.ts tests/ebay/identity.test.ts tests/ebay/oauth.test.ts tests/convex/ebay.test.ts
git commit -m "feat: save each seller's eBay user ID when they connect" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Expected: all tests pass; typecheck prints nothing; push succeeds.

- [ ] **Step 9: Live check on dev (owner-assisted)**

Nothing above proves that eBay's sandbox accepts the new scope or that the sandbox Identity host answers, and sandbox connects on prod go through the same code. Ask the owner to hard-refresh the dev app, enter a ZIP, click **Connect eBay** and sign in with the sandbox seller test user. Expected: the popup says "eBay connected." Then check, printing no tokens (do **not** use `npx convex data`, it prints them), with a one-off query that returns only `{ mode, hasEbayUserId }` per `ebayConnections` row. Expected: the owner's row has `hasEbayUserId: true`.

If the popup reports `invalid_scope`, the sandbox keyset lacks `commerce.identity.readonly`: the owner enables it in the developer portal (Application Keys, OAuth Scopes) and retries. If it says "eBay didn't return your account ID.", get eBay's actual Identity response and adjust `parseEbayUserId`. If the owner cannot check now, carry on but list this as unverified in the final report.

---

### Task 7: Demo rooms never reach real eBay; UI ZIP for production

**Files:**
- Modify: `convex/listingPublish.ts`, `src/components/EbayConnectButton.tsx`, `tests/convex/ebay.test.ts`

**Interfaces:**
- Consumes: `getEbayPublisher(forceMock?: boolean)` (Task 5).
- Produces: `contextForPublish` also returns `isDemo: boolean`.

- [ ] **Step 1: Write the failing test** (append to `tests/convex/ebay.test.ts`)

```ts
describe("demo rooms never reach real eBay", () => {
  it("publishes a demo room's listing through the simulated publisher in production mode", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Demo room" });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["x"])));
    await t.run(async (ctx) => {
      await ctx.db.patch("cleanouts", cleanoutId, { imageStorageId: storageId, isDemo: true });
      const now = Date.now();
      await ctx.db.insert("ebayConnections", {
        userId: alice.userId,
        accessToken: "token",
        refreshToken: "refresh",
        accessTokenExpiresAt: now + 3_600_000,
        mode: "production",
        connectedAt: now,
        updatedAt: now,
        shipFromPostalCode: "94105",
        ebayUserId: "ebay-alice",
      });
    });
    const listingId = await seedListing(t, cleanoutId, await seedItem(t, cleanoutId), "publishing");

    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("a demo room must not touch the network");
      }),
    );
    process.env.EBAY_MODE = "production";
    try {
      await t.action(internal.listingPublish.publishOne, { listingId, userId: alice.userId });
      // Publishing schedules the live-listing email; let it finish so it cannot
      // run after the test. (Real timers: the simulated publisher sleeps 600 ms.)
      await new Promise((resolve) => setTimeout(resolve, 50));
      await t.finishInProgressScheduledFunctions();
    } finally {
      delete process.env.EBAY_MODE;
      vi.unstubAllGlobals();
    }

    const listing = await t.run(async (ctx) => await ctx.db.get("listings", listingId));
    expect(listing?.status).toBe("live");
    expect(listing?.publishMode).toBe("mock");
    expect(listing?.ebayListingUrl).toContain("mock");
  });
});
```

Run: `npx vitest run tests/convex/ebay.test.ts`
Expected: FAIL (the demo room takes the real path, hits the stubbed network and the listing ends up `failed`).

- [ ] **Step 2: Return `isDemo` from `contextForPublish` in `convex/listingPublish.ts`**

In the returned object of `contextForPublish`, add this property after `imageUrl,`:

```ts
      isDemo: cleanout?.isDemo === true,
```

- [ ] **Step 3: Route demo rooms to the simulated publisher in `publishOne`**

Replace the block from `const liveEnv = getEbayEnv();` (added in Task 5) through the `const result = await getEbayPublisher().publish(input);` line with:

```ts
      const ebayEnv = getEbayEnv();
      // A demo room's items are not real, so in production they are simulated
      // exactly like demo mode: nothing is sent to eBay and nothing is billed.
      const liveEnv = ebayEnv === "production" && context.isDemo ? null : ebayEnv;

      // Simulated listings never look at the image or eBay, so they stay free.
      // The mock publisher ignores the input's environment.
      const input: PublishInput =
        liveEnv === null
          ? { accessToken: auth.accessToken, env: "sandbox", listing: { ...base, imageUrl } }
          : await buildLiveInput(ctx, liveEnv, args.userId, auth, context, imageUrl, base);

      const result = await getEbayPublisher(liveEnv === null).publish(input);
```

and in the `markPublished` call change `mode: auth.mode,` to `mode: liveEnv === null ? "mock" : auth.mode,`.

- [ ] **Step 4: Show the ZIP field for any real eBay mode, `src/components/EbayConnectButton.tsx`**

Change:

```tsx
  const needsZip = status.configuredMode === "sandbox";
```

to:

```tsx
  const needsZip = status.configuredMode !== "mock";
```

- [ ] **Step 5: Run everything, push to dev, commit**

```bash
npx vitest run
npx tsc --noEmit -p convex/tsconfig.json
npm run typecheck
npm run build
npx convex dev --once
git add convex/listingPublish.ts convex/_generated/api.d.ts src/components/EbayConnectButton.tsx tests/convex/ebay.test.ts
git commit -m "feat: keep demo rooms off real eBay in production mode" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Expected: all tests pass; both typechecks clean; build succeeds; push succeeds.

- [ ] **Step 6: Log the work in `hackathon.md`**

Read `.claude/skills/convex-hackathon-skill/SKILL.md` and its `references/log-format.md`, then append one entry per commit made in Tasks 1 to 7, oldest to newest (list them with `TZ=UTC git log --reverse --format='%h %ad %s' --date=format-local:%Y-%m-%d feature/ebay-seller-setup..HEAD`). Summarize behavior first, then name the main files and Convex features (HTTP actions, internal actions, schema and indexes, WebCrypto signature verification). Never write an email address, a token, the verification token or the Cert ID. Bump `Last updated` to the latest logged evidence in UTC. Leave `hackathon.md` uncommitted: it still holds the earlier uncommitted backfill, and Task 8 Step 6 asks the owner whether to commit it.

---

### Task 8: Production rollout and first real test (owner-gated)

Every prod command needs an explicit yes from the owner in chat first. Requires Task 4's portal step to be confirmed and the owner's **production RuName**.

**Files:** none in the repo.

- [ ] **Step 1: Get the two owner inputs**

Ask the owner for: (a) the production RuName string (accepted URL `https://adjoining-gerbil-124.convex.site/ebay/callback`), and (b) their yes to switch prod to real eBay: "Prod will publish real, live eBay listings that can carry fees. We'll test with one cheap item and end it right away."

- [ ] **Step 2: Deploy the backend and site to prod**

```bash
npx convex deploy --yes < /dev/null
npx @convex-dev/static-hosting upload --build --prod < /dev/null
```

Expected: `Deployed Convex functions to https://adjoining-gerbil-124.convex.cloud` and `Upload complete!`. Prod is still in sandbox mode with its sandbox keys, so nothing changes for users yet, except that a sandbox connect on prod now also asks for the identity permission and looks up the seller's eBay user ID (Task 6 Step 9 checked this on dev).

- [ ] **Step 3: Set the production settings, then flip the mode last**

Set the non-secret values (replace `<PROD_RUNAME>` with the RuName the owner gave):

```bash
npx convex env set --prod "EBAY_CLIENT_ID=AaashAga-convexha-PRD-7a22f5e1c-48b2a292"
npx convex env set --prod "EBAY_RU_NAME=<PROD_RUNAME>"
```

The owner sets the secret with the clipboard (PowerShell; copy the production Cert ID first, never paste it into chat again):

```powershell
Get-Clipboard | npx convex env set --prod EBAY_CLIENT_SECRET
```

Then, once all three are set, switch the mode:

```bash
npx convex env set --prod EBAY_MODE production
```

There is a short window between the first and last command where prod has production keys but sandbox mode; do the four commands back to back. Verify the names (values are not printed):

```bash
npx convex env list --prod | cut -d= -f1 | grep -E "^EBAY" | sort
```

Expected: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_DELETION_VERIFICATION_TOKEN`, `EBAY_MODE`, `EBAY_RU_NAME`, and no `EBAY_ACTIVITY_MODE` (or the value `mock`). The real-offer adapter (`convex/marketplace/ebay.ts`) is hard-wired to eBay's sandbox endpoint, so `EBAY_ACTIVITY_MODE=ebay` must never be set while prod is in production mode; offers stay simulated, as before.

- [ ] **Step 4: Smoke-check prod**

```bash
S=https://adjoining-gerbil-124.convex.site
echo "GET / -> $(curl -s -o /dev/null -w '%{http_code}' $S/)"
echo "POST /ebay/account-deletion (no signature) -> $(curl -s -X POST -o /dev/null -w '%{http_code}' -d '{}' $S/ebay/account-deletion)"
```

Expected: `200`, then `412`.

- [ ] **Step 5: Owner: the first real connection and one cheap listing**

Ask the owner to: hard-refresh the prod site, sign in, open the review step, enter their ZIP, click **Connect eBay**, and log in with their **real** eBay account. The consent screen should list the identity permission alongside selling access. Then publish **one cheap real item** (not the sample room, which is simulated on purpose), open the resulting listing on ebay.com, and **end the listing** in Seller Hub straight away.

If connect fails with an invalid-scope message, the production keyset lacks `commerce.identity.readonly`: the owner enables it in the developer portal and retries. If the location step fails, report eBay's exact message.

- [ ] **Step 6: Wrap up**

Ask the owner whether to merge `feature/ebay-production` (and the earlier `feature/ebay-seller-setup` and `feature/google-auth`) into `main`, and whether to commit the refreshed `hackathon.md`. Do neither without a yes.

---

## Self-review (spec coverage)

| Spec section | Where it is implemented |
|---|---|
| 3.1 Endpoint: handshake GET | Tasks 1 (`challengeResponse`), 3 (route), 3 step 4 (live dev check), 4 (prod check) |
| 3.1 POST: signature verification, key fetch and cache, 412/200/500 rules | Tasks 1 (verification), 2 (`handle`, key cache, tests for every status). The spec calls the action `process`; the plan names it `handle` so it does not shadow the `process` global |
| 3.1 Deletion of the matching connection only, unknown user harmless | Task 2 (`deleteByEbayUserId`, tests) |
| 3.1 Schema (`ebayUserId`, `by_ebayUserId`, `ebayPublicKeys`) | Task 2 |
| 3.2 `EBAY_MODE` production, `getEbayEnv`, every hard-coded "sandbox" replaced | Tasks 2 (`getEbayEnv`) and 5 |
| 3.2 Scopes: identity added at connect; refresh unchanged | Task 6 |
| 3.2 UI ZIP for any real mode; labels follow the mode | Task 7 (labels already follow the mode: `SaleReview` shows "eBay" unless sandbox) |
| 3.2 Demo rooms never reach real eBay | Task 7 |
| 3.3 eBay user ID at connect from the Identity API; failure saves nothing; status rules | Task 6 |
| 3.4 Testing (pure, Convex, HTTP) | Tasks 1, 2, 5, 6, 7 (tests); HTTP layer checked live in Task 3 step 4 and Task 4 step 4 |
| 3.5 Rollout in two owner-gated steps, first real test | Tasks 4 and 8 |
| 4 Risks: production billing, missing identity scope, unverified payload fields, no sandbox notifications | Task 8 step 5 (cheap test, scope fallback); Task 1 (`readDeletedUserId` reads defensively); Task 2 (acknowledge anything unmatched) |
| 5 Out of scope | Not planned: buyer-offer sync, real shipping cost, growth check, multi-marketplace |
