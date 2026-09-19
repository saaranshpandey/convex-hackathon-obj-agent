# eBay Per-seller Setup and Per-item Categories: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any customer who connects their own eBay account publish listings: each seller gets their own shipping location and business policies, and each listing gets the right eBay category, a valid condition, and its required item details.

**Architecture:** A seller's ZIP is collected at connect and carried through eBay's redirect on the one-time state code. At publish time (inside the background job) the app makes sure the seller's location and policies exist, then looks up the item's category, its rules and a valid condition with an app-level token, fills the required details with one OpenAI call, and hands everything to the existing Inventory-API publisher. All eBay calls live in small plain-fetch modules so they can be tested with a faked eBay.

**Tech Stack:** Convex 1.45, eBay Sell Inventory/Account, Commerce Taxonomy and Sell Metadata REST APIs (sandbox), OpenAI chat completions with strict JSON schema, vitest 5 (`convex-test` for Convex functions), React 19.

**Spec:** `docs/superpowers/specs/2026-09-19-ebay-seller-setup-and-categories-design.md`

## Global Constraints

- eBay stays **sandbox only** in this work. Do not add production support.
- Exact user-facing messages (tests assert these):
  - No ZIP at publish: `Reconnect eBay and enter your ZIP code — it's needed to set up your shipping location.`
  - Invalid ZIP at connect: `Enter a valid US ZIP code (for example 94105).`
  - No category: `Couldn't find an eBay category for "<query>".` (`<query>` is the category query text)
- Seller-created object names (used to find existing ones): `Roomsale Standard Shipping`, `Roomsale Standard Payment`, `Roomsale Standard Returns`. Location key: `roomsale-<first 5 digits of ZIP>`.
- Defaults unchanged from today: flat $5 USPS Priority, 3-day handling; payment not immediate; 30-day returns, buyer pays return shipping; default package 5 lb, 12x12x12 in.
- Unknown item details are sent as `Does not apply`; an unknown Brand is sent as `Unbranded`. Never guess a measurement.
- Codebase conventions: two-argument `ctx.db.get("table", id)`, `ctx.db.patch("table", id, ...)`; object-form Convex functions with `args` validators; no `returns:` validators (none exist in this repo, ignore the `convex-lint` hook nags); no code comments except for a non-obvious WHY.
- Identity comes only from `requireUserId` / `getAuthUserId`; never accept a user id from the client.
- Never run a command against prod without an explicit yes from the owner, in chat, for that specific step. Dev is `scrupulous-newt-316`; prod is `adjoining-gerbil-124`.
- Stage files by name (never `git add -A` or `git add .`). Each commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (as a second `-m`). Never stage `todo.txt` or `commands.txt`.
- Convex-function tests live in `tests/convex/` with the first-line docblock `// @vitest-environment edge-runtime`. Pure-logic tests live in `tests/ebay/` and use the default node environment. Tests that change `process.env` must restore it in a `finally`.

## Before you start

- [ ] Create a working branch from the current auth branch (it is unmerged and prod runs it):

```bash
git switch -c feature/ebay-seller-setup
```

- [ ] Commit the spec and this plan:

```bash
git add docs/superpowers/specs/2026-09-19-ebay-seller-setup-and-categories-design.md docs/superpowers/plans/2026-09-19-ebay-seller-setup-and-categories.md
git commit -m "docs: add eBay seller setup and categories spec and plan" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

## File structure

**Create**
- `convex/ebay/postalCode.ts`: `isValidPostalCode`, `locationKeyFor` (pure; also imported by the frontend).
- `convex/ebay/http.ts`: `apiBase`, `ebayRequest` (moved out of `sandbox.ts`).
- `convex/ebay/sellerSetup.ts`: `ensureSellerSetup` (opt-in, location, three policies; create-or-find).
- `convex/ebay/categoryRules.ts`: category query, category suggestion, category rules (required details, valid conditions), `pickCondition`, response parsers.
- `convex/ebay/itemDetails.ts`: `fillItemDetails` (one OpenAI call) and its pure helpers.
- `convex/ebay/prepare.ts`: `resolveListingSpec` (composes the lookups).
- `tests/ebay/postalCode.test.ts`, `tests/ebay/oauth.test.ts`, `tests/ebay/sellerSetup.test.ts`, `tests/ebay/categoryRules.test.ts`, `tests/ebay/itemDetails.test.ts`, `tests/ebay/prepare.test.ts`, `tests/ebay/live.test.ts` (skipped unless `EBAY_LIVE=1`), `tests/ebay/fakeFetch.ts`.
- `tests/ebay/fixtures/category-suggestions.json`, `tests/ebay/fixtures/category-aspects.json`, `tests/ebay/fixtures/condition-policies.json`.

**Modify**
- `convex/ebay/types.ts`, `convex/ebay/oauth.ts`, `convex/ebay/sandbox.ts`, `convex/ebay/oauthState.ts`.
- `convex/schema.ts`, `convex/ebayAuth.ts`, `convex/http.ts`, `convex/listingPublish.ts`, `convex/convex.config.ts`.
- `src/components/EbayConnectButton.tsx`.
- `tests/convex/ebay.test.ts`.

**Delete**
- `convex/ebaySetup.ts`.

---

### Task 1: Shared foundations

Behavior-neutral groundwork: small pure helpers, shared types, the app-token helper, and the request helper moved out of the publisher.

**Files:**
- Create: `convex/ebay/postalCode.ts`, `convex/ebay/http.ts`, `tests/ebay/postalCode.test.ts`, `tests/ebay/fakeFetch.ts`, `tests/ebay/oauth.test.ts`
- Modify: `convex/ebay/types.ts`, `convex/ebay/oauth.ts`, `convex/ebay/sandbox.ts`

**Interfaces:**
- Produces:
  - `isValidPostalCode(value: string): boolean`, `locationKeyFor(postalCode: string): string` (from `convex/ebay/postalCode.ts`)
  - `apiBase(env: EbayEnv): string`, `ebayRequest(env: EbayEnv, accessToken: string, method: string, path: string, body?: unknown): Promise<Record<string, unknown>>` (from `convex/ebay/http.ts`)
  - `getAppAccessToken(input: { env: EbayEnv; clientId: string; clientSecret: string }): Promise<string>` (from `convex/ebay/oauth.ts`)
  - types `ListingCondition` and `SellerSetup` (from `convex/ebay/types.ts`)
  - test helper `fakeEbay(handlers)` returning the recorded calls (from `tests/ebay/fakeFetch.ts`)

- [ ] **Step 1: Write the failing postal-code test, `tests/ebay/postalCode.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { isValidPostalCode, locationKeyFor } from "../../convex/ebay/postalCode";

describe("isValidPostalCode", () => {
  it("accepts a 5-digit ZIP, a ZIP+4, and surrounding spaces", () => {
    expect(isValidPostalCode("94105")).toBe(true);
    expect(isValidPostalCode("94105-1234")).toBe(true);
    expect(isValidPostalCode(" 94105 ")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidPostalCode("9410")).toBe(false);
    expect(isValidPostalCode("abcde")).toBe(false);
    expect(isValidPostalCode("94105-12")).toBe(false);
    expect(isValidPostalCode("")).toBe(false);
  });
});

describe("locationKeyFor", () => {
  it("uses only the first five digits, so a ZIP+4 shares its ZIP's location", () => {
    expect(locationKeyFor("94105")).toBe("roomsale-94105");
    expect(locationKeyFor(" 94105-1234 ")).toBe("roomsale-94105");
  });
});
```

Run: `npx vitest run tests/ebay/postalCode.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Create `convex/ebay/postalCode.ts`**

```ts
const POSTAL_CODE = /^\d{5}(-\d{4})?$/;

export function isValidPostalCode(value: string): boolean {
  return POSTAL_CODE.test(value.trim());
}

export function locationKeyFor(postalCode: string): string {
  return `roomsale-${postalCode.trim().slice(0, 5)}`;
}
```

Run: `npx vitest run tests/ebay/postalCode.test.ts`
Expected: PASS.

- [ ] **Step 3: Add the shared types to `convex/ebay/types.ts`**

Add these two exports directly below the `EbayAccessToken` type:

```ts
export type ListingCondition = "new" | "like_new" | "good" | "fair" | "poor";

/** IDs of a seller's own shipping location and business policies. */
export type SellerSetup = {
  locationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
};
```

- [ ] **Step 4: Create `convex/ebay/http.ts`** (moved verbatim from `sandbox.ts`)

```ts
import { EbayError, type EbayEnv } from "./types";

export function apiBase(env: EbayEnv): string {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

export async function ebayRequest(
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
```

- [ ] **Step 5: Point `convex/ebay/sandbox.ts` at the shared helper**

In `convex/ebay/sandbox.ts`, delete exactly two things: the whole local `function apiBase(...) { ... }` and the whole local `async function ebayRequest(...) { ... }`. Add this import below the existing `./types` import:

```ts
import { ebayRequest } from "./http";
```

Leave everything else in the file untouched in this task. In particular keep the `CONDITION_MAP` constant, which sits between those two functions and is removed later in Task 7.

- [ ] **Step 6: Create the shared fake for eBay/OpenAI, `tests/ebay/fakeFetch.ts`**

```ts
import { vi } from "vitest";

export type FakeCall = { method: string; path: string; query: string; body: unknown };
export type FakeReply = { status: number; json?: unknown };
export type FakeHandlers = Record<string, (call: FakeCall) => FakeReply>;

/** JSON bodies are parsed; form-encoded ones (eBay's token endpoint) stay raw text. */
function readBody(raw: unknown): unknown {
  if (typeof raw !== "string" || raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Replaces global fetch with a router keyed by `<METHOD> <pathname>`. Any
 * unrouted request answers 599 so a missing handler fails loudly.
 */
export function fakeEbay(handlers: FakeHandlers): FakeCall[] {
  const calls: FakeCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const call: FakeCall = {
        method,
        path: url.pathname,
        query: url.search,
        body: readBody(init?.body),
      };
      calls.push(call);

      const handler = handlers[`${method} ${url.pathname}`];
      if (!handler) return new Response(`no handler for ${method} ${url.pathname}`, { status: 599 });

      const reply = handler(call);
      return new Response(reply.json === undefined ? null : JSON.stringify(reply.json), {
        status: reply.status,
      });
    }),
  );

  return calls;
}
```

- [ ] **Step 7: Write the failing app-token test, `tests/ebay/oauth.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppAccessToken } from "../../convex/ebay/oauth";
import { fakeEbay } from "./fakeFetch";

afterEach(() => vi.unstubAllGlobals());

describe("getAppAccessToken", () => {
  it("asks eBay for a client-credentials token and returns it", async () => {
    const calls = fakeEbay({
      "POST /identity/v1/oauth2/token": () => ({
        status: 200,
        json: { access_token: "app-token", expires_in: 7200, token_type: "Application Access Token" },
      }),
    });

    const token = await getAppAccessToken({ env: "sandbox", clientId: "id", clientSecret: "secret" });

    expect(token).toBe("app-token");
    expect(calls).toHaveLength(1);
  });

  it("rejects when eBay refuses the app credentials", async () => {
    fakeEbay({ "POST /identity/v1/oauth2/token": () => ({ status: 401, json: {} }) });

    await expect(
      getAppAccessToken({ env: "sandbox", clientId: "id", clientSecret: "wrong" }),
    ).rejects.toThrow("eBay rejected the app credentials");
  });
});
```

Run: `npx vitest run tests/ebay/oauth.test.ts`
Expected: FAIL (`getAppAccessToken` is not exported).

- [ ] **Step 8: Add `getAppAccessToken` to `convex/ebay/oauth.ts`** (append at the end of the file)

```ts
/** App-level token (no user consent) for lookups such as categories and rules. */
export async function getAppAccessToken(input: {
  env: EbayEnv;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const payload = await postTokenRequest(
    input.env,
    input.clientId,
    input.clientSecret,
    new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  );
  return payload.access_token;
}
```

- [ ] **Step 9: Run everything**

```bash
npx vitest run
npx tsc --noEmit -p convex/tsconfig.json
```

Expected: all tests pass (including the existing 47 plus the new ones); typecheck prints nothing.

- [ ] **Step 10: Commit**

```bash
git add convex/ebay/postalCode.ts convex/ebay/http.ts convex/ebay/types.ts convex/ebay/oauth.ts convex/ebay/sandbox.ts tests/ebay/postalCode.test.ts tests/ebay/fakeFetch.ts tests/ebay/oauth.test.ts
git commit -m "refactor: share the eBay request helper; add ZIP helpers and app token" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Seller setup module

**Files:**
- Create: `convex/ebay/sellerSetup.ts`, `tests/ebay/sellerSetup.test.ts`

**Interfaces:**
- Consumes: `ebayRequest` (Task 1), `locationKeyFor` (Task 1), `EbayError`, `EbayEnv`, `SellerSetup` (Task 1).
- Produces: `ensureSellerSetup(input: { env: EbayEnv; accessToken: string; postalCode: string }): Promise<SellerSetup>`.

- [ ] **Step 1: Write the failing test, `tests/ebay/sellerSetup.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureSellerSetup } from "../../convex/ebay/sellerSetup";
import { fakeEbay, type FakeHandlers } from "./fakeFetch";

afterEach(() => vi.unstubAllGlobals());

const input = { env: "sandbox" as const, accessToken: "seller-token", postalCode: "94105" };

const freshSeller: FakeHandlers = {
  "POST /sell/account/v1/program/opt_in": () => ({ status: 200 }),
  "GET /sell/inventory/v1/location/roomsale-94105": () => ({ status: 404, json: {} }),
  "POST /sell/inventory/v1/location/roomsale-94105": () => ({ status: 204 }),
  "GET /sell/account/v1/fulfillment_policy": () => ({ status: 200, json: { total: 0 } }),
  "POST /sell/account/v1/fulfillment_policy": () => ({ status: 201, json: { fulfillmentPolicyId: "F1" } }),
  "GET /sell/account/v1/payment_policy": () => ({ status: 200, json: { total: 0 } }),
  "POST /sell/account/v1/payment_policy": () => ({ status: 201, json: { paymentPolicyId: "P1" } }),
  "GET /sell/account/v1/return_policy": () => ({ status: 200, json: { total: 0 } }),
  "POST /sell/account/v1/return_policy": () => ({ status: 201, json: { returnPolicyId: "R1" } }),
};

const returningSeller: FakeHandlers = {
  "POST /sell/account/v1/program/opt_in": () => ({ status: 409, json: { errors: [{ message: "already" }] } }),
  "GET /sell/inventory/v1/location/roomsale-94105": () => ({ status: 200, json: {} }),
  "GET /sell/account/v1/fulfillment_policy": () => ({
    status: 200,
    json: {
      fulfillmentPolicies: [
        { name: "Someone else's policy", fulfillmentPolicyId: "X" },
        { name: "Roomsale Standard Shipping", fulfillmentPolicyId: "F9" },
      ],
    },
  }),
  "GET /sell/account/v1/payment_policy": () => ({
    status: 200,
    json: { paymentPolicies: [{ name: "Roomsale Standard Payment", paymentPolicyId: "P9" }] },
  }),
  "GET /sell/account/v1/return_policy": () => ({
    status: 200,
    json: { returnPolicies: [{ name: "Roomsale Standard Returns", returnPolicyId: "R9" }] },
  }),
};

describe("ensureSellerSetup", () => {
  it("creates the location and all three policies for a brand-new seller", async () => {
    const calls = fakeEbay(freshSeller);

    const setup = await ensureSellerSetup(input);

    expect(setup).toEqual({
      locationKey: "roomsale-94105",
      fulfillmentPolicyId: "F1",
      paymentPolicyId: "P1",
      returnPolicyId: "R1",
    });
    const posts = calls.filter((c) => c.method === "POST").map((c) => c.path);
    expect(posts).toEqual([
      "/sell/account/v1/program/opt_in",
      "/sell/inventory/v1/location/roomsale-94105",
      "/sell/account/v1/fulfillment_policy",
      "/sell/account/v1/payment_policy",
      "/sell/account/v1/return_policy",
    ]);
    const location = calls.find((c) => c.method === "POST" && c.path.includes("/location/"));
    expect(location?.body).toMatchObject({
      location: { address: { postalCode: "94105", country: "US" } },
    });
    const shipping = calls.find((c) => c.path === "/sell/account/v1/fulfillment_policy" && c.method === "POST");
    expect(shipping?.body).toMatchObject({ name: "Roomsale Standard Shipping", marketplaceId: "EBAY_US" });
  });

  it("reuses an existing location and policies, and tolerates 'already opted in'", async () => {
    const calls = fakeEbay(returningSeller);

    const setup = await ensureSellerSetup(input);

    expect(setup).toEqual({
      locationKey: "roomsale-94105",
      fulfillmentPolicyId: "F9",
      paymentPolicyId: "P9",
      returnPolicyId: "R9",
    });
    const creates = calls.filter(
      (c) => c.method === "POST" && !c.path.endsWith("/opt_in"),
    );
    expect(creates).toEqual([]);
  });

  it("treats a 404 policy list as empty and creates the policy", async () => {
    fakeEbay({
      ...freshSeller,
      "GET /sell/account/v1/payment_policy": () => ({ status: 404, json: {} }),
    });

    const setup = await ensureSellerSetup(input);

    expect(setup.paymentPolicyId).toBe("P1");
  });

  it("keeps a ZIP+4 in the address but shares the 5-digit location key", async () => {
    const calls = fakeEbay({
      ...freshSeller,
      "GET /sell/inventory/v1/location/roomsale-94105": () => ({ status: 404, json: {} }),
    });

    await ensureSellerSetup({ ...input, postalCode: "94105-1234" });

    const location = calls.find((c) => c.method === "POST" && c.path.includes("/location/"));
    expect(location?.body).toMatchObject({ location: { address: { postalCode: "94105-1234" } } });
  });

  it("stops and asks the seller to reconnect when eBay rejects their token", async () => {
    fakeEbay({ "POST /sell/account/v1/program/opt_in": () => ({ status: 401, json: {} }) });

    await expect(ensureSellerSetup(input)).rejects.toThrow("Reconnect your eBay account");
  });
});
```

Run: `npx vitest run tests/ebay/sellerSetup.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Create `convex/ebay/sellerSetup.ts`**

```ts
import { ebayRequest } from "./http";
import { locationKeyFor } from "./postalCode";
import { EbayError, type EbayEnv, type SellerSetup } from "./types";

const CATEGORY_TYPES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

type PolicySpec = {
  name: string;
  path: string;
  listKey: string;
  idKey: string;
  body: Record<string, unknown>;
};

const FULFILLMENT: PolicySpec = {
  name: "Roomsale Standard Shipping",
  path: "/sell/account/v1/fulfillment_policy",
  listKey: "fulfillmentPolicies",
  idKey: "fulfillmentPolicyId",
  body: {
    handlingTime: { value: 3, unit: "DAY" },
    shippingOptions: [
      {
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [
          {
            sortOrder: 1,
            shippingCarrierCode: "USPS",
            shippingServiceCode: "USPSPriority",
            shippingCost: { value: "5.00", currency: "USD" },
            freeShipping: false,
          },
        ],
      },
    ],
  },
};

const PAYMENT: PolicySpec = {
  name: "Roomsale Standard Payment",
  path: "/sell/account/v1/payment_policy",
  listKey: "paymentPolicies",
  idKey: "paymentPolicyId",
  body: { immediatePay: false },
};

const RETURNS: PolicySpec = {
  name: "Roomsale Standard Returns",
  path: "/sell/account/v1/return_policy",
  listKey: "returnPolicies",
  idKey: "returnPolicyId",
  body: {
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: "DAY" },
    refundMethod: "MONEY_BACK",
    returnShippingCostPayer: "BUYER",
  },
};

/** New sellers must opt in before they can create business policies. */
async function optIn(env: EbayEnv, accessToken: string): Promise<void> {
  try {
    await ebayRequest(env, accessToken, "POST", "/sell/account/v1/program/opt_in", {
      programType: "SELLING_POLICY_MANAGEMENT",
    });
  } catch (error) {
    // "Already opted in" comes back as a 4xx; a real problem shows up when the
    // policies are created. Only a rejected token must stop us here.
    const tolerable =
      error instanceof EbayError &&
      error.status !== undefined &&
      error.status < 500 &&
      error.status !== 401;
    if (!tolerable) throw error;
  }
}

async function ensureLocation(
  env: EbayEnv,
  accessToken: string,
  postalCode: string,
): Promise<string> {
  const key = locationKeyFor(postalCode);

  try {
    await ebayRequest(env, accessToken, "GET", `/sell/inventory/v1/location/${key}`);
    return key;
  } catch (error) {
    if (!(error instanceof EbayError) || error.status !== 404) throw error;
  }

  await ebayRequest(env, accessToken, "POST", `/sell/inventory/v1/location/${key}`, {
    location: { address: { postalCode: postalCode.trim(), country: "US" } },
    locationTypes: ["WAREHOUSE"],
    name: `Roomsale ship-from ${key.slice(-5)}`,
    merchantLocationStatus: "ENABLED",
  });
  return key;
}

async function findOrCreatePolicy(
  env: EbayEnv,
  accessToken: string,
  spec: PolicySpec,
): Promise<string> {
  let existing: unknown[] = [];
  try {
    const listed = await ebayRequest(env, accessToken, "GET", `${spec.path}?marketplace_id=EBAY_US`);
    const candidates = listed[spec.listKey];
    existing = Array.isArray(candidates) ? candidates : [];
  } catch (error) {
    if (!(error instanceof EbayError) || error.status !== 404) throw error;
  }

  for (const policy of existing) {
    const record = policy as Record<string, unknown> | null;
    if (record !== null && record.name === spec.name && typeof record[spec.idKey] === "string") {
      return record[spec.idKey] as string;
    }
  }

  const created = await ebayRequest(env, accessToken, "POST", spec.path, {
    name: spec.name,
    marketplaceId: "EBAY_US",
    categoryTypes: CATEGORY_TYPES,
    ...spec.body,
  });
  const id = created[spec.idKey];
  if (typeof id !== "string") throw new EbayError(`eBay did not return a ${spec.idKey}.`);
  return id;
}

/**
 * Makes sure this seller has their own shipping location and business
 * policies, reusing ours by name when they exist so a retry never duplicates.
 */
export async function ensureSellerSetup(input: {
  env: EbayEnv;
  accessToken: string;
  postalCode: string;
}): Promise<SellerSetup> {
  await optIn(input.env, input.accessToken);
  const locationKey = await ensureLocation(input.env, input.accessToken, input.postalCode);
  const fulfillmentPolicyId = await findOrCreatePolicy(input.env, input.accessToken, FULFILLMENT);
  const paymentPolicyId = await findOrCreatePolicy(input.env, input.accessToken, PAYMENT);
  const returnPolicyId = await findOrCreatePolicy(input.env, input.accessToken, RETURNS);

  return { locationKey, fulfillmentPolicyId, paymentPolicyId, returnPolicyId };
}
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/ebay/sellerSetup.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit -p convex/tsconfig.json
git add convex/ebay/sellerSetup.ts tests/ebay/sellerSetup.test.ts
git commit -m "feat: create or reuse a seller's own eBay location and policies" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Expected: typecheck prints nothing.

---

### Task 3: Category, rules and condition lookups

**Files:**
- Create: `convex/ebay/categoryRules.ts`, `tests/ebay/categoryRules.test.ts`, `tests/ebay/fixtures/category-suggestions.json`, `tests/ebay/fixtures/category-aspects.json`, `tests/ebay/fixtures/condition-policies.json`, `tests/ebay/live.test.ts`

**Interfaces:**
- Consumes: `ebayRequest` (Task 1), `EbayEnv`, `ListingCondition` (Task 1).
- Produces:
  - types `EbayCategory = { categoryId: string; categoryName: string }`, `RequiredDetail = { name: string; mode: "FREE_TEXT" | "SELECTION_ONLY"; allowedValues: string[] }`, `CategoryRules = { requiredDetails: RequiredDetail[]; validConditionIds: number[] }`
  - `buildCategoryQuery(facts: { brand: string | null; model: string | null; genericName: string }): string`
  - `suggestCategory(env: EbayEnv, appToken: string, query: string): Promise<EbayCategory | null>`
  - `getCategoryRules(env: EbayEnv, appToken: string, categoryId: string): Promise<CategoryRules>`
  - `pickCondition(condition: ListingCondition, validConditionIds: number[]): string`
  - parsers `parseCategorySuggestion`, `parseRequiredDetails`, `parseConditionIds`

- [ ] **Step 1: Create the fixtures** (shapes copied from real sandbox responses, trimmed; the `Refresh Rate` aspect is synthetic, added to cover the restricted-list case)

`tests/ebay/fixtures/category-suggestions.json`:

```json
{
  "categorySuggestions": [
    {
      "category": { "categoryId": "80053", "categoryName": "Monitors" },
      "categoryTreeNodeLevel": 3,
      "categoryTreeNodeAncestors": [
        { "categoryId": "162497", "categoryName": "Monitors, Projectors & Accs", "categoryTreeNodeLevel": 2 },
        { "categoryId": "58058", "categoryName": "Computers/Tablets & Networking", "categoryTreeNodeLevel": 1 }
      ]
    },
    {
      "category": { "categoryId": "179", "categoryName": "PC Desktops & All-In-Ones" },
      "categoryTreeNodeLevel": 3,
      "categoryTreeNodeAncestors": []
    }
  ],
  "categoryTreeId": "0",
  "categoryTreeVersion": "131"
}
```

`tests/ebay/fixtures/category-aspects.json`:

```json
{
  "aspects": [
    {
      "localizedAspectName": "Brand",
      "aspectConstraint": {
        "aspectDataType": "STRING",
        "itemToAspectCardinality": "SINGLE",
        "aspectMode": "FREE_TEXT",
        "aspectRequired": true,
        "aspectUsage": "RECOMMENDED",
        "aspectEnabledForVariations": false,
        "aspectApplicableTo": ["PRODUCT"]
      },
      "aspectValues": [{ "localizedValue": "Unbranded" }, { "localizedValue": "3G Technology" }]
    },
    {
      "localizedAspectName": "Screen Size",
      "aspectConstraint": {
        "aspectDataType": "STRING",
        "itemToAspectCardinality": "SINGLE",
        "aspectMode": "FREE_TEXT",
        "aspectRequired": true,
        "aspectUsage": "RECOMMENDED",
        "aspectEnabledForVariations": false,
        "aspectApplicableTo": ["PRODUCT"]
      }
    },
    {
      "localizedAspectName": "Refresh Rate",
      "aspectConstraint": {
        "aspectDataType": "STRING",
        "itemToAspectCardinality": "SINGLE",
        "aspectMode": "SELECTION_ONLY",
        "aspectRequired": true,
        "aspectUsage": "RECOMMENDED",
        "aspectEnabledForVariations": false,
        "aspectApplicableTo": ["PRODUCT"]
      },
      "aspectValues": [{ "localizedValue": "60 Hz" }, { "localizedValue": "144 Hz" }]
    },
    {
      "localizedAspectName": "Energy Star",
      "aspectConstraint": {
        "aspectDataType": "STRING",
        "itemToAspectCardinality": "SINGLE",
        "aspectMode": "SELECTION_ONLY",
        "aspectRequired": false,
        "aspectUsage": "RECOMMENDED",
        "aspectEnabledForVariations": false,
        "aspectApplicableTo": ["PRODUCT"]
      },
      "aspectValues": [{ "localizedValue": "1 Star" }, { "localizedValue": "2 Stars" }]
    }
  ]
}
```

`tests/ebay/fixtures/condition-policies.json`:

```json
{
  "itemConditionPolicies": [
    {
      "categoryTreeId": "0",
      "categoryId": "133705",
      "itemConditionRequired": true,
      "itemConditions": [
        { "conditionId": "1000", "conditionDescription": "New" },
        { "conditionId": "1500", "conditionDescription": "Open box" },
        { "conditionId": "2500", "conditionDescription": "Seller refurbished" },
        { "conditionId": "3000", "conditionDescription": "Used" },
        { "conditionId": "7000", "conditionDescription": "For parts or not working" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing test, `tests/ebay/categoryRules.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCategoryQuery,
  parseCategorySuggestion,
  parseConditionIds,
  parseRequiredDetails,
  pickCondition,
} from "../../convex/ebay/categoryRules";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8"));

describe("buildCategoryQuery", () => {
  it("joins brand, model and generic name, skipping what is unknown", () => {
    expect(buildCategoryQuery({ brand: "Acer", model: null, genericName: "computer monitor" })).toBe(
      "Acer computer monitor",
    );
    expect(
      buildCategoryQuery({ brand: "Sony", model: "DualSense", genericName: "game controller" }),
    ).toBe("Sony DualSense game controller");
    expect(buildCategoryQuery({ brand: null, model: null, genericName: "desk" })).toBe("desk");
  });
});

describe("parseCategorySuggestion", () => {
  it("returns eBay's top suggestion", () => {
    expect(parseCategorySuggestion(fixture("category-suggestions"))).toEqual({
      categoryId: "80053",
      categoryName: "Monitors",
    });
  });

  it("returns null when there is nothing usable", () => {
    expect(parseCategorySuggestion({ categorySuggestions: [] })).toBeNull();
    expect(parseCategorySuggestion({})).toBeNull();
    expect(parseCategorySuggestion(null)).toBeNull();
    expect(parseCategorySuggestion({ categorySuggestions: [{ category: {} }] })).toBeNull();
  });
});

describe("parseRequiredDetails", () => {
  it("keeps only required details, with allowed values only for restricted ones", () => {
    expect(parseRequiredDetails(fixture("category-aspects"))).toEqual([
      { name: "Brand", mode: "FREE_TEXT", allowedValues: [] },
      { name: "Screen Size", mode: "FREE_TEXT", allowedValues: [] },
      { name: "Refresh Rate", mode: "SELECTION_ONLY", allowedValues: ["60 Hz", "144 Hz"] },
    ]);
  });

  it("returns nothing for an unexpected payload", () => {
    expect(parseRequiredDetails({})).toEqual([]);
    expect(parseRequiredDetails(null)).toEqual([]);
  });
});

describe("parseConditionIds", () => {
  it("reads the valid condition IDs for the category as numbers", () => {
    expect(parseConditionIds(fixture("condition-policies"))).toEqual([1000, 1500, 2500, 3000, 7000]);
  });

  it("returns nothing for an unexpected payload", () => {
    expect(parseConditionIds({})).toEqual([]);
    expect(parseConditionIds({ itemConditionPolicies: [{ itemConditions: [{ conditionId: null }] }] })).toEqual([]);
  });
});

describe("pickCondition", () => {
  it("takes the first preferred condition the category accepts", () => {
    expect(pickCondition("new", [1000, 1500, 3000])).toBe("NEW");
    expect(pickCondition("like_new", [1000, 2750, 3000])).toBe("LIKE_NEW");
    expect(pickCondition("good", [1000, 4000, 5000])).toBe("USED_GOOD");
    expect(pickCondition("fair", [1000, 5000])).toBe("USED_GOOD");
  });

  it("falls back to plain Used when the category only allows that", () => {
    expect(pickCondition("good", [1000, 3000])).toBe("USED_EXCELLENT");
    expect(pickCondition("new", [3000, 7000])).toBe("USED_EXCELLENT");
    expect(pickCondition("poor", [1000, 3000])).toBe("USED_EXCELLENT");
  });

  it("keeps the first preference when nothing matches, so publish still tries", () => {
    expect(pickCondition("poor", [1000])).toBe("USED_ACCEPTABLE");
    expect(pickCondition("good", [])).toBe("USED_GOOD");
  });
});
```

Run: `npx vitest run tests/ebay/categoryRules.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `convex/ebay/categoryRules.ts`**

```ts
import { ebayRequest } from "./http";
import type { EbayEnv, ListingCondition } from "./types";

/** eBay US's category tree. */
const CATEGORY_TREE = "0";

export type EbayCategory = { categoryId: string; categoryName: string };

export type RequiredDetail = {
  name: string;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  allowedValues: string[];
};

export type CategoryRules = {
  requiredDetails: RequiredDetail[];
  validConditionIds: number[];
};

/**
 * The generic name is always included: eBay's category finder is text-based,
 * and a brand on its own ("Acer") matches poorly.
 */
export function buildCategoryQuery(facts: {
  brand: string | null;
  model: string | null;
  genericName: string;
}): string {
  return [facts.brand, facts.model, facts.genericName]
    .filter((part): part is string => !!part)
    .join(" ");
}

export function parseCategorySuggestion(payload: unknown): EbayCategory | null {
  const suggestions = (payload as { categorySuggestions?: unknown } | null)?.categorySuggestions;
  if (!Array.isArray(suggestions) || suggestions.length === 0) return null;

  const category = (
    suggestions[0] as { category?: { categoryId?: unknown; categoryName?: unknown } } | null
  )?.category;
  if (typeof category?.categoryId !== "string" || typeof category.categoryName !== "string") {
    return null;
  }
  return { categoryId: category.categoryId, categoryName: category.categoryName };
}

export function parseRequiredDetails(payload: unknown): RequiredDetail[] {
  const aspects = (payload as { aspects?: unknown } | null)?.aspects;
  if (!Array.isArray(aspects)) return [];

  const details: RequiredDetail[] = [];
  for (const aspect of aspects) {
    const record = aspect as {
      localizedAspectName?: unknown;
      aspectConstraint?: { aspectRequired?: unknown; aspectMode?: unknown };
      aspectValues?: unknown;
    } | null;
    if (record === null || typeof record.localizedAspectName !== "string") continue;

    const constraint = record.aspectConstraint;
    if (!constraint || constraint.aspectRequired !== true) continue;

    const restricted = constraint.aspectMode === "SELECTION_ONLY";
    const values = Array.isArray(record.aspectValues)
      ? record.aspectValues.flatMap((value) => {
          const text = (value as { localizedValue?: unknown } | null)?.localizedValue;
          return typeof text === "string" ? [text] : [];
        })
      : [];

    details.push({
      name: record.localizedAspectName,
      mode: restricted ? "SELECTION_ONLY" : "FREE_TEXT",
      allowedValues: restricted ? values : [],
    });
  }
  return details;
}

export function parseConditionIds(payload: unknown): number[] {
  const policies = (payload as { itemConditionPolicies?: unknown } | null)?.itemConditionPolicies;
  if (!Array.isArray(policies)) return [];

  const conditions = (policies[0] as { itemConditions?: unknown } | undefined)?.itemConditions;
  if (!Array.isArray(conditions)) return [];

  return conditions.flatMap((condition) => {
    const raw = (condition as { conditionId?: unknown } | null)?.conditionId;
    const id = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
    return Number.isFinite(id) ? [id] : [];
  });
}

export async function suggestCategory(
  env: EbayEnv,
  appToken: string,
  query: string,
): Promise<EbayCategory | null> {
  const payload = await ebayRequest(
    env,
    appToken,
    "GET",
    `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE}/get_category_suggestions?q=${encodeURIComponent(query)}`,
  );
  return parseCategorySuggestion(payload);
}

export async function getCategoryRules(
  env: EbayEnv,
  appToken: string,
  categoryId: string,
): Promise<CategoryRules> {
  const [aspects, conditions] = await Promise.all([
    ebayRequest(
      env,
      appToken,
      "GET",
      `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
    ),
    ebayRequest(
      env,
      appToken,
      "GET",
      `/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=${encodeURIComponent(`categoryIds:{${categoryId}}`)}`,
    ),
  ]);

  return {
    requiredDetails: parseRequiredDetails(aspects),
    validConditionIds: parseConditionIds(conditions),
  };
}

/** eBay's condition IDs for the Inventory API's condition enums. */
const CONDITION_IDS: Record<string, number> = {
  NEW: 1000,
  NEW_OTHER: 1500,
  SELLER_REFURBISHED: 2500,
  LIKE_NEW: 2750,
  USED_EXCELLENT: 3000,
  USED_VERY_GOOD: 4000,
  USED_GOOD: 5000,
  USED_ACCEPTABLE: 6000,
};

/** Best match first; plain "Used" (USED_EXCELLENT) is the widest fallback. */
const PREFERENCES: Record<ListingCondition, string[]> = {
  new: ["NEW", "NEW_OTHER", "USED_EXCELLENT"],
  like_new: ["LIKE_NEW", "NEW_OTHER", "USED_EXCELLENT", "USED_VERY_GOOD"],
  good: ["USED_GOOD", "USED_VERY_GOOD", "USED_EXCELLENT"],
  fair: ["USED_ACCEPTABLE", "USED_GOOD", "USED_EXCELLENT"],
  poor: ["USED_ACCEPTABLE", "USED_GOOD", "USED_EXCELLENT"],
};

export function pickCondition(condition: ListingCondition, validConditionIds: number[]): string {
  const preferences = PREFERENCES[condition];
  return (
    preferences.find((option) => validConditionIds.includes(CONDITION_IDS[option])) ??
    preferences[0]
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/ebay/categoryRules.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the gated live smoke test, `tests/ebay/live.test.ts`**

It is skipped unless `EBAY_LIVE=1` and the app keys are in the environment, so the normal suite never touches the network.

```ts
import { describe, expect, it } from "vitest";
import { getCategoryRules, suggestCategory } from "../../convex/ebay/categoryRules";
import { getAppAccessToken } from "../../convex/ebay/oauth";

const live =
  process.env.EBAY_LIVE === "1" && !!process.env.EBAY_CLIENT_ID && !!process.env.EBAY_CLIENT_SECRET;

describe.skipIf(!live)("eBay sandbox lookups (live)", () => {
  it("finds sensible categories and their rules for real items", async () => {
    const appToken = await getAppAccessToken({
      env: "sandbox",
      clientId: process.env.EBAY_CLIENT_ID!,
      clientSecret: process.env.EBAY_CLIENT_SECRET!,
    });

    const controller = await suggestCategory("sandbox", appToken, "Sony DualSense wireless controller");
    expect(controller?.categoryId).toBe("117042");

    const monitor = await suggestCategory("sandbox", appToken, "Acer curved computer monitor");
    expect(monitor?.categoryId).toBe("80053");

    const rules = await getCategoryRules("sandbox", appToken, monitor!.categoryId);
    expect(rules.requiredDetails.map((detail) => detail.name)).toEqual(
      expect.arrayContaining(["Brand", "Screen Size"]),
    );
    expect(rules.validConditionIds).toContain(3000);
  });
});
```

- [ ] **Step 6: Run the live smoke against the real sandbox**

```bash
EBAY_LIVE=1 EBAY_CLIENT_ID="$(npx convex env get EBAY_CLIENT_ID | tr -d '\r\n')" EBAY_CLIENT_SECRET="$(npx convex env get EBAY_CLIENT_SECRET | tr -d '\r\n')" npx vitest run tests/ebay/live.test.ts
```

Expected: PASS (1 test). If a category ID differs, eBay's sandbox taxonomy changed: print the suggestion and adjust the two expected IDs, do not loosen the other assertions.

- [ ] **Step 7: Typecheck and commit**

```bash
npx vitest run
npx tsc --noEmit -p convex/tsconfig.json
git add convex/ebay/categoryRules.ts tests/ebay/categoryRules.test.ts tests/ebay/live.test.ts tests/ebay/fixtures/category-suggestions.json tests/ebay/fixtures/category-aspects.json tests/ebay/fixtures/condition-policies.json
git commit -m "feat: look up an item's eBay category, required details and valid conditions" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Expected: all tests pass (the live one is skipped); typecheck prints nothing.

---

### Task 4: Item details (AI fill)

**Files:**
- Create: `convex/ebay/itemDetails.ts`, `tests/ebay/itemDetails.test.ts`

**Interfaces:**
- Consumes: `RequiredDetail` (Task 3).
- Produces:
  - type `ItemFacts = { genericName: string; brand: string | null; model: string | null; category: string; condition: string; attributes: string[] }`
  - `DOES_NOT_APPLY` (`"Does not apply"`)
  - `knownDetailValues(facts: ItemFacts): Record<string, string>`
  - `normalizeDetails(required: RequiredDetail[], raw: Record<string, unknown>): Record<string, string[]>`
  - `buildDetailsSchema(required: RequiredDetail[])`, `buildDetailsPrompt(input: { required: RequiredDetail[]; facts: ItemFacts; title: string; description: string }): string`
  - `fillItemDetails(input: { apiKey: string; model?: string; required: RequiredDetail[]; facts: ItemFacts; title: string; description: string }): Promise<Record<string, string[]>>` (never throws for an OpenAI problem; falls back to known values)

- [ ] **Step 1: Write the failing test, `tests/ebay/itemDetails.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequiredDetail } from "../../convex/ebay/categoryRules";
import {
  buildDetailsPrompt,
  buildDetailsSchema,
  fillItemDetails,
  knownDetailValues,
  normalizeDetails,
  type ItemFacts,
} from "../../convex/ebay/itemDetails";
import { fakeEbay } from "./fakeFetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const required: RequiredDetail[] = [
  { name: "Brand", mode: "FREE_TEXT", allowedValues: [] },
  { name: "Screen Size", mode: "FREE_TEXT", allowedValues: [] },
  { name: "Refresh Rate", mode: "SELECTION_ONLY", allowedValues: ["60 Hz", "144 Hz"] },
];

const facts: ItemFacts = {
  genericName: "computer monitor",
  brand: "Acer",
  model: null,
  category: "computer monitor",
  condition: "Looks lightly used",
  attributes: ["Black bezel", "Curved screen"],
};

describe("knownDetailValues", () => {
  it("offers what the photo analysis established, under eBay's usual names", () => {
    expect(knownDetailValues(facts)).toEqual({ Type: "computer monitor", Brand: "Acer" });
    expect(knownDetailValues({ ...facts, brand: null, model: "DualSense" })).toEqual({
      Type: "computer monitor",
      Model: "DualSense",
    });
  });
});

describe("normalizeDetails", () => {
  it("trims values and fills gaps with Does not apply, and Unbranded for Brand", () => {
    expect(
      normalizeDetails(required, { Brand: "  Acer ", "Screen Size": "", "Refresh Rate": "144 hz" }),
    ).toEqual({
      Brand: ["Acer"],
      "Screen Size": ["Does not apply"],
      "Refresh Rate": ["144 Hz"],
    });

    expect(normalizeDetails(required, {})).toEqual({
      Brand: ["Unbranded"],
      "Screen Size": ["Does not apply"],
      "Refresh Rate": ["Does not apply"],
    });
  });

  it("replaces a restricted-list value that is not on the list", () => {
    expect(normalizeDetails(required, { "Refresh Rate": "240 Hz" })["Refresh Rate"]).toEqual([
      "Does not apply",
    ]);
  });
});

describe("buildDetailsSchema", () => {
  it("keys the schema on an index so odd eBay names cannot break it", () => {
    const schema = buildDetailsSchema(required);

    expect(Object.keys(schema.properties)).toEqual(["d0", "d1", "d2"]);
    expect(schema.required).toEqual(["d0", "d1", "d2"]);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("buildDetailsPrompt", () => {
  it("lists each detail, its choices, and the known facts", () => {
    const prompt = buildDetailsPrompt({
      required,
      facts,
      title: "Acer Curved Monitor",
      description: "27 inch curved monitor",
    });

    expect(prompt).toContain("d0: Brand — free text");
    expect(prompt).toContain("d2: Refresh Rate — choose exactly one of: 60 Hz | 144 Hz");
    expect(prompt).toContain("Title: Acer Curved Monitor");
    expect(prompt).toContain("Brand: Acer");
    expect(prompt).toContain("Model: unknown");
    expect(prompt).toContain("Black bezel; Curved screen");
  });
});

function openAiReturning(content: unknown, status = 200) {
  return fakeEbay({
    "POST /v1/chat/completions": () => ({
      status,
      json: status === 200 ? { choices: [{ message: { content: JSON.stringify(content) } }] } : {},
    }),
  });
}

describe("fillItemDetails", () => {
  const input = {
    apiKey: "key",
    required,
    facts,
    title: "Acer Curved Monitor",
    description: "27 inch curved monitor",
  };

  it("maps the model's indexed answers back to eBay's detail names", async () => {
    const calls = openAiReturning({ d0: "Acer", d1: "27 in", d2: "144 Hz" });

    const details = await fillItemDetails(input);

    expect(details).toEqual({
      Brand: ["Acer"],
      "Screen Size": ["27 in"],
      "Refresh Rate": ["144 Hz"],
    });
    expect(calls).toHaveLength(1);
  });

  it("keeps a known value when the model says Does not apply", async () => {
    openAiReturning({ d0: "Does not apply", d1: "Does not apply", d2: "Does not apply" });

    const details = await fillItemDetails(input);

    expect(details.Brand).toEqual(["Acer"]);
    expect(details["Screen Size"]).toEqual(["Does not apply"]);
  });

  it("falls back to known values when OpenAI fails, instead of blocking publish", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    openAiReturning({}, 500);

    const details = await fillItemDetails(input);

    expect(details).toEqual({
      Brand: ["Acer"],
      "Screen Size": ["Does not apply"],
      "Refresh Rate": ["Does not apply"],
    });
  });

  it("makes no call when the category requires nothing", async () => {
    const calls = openAiReturning({});

    expect(await fillItemDetails({ ...input, required: [] })).toEqual({});
    expect(calls).toHaveLength(0);
  });
});
```

Run: `npx vitest run tests/ebay/itemDetails.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Create `convex/ebay/itemDetails.ts`**

```ts
import type { RequiredDetail } from "./categoryRules";

export const DOES_NOT_APPLY = "Does not apply";

const DEFAULT_MODEL = "gpt-5.6-luna";
const MAX_SHOWN_ALLOWED_VALUES = 60;

export type ItemFacts = {
  genericName: string;
  brand: string | null;
  model: string | null;
  category: string;
  condition: string;
  attributes: string[];
};

const SYSTEM_PROMPT = `You fill in required eBay item details for a used-item listing.

Rules:
- Use ONLY facts stated in the item information you are given. Never guess.
- Never invent measurements, sizes or counts. If a value is not stated, answer "Does not apply".
- Brand: the manufacturer if stated, otherwise "Unbranded".
- For details with a list of choices, answer with exactly one item from that list, copied exactly. If none clearly fits, answer "Does not apply".
- Answers are short values (a few words), never sentences.`;

/** What the photo analysis established, under eBay's most common detail names. */
export function knownDetailValues(facts: ItemFacts): Record<string, string> {
  const known: Record<string, string> = { Type: facts.category };
  if (facts.brand) known.Brand = facts.brand;
  if (facts.model) known.Model = facts.model;
  return known;
}

/** Guarantees every required detail has a valid, non-empty value. */
export function normalizeDetails(
  required: RequiredDetail[],
  raw: Record<string, unknown>,
): Record<string, string[]> {
  const details: Record<string, string[]> = {};

  for (const detail of required) {
    const fallback = detail.name.toLowerCase() === "brand" ? "Unbranded" : DOES_NOT_APPLY;
    const candidate = typeof raw[detail.name] === "string" ? (raw[detail.name] as string).trim() : "";
    let value = candidate === "" ? fallback : candidate;

    if (detail.mode === "SELECTION_ONLY" && detail.allowedValues.length > 0) {
      const match = detail.allowedValues.find(
        (allowed) => allowed.toLowerCase() === value.toLowerCase(),
      );
      value = match ?? DOES_NOT_APPLY;
    }

    details[detail.name] = [value];
  }

  return details;
}

/** Keyed on an index because eBay's detail names can contain odd characters. */
export function buildDetailsSchema(required: RequiredDetail[]) {
  const properties: Record<string, { type: "string" }> = {};
  required.forEach((_, index) => {
    properties[`d${index}`] = { type: "string" };
  });

  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  } as const;
}

export function buildDetailsPrompt(input: {
  required: RequiredDetail[];
  facts: ItemFacts;
  title: string;
  description: string;
}): string {
  const fields = input.required.map((detail, index) => {
    const choices =
      detail.mode === "SELECTION_ONLY" && detail.allowedValues.length > 0
        ? ` — choose exactly one of: ${detail.allowedValues.slice(0, MAX_SHOWN_ALLOWED_VALUES).join(" | ")}`
        : " — free text";
    return `d${index}: ${detail.name}${choices}`;
  });

  const { facts } = input;
  return [
    "Details to fill in:",
    ...fields,
    "",
    "Item information:",
    `Title: ${input.title}`,
    `Description: ${input.description}`,
    `Kind of item: ${facts.genericName} (${facts.category})`,
    `Brand: ${facts.brand ?? "unknown"}`,
    `Model: ${facts.model ?? "unknown"}`,
    `Visible attributes: ${facts.attributes.join("; ") || "none"}`,
  ].join("\n");
}

/**
 * One small OpenAI call fills the category's required details. An OpenAI
 * problem never blocks a publish: it falls back to what we already know.
 */
export async function fillItemDetails(input: {
  apiKey: string;
  model?: string;
  required: RequiredDetail[];
  facts: ItemFacts;
  title: string;
  description: string;
}): Promise<Record<string, string[]>> {
  if (input.required.length === 0) return {};

  const known = knownDetailValues(input.facts);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model ?? DEFAULT_MODEL,
        reasoning_effort: "low",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildDetailsPrompt(input) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ebay_item_details",
            strict: true,
            schema: buildDetailsSchema(input.required),
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned an empty response");
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const byName: Record<string, unknown> = {};
    input.required.forEach((detail, index) => {
      const answer = parsed[`d${index}`];
      const text = typeof answer === "string" ? answer.trim() : "";
      const usable = text !== "" && text.toLowerCase() !== DOES_NOT_APPLY.toLowerCase();
      byName[detail.name] = usable ? text : (known[detail.name] ?? text);
    });

    return normalizeDetails(input.required, byName);
  } catch (error) {
    console.warn(
      "eBay item-detail fill failed; using known values only:",
      error instanceof Error ? error.message : error,
    );
    return normalizeDetails(input.required, known);
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/ebay/itemDetails.test.ts`
Expected: PASS (all tests).

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit -p convex/tsconfig.json
git add convex/ebay/itemDetails.ts tests/ebay/itemDetails.test.ts
git commit -m "feat: fill an eBay category's required item details from what we know" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Expected: typecheck prints nothing.

---

### Task 5: Resolve a listing's eBay spec

**Files:**
- Create: `convex/ebay/prepare.ts`, `tests/ebay/prepare.test.ts`

**Interfaces:**
- Consumes: `buildCategoryQuery`, `suggestCategory`, `getCategoryRules`, `pickCondition` (Task 3); `fillItemDetails`, `ItemFacts` (Task 4); `EbayError`, `EbayEnv`, `ListingCondition` (Task 1).
- Produces:
  - type `ListingSpec = { categoryId: string; categoryName: string; ebayCondition: string; aspects: Record<string, string[]> }`
  - `resolveListingSpec(input: { env: EbayEnv; appToken: string; openaiApiKey: string; model?: string; facts: ItemFacts; title: string; description: string; condition: ListingCondition }): Promise<ListingSpec>`

- [ ] **Step 1: Write the failing test, `tests/ebay/prepare.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveListingSpec } from "../../convex/ebay/prepare";
import { fakeEbay } from "./fakeFetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8"));

const TAXONOMY = "/commerce/taxonomy/v1/category_tree/0";

const input = {
  env: "sandbox" as const,
  appToken: "app-token",
  openaiApiKey: "key",
  facts: {
    genericName: "computer monitor",
    brand: "Acer",
    model: null,
    category: "computer monitor",
    condition: "Looks lightly used",
    attributes: ["Curved screen"],
  },
  title: "Acer Curved Monitor",
  description: "27 inch curved monitor",
  condition: "good" as const,
};

describe("resolveListingSpec", () => {
  it("finds the category, a valid condition, and the required details", async () => {
    const calls = fakeEbay({
      [`GET ${TAXONOMY}/get_category_suggestions`]: () => ({
        status: 200,
        json: fixture("category-suggestions"),
      }),
      [`GET ${TAXONOMY}/get_item_aspects_for_category`]: () => ({
        status: 200,
        json: fixture("category-aspects"),
      }),
      "GET /sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies": () => ({
        status: 200,
        json: fixture("condition-policies"),
      }),
      "POST /v1/chat/completions": () => ({
        status: 200,
        json: {
          choices: [{ message: { content: JSON.stringify({ d0: "Acer", d1: "27 in", d2: "144 Hz" }) } }],
        },
      }),
    });

    const spec = await resolveListingSpec(input);

    expect(spec).toEqual({
      categoryId: "80053",
      categoryName: "Monitors",
      ebayCondition: "USED_EXCELLENT",
      aspects: { Brand: ["Acer"], "Screen Size": ["27 in"], "Refresh Rate": ["144 Hz"] },
    });
    const search = calls.find((call) => call.path.endsWith("get_category_suggestions"));
    expect(decodeURIComponent(search?.query ?? "")).toContain("Acer computer monitor");
  });

  it("retries the category search with the listing title, then gives up clearly", async () => {
    const calls = fakeEbay({
      [`GET ${TAXONOMY}/get_category_suggestions`]: () => ({
        status: 200,
        json: { categorySuggestions: [] },
      }),
    });

    await expect(resolveListingSpec(input)).rejects.toThrow(
      'Couldn\'t find an eBay category for "Acer computer monitor".',
    );
    expect(calls.filter((call) => call.path.endsWith("get_category_suggestions"))).toHaveLength(2);
  });

  it("still resolves when OpenAI is down, using what is known", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeEbay({
      [`GET ${TAXONOMY}/get_category_suggestions`]: () => ({
        status: 200,
        json: fixture("category-suggestions"),
      }),
      [`GET ${TAXONOMY}/get_item_aspects_for_category`]: () => ({
        status: 200,
        json: fixture("category-aspects"),
      }),
      "GET /sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies": () => ({
        status: 200,
        json: fixture("condition-policies"),
      }),
      "POST /v1/chat/completions": () => ({ status: 500, json: {} }),
    });

    const spec = await resolveListingSpec(input);

    expect(spec.aspects).toEqual({
      Brand: ["Acer"],
      "Screen Size": ["Does not apply"],
      "Refresh Rate": ["Does not apply"],
    });
  });
});
```

Run: `npx vitest run tests/ebay/prepare.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Create `convex/ebay/prepare.ts`**

```ts
import {
  buildCategoryQuery,
  getCategoryRules,
  pickCondition,
  suggestCategory,
} from "./categoryRules";
import { fillItemDetails, type ItemFacts } from "./itemDetails";
import { EbayError, type EbayEnv, type ListingCondition } from "./types";

export type ListingSpec = {
  categoryId: string;
  categoryName: string;
  ebayCondition: string;
  aspects: Record<string, string[]>;
};

/** Everything eBay needs to know about the item itself, resolved at publish time. */
export async function resolveListingSpec(input: {
  env: EbayEnv;
  appToken: string;
  openaiApiKey: string;
  model?: string;
  facts: ItemFacts;
  title: string;
  description: string;
  condition: ListingCondition;
}): Promise<ListingSpec> {
  const query = buildCategoryQuery(input.facts);
  const category =
    (await suggestCategory(input.env, input.appToken, query)) ??
    (await suggestCategory(input.env, input.appToken, input.title));
  if (category === null) {
    throw new EbayError(`Couldn't find an eBay category for "${query}".`);
  }

  const rules = await getCategoryRules(input.env, input.appToken, category.categoryId);
  const aspects = await fillItemDetails({
    apiKey: input.openaiApiKey,
    model: input.model,
    required: rules.requiredDetails,
    facts: input.facts,
    title: input.title,
    description: input.description,
  });

  return {
    categoryId: category.categoryId,
    categoryName: category.categoryName,
    ebayCondition: pickCondition(input.condition, rules.validConditionIds),
    aspects,
  };
}
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/ebay/prepare.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Typecheck and commit**

```bash
npx vitest run
npx tsc --noEmit -p convex/tsconfig.json
git add convex/ebay/prepare.ts tests/ebay/prepare.test.ts
git commit -m "feat: resolve a listing's eBay category, condition and details" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Expected: all tests pass; typecheck prints nothing.

---

### Task 6: ZIP through connect, callback and connection status

**Files:**
- Modify: `convex/schema.ts`, `convex/ebay/oauthState.ts`, `convex/ebayAuth.ts`, `convex/http.ts`, `tests/convex/ebay.test.ts`

**Interfaces:**
- Consumes: `isValidPostalCode` (Task 1), `SellerSetup` type (Task 1).
- Produces:
  - schema: `sellerSetupValidator` (exported), `ebayConnections.shipFromPostalCode?`, `ebayConnections.sellerSetup?`, `ebayOauthStates.postalCode?`
  - `issueOauthState(ctx, userId, postalCode?)`, `consumeOauthState(ctx, nonce, now): Promise<{ userId: Id<"users">; postalCode: string | null } | null>`
  - `api.ebayAuth.connect({ postalCode? })`; `internal.ebayAuth.consumeState({ nonce })` returning `{ userId, postalCode } | null`; `internal.ebayAuth.saveConnection({ ..., shipFromPostalCode? })`; `internal.ebayAuth.saveSellerSetup({ userId, sellerSetup })`
  - `api.ebayAuth.connectionStatus` returns `{ connected: boolean; mode: string | null; configuredMode: "mock" | "sandbox"; shipFromPostalCode: string | null }`

- [ ] **Step 1: Update the existing tests and add new ones in `tests/convex/ebay.test.ts`**

In the existing test `works once and then is gone`, change the expectation lines to:

```ts
    expect(first).toEqual({ userId: alice.userId, postalCode: null });
    expect(second).toBeNull();
```

Add these tests at the end of the file (inside no describe, or in a new `describe("eBay ZIP code", ...)`; the file already imports `api`, `internal`, `issueOauthState`, `createUser`, `newTest`, `vi`):

```ts
describe("the seller's ZIP code", () => {
  const sandboxEnv = () => {
    process.env.EBAY_MODE = "sandbox";
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_RU_NAME = "ru-name";
  };
  const clearSandboxEnv = () => {
    delete process.env.EBAY_MODE;
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_RU_NAME;
  };

  it("connect in sandbox mode requires a valid ZIP", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");

    sandboxEnv();
    try {
      await expect(alice.as.mutation(api.ebayAuth.connect, {})).rejects.toThrow(
        "Enter a valid US ZIP code (for example 94105).",
      );
      await expect(
        alice.as.mutation(api.ebayAuth.connect, { postalCode: "abc" }),
      ).rejects.toThrow("Enter a valid US ZIP code (for example 94105).");

      const result = await alice.as.mutation(api.ebayAuth.connect, { postalCode: "94105" });
      expect(result.mode).toBe("sandbox");
      expect(result.authorizeUrl).toContain("auth.sandbox.ebay.com");
    } finally {
      clearSandboxEnv();
    }
  });

  it("the ZIP travels through the one-time code onto the connection", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const nonce = await t.run(async (ctx) => await issueOauthState(ctx, alice.userId, "94105"));

    const state = await t.mutation(internal.ebayAuth.consumeState, { nonce });
    expect(state).toEqual({ userId: alice.userId, postalCode: "94105" });

    await t.mutation(internal.ebayAuth.saveConnection, {
      userId: alice.userId,
      accessToken: "token",
      refreshToken: "refresh",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      mode: "sandbox",
      shipFromPostalCode: state?.postalCode ?? undefined,
    });

    sandboxEnv();
    try {
      const status = await alice.as.query(api.ebayAuth.connectionStatus, {});
      expect(status).toEqual({
        connected: true,
        mode: "sandbox",
        configuredMode: "sandbox",
        shipFromPostalCode: "94105",
      });
    } finally {
      clearSandboxEnv();
    }
  });

  it("a sandbox connection without a ZIP counts as not connected", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    await t.mutation(internal.ebayAuth.saveConnection, {
      userId: alice.userId,
      accessToken: "token",
      refreshToken: "refresh",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      mode: "sandbox",
    });

    sandboxEnv();
    try {
      const status = await alice.as.query(api.ebayAuth.connectionStatus, {});
      expect(status.connected).toBe(false);
      expect(status.configuredMode).toBe("sandbox");
    } finally {
      clearSandboxEnv();
    }
  });

  it("remembers a seller's setup IDs on their connection", async () => {
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

    await t.mutation(internal.ebayAuth.saveSellerSetup, {
      userId: alice.userId,
      sellerSetup: {
        locationKey: "roomsale-94105",
        fulfillmentPolicyId: "F1",
        paymentPolicyId: "P1",
        returnPolicyId: "R1",
      },
    });

    const connection = await t.query(internal.ebayAuth.connectionForUser, { userId: alice.userId });
    expect(connection?.sellerSetup?.fulfillmentPolicyId).toBe("F1");
    expect(connection?.shipFromPostalCode).toBe("94105");
  });
});
```

Run: `npx vitest run tests/convex/ebay.test.ts`
Expected: FAIL (the new tests and the changed expectation).

- [ ] **Step 2: Extend the schema in `convex/schema.ts`**

Add this exported validator next to the other exported validators (for example below `researchSourceValidator`):

```ts
export const sellerSetupValidator = v.object({
  locationKey: v.string(),
  fulfillmentPolicyId: v.string(),
  paymentPolicyId: v.string(),
  returnPolicyId: v.string(),
});
```

In the `ebayConnections` table, add these two fields after `updatedAt: v.number(),`:

```ts
    /** Where this seller ships from; used to create their own eBay location. */
    shipFromPostalCode: v.optional(v.string()),
    /** The seller's own location and policy IDs, once they have been created. */
    sellerSetup: v.optional(sellerSetupValidator),
```

In the `ebayOauthStates` table, add this field after `expiresAt: v.number(),`:

```ts
    /** The ZIP the seller entered before being sent to eBay. */
    postalCode: v.optional(v.string()),
```

- [ ] **Step 3: Rewrite `convex/ebay/oauthState.ts`** (full replacement)

```ts
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** A random single-use code that stands in for the user across eBay's redirect. */
export async function issueOauthState(
  ctx: MutationCtx,
  userId: Id<"users">,
  postalCode?: string,
): Promise<string> {
  const nonce = crypto.randomUUID();
  await ctx.db.insert("ebayOauthStates", {
    nonce,
    userId,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    postalCode,
  });
  return nonce;
}

/** Deletes the code whether or not it is still valid, so a link can never be replayed. */
export async function consumeOauthState(
  ctx: MutationCtx,
  nonce: string,
  now: number,
): Promise<{ userId: Id<"users">; postalCode: string | null } | null> {
  const row = await ctx.db
    .query("ebayOauthStates")
    .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
    .unique();
  if (row === null) return null;

  await ctx.db.delete("ebayOauthStates", row._id);
  if (row.expiresAt < now) return null;
  return { userId: row.userId, postalCode: row.postalCode ?? null };
}
```

- [ ] **Step 4: Update `convex/ebayAuth.ts`**

Add these imports (merge with existing import lines):

```ts
import { sellerSetupValidator } from "./schema";
import { isValidPostalCode } from "./ebay/postalCode";
```

Add the optional ZIP to `upsertConnection`'s `fields` type (after `mode: string;`):

```ts
    shipFromPostalCode?: string;
```

Replace the `connect` mutation with:

```ts
/** Mock mode connects instantly (no OAuth). Sandbox mode returns the
 * consent URL for the client to open in a popup. */
export const connect = mutation({
  args: { postalCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const mode = getEbayMode();

    if (mode === "mock") {
      const now = Date.now();
      await upsertConnection(ctx, {
        userId,
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
        accessTokenExpiresAt: now + 1000 * 60 * 60 * 24 * 365,
        mode: "mock",
      });
      return { mode: "mock" as const, authorizeUrl: null };
    }

    const postalCode = args.postalCode?.trim();
    if (postalCode === undefined || !isValidPostalCode(postalCode)) {
      throw new Error("Enter a valid US ZIP code (for example 94105).");
    }

    const clientId = env.EBAY_CLIENT_ID?.trim();
    const ruName = env.EBAY_RU_NAME?.trim();
    if (!clientId || !ruName) {
      throw new Error(
        "eBay sandbox isn't configured yet — EBAY_CLIENT_ID and EBAY_RU_NAME must be set in the Convex environment.",
      );
    }

    const state = await issueOauthState(ctx, userId, postalCode);
    const authorizeUrl = buildAuthorizeUrl({ env: "sandbox", clientId, ruName, state });

    return { mode: "sandbox" as const, authorizeUrl };
  },
});
```

Replace `saveConnection`'s `args` object to add the ZIP (add this line after `mode: v.string(),`):

```ts
    shipFromPostalCode: v.optional(v.string()),
```

Add this new internal mutation after `saveConnection`:

```ts
export const saveSellerSetup = internalMutation({
  args: { userId: v.id("users"), sellerSetup: sellerSetupValidator },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (connection === null) return null;

    await ctx.db.patch("ebayConnections", connection._id, { sellerSetup: args.sellerSetup });
    return null;
  },
});
```

Replace `connectionStatus` with:

```ts
export const connectionStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const configuredMode = getEbayMode();
    // A demo connection can't publish to real eBay (or the reverse), and a real
    // one needs the seller's ZIP, so after a mode switch or for an older
    // connection the user is asked to connect again instead of failing later.
    const usable =
      connection !== null &&
      connection.mode === configuredMode &&
      (configuredMode === "mock" || connection.shipFromPostalCode !== undefined);

    return {
      connected: usable,
      mode: usable ? connection.mode : null,
      configuredMode,
      shipFromPostalCode: connection?.shipFromPostalCode ?? null,
    };
  },
});
```

(`consumeState` keeps its body; it now returns the object from `consumeOauthState`. `connectionForUser` returns the whole row, so it already includes the new fields.)

- [ ] **Step 5: Update the callback in `convex/http.ts`**

Replace this block:

```ts
    const userId: Id<"users"> | null = await ctx.runMutation(internal.ebayAuth.consumeState, {
      nonce: state,
    });
    if (userId === null) {
      return page(false, "This connection link is invalid or has expired. Please try again.");
    }
```

with:

```ts
    const pending: { userId: Id<"users">; postalCode: string | null } | null =
      await ctx.runMutation(internal.ebayAuth.consumeState, { nonce: state });
    if (pending === null) {
      return page(false, "This connection link is invalid or has expired. Please try again.");
    }
```

and replace the `saveConnection` call's `userId,` line so the call becomes:

```ts
      await ctx.runMutation(internal.ebayAuth.saveConnection, {
        userId: pending.userId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? undefined,
        mode: "sandbox",
        shipFromPostalCode: pending.postalCode ?? undefined,
      });
```

(Keep the surrounding `try`/`catch` and the success page as they are.)

- [ ] **Step 6: Run the tests, typecheck, push to dev**

```bash
npx vitest run
npx tsc --noEmit -p convex/tsconfig.json
npx convex dev --once
```

Expected: all tests pass; typecheck prints nothing; push succeeds (the schema change is additive, so no data is affected). The root `npm run typecheck` may fail on `EbayConnectButton` until Task 8: that is expected.

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts convex/ebay/oauthState.ts convex/ebayAuth.ts convex/http.ts convex/_generated/api.d.ts tests/convex/ebay.test.ts
git commit -m "feat: collect the seller's ZIP at connect and carry it through eBay's redirect" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Publish flow, publisher input, cleanup

**Files:**
- Modify: `convex/ebay/types.ts`, `convex/ebay/sandbox.ts`, `convex/listingPublish.ts`, `convex/convex.config.ts`, `tests/convex/ebay.test.ts`
- Delete: `convex/ebaySetup.ts`

**Interfaces:**
- Consumes: `ensureSellerSetup` (Task 2), `resolveListingSpec` (Task 5), `getAppAccessToken` (Task 1), `locationKeyFor` (Task 1), `internal.ebayAuth.saveSellerSetup` and `connectionForUser` (Task 6).
- Produces: `PublishInput` with optional `categoryId`, `merchantLocationKey`, `fulfillmentPolicyId`, `paymentPolicyId`, `returnPolicyId`, and `listing: { sku, title, description, price, imageUrl, ebayCondition?, aspects? }`.

- [ ] **Step 1: Add the failing test to `tests/convex/ebay.test.ts`**

Add inside the existing `describe("publishing is private to the listing owner", ...)`'s file scope (a new `describe` at the end is fine):

```ts
describe("publishing in sandbox mode needs the seller's ZIP", () => {
  it("fails with a clear message when the connection has no ZIP", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["x"])));
    await t.run(async (ctx) => {
      await ctx.db.patch("cleanouts", cleanoutId, { imageStorageId: storageId });
      const now = Date.now();
      await ctx.db.insert("ebayConnections", {
        userId: alice.userId,
        accessToken: "token",
        refreshToken: "refresh",
        accessTokenExpiresAt: now + 3_600_000,
        mode: "sandbox",
        connectedAt: now,
        updatedAt: now,
      });
    });
    const listingId = await seedListing(t, cleanoutId, await seedItem(t, cleanoutId), "publishing");

    process.env.EBAY_MODE = "sandbox";
    try {
      await t.action(internal.listingPublish.publishOne, { listingId, userId: alice.userId });
    } finally {
      delete process.env.EBAY_MODE;
    }

    const listing = await t.run(async (ctx) => await ctx.db.get("listings", listingId));
    expect(listing?.status).toBe("failed");
    expect(listing?.publishError).toBe(
      "Reconnect eBay and enter your ZIP code — it's needed to set up your shipping location.",
    );
  });
});
```

Run: `npx vitest run tests/convex/ebay.test.ts`
Expected: FAIL (publish reads env vars and reports a different error).

- [ ] **Step 2: Change `PublishInput` in `convex/ebay/types.ts`**

Replace the whole `PublishInput` type with:

```ts
export type PublishInput = {
  accessToken: string;
  env: EbayEnv;
  categoryId?: string;
  merchantLocationKey?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  listing: {
    sku: string;
    title: string;
    description: string;
    price: number;
    imageUrl: string;
    /** Already-resolved eBay condition enum for this category. */
    ebayCondition?: string;
    /** Already-resolved required item details for this category. */
    aspects?: Record<string, string[]>;
  };
};
```

- [ ] **Step 3: Rewrite `convex/ebay/sandbox.ts`** (full replacement)

```ts
/**
 * Real eBay Sell Inventory API flow: createOrReplaceInventoryItem, then
 * createOffer, then publishOffer. The seller's location and policies, the
 * category, the condition and the item details are resolved by the caller
 * (see ebay/sellerSetup.ts and ebay/prepare.ts); this file only talks to the
 * Inventory API.
 */

import { ebayRequest } from "./http";
import { EbayError, type EbayEnv, type EbayPublisher } from "./types";

export function createSandboxPublisher(env: EbayEnv): EbayPublisher {
  return {
    name: env,
    async publish(input) {
      const {
        categoryId,
        merchantLocationKey,
        fulfillmentPolicyId,
        paymentPolicyId,
        returnPolicyId,
      } = input;
      const { ebayCondition, aspects } = input.listing;
      if (
        !categoryId ||
        !merchantLocationKey ||
        !fulfillmentPolicyId ||
        !paymentPolicyId ||
        !returnPolicyId ||
        !ebayCondition ||
        !aspects
      ) {
        throw new EbayError(
          "The eBay publisher was called without a category, seller setup, condition or item details.",
        );
      }

      const sku = input.listing.sku;

      const putInventoryItem = (condition: string) =>
        ebayRequest(env, input.accessToken, "PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
          condition,
          product: {
            title: input.listing.title,
            description: input.listing.description,
            imageUrls: [input.listing.imageUrl],
            aspects,
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

      await putInventoryItem(ebayCondition);

      let offerId: string;
      try {
        const offer = await ebayRequest(env, input.accessToken, "POST", "/sell/inventory/v1/offer", {
          sku,
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
          availableQuantity: 1,
          categoryId,
          listingDescription: input.listing.description,
          pricingSummary: { price: { value: String(input.listing.price), currency: "USD" } },
          listingPolicies: { fulfillmentPolicyId, paymentPolicyId, returnPolicyId },
          merchantLocationKey,
        });
        if (typeof offer.offerId !== "string") {
          throw new EbayError("eBay did not return an offer ID.");
        }
        offerId = offer.offerId;
      } catch (error) {
        // A prior attempt on this SKU got as far as creating an offer, then
        // failed at a later step — eBay reports the existing offerId in the
        // error itself, so reuse it instead of treating retry as impossible.
        const existingOfferId =
          error instanceof EbayError
            ? /"name":\s*"offerId",\s*"value":\s*"(\d+)"/.exec(error.message)?.[1]
            : undefined;
        if (!existingOfferId) throw error;
        offerId = existingOfferId;
      }

      const publishOffer = () =>
        ebayRequest(env, input.accessToken, "POST", `/sell/inventory/v1/offer/${offerId}/publish`);

      let published: Record<string, unknown>;
      try {
        published = await publishOffer();
      } catch (error) {
        // errorId 25021: the chosen condition isn't valid for this category.
        // The category lookup normally prevents this; retry once with plain
        // "Used", which every category we have seen accepts.
        if (error instanceof EbayError && /"errorId":\s*25021/.test(error.message)) {
          await putInventoryItem("USED_EXCELLENT");
          published = await publishOffer();
        } else {
          throw error;
        }
      }

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

- [ ] **Step 4: Update `convex/listingPublish.ts`**

Add these imports (merge with existing lines):

```ts
import type { Doc } from "./_generated/dataModel";
import type { IdentificationResult } from "./identify";
import { getAppAccessToken, refreshAccessToken } from "./ebay/oauth";
import { locationKeyFor } from "./ebay/postalCode";
import { ensureSellerSetup } from "./ebay/sellerSetup";
import { resolveListingSpec } from "./ebay/prepare";
import type { PublishInput } from "./ebay";
```

(The file already imports `refreshAccessToken` from `./ebay/oauth`; extend that import instead of duplicating it. It already imports `Id` from `./_generated/dataModel`; extend that line to `import type { Doc, Id } from "./_generated/dataModel";`.)

Replace `contextForPublish`'s returned object so it carries the full identification instead of `brand`/`itemType`:

```ts
    return {
      listing,
      imageUrl,
      identification:
        item.identification ??
        {
          genericName: item.name,
          brand: null,
          model: null,
          category: item.category,
          condition: "unknown",
          attributes: [],
          confidence: "low" as const,
        },
      detectionBox: item.detectionBox,
    };
```

Replace `getValidAccessToken` so it also returns the connection row (only the signature/return lines change; keep the body's logic):

```ts
/** Returns null if this user has no usable connection for the current mode. */
async function getValidAccessToken(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<{ accessToken: string; mode: string; connection: Doc<"ebayConnections"> } | null> {
  const connection = await ctx.runQuery(internal.ebayAuth.connectionForUser, { userId });
  if (connection === null || connection.mode !== getEbayMode()) return null;
  if (connection.mode === "mock") {
    return { accessToken: connection.accessToken, mode: "mock", connection };
  }

  // A minute of headroom avoids racing eBay's own expiry check.
  if (connection.accessTokenExpiresAt > Date.now() + 60_000) {
    return { accessToken: connection.accessToken, mode: connection.mode, connection };
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
    userId,
    accessToken: refreshed.accessToken,
    accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
  });

  return { accessToken: refreshed.accessToken, mode: connection.mode, connection };
}
```

Add this helper directly above `publishOne`:

```ts
type PublishContext = {
  listing: Doc<"listings">;
  identification: IdentificationResult;
  detectionBox: { x: number; y: number; width: number; height: number };
};

type PublishBase = { sku: string; title: string; description: string; price: number };

/**
 * Everything a real eBay publish needs beyond the listing itself: the
 * seller's own location and policies, and the item's category, condition and
 * required details.
 */
async function buildSandboxInput(
  ctx: ActionCtx,
  userId: Id<"users">,
  auth: { accessToken: string; connection: Doc<"ebayConnections"> },
  context: PublishContext,
  imageUrl: string,
  base: PublishBase,
): Promise<PublishInput> {
  const postalCode = auth.connection.shipFromPostalCode;
  if (postalCode === undefined) {
    throw new Error(
      "Reconnect eBay and enter your ZIP code — it's needed to set up your shipping location.",
    );
  }

  let setup = auth.connection.sellerSetup;
  if (setup === undefined || setup.locationKey !== locationKeyFor(postalCode)) {
    setup = await ensureSellerSetup({ env: "sandbox", accessToken: auth.accessToken, postalCode });
    await ctx.runMutation(internal.ebayAuth.saveSellerSetup, { userId, sellerSetup: setup });
  }

  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new EbayError("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set in the Convex environment.");
  }
  const openaiApiKey = env.OPENAI_API_KEY?.trim();
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY is not set in the Convex environment.");

  const appToken = await getAppAccessToken({ env: "sandbox", clientId, clientSecret });
  const spec = await resolveListingSpec({
    env: "sandbox",
    appToken,
    openaiApiKey,
    model: env.OPENAI_VISION_MODEL?.trim() || undefined,
    facts: context.identification,
    title: context.listing.title,
    description: context.listing.description,
    condition: context.listing.condition,
  });

  const productImageUrl: string = await ctx.runAction(internal.imageCrop.cropToBox, {
    imageUrl,
    box: context.detectionBox,
  });

  return {
    accessToken: auth.accessToken,
    env: "sandbox",
    categoryId: spec.categoryId,
    merchantLocationKey: setup.locationKey,
    fulfillmentPolicyId: setup.fulfillmentPolicyId,
    paymentPolicyId: setup.paymentPolicyId,
    returnPolicyId: setup.returnPolicyId,
    listing: {
      ...base,
      imageUrl: productImageUrl,
      ebayCondition: spec.ebayCondition,
      aspects: spec.aspects,
    },
  };
}
```

Replace the body of `publishOne`'s `try` (from the `auth` null-check through the `publisher.publish` call) so the handler reads:

```ts
export const publishOne = internalAction({
  args: { listingId: v.id("listings"), userId: v.id("users") },
  handler: async (ctx, args) => {
    try {
      const context = await ctx.runQuery(internal.listingPublish.contextForPublish, {
        listingId: args.listingId,
      });
      if (context === null) throw new Error("This listing or its item no longer exists.");
      if (context.imageUrl === null) {
        throw new Error("The source photo could not be read from storage.");
      }
      const imageUrl = context.imageUrl;

      const auth = await getValidAccessToken(ctx, args.userId);
      if (auth === null) throw new Error("Connect your eBay account before publishing.");

      const base: PublishBase = {
        sku: context.listing._id,
        title: context.listing.title,
        description: context.listing.description,
        price: context.listing.price,
      };

      // Demo mode never looks at the image or eBay — it stays free.
      const input: PublishInput =
        auth.mode === "mock"
          ? { accessToken: auth.accessToken, env: "sandbox", listing: { ...base, imageUrl } }
          : await buildSandboxInput(ctx, args.userId, auth, context, imageUrl, base);

      const result = await getEbayPublisher().publish(input);

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

- [ ] **Step 5: Remove the retired env vars and the operator file**

In `convex/convex.config.ts`, delete these five lines from the `env` block:

```ts
    EBAY_MERCHANT_LOCATION_KEY: v.optional(v.string()),
    EBAY_FULFILLMENT_POLICY_ID: v.optional(v.string()),
    EBAY_PAYMENT_POLICY_ID: v.optional(v.string()),
    EBAY_RETURN_POLICY_ID: v.optional(v.string()),
    EBAY_CATEGORY_ID: v.optional(v.string()),
```

Delete the operator tooling that the new modules supersede:

```bash
git rm convex/ebaySetup.ts
```

Verify nothing else references what was removed:

```bash
grep -rn "EBAY_MERCHANT_LOCATION_KEY\|EBAY_FULFILLMENT_POLICY_ID\|EBAY_PAYMENT_POLICY_ID\|EBAY_RETURN_POLICY_ID\|EBAY_CATEGORY_ID\|ebaySetup" convex src tests --include=*.ts --include=*.tsx | grep -v _generated
```

Expected: no output.

- [ ] **Step 6: Run everything and push to dev**

```bash
npx vitest run
npx tsc --noEmit -p convex/tsconfig.json
npx convex dev --once
```

Expected: all tests pass (including the new no-ZIP test and the earlier mode-mismatch tests); typecheck prints nothing; push succeeds. The dev push regenerates `convex/_generated/api.d.ts` and `server.d.ts` (the removed env vars and module).

- [ ] **Step 7: Commit**

```bash
git add convex/ebay/types.ts convex/ebay/sandbox.ts convex/listingPublish.ts convex/convex.config.ts convex/_generated/api.d.ts convex/_generated/server.d.ts tests/convex/ebay.test.ts
git commit -m "feat: publish with each seller's own setup and per-item category, condition and details" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(`git rm` already staged the deletion of `convex/ebaySetup.ts`; it is included in this commit.)

---

### Task 8: Connect UI with the ZIP field

**Files:**
- Modify: `src/components/EbayConnectButton.tsx`

**Interfaces:**
- Consumes: `api.ebayAuth.connectionStatus` (`configuredMode`, `shipFromPostalCode`), `api.ebayAuth.connect({ postalCode? })` (Task 6), `isValidPostalCode` (Task 1).

- [ ] **Step 1: Replace `src/components/EbayConnectButton.tsx`** (full replacement)

```tsx
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { isValidPostalCode } from "../../convex/ebay/postalCode";

export default function EbayConnectButton() {
  const status = useQuery(api.ebayAuth.connectionStatus);
  const connect = useMutation(api.ebayAuth.connect);
  const disconnect = useMutation(api.ebayAuth.disconnect);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zip, setZip] = useState<string | null>(null);

  if (status === undefined) return null;

  if (status.connected) {
    return (
      <button
        onClick={() => void disconnect({})}
        title="Disconnect eBay"
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-ink-soft ring-1 ring-line ring-inset transition-colors hover:bg-canvas"
      >
        <span className="size-1.5 rounded-full bg-accent-deep" />
        eBay ✓ Connected
      </button>
    );
  }

  const needsZip = status.configuredMode === "sandbox";
  const zipValue = zip ?? status.shipFromPostalCode ?? "";
  const canConnect = !connecting && (!needsZip || isValidPostalCode(zipValue));

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      {needsZip && (
        <input
          value={zipValue}
          onChange={(event) => setZip(event.target.value)}
          inputMode="numeric"
          autoComplete="postal-code"
          aria-label="Your ZIP code"
          placeholder="Your ZIP code"
          maxLength={10}
          className="h-10 w-32 rounded-full bg-surface px-4 text-sm text-ink ring-1 ring-line-strong ring-inset placeholder:text-muted"
        />
      )}
      <button
        onClick={async () => {
          setConnecting(true);
          setError(null);
          try {
            const result = await connect({ postalCode: needsZip ? zipValue.trim() : undefined });
            if (result.authorizeUrl) {
              window.open(result.authorizeUrl, "ebay-oauth", "width=500,height=700");
            }
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Couldn't connect eBay.");
          } finally {
            setConnecting(false);
          }
        }}
        disabled={!canConnect}
        className="h-10 rounded-full bg-accent-deep px-5 text-sm font-medium text-white transition-colors hover:bg-[#0077ed] disabled:opacity-50"
      >
        {connecting ? "Connecting…" : "Connect eBay"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both succeed with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/EbayConnectButton.tsx
git commit -m "feat: ask the seller for their ZIP when connecting eBay" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Live check on dev (owner)

This is the real-eBay acceptance test; only the owner can log into eBay.

**Files:** none.

- [ ] **Step 1: Start the dev site**

```bash
npm run dev
```

Confirm it serves at `http://localhost:5173` (dev's `SITE_URL`).

- [ ] **Step 2: Owner: connect with a ZIP**

Ask the owner to: sign in, open the sample room, continue to the review step, type their ZIP into the new field, click **Connect eBay**, log in with their sandbox seller, and click Agree. The popup should say "eBay connected." and close, and the footer should read "Publishes these N listings to eBay sandbox."

- [ ] **Step 3: Owner: publish several kinds of items**

Ask the owner to publish the sample room's items (it includes a desk, kettle, speaker and monitor). Every listing should go live. Then, on eBay's sandbox site, check that each is in a sensible category with its item details filled (for example the monitor shows a screen size, the desk a color). Read the run's Convex logs (`npx convex logs --history 100`) for any `eBay item-detail fill failed` warning and report it.

If eBay rejects the location (for example it says the address needs a city and state), stop and report the exact error to the owner: the fallback is to also ask for city and state.

- [ ] **Step 4: Owner: a second sandbox seller**

Ask the owner to create a second sandbox test user in the eBay developer portal, sign into the app with a different Google account, connect that sandbox user (with a ZIP), and publish. Confirm it works, and confirm in the first seller's Seller Hub that no new policies appeared for them.

- [ ] **Step 5: Record the outcome**

Do not continue to Task 10 until the owner confirms steps 2 to 4 passed.

---

### Task 10: Prod rollout and cleanup (owner-gated)

Every prod command needs an explicit yes from the owner in chat first.

**Files:** none in the repo.

- [ ] **Step 1: Deploy the backend to prod** (after a yes)

```bash
npx convex deploy --yes < /dev/null
```

Expected: `Deployed Convex functions to https://adjoining-gerbil-124.convex.cloud`. The schema change is additive, so no data is touched and no wipe is needed.

- [ ] **Step 2: Upload the site to prod** (after a yes, since the UI changed)

```bash
npx @convex-dev/static-hosting upload --build --prod < /dev/null
```

Expected: `Upload complete!`.

- [ ] **Step 3: Remove the retired env vars from dev and prod** (after a yes for prod)

```bash
for NAME in EBAY_MERCHANT_LOCATION_KEY EBAY_FULFILLMENT_POLICY_ID EBAY_PAYMENT_POLICY_ID EBAY_RETURN_POLICY_ID EBAY_CATEGORY_ID; do
  npx convex env remove "$NAME"
  npx convex env remove --prod "$NAME"
done
```

Expected: each reports unset (or already absent).

- [ ] **Step 4: Owner: reconnect on prod and publish**

Ask the owner to open https://adjoining-gerbil-124.convex.site, hard-refresh, connect eBay with their ZIP, and publish an item. Expected: the listing goes live on eBay sandbox.

- [ ] **Step 5: Wrap up**

Ask the owner whether to merge `feature/ebay-seller-setup` (and the earlier `feature/google-auth`) into `main`. Do not merge without a yes.

---

## Self-review (spec coverage)

| Spec section | Where it is implemented |
|---|---|
| 3.1 Seller setup: data, ZIP flow | Task 6 (schema, oauthState, connect, callback, status) |
| 3.1 `sellerSetup.ts`, defaults, create-or-find, opt-in | Task 2 |
| 3.1 reuse stored setup while location key matches | Task 7 (`buildSandboxInput`) |
| 3.2 app token | Task 1 (`getAppAccessToken`) |
| 3.2 category query, suggestion, rules, `pickCondition` | Task 3 |
| 3.2 item details, `fillItemDetails`, `normalizeDetails`, index-keyed schema | Task 4 |
| 3.2 `resolveListingSpec`, no-category error | Task 5 |
| 3.3 publish order, mock unchanged, `PublishInput` change, shared helper, delete `ebaySetup.ts`, remove env vars | Tasks 1 and 7 |
| 3.3 `connectionStatus` reports `configuredMode` and ZIP; no-ZIP counts as not connected | Task 6 |
| 3.4 UI ZIP field | Task 8 |
| 3.5 Testing (pure, faked eBay, Convex, live) | Tasks 1 to 7 (tests), Task 3 (live smoke), Task 9 (owner live check) |
| 3.6 Rollout | Task 10 |
| 4 Risks (opt-in shape, top suggestion, restricted lists, latency, index-keyed schema) | Task 2 (tolerant opt-in), Task 4 (index keys, fallback), Task 9 (live check surfaces the rest) |
| 5 Out of scope | Not planned: production keyset, shipping by item, optional details, caching, category editing |
