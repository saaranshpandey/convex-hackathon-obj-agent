# Phase 6: eBay Marketplace Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user connect their eBay account (OAuth, no password ever collected) and publish an approved listing to real eBay Sandbox with one click, with a `mock` mode that fully simulates the same flow with zero external dependencies so the demo always works. Extend the listing lifecycle from Phase 5's `draft/approved/listed` to the full `draft/approved/publishing/live/failed/ended/sold`, with clear human-readable errors and duplicate-click-proof publishing.

**Architecture:** New `convex/ebay/` folder holds the provider split this phase explicitly asks for (`EBAY_MODE=mock|sandbox`) — mirrors `convex/segmentation/`'s mock/real pattern. OAuth mechanics (authorize URL, code exchange, token refresh) live in `convex/ebay/oauth.ts` since they're identical regardless of mode (mock mode just never calls them). A new Convex HTTP endpoint (`convex/http.ts`, new file) receives eBay's OAuth redirect — opened in a popup window, so the main app tab never navigates away and picks up the new connection automatically through Convex's normal reactivity once the callback saves it. Publishing follows the same "flip status to claim the job, then run an internalAction" pattern already proven in `research.ts`, so duplicate clicks are rejected server-side, not just disabled client-side.

**Tech Stack:** Same as before — Convex (schema, HTTP actions, mutations, internal actions), plain `fetch` calls to eBay's Identity API (OAuth) and Sell Inventory API (listing creation/publish), React 19 + Tailwind.

**Spec:** Given verbatim by the user in conversation — reproduced below so it travels with the plan.

```text
PHASE 6: EBAY MARKETPLACE INTEGRATION

Integrate eBay. Use OAuth. Never collect or store an eBay password.

Support two modes: EBAY_MODE=mock, EBAY_MODE=sandbox. Mock mode must remain
usable for demos if eBay sandbox is unavailable.

Implement: connect eBay; OAuth callback; securely store/refresh authorization
tokens; create marketplace listing from approved draft; publish listing in
sandbox; save eBay listing ID and URL/status; update listing status in
Convex.

Listing lifecycle: draft, approved, publishing, live, failed, ended, sold.

UI: header shows "Connected / eBay ✓". For each object: name, price,
"● Live on eBay", [View listing]. Do not expose raw OAuth/API complexity.
Add robust human-readable error states.

TEST: OAuth succeeds; disconnected state works; approved item publishes;
unapproved item cannot publish; marketplace ID saved; failed API request
shows retry; duplicate clicks cannot create duplicate listings; mock mode
works independently; sandbox mode works. Stop after Phase 6.
```

The user's own framing for this phase: **"write code; I'll give you eBay creds later for testing, you do everything both modes."** So: build both modes fully now. Sandbox mode cannot be *exercised* against real eBay until real credentials exist (they don't yet), so Task 8's verification tests mock mode end-to-end for real and verifies sandbox mode structurally (correct code paths, clear error messages when unconfigured) — this is called out explicitly so it isn't mistaken for a real sandbox-publish proof.

## Global Constraints

- **Never handle an eBay password.** OAuth inherently satisfies this (we only ever see an authorization code and tokens) — no login form of any kind is built.
- **RuName is not a URL.** It's an opaque identifier eBay issues per app+environment; the real callback URL is configured *in eBay's developer portal* against that RuName, not passed as a literal `redirect_uri`. `EBAY_RU_NAME` in Convex env holds that opaque string.
- **OAuth happens in a popup**, not a full-page redirect: `window.open(authorizeUrl, ...)`. The main app tab keeps its state and picks up the new connection reactively (Convex query re-runs once the callback's mutation lands) — no redirect-back URL needs to be guessed or configured.
- **Tokens are never exposed to the client.** `ebayConnections` rows are read only by internal functions and the HTTP callback; the one public query (`connectionStatus`) returns only `{connected, mode}`.
- **`listingStatus` keeps Phase 5's `"listed"` literal** as a legacy alias (commented as such) rather than renaming it to `"live"` — avoids any data-migration step for whoever runs this plan; all *new* code paths use `"live"`.
- **Business-policy / location / category IDs are env vars, not looked up dynamically.** Real eBay listing creation requires the seller's account to already have fulfillment/payment/return policies and an inventory location configured (done in eBay's Seller Hub, outside this app) — `EBAY_MERCHANT_LOCATION_KEY`, `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_CATEGORY_ID` are read from env with a clear error naming exactly what's missing. No Taxonomy/Account API calls to auto-resolve these — out of scope.
- **No webhook receiver for `ended`/`sold`.** Those two lifecycle states exist in the schema (the spec's full vocabulary) but nothing in this phase transitions a listing into them automatically — real-time eBay webhook handling is out of scope here.
- **`ctx.db.get`/`.patch`/`.delete`/`.insert` take the table name as the first argument** — match exactly, as in every prior phase.
- No new test framework — verify via the running app, Convex data/run tools, and `tsc`/`vite build`, matching Phases 4-5's decision.
- Match existing code style: no comments explaining *what*, one-line *why* comments only, no unrelated refactors.

---

### Task 1: Schema — `ebayConnections` table, extended `listingStatus`, new `listings` fields, env vars

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/convex.config.ts`

**Interfaces:**
- Produces: extended `listingStatus` validator (adds `"publishing" | "live" | "failed" | "ended" | "sold"`, keeps `"listed"`); new `ebayConnections` table (indexed `by_sessionId`); new `listings` fields `ebayListingId`, `ebayOfferId`, `ebayListingUrl`, `publishError`, `publishMode`. New env vars `EBAY_MODE`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RU_NAME`, `EBAY_MERCHANT_LOCATION_KEY`, `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_CATEGORY_ID`.

- [ ] **Step 1: Extend `listingStatus` and add `listings` fields**

In `convex/schema.ts`, replace the current `listingStatus` validator:

```ts
export const listingStatus = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("listed"),
);
```

with:

```ts
export const listingStatus = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("publishing"),
  v.literal("live"),
  v.literal("failed"),
  v.literal("ended"),
  v.literal("sold"),
  // Legacy alias from Phase 5's bulk "List approved items" — no code path
  // produces this anymore (superseded by "live"), kept so existing rows
  // don't need a migration.
  v.literal("listed"),
);
```

In the `listings` table definition, add these fields after `updatedAt: v.number(),` (before the closing `})`):

```ts
    // Phase 6: eBay publish result, independent per listing.
    ebayListingId: v.optional(v.string()),
    ebayOfferId: v.optional(v.string()),
    ebayListingUrl: v.optional(v.string()),
    publishError: v.optional(v.string()),
    /** "mock" | "sandbox" — which mode actually produced this result. */
    publishMode: v.optional(v.string()),
```

- [ ] **Step 2: Add the `ebayConnections` table**

Add a new table after `listings` in the `defineSchema({...})` call:

```ts
  ebayConnections: defineTable({
    sessionId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshTokenExpiresAt: v.optional(v.number()),
    /** "mock" | "sandbox". */
    mode: v.string(),
    connectedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_sessionId", ["sessionId"]),
```

- [ ] **Step 3: Add the eBay env vars**

In `convex/convex.config.ts`, add to the `env` object (after `FIRECRAWL_API_KEY`):

```ts
    /** "mock" | "sandbox". Defaults to "mock" if unset — the demo always works. */
    EBAY_MODE: v.optional(v.string()),
    EBAY_CLIENT_ID: v.optional(v.string()),
    EBAY_CLIENT_SECRET: v.optional(v.string()),
    /** eBay's opaque OAuth redirect identifier for this app + environment — not a URL. */
    EBAY_RU_NAME: v.optional(v.string()),
    EBAY_MERCHANT_LOCATION_KEY: v.optional(v.string()),
    EBAY_FULFILLMENT_POLICY_ID: v.optional(v.string()),
    EBAY_PAYMENT_POLICY_ID: v.optional(v.string()),
    EBAY_RETURN_POLICY_ID: v.optional(v.string()),
    EBAY_CATEGORY_ID: v.optional(v.string()),
```

- [ ] **Step 4: Sync env vars and typecheck**

Run: `npx convex dev --once`
Expected: deploy succeeds.

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/convex.config.ts
git commit -m "feat: add ebayConnections table, extend listing lifecycle for Phase 6"
```

---

### Task 2: eBay OAuth mechanics

**Files:**
- Create: `convex/ebay/types.ts`
- Create: `convex/ebay/oauth.ts`

**Interfaces:**
- Produces: `EbayError` class, `EbayEnv` type (`"sandbox" | "production"`), `EbayTokens` type. `buildAuthorizeUrl(...)`, `exchangeCodeForTokens(...)`, `refreshAccessToken(...)`. Consumed by Task 4 (`http.ts`, `ebayAuth.ts`) and Task 5 (`listingPublish.ts`).

- [ ] **Step 1: Write `convex/ebay/types.ts`**

```ts
export class EbayError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "EbayError";
    this.status = status;
  }
}

/** This app only ever targets sandbox — "production" exists so the code
 * isn't hardcoded to one host, not because this build supports going live. */
export type EbayEnv = "sandbox" | "production";

export type EbayTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number | null;
};

export type EbayAccessToken = {
  accessToken: string;
  accessTokenExpiresAt: number;
};
```

- [ ] **Step 2: Write `convex/ebay/oauth.ts`**

```ts
/**
 * eBay's OAuth Identity API: builds the consent URL, exchanges an
 * authorization code for tokens, and refreshes an expired access token.
 * Identical for mock and sandbox — mock mode simply never calls these.
 */

import { EbayError, type EbayEnv, type EbayAccessToken, type EbayTokens } from "./types";

const SCOPES = "https://api.ebay.com/oauth/api_scope/sell.inventory";

function authBase(env: EbayEnv): string {
  return env === "production" ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com";
}

function apiBase(env: EbayEnv): string {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

export function buildAuthorizeUrl(input: {
  env: EbayEnv;
  clientId: string;
  ruName: string;
  state: string;
}): string {
  const url = new URL(`${authBase(input.env)}/oauth2/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.ruName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", input.state);
  return url.toString();
}

async function postTokenRequest(
  env: EbayEnv,
  clientId: string,
  clientSecret: string,
  body: URLSearchParams,
): Promise<{ access_token: string; refresh_token?: string; expires_in: number; refresh_token_expires_in?: number }> {
  const response = await fetch(`${apiBase(env)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new EbayError(
        "eBay rejected the app credentials. Check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.",
        401,
      );
    }
    throw new EbayError(
      `eBay token request failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
  };

  if (!payload.access_token || !payload.expires_in) {
    throw new EbayError("eBay returned an unexpected token response.");
  }

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_in: payload.expires_in,
    refresh_token_expires_in: payload.refresh_token_expires_in,
  };
}

export async function exchangeCodeForTokens(input: {
  env: EbayEnv;
  clientId: string;
  clientSecret: string;
  ruName: string;
  code: string;
}): Promise<EbayTokens> {
  const payload = await postTokenRequest(
    input.env,
    input.clientId,
    input.clientSecret,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.ruName,
    }),
  );

  if (!payload.refresh_token) {
    throw new EbayError("eBay did not return a refresh token.");
  }

  const now = Date.now();
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    accessTokenExpiresAt: now + payload.expires_in * 1000,
    refreshTokenExpiresAt: payload.refresh_token_expires_in
      ? now + payload.refresh_token_expires_in * 1000
      : null,
  };
}

/** Refresh responses don't include a new refresh token — the caller keeps
 * whichever one it already had stored. */
export async function refreshAccessToken(input: {
  env: EbayEnv;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<EbayAccessToken> {
  const payload = await postTokenRequest(
    input.env,
    input.clientId,
    input.clientSecret,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      scope: SCOPES,
    }),
  );

  return {
    accessToken: payload.access_token,
    accessTokenExpiresAt: Date.now() + payload.expires_in * 1000,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add convex/ebay/types.ts convex/ebay/oauth.ts
git commit -m "feat: add eBay OAuth mechanics (authorize URL, code exchange, refresh)"
```

---

### Task 3: eBay publisher abstraction (mock + sandbox)

**Files:**
- Create: `convex/ebay/mock.ts`
- Create: `convex/ebay/sandbox.ts`
- Create: `convex/ebay/index.ts`

**Interfaces:**
- Consumes: `EbayError`, `EbayEnv` from `./types` (Task 2).
- Produces: `PublishInput`, `PublishResult`, `EbayPublisher` types (added to `./types`); `createMockPublisher()`, `createSandboxPublisher(env)`, `getEbayMode()`, `getEbayPublisher()` — all consumed by Task 5 (`listingPublish.ts`).

- [ ] **Step 1: Add publisher types to `convex/ebay/types.ts`**

Append to the existing file:

```ts
export type PublishInput = {
  accessToken: string;
  env: EbayEnv;
  merchantLocationKey?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  categoryId?: string;
  listing: {
    sku: string;
    title: string;
    description: string;
    price: number;
    condition: "new" | "like_new" | "good" | "fair" | "poor";
    imageUrl: string;
  };
};

export type PublishResult = {
  ebayListingId: string;
  ebayOfferId: string;
  ebayListingUrl: string;
};

export interface EbayPublisher {
  readonly name: string;
  publish(input: PublishInput): Promise<PublishResult>;
}
```

- [ ] **Step 2: Write `convex/ebay/mock.ts`**

```ts
import type { EbayPublisher } from "./types";

/** No network calls — a believable delay and a clearly-fake listing ID/URL. */
export function createMockPublisher(): EbayPublisher {
  return {
    name: "mock",
    async publish() {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const fakeId = `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      return {
        ebayListingId: fakeId,
        ebayOfferId: `OFFER-${fakeId}`,
        ebayListingUrl: `https://www.ebay.com/itm/mock-${fakeId.toLowerCase()}`,
      };
    },
  };
}
```

- [ ] **Step 3: Write `convex/ebay/sandbox.ts`**

```ts
/**
 * Real eBay Sell Inventory API flow: createOrReplaceInventoryItem, then
 * createOffer, then publishOffer. Each stage's required fields (business
 * policies, merchant location, category) come from Convex env — this app
 * doesn't look them up dynamically, so a clear error names exactly what's
 * missing rather than failing deep inside an eBay request.
 */

import { EbayError, type EbayEnv, type EbayPublisher, type PublishInput } from "./types";

function apiBase(env: EbayEnv): string {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

const CONDITION_MAP: Record<PublishInput["listing"]["condition"], string> = {
  new: "NEW",
  like_new: "LIKE_NEW",
  good: "USED_GOOD",
  fair: "USED_ACCEPTABLE",
  poor: "USED_ACCEPTABLE",
};

async function ebayRequest(
  env: EbayEnv,
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiBase(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new EbayError("eBay rejected the access token. Reconnect your eBay account.", 401);
    }
    throw new EbayError(
      `eBay ${method} ${path} failed (${response.status}): ${detail.slice(0, 500)}`,
      response.status,
    );
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export function createSandboxPublisher(env: EbayEnv): EbayPublisher {
  return {
    name: env,
    async publish(input) {
      if (!input.merchantLocationKey) {
        throw new EbayError("EBAY_MERCHANT_LOCATION_KEY is not set in the Convex environment.");
      }
      if (!input.fulfillmentPolicyId || !input.paymentPolicyId || !input.returnPolicyId) {
        throw new EbayError(
          "EBAY_FULFILLMENT_POLICY_ID, EBAY_PAYMENT_POLICY_ID and EBAY_RETURN_POLICY_ID must all be set — create business policies in your eBay Seller Hub first.",
        );
      }
      if (!input.categoryId) {
        throw new EbayError("EBAY_CATEGORY_ID is not set in the Convex environment.");
      }

      const sku = input.listing.sku;

      await ebayRequest(env, input.accessToken, "PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
        condition: CONDITION_MAP[input.listing.condition],
        product: {
          title: input.listing.title,
          description: input.listing.description,
          imageUrls: [input.listing.imageUrl],
        },
        // No real package dimensions are known at this stage — a generic
        // small-parcel default so publish doesn't fail on a missing field.
        packageWeightAndSize: {
          weight: { value: 5, unit: "POUND" },
          dimensions: { length: 12, width: 12, height: 12, unit: "INCH" },
        },
        availability: {
          shipToLocationAvailability: { quantity: 1 },
        },
      });

      const offer = await ebayRequest(env, input.accessToken, "POST", "/sell/inventory/v1/offer", {
        sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        availableQuantity: 1,
        categoryId: input.categoryId,
        listingDescription: input.listing.description,
        pricingSummary: { price: { value: String(input.listing.price), currency: "USD" } },
        listingPolicies: {
          fulfillmentPolicyId: input.fulfillmentPolicyId,
          paymentPolicyId: input.paymentPolicyId,
          returnPolicyId: input.returnPolicyId,
        },
        merchantLocationKey: input.merchantLocationKey,
      });

      const offerId = offer.offerId;
      if (typeof offerId !== "string") {
        throw new EbayError("eBay did not return an offer ID.");
      }

      const published = await ebayRequest(
        env,
        input.accessToken,
        "POST",
        `/sell/inventory/v1/offer/${offerId}/publish`,
      );

      const listingId = published.listingId;
      if (typeof listingId !== "string") {
        throw new EbayError("eBay did not return a listing ID after publishing.");
      }

      const host = env === "production" ? "www.ebay.com" : "sandbox.ebay.com";
      return {
        ebayListingId: listingId,
        ebayOfferId: offerId,
        ebayListingUrl: `https://${host}/itm/${listingId}`,
      };
    },
  };
}
```

- [ ] **Step 4: Write `convex/ebay/index.ts`**

```ts
import { env } from "../_generated/server";
import { createMockPublisher } from "./mock";
import { createSandboxPublisher } from "./sandbox";
import type { EbayPublisher } from "./types";

export * from "./types";

/** Defaults to "mock" — an unset EBAY_MODE must never block the demo. */
export function getEbayMode(): "mock" | "sandbox" {
  return env.EBAY_MODE?.trim().toLowerCase() === "sandbox" ? "sandbox" : "mock";
}

export function getEbayPublisher(): EbayPublisher {
  return getEbayMode() === "mock" ? createMockPublisher() : createSandboxPublisher("sandbox");
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add convex/ebay/
git commit -m "feat: add eBay mock/sandbox publisher abstraction"
```

---

### Task 4: OAuth callback endpoint + connection management

**Files:**
- Create: `convex/http.ts`
- Create: `convex/ebayAuth.ts`

**Interfaces:**
- Consumes: `exchangeCodeForTokens`, `buildAuthorizeUrl` from `./ebay/oauth` (Task 2); `getEbayMode` from `./ebay` (Task 3).
- Produces: `api.ebayAuth.connect` (public mutation, consumed by Task 6), `api.ebayAuth.connectionStatus` (public query, consumed by Task 6), `api.ebayAuth.disconnect` (public mutation, consumed by Task 6), `internal.ebayAuth.saveConnection` (consumed by `http.ts` itself), `internal.ebayAuth.connectionForSession` and `internal.ebayAuth.updateAccessToken` (consumed by Task 5).

- [ ] **Step 1: Write `convex/http.ts`**

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";
import { exchangeCodeForTokens } from "./ebay/oauth";

const http = httpRouter();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** A self-contained confirmation page — the popup closes itself, no redirect
 * back to a guessed frontend URL is needed. */
function page(ok: boolean, message: string): Response {
  const body = ok
    ? "eBay connected."
    : `Couldn't connect eBay: ${escapeHtml(message)}`;
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:48px;color:#141412;">
      <p>${body}</p>
      <p>You can close this window.</p>
      <script>setTimeout(function () { window.close(); }, 1500);</script>
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

http.route({
  path: "/ebay/callback",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

    if (oauthError) return page(false, oauthError);
    if (!code || !state) return page(false, "Missing authorization code.");

    const clientId = env.EBAY_CLIENT_ID?.trim();
    const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
    const ruName = env.EBAY_RU_NAME?.trim();
    if (!clientId || !clientSecret || !ruName) {
      return page(false, "eBay is not fully configured on the server.");
    }

    try {
      const tokens = await exchangeCodeForTokens({
        env: "sandbox",
        clientId,
        clientSecret,
        ruName,
        code,
      });

      await ctx.runMutation(internal.ebayAuth.saveConnection, {
        sessionId: state,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? undefined,
        mode: "sandbox",
      });

      return page(true, "");
    } catch (error) {
      return page(false, error instanceof Error ? error.message : "Connection failed.");
    }
  }),
});

export default http;
```

- [ ] **Step 2: Write `convex/ebayAuth.ts`**

```ts
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { env } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { buildAuthorizeUrl } from "./ebay/oauth";
import { getEbayMode } from "./ebay";

async function upsertConnection(
  ctx: MutationCtx,
  fields: {
    sessionId: string;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: number;
    refreshTokenExpiresAt?: number;
    mode: string;
  },
) {
  const existing = await ctx.db
    .query("ebayConnections")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", fields.sessionId))
    .unique();

  const now = Date.now();
  const row = { ...fields, connectedAt: existing?.connectedAt ?? now, updatedAt: now };

  if (existing !== null) {
    await ctx.db.patch("ebayConnections", existing._id, row);
  } else {
    await ctx.db.insert("ebayConnections", row);
  }
}

/** Mock mode connects instantly (no OAuth). Sandbox mode returns the
 * consent URL for the client to open in a popup. */
export const connect = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const mode = getEbayMode();

    if (mode === "mock") {
      const now = Date.now();
      await upsertConnection(ctx, {
        sessionId: args.sessionId,
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
        accessTokenExpiresAt: now + 1000 * 60 * 60 * 24 * 365,
        mode: "mock",
      });
      return { mode: "mock" as const, authorizeUrl: null };
    }

    const clientId = env.EBAY_CLIENT_ID?.trim();
    const ruName = env.EBAY_RU_NAME?.trim();
    if (!clientId || !ruName) {
      throw new Error(
        "eBay sandbox isn't configured yet — EBAY_CLIENT_ID and EBAY_RU_NAME must be set in the Convex environment.",
      );
    }

    const authorizeUrl = buildAuthorizeUrl({
      env: "sandbox",
      clientId,
      ruName,
      state: args.sessionId,
    });

    return { mode: "sandbox" as const, authorizeUrl };
  },
});

export const saveConnection = internalMutation({
  args: {
    sessionId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshTokenExpiresAt: v.optional(v.number()),
    mode: v.string(),
  },
  handler: async (ctx, args) => {
    await upsertConnection(ctx, args);
    return null;
  },
});

export const connectionStatus = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    return { connected: connection !== null, mode: connection?.mode ?? null };
  },
});

export const disconnect = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (connection !== null) {
      await ctx.db.delete("ebayConnections", connection._id);
    }
    return null;
  },
});

export const connectionForSession = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ebayConnections")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
  },
});

export const updateAccessToken = internalMutation({
  args: { sessionId: v.string(), accessToken: v.string(), accessTokenExpiresAt: v.number() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (connection === null) return null;
    await ctx.db.patch("ebayConnections", connection._id, {
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      updatedAt: Date.now(),
    });
    return null;
  },
});
```

- [ ] **Step 3: Sync and typecheck**

Run: `npx convex dev --once`
Expected: deploy succeeds (registers the new HTTP route and the `ebayAuth` module).

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add convex/http.ts convex/ebayAuth.ts
git commit -m "feat: add eBay OAuth callback endpoint and connection management"
```

---

### Task 5: Publish orchestration

**Files:**
- Create: `convex/listingPublish.ts`
- Modify: `convex/listings.ts`

**Interfaces:**
- Consumes: `getEbayPublisher`, `EbayError` from `./ebay` (Task 3); `refreshAccessToken` from `./ebay/oauth` (Task 2); `internal.ebayAuth.connectionForSession`, `internal.ebayAuth.updateAccessToken` (Task 4).
- Produces: `api.listingPublish.publish`, `api.listingPublish.publishApproved` (public mutations, consumed by Task 7/8). Removes `listings.listApproved` (superseded).

- [ ] **Step 1: Remove the superseded `listApproved` mutation from `convex/listings.ts`**

Delete this block (the old Phase 5 bulk action — it just flipped status locally with no real eBay interaction, now replaced by real publishing):

```ts
/** Bulk-publishes every currently-approved listing; drafts are left untouched. */
export const listApproved = mutation({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const listings = await ctx.db
      .query("listings")
      .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", args.cleanoutId))
      .take(50);

    const approved = listings.filter((listing) => listing.status === "approved");
    for (const listing of approved) {
      await ctx.db.patch("listings", listing._id, {
        status: "listed",
        updatedAt: Date.now(),
      });
      await ctx.db.patch("items", listing.itemId, { status: "listed" });
    }

    return { listed: approved.length };
  },
});
```

- [ ] **Step 2: Write `convex/listingPublish.ts`**

```ts
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { EbayError, getEbayPublisher } from "./ebay";
import { refreshAccessToken } from "./ebay/oauth";

/**
 * Publishing claims the job by flipping status to "publishing" inside the
 * mutation (a transaction) before scheduling the actual eBay call — a second
 * click sees the non-"approved"/"failed" status and is rejected here, not
 * just disabled client-side, so duplicate clicks can never create duplicate
 * eBay listings.
 */
export const publish = mutation({
  args: { listingId: v.id("listings"), sessionId: v.string() },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) throw new Error("Listing not found");
    if (listing.status !== "approved" && listing.status !== "failed") return null;

    await ctx.db.patch("listings", args.listingId, {
      status: "publishing",
      publishError: undefined,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.listingPublish.publishOne, {
      listingId: args.listingId,
      sessionId: args.sessionId,
    });

    return null;
  },
});

export const publishApproved = mutation({
  args: { cleanoutId: v.id("cleanouts"), sessionId: v.string() },
  handler: async (ctx, args) => {
    const listings = await ctx.db
      .query("listings")
      .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", args.cleanoutId))
      .take(50);

    const toPublish = listings.filter((listing) => listing.status === "approved");
    for (const listing of toPublish) {
      await ctx.db.patch("listings", listing._id, {
        status: "publishing",
        publishError: undefined,
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.listingPublish.publishOne, {
        listingId: listing._id,
        sessionId: args.sessionId,
      });
    }

    return { queued: toPublish.length };
  },
});

export const contextForPublish = internalQuery({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) return null;

    const item = await ctx.db.get("items", listing.itemId);
    if (item === null) return null;

    const cleanout = await ctx.db.get("cleanouts", listing.cleanoutId);
    const imageUrl = cleanout?.imageStorageId
      ? await ctx.storage.getUrl(cleanout.imageStorageId)
      : null;

    return { listing, imageUrl };
  },
});

export const markPublished = internalMutation({
  args: {
    listingId: v.id("listings"),
    ebayListingId: v.string(),
    ebayOfferId: v.string(),
    ebayListingUrl: v.string(),
    mode: v.string(),
  },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) return null;

    await ctx.db.patch("listings", args.listingId, {
      status: "live",
      ebayListingId: args.ebayListingId,
      ebayOfferId: args.ebayOfferId,
      ebayListingUrl: args.ebayListingUrl,
      publishMode: args.mode,
      publishError: undefined,
      updatedAt: Date.now(),
    });

    await ctx.db.patch("items", listing.itemId, { status: "listed" });

    return null;
  },
});

export const markPublishFailed = internalMutation({
  args: { listingId: v.id("listings"), error: v.string() },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) return null;

    await ctx.db.patch("listings", args.listingId, {
      status: "failed",
      publishError: args.error.slice(0, 300),
      updatedAt: Date.now(),
    });

    return null;
  },
});

/** Returns null if there's no eBay connection for this session at all. */
async function getValidAccessToken(
  ctx: ActionCtx,
  sessionId: string,
): Promise<{ accessToken: string; mode: string } | null> {
  const connection = await ctx.runQuery(internal.ebayAuth.connectionForSession, { sessionId });
  if (connection === null) return null;
  if (connection.mode === "mock") return { accessToken: connection.accessToken, mode: "mock" };

  // A minute of headroom avoids racing eBay's own expiry check.
  if (connection.accessTokenExpiresAt > Date.now() + 60_000) {
    return { accessToken: connection.accessToken, mode: connection.mode };
  }

  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new EbayError(
      "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set — cannot refresh the eBay connection.",
    );
  }

  const refreshed = await refreshAccessToken({
    env: "sandbox",
    clientId,
    clientSecret,
    refreshToken: connection.refreshToken,
  });

  await ctx.runMutation(internal.ebayAuth.updateAccessToken, {
    sessionId,
    accessToken: refreshed.accessToken,
    accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
  });

  return { accessToken: refreshed.accessToken, mode: connection.mode };
}

export const publishOne = internalAction({
  args: { listingId: v.id("listings"), sessionId: v.string() },
  handler: async (ctx, args) => {
    try {
      const context = await ctx.runQuery(internal.listingPublish.contextForPublish, {
        listingId: args.listingId,
      });
      if (context === null) throw new Error("This listing or its item no longer exists.");
      if (context.imageUrl === null) {
        throw new Error("The source photo could not be read from storage.");
      }

      const auth = await getValidAccessToken(ctx, args.sessionId);
      if (auth === null) throw new Error("Connect your eBay account before publishing.");

      const publisher = getEbayPublisher();
      const result = await publisher.publish({
        accessToken: auth.accessToken,
        env: "sandbox",
        merchantLocationKey: env.EBAY_MERCHANT_LOCATION_KEY?.trim(),
        fulfillmentPolicyId: env.EBAY_FULFILLMENT_POLICY_ID?.trim(),
        paymentPolicyId: env.EBAY_PAYMENT_POLICY_ID?.trim(),
        returnPolicyId: env.EBAY_RETURN_POLICY_ID?.trim(),
        categoryId: env.EBAY_CATEGORY_ID?.trim(),
        listing: {
          sku: context.listing._id,
          title: context.listing.title,
          description: context.listing.description,
          price: context.listing.price,
          condition: context.listing.condition,
          imageUrl: context.imageUrl,
        },
      });

      await ctx.runMutation(internal.listingPublish.markPublished, {
        listingId: args.listingId,
        ebayListingId: result.ebayListingId,
        ebayOfferId: result.ebayOfferId,
        ebayListingUrl: result.ebayListingUrl,
        mode: auth.mode,
      });
    } catch (error) {
      await ctx.runMutation(internal.listingPublish.markPublishFailed, {
        listingId: args.listingId,
        error: error instanceof Error ? error.message : "Publishing failed for an unknown reason.",
      });
    }

    return null;
  },
});
```

- [ ] **Step 3: Sync and typecheck**

Run: `npx convex dev --once`
Expected: deploy succeeds.

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add convex/listingPublish.ts convex/listings.ts
git commit -m "feat: add eBay publish orchestration, replacing the fake bulk-list mutation"
```

---

### Task 6: eBay connect/status UI in the header

**Files:**
- Create: `src/components/EbayConnectButton.tsx`
- Modify: `src/components/TopNav.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `api.ebayAuth.connectionStatus`, `api.ebayAuth.connect`, `api.ebayAuth.disconnect` (Task 4).
- Produces: `EbayConnectButton` default export, props `{ sessionId: string }`. `TopNav` gains a `sessionId: string` prop.

- [ ] **Step 1: Write `src/components/EbayConnectButton.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function EbayConnectButton({ sessionId }: { sessionId: string }) {
  const status = useQuery(api.ebayAuth.connectionStatus, { sessionId });
  const connect = useMutation(api.ebayAuth.connect);
  const disconnect = useMutation(api.ebayAuth.disconnect);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === undefined) return null;

  if (status.connected) {
    return (
      <button
        onClick={() => void disconnect({ sessionId })}
        title="Disconnect eBay"
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-ink-soft ring-1 ring-line ring-inset transition-colors hover:bg-canvas"
      >
        <span className="size-1.5 rounded-full bg-accent-deep" />
        eBay ✓ Connected
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-muted">{error}</span>}
      <button
        onClick={async () => {
          setConnecting(true);
          setError(null);
          try {
            const result = await connect({ sessionId });
            if (result.authorizeUrl) {
              window.open(result.authorizeUrl, "ebay-oauth", "width=500,height=700");
            }
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Couldn't connect eBay.");
          } finally {
            setConnecting(false);
          }
        }}
        disabled={connecting}
        className="rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-50"
      >
        {connecting ? "Connecting…" : "Connect eBay"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire `TopNav.tsx`**

Add the import and a `sessionId` prop:

```ts
import EbayConnectButton from "@/components/EbayConnectButton";
```

```ts
type Props = {
  onHome: () => void;
  /** Provided only in development — wipes this session's Convex data. */
  onReset?: () => void;
  sessionId: string;
};

export default function TopNav({ onHome, onReset, sessionId }: Props) {
```

Add `<EbayConnectButton sessionId={sessionId} />` inside the `<nav>`, right before the existing `<span className="hidden ... sm:inline">Sales</span>`:

```tsx
        <nav className="flex items-center gap-1">
          {onReset && (
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <RotateCcw className="size-3.5" strokeWidth={2} />
              Reset demo data
            </button>
          )}
          <EbayConnectButton sessionId={sessionId} />
          <span className="hidden cursor-default rounded-full px-3.5 py-1.5 text-sm text-muted sm:inline">
            Sales
          </span>
```

- [ ] **Step 3: Pass `sessionId` from `App.tsx`**

Update the `<TopNav .../>` call:

```tsx
      <TopNav
        onHome={() => {
          setDrawing(false);
          setComposingNew(true);
        }}
        onReset={import.meta.env.DEV ? handleReset : undefined}
        sessionId={sessionId}
      />
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/EbayConnectButton.tsx src/components/TopNav.tsx src/App.tsx
git commit -m "feat: add eBay connect/status button to the header"
```

---

### Task 7: Card status badges, View listing link, and threading `sessionId`

**Files:**
- Modify: `src/components/ReadyToSell.tsx`
- Modify: `src/components/Workspace.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- `ReadyToSell` covers all 8 `listingStatus` values in its badge map and switches [Review] to a "View listing" link for live/sold/ended. `ReadyToSell` itself needs no new props — it only displays state, it doesn't call `publish`, so this task does **not** touch `Workspace.tsx`/`App.tsx` (that threading is Task 8's job, done together with where it's actually used — adding an unused `sessionId` prop here first would trip `noUnusedParameters`/`noUnusedLocals` on the root tsconfig, the same class of bug Phase 5 hit).

- [ ] **Step 1: Extend the status badge and add the View listing link in `ReadyToSell.tsx`**

Replace the `STATUS_LABEL` map:

```ts
const STATUS_LABEL: Record<Doc<"listings">["status"], string> = {
  draft: "Ready",
  approved: "Approved",
  publishing: "Publishing…",
  live: "● Live on eBay",
  failed: "Failed",
  ended: "Ended",
  sold: "Sold",
  listed: "Listed",
};

const LIVE_STATUSES = new Set<Doc<"listings">["status"]>(["live", "sold", "ended"]);
```

Replace the card's trailing button:

```tsx
                <span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-medium text-ink-soft ring-1 ring-line ring-inset">
                  {STATUS_LABEL[listing.status]}
                </span>
                {LIVE_STATUSES.has(listing.status) && listing.ebayListingUrl ? (
                  <a
                    href={listing.ebayListingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
                  >
                    View listing
                  </a>
                ) : (
                  <button
                    onClick={() => onReview(listing._id)}
                    className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
                  >
                    Review
                  </button>
                )}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ReadyToSell.tsx
git commit -m "feat: show full eBay lifecycle status and View listing link on cards"
```

---

### Task 8: Drawer retry/live states, bar wiring to real publish

**Files:**
- Modify: `src/components/ListingDrawer.tsx`
- Modify: `src/components/ListingsBar.tsx`
- Modify: `src/components/Workspace.tsx`

**Interfaces:**
- Consumes: `api.listingPublish.publish`, `api.listingPublish.publishApproved` (Task 5).
- `ListingDrawer` gains a `sessionId: string` prop. `ListingsBar` gains a `sessionId: string` prop and calls `publishApproved` instead of the removed `listApproved`.

- [ ] **Step 1: Add failed/live states to `ListingDrawer.tsx`**

Add the import and prop:

```ts
import { useMutation } from "convex/react"; // already imported — add nothing new here
```

Add `sessionId: string;` to `Props`, destructure it, and add the publish mutation near the existing `updateListing`/`approveListing` hooks:

```ts
  const publishListing = useMutation(api.listingPublish.publish);
```

Replace the final `<div className="mt-5 flex gap-2">...</div>` block (Save/Approve buttons) with a status-aware version:

```tsx
        {listing.status === "live" || listing.status === "sold" || listing.status === "ended" ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm text-ink-soft">{title}</p>
            <p className="mt-1 text-sm text-muted">
              ${listing.price} · {listing.condition.replace(/_/g, " ")}
            </p>
            {listing.ebayListingUrl && (
              <a
                href={listing.ebayListingUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block rounded-full bg-canvas px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-line"
              >
                View on eBay
              </a>
            )}
          </div>
        ) : listing.status === "failed" ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm text-muted">
              {listing.publishError ?? "Publishing failed for an unknown reason."}
            </p>
            <Button
              variant="accent"
              className="mt-3 w-full"
              onClick={() => void publishListing({ listingId: listing._id, sessionId })}
            >
              Retry publish
            </Button>
          </div>
        ) : (
          <div className="mt-5 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={listing.status === "publishing"}
              onClick={() => void updateListing(draft())}
            >
              Save
            </Button>
            <Button
              variant="accent"
              className="flex-1"
              disabled={listing.status === "publishing"}
              onClick={() => void approveListing(draft())}
            >
              {listing.status === "publishing" ? "Publishing…" : "Approve listing"}
            </Button>
          </div>
        )}
```

- [ ] **Step 2: Wire `ListingsBar.tsx` to real publishing**

Replace the `listApproved` usage:

```ts
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

type Props = {
  cleanoutId: Id<"cleanouts">;
  sessionId: string;
  listings: Doc<"listings">[];
  onReviewAll: () => void;
};

export default function ListingsBar({ cleanoutId, sessionId, listings, onReviewAll }: Props) {
  const publishApproved = useMutation(api.listingPublish.publishApproved);
  const approvedCount = listings.filter((listing) => listing.status === "approved").length;

  if (listings.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-6 pb-6">
      <div className="surface flex items-center gap-4 px-5 py-3">
        <span className="text-sm font-medium text-ink">
          {listings.length} {listings.length === 1 ? "listing" : "listings"} ready
        </span>
        <Button variant="outline" size="sm" onClick={onReviewAll}>
          Review all
        </Button>
        <Button
          variant="accent"
          size="sm"
          disabled={approvedCount === 0}
          onClick={() => void publishApproved({ cleanoutId, sessionId })}
        >
          List approved items
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Thread `sessionId` into `Workspace.tsx` and pass it to both components**

Add `sessionId: string;` to `Workspace`'s `Props` and destructure it in the function signature — used immediately below, so this doesn't create an unused-prop window.

Update the `<ListingsBar .../>` call:

```tsx
      <ListingsBar
        cleanoutId={cleanout._id}
        sessionId={sessionId}
        listings={listings}
        onReviewAll={() => {
          if (listings[0]) onReviewListing(listings[0]._id);
        }}
      />
```

Update the `<ListingDrawer .../>` call:

```tsx
          <ListingDrawer
            key={activeListing._id}
            imageUrl={imageUrl}
            listing={activeListing}
            item={activeListingItem}
            sessionId={sessionId}
            hasPrev={activeListingIndex > 0}
            hasNext={activeListingIndex < listings.length - 1}
            onNavigate={onNavigateListing}
            onClose={onCloseDrawer}
          />
```

- [ ] **Step 4: Pass `sessionId` from `App.tsx`**

Add `sessionId={sessionId}` to the existing `<Workspace .../>` call.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ListingDrawer.tsx src/components/ListingsBar.tsx src/components/Workspace.tsx src/App.tsx
git commit -m "feat: wire drawer retry and bottom bar to real eBay publishing"
```

---

### Task 9: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Confirm `EBAY_MODE` and run the app**

Check `mcp__plugin_convex_convex__envList` — if `EBAY_MODE` isn't set, `getEbayMode()` defaults to `"mock"`, which is what should be verified first regardless. Ensure `npx convex dev` and `npm run dev` are running (reuse Phase 4/5's if still up).

- [ ] **Step 2: Mock mode — full real test via Convex tools**

Using `mcp__plugin_convex_convex__run`/`data`/`runOneoffQuery` (same approach as Phases 4-5, to avoid needing a browser):
- Call `ebayAuth.js:connect` with a test `sessionId` — confirm it returns `{mode: "mock", authorizeUrl: null}` and `ebayAuth.js:connectionStatus` immediately reports `connected: true`.
- Pick an existing `"approved"` listing (or approve a draft one first via `listings.js:approve`). Call `listingPublish.js:publish` with that listing's ID and the test `sessionId`.
- Confirm the listing's `status` becomes `"publishing"` immediately, then `"live"` shortly after, with `ebayListingId`, `ebayOfferId`, `ebayListingUrl` all populated and `publishMode: "mock"`.
- Call `listingPublish.js:publish` again on the **same** listing (now `"live"`) — confirm it returns `null` and the listing is unchanged (proves "duplicate clicks cannot create duplicate listings").
- Call `listingPublish.js:publish` on a `"draft"` listing (never approved) — confirm it's rejected (status unchanged, no `publishing`/`live` transition) — proves "unapproved item cannot publish".
- **Failed → retry, without needing real eBay credentials:** approve a fresh listing, then call `listingPublish.js:publish` for it using a `sessionId` that has **no** `ebayConnections` row at all (never connected). `getValidAccessToken` returns `null`, so `publishOne` throws "Connect your eBay account before publishing" and `markPublishFailed` sets `status: "failed"` with that message in `publishError` — confirm both. Then connect that same `sessionId` (mock) and call `publish` again on the same (now `"failed"`) listing — confirm the guard's `status !== "approved" && status !== "failed"` check lets it through, and it reaches `"live"` — proves "failed API request shows retry" end to end.
- Call `ebayAuth.js:disconnect` with the test `sessionId` — confirm `connectionStatus` reports `connected: false` — proves "disconnected state works".

- [ ] **Step 3: Sandbox mode — structural verification (no real eBay account yet)**

With `EBAY_MODE` still unset/`"mock"` (or temporarily set to `"sandbox"` if the deployment allows it without real credentials): call `ebayAuth.js:connect` — confirm it throws the clear "EBAY_CLIENT_ID and EBAY_RU_NAME must be set" error rather than crashing or silently doing nothing. If credentials happen to be set already but a real Sandbox test-user account isn't, attempting a full connect will fail at the eBay consent screen (outside this app's control) — that's expected and not a code bug. Note plainly in the final report that a live sandbox publish was **not** exercised, pending real credentials.

- [ ] **Step 4: Confirm no runtime errors**

Check `mcp__plugin_convex_convex__logs` with `status: "failure"` — expect none from this test run.

- [ ] **Step 5: Full build**

Run: `npm run build`
Expected: `tsc --noEmit && vite build` both succeed with no errors.

- [ ] **Step 6: Note what could not be verified**

Same as Phases 4-5: no browser-automation tool available, so the popup OAuth window, the "eBay ✓ Connected" header badge, and the drawer's failed/live states were not visually confirmed — point the user at the running app to check those, plus real sandbox publishing once they provide credentials.

- [ ] **Step 7: Report results and stop**

Per the spec, "Stop after Phase 6" — no Phase 7, nothing deployed or pushed further.
