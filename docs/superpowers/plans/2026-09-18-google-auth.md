# Google Sign-in, Per-user Rooms and Emails: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the anonymous browser-UUID identity with Google sign-in so each user only sees and changes their own rooms, listings, offers, eBay connection and emails.

**Architecture:** `@convex-dev/auth` (Google provider) runs inside Convex. A small `convex/access.ts` derives the caller from the login token and walks user → cleanout → item/listing/offer to enforce ownership in every public function. All `sessionId` arguments disappear. The eBay connection is re-keyed by user with a one-time OAuth state code. Owner emails go to the owner's Google email.

**Tech Stack:** Convex 1.45, `@convex-dev/auth` 0.0.95, `@auth/core` 0.41.3, React 19 + Vite 6 + Tailwind 4, vitest 5, `convex-test` 0.0.59 with `@edge-runtime/vm`.

**Spec:** `docs/superpowers/specs/2026-09-18-auth-design.md`

## Global Constraints

- Identity comes only from `getAuthUserId(ctx)` (via `requireUserId`). No Convex function accepts a user id or session id from the client.
- "Not yours" and "does not exist" throw the same error, exactly `Not found`. A signed-out caller gets exactly `Sign in required`.
- Codebase conventions: two-argument `ctx.db.get("table", id)`, `ctx.db.patch("table", id, ...)`, `ctx.db.delete("table", id)`; object-form functions with `args` validators; no `returns:` validators (none exist in this repo, ignore the `convex-lint` hook nags about them); no code comments except for a non-obvious WHY.
- Dev deployment is `scrupulous-newt-316`. Prod deployment is `adjoining-gerbil-124`. Never run a command against prod without an explicit yes from the owner, in chat, for that specific command.
- Stage files by name (never `git add -A` or `git add .`). Each commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (pass it as a second `-m`).
- Pre-existing uncommitted changes in the tree that are NOT part of this plan: `todo.txt`, `commands.txt`. Never stage them. `package.json`, `package-lock.json`, `convex/convex.config.ts` and `convex/http.ts` already carry uncommitted static-hosting changes; they get committed together with the auth changes to those same files.
- Env vars for auth on every deployment: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`. Dev `SITE_URL` is `http://localhost:5173`. Prod `SITE_URL` is `https://adjoining-gerbil-124.convex.site`. Prod gets its own freshly generated key pair, never the dev one.
- `USER_NOTIFY_EMAIL` is removed from the code and from both deployments.
- Convex-function tests live in `tests/convex/`, use `convex-test`, and select the edge runtime per file with a first-line docblock `// @vitest-environment edge-runtime`. Pure-logic tests live in `tests/` and use the default node environment.

## Before you start

- [ ] Create a working branch so the dev app can be broken between tasks without touching `main`:

```bash
git switch -c feature/google-auth
```

## Human prerequisites (the owner does these; the executor asks for them at the marked steps)

**H1. Create the Google OAuth client** (needed before sign-in can be verified, first used in Task 1 step 9):

1. Go to https://console.cloud.google.com, create or pick a project.
2. In "Google Auth Platform" (formerly "OAuth consent screen"): choose **External**, app name `Roomsale`, add a support email, save. Leave it in **Testing** for now and add your own Google account as a **test user**.
3. Go to Credentials, then Create credentials, then **OAuth client ID**, application type **Web application**, name `Roomsale`.
4. Under **Authorized redirect URIs** add both:
   - `https://scrupulous-newt-316.convex.site/api/auth/callback/google`
   - `https://adjoining-gerbil-124.convex.site/api/auth/callback/google`
5. Copy the **Client ID** and **Client secret**. Never paste them into chat.

**H2. Set the Google credentials on dev** (PowerShell, from the repo root; the secret goes through the clipboard so it stays out of shell history):

```powershell
npx convex env set AUTH_GOOGLE_ID "<client id>"
Get-Clipboard | npx convex env set AUTH_GOOGLE_SECRET
```

(Copy the client secret to the clipboard first.) Prod is done in Task 8 with `--prod`.

**H3.** Explicit yes to wipe the dev test data (Task 2).

**H4.** Explicit yes for each prod command (Task 8).

## File structure

**Create**
- `convex/auth.ts`: Convex Auth setup with the Google provider.
- `convex/auth.config.ts`: tells Convex to trust tokens this deployment issues.
- `convex/users.ts`: `me` query for the account menu.
- `convex/access.ts`: `requireUserId`, `requireOwnedCleanout/Item/Listing/Offer`, `ownerEmailForCleanout`.
- `convex/ebay/oauthState.ts`: one-time eBay OAuth state helpers.
- `convex/agentMail/sender.ts`: reply-sender check (pure).
- `convex/agentMail/messages.ts`: "listing is live" email text (pure).
- `convex/maintenance.ts`: one-off dev wipe (created and deleted inside Task 2).
- `src/components/AuthGate.tsx`, `src/components/SignIn.tsx`, `src/components/AccountMenu.tsx`.
- `tests/convex/helpers.ts`, `tests/convex/infra.test.ts`, `tests/convex/rooms.test.ts`, `tests/convex/offers.test.ts`, `tests/convex/ebay.test.ts`, `tests/convex/email.test.ts`.
- `tests/agentMail/sender.test.ts`, `tests/agentMail/messages.test.ts`.

**Modify**
- `convex/schema.ts`, `convex/http.ts`, `convex/cleanouts.ts`, `convex/activity.ts`, `convex/items.ts`, `convex/research.ts`, `convex/listings.ts`, `convex/demo.ts`, `convex/dev.ts`, `convex/offers.ts`, `convex/agentMail.ts`, `convex/ebayAuth.ts`, `convex/ebaySetup.ts`, `convex/listingPublish.ts`, `convex/convex.config.ts`.
- `src/main.tsx`, `src/App.tsx`, `src/components/TopNav.tsx`, `src/components/Workspace.tsx`, `src/components/SaleReview.tsx`, `src/components/EbayConnectButton.tsx`, `src/components/ListingsBar.tsx`, `src/components/AgentTab.tsx`.
- `vitest.config.ts`, `.gitignore`, `package.json`, `package-lock.json`.

**Delete**
- `src/lib/session.ts`.

---

### Task 1: Auth backend foundation (dev)

**Files:**
- Create: `convex/auth.ts`, `convex/auth.config.ts`, `convex/users.ts`
- Modify: `convex/schema.ts`, `convex/http.ts`, `.gitignore`, `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `auth` (exports `auth`, `signIn`, `signOut`, `store`, `isAuthenticated`) from `convex/auth.ts`; the `users` table (from `authTables`); `api.users.me` returning `{ name: string | null; email: string | null; image: string | null } | null`.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-exact @convex-dev/auth@0.0.95 @auth/core@0.41.3
npm install --save-dev jose
```

Expected: install succeeds; `package.json` lists both new dependencies.

- [ ] **Step 2: Keep generated keys out of git**

Append this line to `.gitignore`:

```
.auth-keys*.json
```

- [ ] **Step 3: Create `convex/auth.ts`**

```ts
import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
});
```

- [ ] **Step 4: Create `convex/auth.config.ts`**

A missing or wrong file makes the app silently always signed out.

```ts
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
```

- [ ] **Step 5: Add the auth tables to `convex/schema.ts`**

Add the import below the existing `convex/values` import:

```ts
import { authTables } from "@convex-dev/auth/server";
```

Change the start of the schema so the tables are spread first:

```ts
export default defineSchema({
  ...authTables,
  cleanouts: defineTable({
```

(Everything else in the schema stays as is in this task.)

- [ ] **Step 6: Register the auth routes in `convex/http.ts`**

Add the import next to the other local imports:

```ts
import { auth } from "./auth";
```

Add this line immediately after `const http = httpRouter();`:

```ts
auth.addHttpRoutes(http);
```

- [ ] **Step 7: Create `convex/users.ts`**

```ts
import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const user = await ctx.db.get("users", userId);
    if (user === null) return null;

    return {
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
    };
  },
});
```

- [ ] **Step 8: Generate the signing keys headlessly and set them on dev**

Never run the interactive `npx @convex-dev/auth` wizard (it hangs without a terminal). Generate the key pair:

```bash
node -e 'import("jose").then(async({generateKeyPair,exportPKCS8,exportJWK})=>{const k=await generateKeyPair("RS256",{extractable:true});const priv=await exportPKCS8(k.privateKey);const pub=await exportJWK(k.publicKey);process.stdout.write(JSON.stringify({JWT_PRIVATE_KEY:priv.trimEnd().replace(/\n/g," "),JWKS:JSON.stringify({keys:[{use:"sig",...pub}]})}))})' > .auth-keys.json
```

Set the variables on dev. Preferred: the Convex MCP `envSet` tool (load its schema with ToolSearch `select:mcp__plugin_convex_convex__envSet`), one call each for `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` against the dev deployment selector. CLI fallback (use the `NAME=VALUE` form, because the key value starts with a dash):

```bash
npx convex env set "JWT_PRIVATE_KEY=$(node -p "require('./.auth-keys.json').JWT_PRIVATE_KEY")"
npx convex env set "JWKS=$(node -p "require('./.auth-keys.json').JWKS")"
npx convex env set SITE_URL http://localhost:5173
```

Then delete the key file:

```bash
rm .auth-keys.json
```

- [ ] **Step 9 (Human H1 + H2): Google credentials on dev**

Ask the owner to complete H1 and H2 now. Sign-in cannot be verified until they have. Continue with the code steps if they need time.

- [ ] **Step 10: Typecheck and push to dev**

```bash
npx tsc --noEmit -p convex/tsconfig.json
npx convex dev --once
```

Expected: typecheck prints nothing; the push ends with `Convex functions ready!`.

- [ ] **Step 11: Confirm the deployment now publishes its signing identity**

```bash
curl -s https://scrupulous-newt-316.convex.site/.well-known/openid-configuration
curl -s https://scrupulous-newt-316.convex.site/.well-known/jwks.json
```

Expected: the first returns JSON containing `"issuer":"https://scrupulous-newt-316.convex.site"`; the second returns `{"keys":[{...}]}` containing one RSA key.

- [ ] **Step 12: Commit**

```bash
git add .gitignore package.json package-lock.json convex/auth.ts convex/auth.config.ts convex/users.ts convex/schema.ts convex/http.ts convex/convex.config.ts convex/_generated/api.d.ts convex/_generated/api.js convex/_generated/dataModel.d.ts convex/_generated/server.d.ts
git commit -m "feat: add Convex Auth with Google sign-in (backend foundation)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(If `git status` shows other `convex/_generated/*` files changed, stage those too. If it shows a listed file unchanged, drop it from the `git add`.)

---

### Task 2: Wipe the dev test data (owner-gated)

The next task makes `cleanouts.userId` a required user id, which existing rows (browser UUIDs) cannot satisfy. Prod is empty; dev holds only test data.

**Files:**
- Create then delete: `convex/maintenance.ts`

**Interfaces:**
- Produces: nothing that survives this task. The dev database ends with empty `activity`, `agentMessages`, `offers`, `listings`, `items`, `cleanouts`, `ebayConnections` tables.

- [ ] **Step 1 (Human H3): Get explicit permission**

Ask the owner exactly this and wait for a yes:

> This deletes every room, item, listing, offer, message, activity row and eBay connection on the DEV deployment (scrupulous-newt-316), plus their stored images. You will need to reconnect eBay afterwards. Prod is not touched. Proceed?

Do not continue without a yes.

- [ ] **Step 2: Create `convex/maintenance.ts`**

```ts
import { internalMutation } from "./_generated/server";

const BATCH = 2000;

export const wipeUserData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const deleted: Record<string, number> = {};

    const activity = await ctx.db.query("activity").take(BATCH);
    for (const row of activity) await ctx.db.delete("activity", row._id);
    deleted.activity = activity.length;

    const messages = await ctx.db.query("agentMessages").take(BATCH);
    for (const row of messages) await ctx.db.delete("agentMessages", row._id);
    deleted.agentMessages = messages.length;

    const offers = await ctx.db.query("offers").take(BATCH);
    for (const row of offers) await ctx.db.delete("offers", row._id);
    deleted.offers = offers.length;

    const listings = await ctx.db.query("listings").take(BATCH);
    for (const row of listings) await ctx.db.delete("listings", row._id);
    deleted.listings = listings.length;

    const connections = await ctx.db.query("ebayConnections").take(BATCH);
    for (const row of connections) await ctx.db.delete("ebayConnections", row._id);
    deleted.ebayConnections = connections.length;

    const items = await ctx.db.query("items").take(BATCH);
    for (const row of items) {
      if (row.maskStorageId !== undefined) await ctx.storage.delete(row.maskStorageId);
      await ctx.db.delete("items", row._id);
    }
    deleted.items = items.length;

    const cleanouts = await ctx.db.query("cleanouts").take(BATCH);
    for (const row of cleanouts) {
      if (row.imageStorageId !== undefined) await ctx.storage.delete(row.imageStorageId);
      await ctx.db.delete("cleanouts", row._id);
    }
    deleted.cleanouts = cleanouts.length;

    return deleted;
  },
});
```

- [ ] **Step 3: Push to dev and run it**

```bash
npx convex dev --once
npx convex run maintenance:wipeUserData
```

Expected: the run prints a JSON object of deleted counts, for example `{ "activity": 60, ..., "cleanouts": 6 }`.

- [ ] **Step 4: Verify the tables are empty**

```bash
npx convex data cleanouts
npx convex data listings
npx convex data ebayConnections
```

Expected: each reports no documents.

- [ ] **Step 5: Remove the one-off file**

```bash
rm convex/maintenance.ts
npx convex dev --once
```

Expected: push succeeds. Nothing to commit for this task (the file was created and removed).

---

### Task 3: Test setup, access helpers, and ownership for rooms, items, listings

**Files:**
- Create: `convex/access.ts`, `tests/convex/helpers.ts`, `tests/convex/infra.test.ts`, `tests/convex/rooms.test.ts`
- Modify: `vitest.config.ts`, `convex/schema.ts`, `convex/cleanouts.ts` (full rewrite), `convex/activity.ts`, `convex/items.ts` (full rewrite), `convex/research.ts`, `convex/listings.ts`, `convex/demo.ts`, `convex/dev.ts` (full rewrite), `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: `users` table (Task 1).
- Produces (later tasks rely on these exact names):
  - `requireUserId(ctx: Pick<QueryCtx, "auth">): Promise<Id<"users">>`
  - `requireOwnedCleanout(ctx, cleanoutId: Id<"cleanouts">): Promise<Doc<"cleanouts">>`
  - `requireOwnedItem(ctx, itemId: Id<"items">): Promise<{ item: Doc<"items">; cleanout: Doc<"cleanouts"> }>`
  - `requireOwnedListing(ctx, listingId: Id<"listings">): Promise<{ listing: Doc<"listings">; cleanout: Doc<"cleanouts"> }>`
  - `requireOwnedOffer(ctx, offerId: Id<"offers">): Promise<{ offer: Doc<"offers">; listing: Doc<"listings">; cleanout: Doc<"cleanouts"> }>`
  - `api.cleanouts.latestForUser` (no args), `api.cleanouts.start({ title })`, `api.demo.seedRoom({ storageId, imageWidth?, imageHeight? })`, `api.dev.resetDemoData({})`.
  - Test helpers: `newTest()`, `createUser(t, email)` returning `{ userId, as }`, `seedItem(t, cleanoutId)`, `seedListing(t, cleanoutId, itemId, status?)`.

- [ ] **Step 1: Install the test dependencies**

```bash
npm install --save-dev convex-test @edge-runtime/vm
```

- [ ] **Step 2: Update `vitest.config.ts`**

Replace the whole file:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure-TypeScript unit tests run in node. Convex-function tests live in
    // tests/convex and pick the edge runtime per file with a
    // `@vitest-environment edge-runtime` docblock.
    include: ["tests/**/*.test.ts"],
    environment: "node",
    server: { deps: { inline: ["convex-test"] } },
  },
});
```

- [ ] **Step 3: Create `tests/convex/helpers.ts`**

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import type { Doc, Id } from "../../convex/_generated/dataModel";

const modules = import.meta.glob("../../convex/**/*.*s");

export type TestConvex = ReturnType<typeof newTest>;

export function newTest() {
  return convexTest(schema, modules);
}

/** Convex Auth identifies a caller by a token subject of `<userId>|<sessionId>`. */
export async function createUser(t: TestConvex, email: string) {
  const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email }));
  return { userId, as: t.withIdentity({ subject: `${userId}|test-session` }) };
}

export async function seedItem(t: TestConvex, cleanoutId: Id<"cleanouts">) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("items", {
        cleanoutId,
        name: "Lamp",
        category: "home",
        selected: true,
        confidence: 0.9,
        polygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.3, y: 0.1 },
          { x: 0.3, y: 0.3 },
          { x: 0.1, y: 0.3 },
        ],
        detectionBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        source: "detected",
        maskStatus: "failed",
        status: "detected",
        createdAt: Date.now(),
      }),
  );
}

export async function seedListing(
  t: TestConvex,
  cleanoutId: Id<"cleanouts">,
  itemId: Id<"items">,
  status: Doc<"listings">["status"] = "draft",
) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("listings", {
        cleanoutId,
        itemId,
        marketplace: "ebay",
        title: "Lamp",
        description: "A lamp",
        category: "Home",
        condition: "good",
        price: 40,
        status,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
  );
}
```

- [ ] **Step 4: Create `tests/convex/infra.test.ts` and run it**

```ts
// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import { createUser, newTest } from "./helpers";

it("convex-test boots against the real schema and creates a signed-in identity", async () => {
  const t = newTest();
  const alice = await createUser(t, "alice@example.com");

  const stored = await t.run(async (ctx) => await ctx.db.get("users", alice.userId));

  expect(stored?.email).toBe("alice@example.com");
});
```

Run: `npx vitest run tests/convex/infra.test.ts`
Expected: PASS. If `convexTest` throws about not finding the `_generated` folder, the glob keys are wrong: print `Object.keys(modules).slice(0, 5)` and confirm they end with `/convex/_generated/server.js`; fix the glob path before continuing. If vitest reports an unknown environment `edge-runtime`, confirm `@edge-runtime/vm` installed.

- [ ] **Step 5: Change the schema so every room has an owner**

In `convex/schema.ts`, in the `cleanouts` table, replace:

```ts
    // Anonymous session id for now; becomes a real auth subject in a later phase.
    userId: v.optional(v.string()),
```

with:

```ts
    /** The signed-in owner. Every room belongs to exactly one user. */
    userId: v.id("users"),
```

- [ ] **Step 6: Create `convex/access.ts`**

```ts
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/** MutationCtx is a superset of QueryCtx, so these helpers work in both. */
type ReadCtx = Pick<QueryCtx, "auth" | "db">;

const NOT_FOUND = "Not found";

export async function requireUserId(ctx: Pick<QueryCtx, "auth">): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in required");
  return userId;
}

export async function requireOwnedCleanout(
  ctx: ReadCtx,
  cleanoutId: Id<"cleanouts">,
): Promise<Doc<"cleanouts">> {
  const userId = await requireUserId(ctx);
  const cleanout = await ctx.db.get("cleanouts", cleanoutId);
  if (cleanout === null || cleanout.userId !== userId) throw new Error(NOT_FOUND);
  return cleanout;
}

export async function requireOwnedItem(ctx: ReadCtx, itemId: Id<"items">) {
  const item = await ctx.db.get("items", itemId);
  if (item === null) throw new Error(NOT_FOUND);
  const cleanout = await requireOwnedCleanout(ctx, item.cleanoutId);
  return { item, cleanout };
}

export async function requireOwnedListing(ctx: ReadCtx, listingId: Id<"listings">) {
  const listing = await ctx.db.get("listings", listingId);
  if (listing === null) throw new Error(NOT_FOUND);
  const cleanout = await requireOwnedCleanout(ctx, listing.cleanoutId);
  return { listing, cleanout };
}

export async function requireOwnedOffer(ctx: ReadCtx, offerId: Id<"offers">) {
  const offer = await ctx.db.get("offers", offerId);
  if (offer === null) throw new Error(NOT_FOUND);
  const { listing, cleanout } = await requireOwnedListing(ctx, offer.listingId);
  return { offer, listing, cleanout };
}
```

- [ ] **Step 7: Write the failing rooms test, `tests/convex/rooms.test.ts`**

```ts
// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { createUser, newTest, seedItem, seedListing } from "./helpers";

describe("rooms are private to their owner", () => {
  it("a signed-out caller cannot start a room or get an upload URL", async () => {
    const t = newTest();

    await expect(t.mutation(api.cleanouts.start, { title: "Room" })).rejects.toThrow(
      "Sign in required",
    );
    await expect(t.mutation(api.cleanouts.generateUploadUrl, {})).rejects.toThrow(
      "Sign in required",
    );
  });

  it("latestForUser returns only the caller's own newest room", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");

    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });

    const mine = await alice.as.query(api.cleanouts.latestForUser, {});
    expect(mine?.cleanout._id).toBe(cleanoutId);
    expect(await bob.as.query(api.cleanouts.latestForUser, {})).toBeNull();
  });

  it("another user cannot touch someone else's room", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["x"])));

    await expect(
      bob.as.mutation(api.cleanouts.attachImage, { cleanoutId, storageId }),
    ).rejects.toThrow("Not found");
    await expect(
      bob.as.mutation(api.cleanouts.markUploadFailed, { cleanoutId, error: "x" }),
    ).rejects.toThrow("Not found");
    await expect(bob.as.mutation(api.cleanouts.retryAnalysis, { cleanoutId })).rejects.toThrow(
      "Not found",
    );
    await expect(
      bob.as.mutation(api.items.setAll, { cleanoutId, selected: true }),
    ).rejects.toThrow("Not found");
    await expect(
      bob.as.mutation(api.items.addManual, {
        cleanoutId,
        name: "Lamp",
        boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      }),
    ).rejects.toThrow("Not found");
    await expect(bob.as.mutation(api.research.startResearch, { cleanoutId })).rejects.toThrow(
      "Not found",
    );
    await expect(bob.as.query(api.activity.list, { cleanoutId })).rejects.toThrow("Not found");
  });

  it("another user cannot toggle, rename or remove someone else's item, but the owner can", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
    const itemId = await seedItem(t, cleanoutId);

    await expect(bob.as.mutation(api.items.toggle, { itemId })).rejects.toThrow("Not found");
    await expect(bob.as.mutation(api.items.rename, { itemId, name: "Mine now" })).rejects.toThrow(
      "Not found",
    );
    await expect(bob.as.mutation(api.items.remove, { itemId })).rejects.toThrow("Not found");

    await alice.as.mutation(api.items.toggle, { itemId });
    const item = await t.run(async (ctx) => await ctx.db.get("items", itemId));
    expect(item?.selected).toBe(false);
  });

  it("another user cannot edit or approve someone else's listing, but the owner can", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
    const itemId = await seedItem(t, cleanoutId);
    const listingId = await seedListing(t, cleanoutId, itemId);
    const fields = {
      listingId,
      title: "Lamp",
      description: "A lamp",
      category: "Home",
      condition: "good" as const,
      price: 45,
    };

    await expect(bob.as.mutation(api.listings.update, fields)).rejects.toThrow("Not found");
    await expect(bob.as.mutation(api.listings.approve, fields)).rejects.toThrow("Not found");

    await alice.as.mutation(api.listings.approve, fields);
    const listing = await t.run(async (ctx) => await ctx.db.get("listings", listingId));
    expect(listing?.status).toBe("approved");
    expect(listing?.price).toBe(45);
  });

  it("resetDemoData deletes only the caller's own rooms", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
    await bob.as.mutation(api.cleanouts.start, { title: "Bob room" });

    await alice.as.mutation(api.dev.resetDemoData, {});

    expect(await alice.as.query(api.cleanouts.latestForUser, {})).toBeNull();
    expect((await bob.as.query(api.cleanouts.latestForUser, {}))?.cleanout.title).toBe("Bob room");
  });
});
```

- [ ] **Step 8: Run it to see it fail**

Run: `npx vitest run tests/convex/rooms.test.ts`
Expected: FAIL (`latestForUser` does not exist / argument validation errors).

- [ ] **Step 9: Rewrite `convex/cleanouts.ts`** (full replacement)

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { recordActivity } from "./activity";
import { requireOwnedCleanout, requireUserId } from "./access";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Opens a cleanout before the bytes are uploaded, so the workspace can render
 * an "uploading" state instead of a blank screen while the photo travels.
 */
export const start = mutation({
  args: { title: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const cleanoutId = await ctx.db.insert("cleanouts", {
      userId,
      title: args.title,
      status: "uploading",
      selectedCount: 0,
      createdAt: Date.now(),
    });

    await recordActivity(ctx, {
      cleanoutId,
      type: "cleanout_created",
      message: `Started “${args.title}”`,
    });

    return cleanoutId;
  },
});

export const attachImage = mutation({
  args: {
    cleanoutId: v.id("cleanouts"),
    storageId: v.id("_storage"),
    // Measured client-side; box prompts are expressed in pixels.
    imageWidth: v.optional(v.number()),
    imageHeight: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnedCleanout(ctx, args.cleanoutId);

    await ctx.db.patch("cleanouts", args.cleanoutId, {
      imageStorageId: args.storageId,
      imageWidth: args.imageWidth,
      imageHeight: args.imageHeight,
      status: "analyzing",
    });

    await recordActivity(ctx, {
      cleanoutId: args.cleanoutId,
      type: "detection_started",
      message: "Scanning the room…",
    });

    await ctx.scheduler.runAfter(0, internal.detection.analyze, {
      cleanoutId: args.cleanoutId,
    });

    return null;
  },
});

/** Called by the client when the upload itself fails. */
export const markUploadFailed = mutation({
  args: { cleanoutId: v.id("cleanouts"), error: v.string() },
  handler: async (ctx, args) => {
    await requireOwnedCleanout(ctx, args.cleanoutId);

    await ctx.db.patch("cleanouts", args.cleanoutId, {
      status: "failed",
      error: args.error,
    });

    await recordActivity(ctx, {
      cleanoutId: args.cleanoutId,
      type: "detection_failed",
      message: args.error,
    });

    return null;
  },
});

/** Re-runs detection on a cleanout that failed or found nothing. */
export const retryAnalysis = mutation({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const cleanout = await requireOwnedCleanout(ctx, args.cleanoutId);
    if (cleanout.imageStorageId === undefined) {
      throw new Error("This cleanout has no image to analyse");
    }

    const existing = await ctx.db
      .query("items")
      .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", args.cleanoutId))
      .take(100);
    for (const item of existing) {
      if (item.maskStorageId !== undefined) {
        await ctx.storage.delete(item.maskStorageId);
      }
      await ctx.db.delete("items", item._id);
    }

    await ctx.db.patch("cleanouts", args.cleanoutId, {
      status: "analyzing",
      selectedCount: 0,
      error: undefined,
    });

    await recordActivity(ctx, {
      cleanoutId: args.cleanoutId,
      type: "detection_retried",
      message: "Scanning the room again…",
    });

    await ctx.scheduler.runAfter(0, internal.detection.analyze, {
      cleanoutId: args.cleanoutId,
    });

    return null;
  },
});

/**
 * The whole workspace in one reactive read: the caller's most recent cleanout,
 * its signed image URL, and its items.
 */
export const latestForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    const cleanout = await ctx.db
      .query("cleanouts")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .first();

    if (cleanout === null) return null;

    const [imageUrl, items] = await Promise.all([
      cleanout.imageStorageId
        ? ctx.storage.getUrl(cleanout.imageStorageId)
        : Promise.resolve(null),
      ctx.db
        .query("items")
        .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", cleanout._id))
        .take(50),
    ]);

    // Masks arrive one at a time; each ready item carries its own signed URL.
    const withMasks = await Promise.all(
      items.map(async (item) => ({
        ...item,
        maskUrl: item.maskStorageId
          ? await ctx.storage.getUrl(item.maskStorageId)
          : null,
      })),
    );

    const listings = await ctx.db
      .query("listings")
      .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", cleanout._id))
      .take(50);

    return { cleanout, imageUrl, items: withMasks, listings };
  },
});
```

- [ ] **Step 10: Update `convex/activity.ts`**

Add the import below the existing imports:

```ts
import { requireOwnedCleanout } from "./access";
```

Replace the `list` query with:

```ts
export const list = query({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    await requireOwnedCleanout(ctx, args.cleanoutId);

    return await ctx.db
      .query("activity")
      .withIndex("by_cleanoutId_and_createdAt", (q) =>
        q.eq("cleanoutId", args.cleanoutId),
      )
      .order("desc")
      .take(30);
  },
});
```

- [ ] **Step 11: Rewrite `convex/items.ts`** (full replacement)

Deleting an item that is already gone now throws `Not found` instead of silently succeeding (the same error a stranger gets, by design).

```ts
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { recordActivity } from "./activity";
import { requireOwnedCleanout, requireOwnedItem } from "./access";
import { getMaskRefiner } from "./segmentation";

const MAX_NAME_LENGTH = 80;

export const toggle = mutation({
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const { item, cleanout } = await requireOwnedItem(ctx, args.itemId);

    const selected = !item.selected;
    await ctx.db.patch("items", item._id, { selected });
    await ctx.db.patch("cleanouts", cleanout._id, {
      selectedCount: Math.max(0, cleanout.selectedCount + (selected ? 1 : -1)),
    });

    await recordActivity(ctx, {
      cleanoutId: item.cleanoutId,
      itemId: item._id,
      type: selected ? "item_selected" : "item_deselected",
      message: `${selected ? "Added" : "Removed"} ${item.name}`,
    });

    return null;
  },
});

export const setAll = mutation({
  args: { cleanoutId: v.id("cleanouts"), selected: v.boolean() },
  handler: async (ctx, args) => {
    await requireOwnedCleanout(ctx, args.cleanoutId);

    const items = await ctx.db
      .query("items")
      .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", args.cleanoutId))
      .take(50);

    for (const item of items) {
      if (item.selected !== args.selected) {
        await ctx.db.patch("items", item._id, { selected: args.selected });
      }
    }

    await ctx.db.patch("cleanouts", args.cleanoutId, {
      selectedCount: args.selected ? items.length : 0,
    });

    await recordActivity(ctx, {
      cleanoutId: args.cleanoutId,
      type: "selection_bulk",
      message: args.selected
        ? `Selected all ${items.length} items`
        : "Cleared the selection",
    });

    return null;
  },
});

export const rename = mutation({
  args: { itemId: v.id("items"), name: v.string() },
  handler: async (ctx, args) => {
    const name = args.name.trim().slice(0, MAX_NAME_LENGTH);
    if (name.length === 0) throw new Error("An item needs a name");

    const { item } = await requireOwnedItem(ctx, args.itemId);
    if (item.name === name) return null;

    await ctx.db.patch("items", item._id, { name });

    await recordActivity(ctx, {
      cleanoutId: item.cleanoutId,
      itemId: item._id,
      type: "item_renamed",
      message: `Renamed ${item.name} to ${name}`,
    });

    return null;
  },
});

/** Adds an object the detector missed, from a box the user drew on the photo. */
export const addManual = mutation({
  args: {
    cleanoutId: v.id("cleanouts"),
    name: v.string(),
    boundingBox: v.object({
      x: v.number(),
      y: v.number(),
      width: v.number(),
      height: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim().slice(0, MAX_NAME_LENGTH);
    if (name.length === 0) throw new Error("An item needs a name");

    const cleanout = await requireOwnedCleanout(ctx, args.cleanoutId);

    const { x, y, width, height } = args.boundingBox;
    if (width <= 0 || height <= 0) throw new Error("That box is empty");

    const right = x + width;
    const bottom = y + height;

    // A hand-drawn box is just as good a prompt as a detected one.
    let refine = false;
    try {
      refine = getMaskRefiner() !== null;
    } catch {
      refine = false;
    }

    const itemId = await ctx.db.insert("items", {
      cleanoutId: args.cleanoutId,
      name,
      category: "other",
      selected: true,
      confidence: 1,
      polygon: [
        { x, y },
        { x: right, y },
        { x: right, y: bottom },
        { x, y: bottom },
      ],
      detectionBox: { x, y, width, height },
      source: "manual",
      status: "detected",
      maskStatus: refine ? "pending" : "failed",
      maskError: refine ? undefined : "Mask refinement is not configured.",
      createdAt: Date.now(),
    });

    if (refine) {
      await ctx.scheduler.runAfter(0, internal.masks.refineCleanout, {
        cleanoutId: args.cleanoutId,
        itemIds: [itemId],
      });
    }

    await ctx.db.patch("cleanouts", args.cleanoutId, {
      selectedCount: cleanout.selectedCount + 1,
    });

    await recordActivity(ctx, {
      cleanoutId: args.cleanoutId,
      itemId,
      type: "item_added",
      message: `You added ${name}`,
    });

    return itemId;
  },
});

export const remove = mutation({
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const { item, cleanout } = await requireOwnedItem(ctx, args.itemId);

    if (item.selected) {
      await ctx.db.patch("cleanouts", cleanout._id, {
        selectedCount: Math.max(0, cleanout.selectedCount - 1),
      });
    }

    if (item.maskStorageId !== undefined) {
      await ctx.storage.delete(item.maskStorageId);
    }
    await ctx.db.delete("items", item._id);

    await recordActivity(ctx, {
      cleanoutId: item.cleanoutId,
      type: "item_removed",
      message: `Deleted ${item.name}`,
    });

    return null;
  },
});
```

- [ ] **Step 12: Update `convex/research.ts`**

Add the import below `import { recordActivity } from "./activity";`:

```ts
import { requireOwnedCleanout } from "./access";
```

In `startResearch`, replace this opening:

```ts
export const startResearch = mutation({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const items = await ctx.db
```

with:

```ts
export const startResearch = mutation({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const cleanout = await requireOwnedCleanout(ctx, args.cleanoutId);

    const items = await ctx.db
```

Further down in the same function, replace:

```ts
    const cleanout = await ctx.db.get("cleanouts", args.cleanoutId);
    if (cleanout?.isDemo === true) {
```

with:

```ts
    if (cleanout.isDemo === true) {
```

- [ ] **Step 13: Update `convex/listings.ts`**

Add the import below the existing imports:

```ts
import { requireOwnedListing } from "./access";
```

In BOTH `update` and `approve`, replace this pair of lines (it appears twice, so replace all occurrences):

```ts
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) throw new Error("Listing not found");
```

with:

```ts
    await requireOwnedListing(ctx, args.listingId);
```

- [ ] **Step 14: Update `convex/demo.ts`**

Add the import below `import { recordActivity } from "./activity";`:

```ts
import { requireUserId } from "./access";
```

In `seedRoom`, remove the line `sessionId: v.string(),` from `args`, and change the handler start from:

```ts
  handler: async (ctx, args) => {
    const cleanoutId = await ctx.db.insert("cleanouts", {
      userId: args.sessionId,
```

to:

```ts
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const cleanoutId = await ctx.db.insert("cleanouts", {
      userId,
```

- [ ] **Step 15: Rewrite `convex/dev.ts`** (full replacement)

```ts
import { mutation } from "./_generated/server";
import { requireUserId } from "./access";

/**
 * Developer helper: wipes everything belonging to the signed-in user, including
 * the stored images. Exposed in the UI only when running the dev server.
 */
export const resetDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    const cleanouts = await ctx.db
      .query("cleanouts")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .take(20);

    for (const cleanout of cleanouts) {
      const items = await ctx.db
        .query("items")
        .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", cleanout._id))
        .take(200);
      for (const item of items) {
        if (item.maskStorageId !== undefined) {
          await ctx.storage.delete(item.maskStorageId);
        }
        await ctx.db.delete("items", item._id);
      }

      const events = await ctx.db
        .query("activity")
        .withIndex("by_cleanoutId_and_createdAt", (q) =>
          q.eq("cleanoutId", cleanout._id),
        )
        .take(500);
      for (const event of events) {
        await ctx.db.delete("activity", event._id);
      }

      // Absent when the upload never completed.
      if (cleanout.imageStorageId !== undefined) {
        await ctx.storage.delete(cleanout.imageStorageId);
      }
      await ctx.db.delete("cleanouts", cleanout._id);
    }

    return { deletedCleanouts: cleanouts.length };
  },
});
```

- [ ] **Step 16: Run the tests to see them pass**

Run: `npx vitest run tests/convex`
Expected: PASS (infra + all 6 rooms tests).

- [ ] **Step 17: Typecheck and push to dev**

```bash
npx tsc --noEmit -p convex/tsconfig.json
npx convex dev --once
```

Expected: typecheck prints nothing; push succeeds (the dev tables are empty after Task 2, so the new required `userId` validates). The root `npm run typecheck` is expected to fail until Task 7 because `src/` still calls the old signatures.

- [ ] **Step 18: Commit**

```bash
git add vitest.config.ts package.json package-lock.json convex/access.ts convex/schema.ts convex/cleanouts.ts convex/activity.ts convex/items.ts convex/research.ts convex/listings.ts convex/demo.ts convex/dev.ts convex/_generated/api.d.ts tests/convex/helpers.ts tests/convex/infra.test.ts tests/convex/rooms.test.ts
git commit -m "feat: require sign-in and enforce room ownership on cleanouts, items, listings" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Ownership for offers and the agent thread

**Files:**
- Modify: `convex/offers.ts`, `convex/agentMail.ts`, `tests/convex/helpers.ts`
- Create: `tests/convex/offers.test.ts`

**Interfaces:**
- Consumes: `requireOwnedListing`, `requireOwnedOffer`, `requireUserId` (Task 3); test helpers (Task 3).
- Produces: `internal.offers.isOfferOwnedBy({ offerId, userId }): boolean`; `internal.agentMail.sendTestPriceDropSuggestion` (now internal, same args); test helper `seedOffer(t, listingId, status?)`.

- [ ] **Step 1: Add `seedOffer` to `tests/convex/helpers.ts`** (append at the end of the file)

```ts
export async function seedOffer(
  t: TestConvex,
  listingId: Id<"listings">,
  status: Doc<"offers">["status"] = "pending",
) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("offers", {
        listingId,
        marketplaceOfferId: `OFFER-${Math.random().toString(36).slice(2, 10)}`,
        amount: 30,
        currency: "USD",
        status,
        source: "mock",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
  );
}
```

- [ ] **Step 2: Write the failing test, `tests/convex/offers.test.ts`**

```ts
// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { createUser, newTest, seedItem, seedListing, seedOffer } from "./helpers";

async function aliceWithLiveListing() {
  const t = newTest();
  const alice = await createUser(t, "alice@example.com");
  const bob = await createUser(t, "bob@example.com");
  const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
  const itemId = await seedItem(t, cleanoutId);
  const listingId = await seedListing(t, cleanoutId, itemId, "live");
  const offerId = await seedOffer(t, listingId);
  return { t, alice, bob, listingId, offerId };
}

describe("offers and the agent thread are private to the listing owner", () => {
  it("another user cannot read a listing's offers or messages, but the owner can", async () => {
    const { alice, bob, listingId } = await aliceWithLiveListing();

    await expect(bob.as.query(api.offers.listForListing, { listingId })).rejects.toThrow(
      "Not found",
    );
    await expect(bob.as.query(api.agentMail.messagesForListing, { listingId })).rejects.toThrow(
      "Not found",
    );

    const offers = await alice.as.query(api.offers.listForListing, { listingId });
    expect(offers).toHaveLength(1);
  });

  it("another user cannot decide on someone else's offer", async () => {
    const { bob, offerId } = await aliceWithLiveListing();

    await expect(
      bob.as.action(api.offers.decide, { offerId, action: "accept" }),
    ).rejects.toThrow("Not found");
  });

  it("a signed-out caller cannot decide on an offer", async () => {
    const { t, offerId } = await aliceWithLiveListing();

    await expect(t.action(api.offers.decide, { offerId, action: "accept" })).rejects.toThrow(
      "Sign in required",
    );
  });

  it("another user cannot simulate offers on someone else's listing", async () => {
    const { bob, listingId, offerId } = await aliceWithLiveListing();

    await expect(
      bob.as.mutation(api.offers.simulateBuyerOffer, { listingId, amount: 20 }),
    ).rejects.toThrow("Not found");
    await expect(
      bob.as.mutation(api.offers.simulateBuyerAcceptsCounter, { offerId }),
    ).rejects.toThrow("Not found");
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run tests/convex/offers.test.ts`
Expected: FAIL (Bob's calls succeed or throw a different error).

- [ ] **Step 4: Update `convex/offers.ts`**

Add `internalQuery` to the server import block:

```ts
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
```

Add below the `import { env } from "./_generated/server";` line:

```ts
import { requireOwnedListing, requireOwnedOffer, requireUserId } from "./access";
```

Replace `listForListing` with:

```ts
export const listForListing = query({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    await requireOwnedListing(ctx, args.listingId);

    return await ctx.db
      .query("offers")
      .withIndex("by_listingId_and_createdAt", (q) => q.eq("listingId", args.listingId))
      .order("desc")
      .take(20);
  },
});
```

In `simulateBuyerOffer`, replace these four lines:

```ts
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) throw new Error("Listing not found");
    const cleanout = await ctx.db.get("cleanouts", listing.cleanoutId);
    assertSimulationAllowed(cleanout?.isDemo === true);
```

with:

```ts
    const { listing, cleanout } = await requireOwnedListing(ctx, args.listingId);
    assertSimulationAllowed(cleanout.isDemo === true);
```

In `simulateBuyerAcceptsCounter`, replace these six lines:

```ts
    const offer = await ctx.db.get("offers", args.offerId);
    if (offer === null) throw new Error("Offer not found");
    const parentListing = await ctx.db.get("listings", offer.listingId);
    const parentCleanout =
      parentListing === null ? null : await ctx.db.get("cleanouts", parentListing.cleanoutId);
    assertSimulationAllowed(parentCleanout?.isDemo === true);
```

with:

```ts
    const { offer, cleanout } = await requireOwnedOffer(ctx, args.offerId);
    assertSimulationAllowed(cleanout.isDemo === true);
```

Replace the `decide` action (at the bottom of the file, above `activityMode`) with these two exports:

```ts
export const isOfferOwnedBy = internalQuery({
  args: { offerId: v.id("offers"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const offer = await ctx.db.get("offers", args.offerId);
    if (offer === null) return false;
    const listing = await ctx.db.get("listings", offer.listingId);
    if (listing === null) return false;
    const cleanout = await ctx.db.get("cleanouts", listing.cleanoutId);
    return cleanout !== null && cleanout.userId === args.userId;
  },
});

/** Web UI entry point. Same logic as an emailed reply, after an ownership check. */
export const decide = action({
  args: { offerId: v.id("offers"), action: offerAction, amount: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const userId = await requireUserId(ctx);
    const owned: boolean = await ctx.runQuery(internal.offers.isOfferOwnedBy, {
      offerId: args.offerId,
      userId,
    });
    if (!owned) throw new Error("Not found");

    return await ctx.runAction(internal.offers.applyDecision, args);
  },
});
```

- [ ] **Step 5: Update `convex/agentMail.ts`**

Change the server import to drop `mutation` (no longer used):

```ts
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
```

Add below `import { isValidAmount } from "./money";`:

```ts
import { requireOwnedListing } from "./access";
```

Replace `messagesForListing` with:

```ts
export const messagesForListing = query({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    await requireOwnedListing(ctx, args.listingId);

    return await ctx.db
      .query("agentMessages")
      .withIndex("by_listingId_and_createdAt", (q) => q.eq("listingId", args.listingId))
      .order("asc")
      .take(100);
  },
});
```

Change the declaration line of the test hook from `export const sendTestPriceDropSuggestion = mutation({` to `export const sendTestPriceDropSuggestion = internalMutation({`. Its body stays as is. It is now runnable only from the CLI or dashboard:

```bash
npx convex run agentMail:sendTestPriceDropSuggestion '{"listingId":"<id>","suggestedPrice":30}'
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run tests/convex`
Expected: PASS.

- [ ] **Step 7: Typecheck, push, commit**

```bash
npx tsc --noEmit -p convex/tsconfig.json
npx convex dev --once
git add convex/offers.ts convex/agentMail.ts convex/_generated/api.d.ts tests/convex/helpers.ts tests/convex/offers.test.ts
git commit -m "feat: enforce listing ownership on offers and the agent thread" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Expected: typecheck prints nothing; push succeeds.

---

### Task 5: eBay per user, one-time OAuth state, publish, operator tools

**Files:**
- Create: `convex/ebay/oauthState.ts`, `tests/convex/ebay.test.ts`
- Modify: `convex/schema.ts`, `convex/ebayAuth.ts` (full rewrite), `convex/http.ts`, `convex/listingPublish.ts`, `convex/ebaySetup.ts`

**Interfaces:**
- Consumes: `requireUserId`, `requireOwnedListing`, `requireOwnedCleanout` (Task 3).
- Produces:
  - `issueOauthState(ctx: MutationCtx, userId: Id<"users">): Promise<string>` and `consumeOauthState(ctx: MutationCtx, nonce: string, now: number): Promise<Id<"users"> | null>` (in `convex/ebay/oauthState.ts`).
  - `internal.ebayAuth.consumeState({ nonce }): Id<"users"> | null`, `internal.ebayAuth.saveConnection({ userId, accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt?, mode })`, `internal.ebayAuth.connectionForUser({ userId })`, `internal.ebayAuth.updateAccessToken({ userId, accessToken, accessTokenExpiresAt })`.
  - `api.ebayAuth.connect({})`, `api.ebayAuth.connectionStatus({})`, `api.ebayAuth.disconnect({})`.
  - `api.listingPublish.publish({ listingId })`, `api.listingPublish.publishApproved({ cleanoutId })`, `internal.listingPublish.publishOne({ listingId, userId })`.

- [ ] **Step 1: Write the failing test, `tests/convex/ebay.test.ts`**

```ts
// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { issueOauthState } from "../../convex/ebay/oauthState";
import { createUser, newTest, seedItem, seedListing } from "./helpers";

describe("eBay connection is per user", () => {
  it("connect, status and disconnect only ever touch the caller's own connection", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");

    await alice.as.mutation(api.ebayAuth.connect, {});

    expect((await alice.as.query(api.ebayAuth.connectionStatus, {})).connected).toBe(true);
    expect((await bob.as.query(api.ebayAuth.connectionStatus, {})).connected).toBe(false);

    await bob.as.mutation(api.ebayAuth.disconnect, {});
    expect((await alice.as.query(api.ebayAuth.connectionStatus, {})).connected).toBe(true);

    await expect(t.mutation(api.ebayAuth.connect, {})).rejects.toThrow("Sign in required");
  });
});

describe("eBay OAuth state is a one-time code", () => {
  it("works once and then is gone", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const nonce = await t.run(async (ctx) => await issueOauthState(ctx, alice.userId));

    const first = await t.mutation(internal.ebayAuth.consumeState, { nonce });
    const second = await t.mutation(internal.ebayAuth.consumeState, { nonce });

    expect(first).toBe(alice.userId);
    expect(second).toBeNull();
  });

  it("rejects an unknown code", async () => {
    const t = newTest();

    expect(await t.mutation(internal.ebayAuth.consumeState, { nonce: "not-a-real-code" })).toBeNull();
  });

  it("rejects an expired code", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    await t.run(async (ctx) => {
      await ctx.db.insert("ebayOauthStates", {
        nonce: "old-code",
        userId: alice.userId,
        expiresAt: Date.now() - 1,
      });
    });

    expect(await t.mutation(internal.ebayAuth.consumeState, { nonce: "old-code" })).toBeNull();
  });
});

describe("publishing is private to the listing owner", () => {
  it("another user cannot publish someone else's listing, but the owner can", async () => {
    // Publishing schedules a background job; fake timers keep it from running mid-test.
    vi.useFakeTimers();
    try {
      const t = newTest();
      const alice = await createUser(t, "alice@example.com");
      const bob = await createUser(t, "bob@example.com");
      const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
      const itemId = await seedItem(t, cleanoutId);
      const listingId = await seedListing(t, cleanoutId, itemId, "approved");

      await expect(bob.as.mutation(api.listingPublish.publish, { listingId })).rejects.toThrow(
        "Not found",
      );
      await expect(
        bob.as.mutation(api.listingPublish.publishApproved, { cleanoutId }),
      ).rejects.toThrow("Not found");

      await alice.as.mutation(api.listingPublish.publish, { listingId });
      const listing = await t.run(async (ctx) => await ctx.db.get("listings", listingId));
      expect(listing?.status).toBe("publishing");
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Note: the first test relies on `EBAY_MODE` being unset in the test process so `connect` uses mock mode (the repo default).

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/convex/ebay.test.ts`
Expected: FAIL (`consumeState` and `ebayOauthStates` do not exist).

- [ ] **Step 3: Re-key the eBay tables in `convex/schema.ts`**

Replace the whole `ebayConnections` table definition with:

```ts
  ebayConnections: defineTable({
    userId: v.id("users"),
    accessToken: v.string(),
    refreshToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshTokenExpiresAt: v.optional(v.number()),
    /** "mock" | "sandbox". */
    mode: v.string(),
    connectedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  /** One-time codes that carry a signed-in user through eBay's OAuth redirect. */
  ebayOauthStates: defineTable({
    nonce: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
  }).index("by_nonce", ["nonce"]),
```

- [ ] **Step 4: Create `convex/ebay/oauthState.ts`**

```ts
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** A random single-use code that stands in for the user across eBay's redirect. */
export async function issueOauthState(ctx: MutationCtx, userId: Id<"users">): Promise<string> {
  const nonce = crypto.randomUUID();
  await ctx.db.insert("ebayOauthStates", {
    nonce,
    userId,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });
  return nonce;
}

/** Deletes the code whether or not it is still valid, so a link can never be replayed. */
export async function consumeOauthState(
  ctx: MutationCtx,
  nonce: string,
  now: number,
): Promise<Id<"users"> | null> {
  const row = await ctx.db
    .query("ebayOauthStates")
    .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
    .unique();
  if (row === null) return null;

  await ctx.db.delete("ebayOauthStates", row._id);
  return row.expiresAt >= now ? row.userId : null;
}
```

- [ ] **Step 5: Rewrite `convex/ebayAuth.ts`** (full replacement)

```ts
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { env } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUserId } from "./access";
import { buildAuthorizeUrl } from "./ebay/oauth";
import { getEbayMode } from "./ebay";
import { consumeOauthState, issueOauthState } from "./ebay/oauthState";

async function upsertConnection(
  ctx: MutationCtx,
  fields: {
    userId: Id<"users">;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: number;
    refreshTokenExpiresAt?: number;
    mode: string;
  },
) {
  const existing = await ctx.db
    .query("ebayConnections")
    .withIndex("by_userId", (q) => q.eq("userId", fields.userId))
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
  args: {},
  handler: async (ctx) => {
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

    const clientId = env.EBAY_CLIENT_ID?.trim();
    const ruName = env.EBAY_RU_NAME?.trim();
    if (!clientId || !ruName) {
      throw new Error(
        "eBay sandbox isn't configured yet — EBAY_CLIENT_ID and EBAY_RU_NAME must be set in the Convex environment.",
      );
    }

    const state = await issueOauthState(ctx, userId);
    const authorizeUrl = buildAuthorizeUrl({ env: "sandbox", clientId, ruName, state });

    return { mode: "sandbox" as const, authorizeUrl };
  },
});

export const consumeState = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, args) => await consumeOauthState(ctx, args.nonce, Date.now()),
});

export const saveConnection = internalMutation({
  args: {
    userId: v.id("users"),
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
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return { connected: connection !== null, mode: connection?.mode ?? null };
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (connection !== null) {
      await ctx.db.delete("ebayConnections", connection._id);
    }
    return null;
  },
});

export const connectionForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

export const updateAccessToken = internalMutation({
  args: { userId: v.id("users"), accessToken: v.string(), accessTokenExpiresAt: v.number() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
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

- [ ] **Step 6: Make `/ebay/callback` consume the one-time code, in `convex/http.ts`**

Add the type import below the other imports:

```ts
import type { Id } from "./_generated/dataModel";
```

In the `/ebay/callback` handler, insert this block right after the line `if (!code || !state) return page(false, "Missing authorization code.");`:

```ts
    const userId: Id<"users"> | null = await ctx.runMutation(internal.ebayAuth.consumeState, {
      nonce: state,
    });
    if (userId === null) {
      return page(false, "This connection link is invalid or has expired. Please try again.");
    }
```

Then change the `saveConnection` call from:

```ts
      await ctx.runMutation(internal.ebayAuth.saveConnection, {
        sessionId: state,
```

to:

```ts
      await ctx.runMutation(internal.ebayAuth.saveConnection, {
        userId,
```

- [ ] **Step 7: Update `convex/listingPublish.ts`**

Add below the existing imports:

```ts
import type { Id } from "./_generated/dataModel";
import { requireOwnedCleanout, requireOwnedListing } from "./access";
```

Replace the `publish` and `publishApproved` exports (everything from the `publish` doc comment through the end of `publishApproved`) with:

```ts
/**
 * Publishing claims the job by flipping status to "publishing" inside the
 * mutation (a transaction) before scheduling the actual eBay call — a second
 * click sees the non-"approved"/"failed" status and is rejected here, not
 * just disabled client-side, so duplicate clicks can never create duplicate
 * eBay listings.
 */
export const publish = mutation({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    const { listing, cleanout } = await requireOwnedListing(ctx, args.listingId);
    if (listing.status !== "approved" && listing.status !== "failed") return null;

    await ctx.db.patch("listings", args.listingId, {
      status: "publishing",
      publishError: undefined,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.listingPublish.publishOne, {
      listingId: args.listingId,
      userId: cleanout.userId,
    });

    return null;
  },
});

export const publishApproved = mutation({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const cleanout = await requireOwnedCleanout(ctx, args.cleanoutId);

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
        userId: cleanout.userId,
      });
    }

    return { queued: toPublish.length };
  },
});
```

Replace the `getValidAccessToken` helper's signature and its three `sessionId` uses so the whole helper reads:

```ts
/** Returns null if this user has no eBay connection at all. */
async function getValidAccessToken(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<{ accessToken: string; mode: string } | null> {
  const connection = await ctx.runQuery(internal.ebayAuth.connectionForUser, { userId });
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
    userId,
    accessToken: refreshed.accessToken,
    accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
  });

  return { accessToken: refreshed.accessToken, mode: connection.mode };
}
```

In `publishOne`, change `args: { listingId: v.id("listings"), sessionId: v.string() },` to:

```ts
  args: { listingId: v.id("listings"), userId: v.id("users") },
```

and change `const auth = await getValidAccessToken(ctx, args.sessionId);` to:

```ts
      const auth = await getValidAccessToken(ctx, args.userId);
```

- [ ] **Step 8: Turn the operator tools in `convex/ebaySetup.ts` internal and key them by user**

Apply these mechanical edits (use replace-all for each):

1. `import { action, internalQuery } from "./_generated/server";` becomes `import { internalAction, internalQuery } from "./_generated/server";`
2. `= action({` becomes `= internalAction({` (7 occurrences: `provisionLocationOnly`, `suggestCategory`, `conditionPolicies`, `retryWithCondition`, `retryWithAspects`, `retryPublishOffer`, `provisionSellerAccount`).
3. `sessionId: v.string()` becomes `userId: v.id("users")` (in `connectionAccessToken` and every action's `args`).
4. `sessionId: args.sessionId` becomes `userId: args.userId`.
5. In `connectionAccessToken`, replace
   `.withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))`
   with
   `.withIndex("by_userId", (q) => q.eq("userId", args.userId))`.
6. In the file's header comment, replace the sentence "run manually once per eBay account via the Convex CLI/dashboard, not from the UI." with:

```
 * once per eBay account from the CLI, e.g.
 * `npx convex run ebaySetup:provisionSellerAccount '{"userId":"<users id>"}'`.
 * These are internal functions, so they can never be called from a browser.
```

Verify nothing was missed:

```bash
grep -n "sessionId\|by_sessionId\| action(" convex/ebaySetup.ts
```

Expected: no output.

- [ ] **Step 9: Run the tests to see them pass**

Run: `npx vitest run tests/convex`
Expected: PASS.

- [ ] **Step 10: Typecheck, push, commit**

```bash
npx tsc --noEmit -p convex/tsconfig.json
npx convex dev --once
git add convex/schema.ts convex/ebay/oauthState.ts convex/ebayAuth.ts convex/http.ts convex/listingPublish.ts convex/ebaySetup.ts convex/_generated/api.d.ts tests/convex/ebay.test.ts
git commit -m "feat: per-user eBay connection with one-time OAuth state; owner-checked publish" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Expected: typecheck prints nothing; push succeeds.

---

### Task 6: Per-user emails, sender check, "listing is live" email

**Files:**
- Create: `convex/agentMail/sender.ts`, `convex/agentMail/messages.ts`, `tests/agentMail/sender.test.ts`, `tests/agentMail/messages.test.ts`, `tests/convex/email.test.ts`
- Modify: `convex/access.ts`, `convex/agentMail.ts`, `convex/http.ts`, `convex/listingPublish.ts`, `convex/convex.config.ts`

**Interfaces:**
- Consumes: `requireOwnedListing` etc. (Task 3), `internal.agentMail.*` (existing).
- Produces:
  - `senderMatchesOwner(from: string | undefined, ownerEmail: string | null): boolean` and `extractAddress(from: string): string` (in `convex/agentMail/sender.ts`).
  - `listingLiveEmail(input: { title: string; price: number; url: string; mode: string }): { subject: string; text: string }` (in `convex/agentMail/messages.ts`).
  - `ownerEmailForCleanout(ctx: Pick<QueryCtx, "db">, cleanoutId: Id<"cleanouts">): Promise<string | null>` (in `convex/access.ts`).
  - `internal.agentMail.ownerEmailForListing({ listingId }): string | null`; `internal.agentMail.contextForListing` now also returns `ownerEmail`; `internal.agentMail.sendListingLiveEmail({ listingId })`; `internal.agentMail.handleInboundReply` gains optional `from`.

- [ ] **Step 1: Write the failing pure tests**

`tests/agentMail/sender.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractAddress, senderMatchesOwner } from "../../convex/agentMail/sender";

describe("extractAddress", () => {
  it("returns a bare address lowercased", () => {
    expect(extractAddress("Owner@Example.com")).toBe("owner@example.com");
  });

  it("pulls the address out of a display-name form", () => {
    expect(extractAddress("Jane Doe <Jane@Example.com>")).toBe("jane@example.com");
  });
});

describe("senderMatchesOwner", () => {
  it("accepts the owner's address in any case or display-name form", () => {
    expect(senderMatchesOwner("Jane <JANE@example.com>", "jane@example.com")).toBe(true);
  });

  it("rejects a different sender", () => {
    expect(senderMatchesOwner("mallory@example.com", "jane@example.com")).toBe(false);
  });

  it("allows a reply whose sender the webhook did not include", () => {
    expect(senderMatchesOwner(undefined, "jane@example.com")).toBe(true);
  });

  it("rejects a reply when the owner has no email on file", () => {
    expect(senderMatchesOwner("jane@example.com", null)).toBe(false);
  });
});
```

`tests/agentMail/messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listingLiveEmail } from "../../convex/agentMail/messages";

describe("listingLiveEmail", () => {
  it("names the item, price and link for a real listing", () => {
    const { subject, text } = listingLiveEmail({
      title: "White Desk",
      price: 120,
      url: "https://sandbox.ebay.com/itm/1",
      mode: "sandbox",
    });

    expect(subject).toBe("Your White Desk is live on eBay");
    expect(text).toContain("Price: $120");
    expect(text).toContain("https://sandbox.ebay.com/itm/1");
    expect(text).not.toContain("demo");
  });

  it("labels a mock listing as a demo", () => {
    const { subject, text } = listingLiveEmail({
      title: "White Desk",
      price: 120,
      url: "https://example.com/mock",
      mode: "mock",
    });

    expect(subject).toBe("(Demo) Your White Desk is listed");
    expect(text).toContain("demo listing");
  });
});
```

Run: `npx vitest run tests/agentMail`
Expected: FAIL (modules do not exist).

- [ ] **Step 2: Create `convex/agentMail/sender.ts`**

```ts
/** Extracts the bare, lowercased address from "Name <a@b.com>" or "a@b.com". */
export function extractAddress(from: string): string {
  const bracketed = /<([^>]+)>/.exec(from);
  return (bracketed?.[1] ?? from).trim().toLowerCase();
}

/**
 * Whether an inbound reply may act on a listing. A reply whose sender the
 * webhook did not report is allowed (the thread id is still required), but a
 * reported sender that is not the listing owner is not.
 */
export function senderMatchesOwner(from: string | undefined, ownerEmail: string | null): boolean {
  if (from === undefined) return true;
  if (ownerEmail === null) return false;
  return extractAddress(from) === ownerEmail.trim().toLowerCase();
}
```

- [ ] **Step 3: Create `convex/agentMail/messages.ts`**

```ts
export function listingLiveEmail(input: {
  title: string;
  price: number;
  url: string;
  mode: string;
}): { subject: string; text: string } {
  const demo = input.mode === "mock";

  const subject = demo
    ? `(Demo) Your ${input.title} is listed`
    : `Your ${input.title} is live on eBay`;

  const text = [
    demo
      ? "This is a demo listing — it was simulated and is not on real eBay."
      : "Your listing is live on eBay.",
    "",
    input.title,
    `Price: $${input.price}`,
    input.url,
    "",
    "I'll email you when a buyer makes an offer.",
  ].join("\n");

  return { subject, text };
}
```

- [ ] **Step 4: Run the pure tests to see them pass**

Run: `npx vitest run tests/agentMail`
Expected: PASS.

- [ ] **Step 5: Add `ownerEmailForCleanout` to `convex/access.ts`** (append at the end of the file)

```ts
export async function ownerEmailForCleanout(
  ctx: Pick<QueryCtx, "db">,
  cleanoutId: Id<"cleanouts">,
): Promise<string | null> {
  const cleanout = await ctx.db.get("cleanouts", cleanoutId);
  if (cleanout === null) return null;

  const user = await ctx.db.get("users", cleanout.userId);
  return user?.email ?? null;
}
```

- [ ] **Step 6: Write the failing wiring test, `tests/convex/email.test.ts`**

```ts
// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { createUser, newTest, seedItem, seedListing } from "./helpers";

it("a listing's email context carries its owner's email, and only that owner's", async () => {
  const t = newTest();
  const alice = await createUser(t, "alice@example.com");
  const bob = await createUser(t, "bob@example.com");
  const aliceRoom = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
  const bobRoom = await bob.as.mutation(api.cleanouts.start, { title: "Bob room" });
  const aliceListing = await seedListing(t, aliceRoom, await seedItem(t, aliceRoom), "live");
  const bobListing = await seedListing(t, bobRoom, await seedItem(t, bobRoom), "live");

  const forAlice = await t.query(internal.agentMail.contextForListing, {
    listingId: aliceListing,
  });
  const forBob = await t.query(internal.agentMail.contextForListing, { listingId: bobListing });

  expect(forAlice?.ownerEmail).toBe("alice@example.com");
  expect(forBob?.ownerEmail).toBe("bob@example.com");
  expect(
    await t.query(internal.agentMail.ownerEmailForListing, { listingId: aliceListing }),
  ).toBe("alice@example.com");
});
```

Run: `npx vitest run tests/convex/email.test.ts`
Expected: FAIL (`ownerEmail` is undefined; `ownerEmailForListing` does not exist).

- [ ] **Step 7: Update `convex/agentMail.ts`**

Add below the existing imports:

```ts
import { ownerEmailForCleanout } from "./access";
import { senderMatchesOwner } from "./agentMail/sender";
import { listingLiveEmail } from "./agentMail/messages";
```

(If Task 4 already added `import { requireOwnedListing } from "./access";`, merge into one import line: `import { ownerEmailForCleanout, requireOwnedListing } from "./access";`.)

Replace `contextForListing` with these two exports:

```ts
export const contextForListing = internalQuery({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) return null;
    const item = await ctx.db.get("items", listing.itemId);
    const ownerEmail = await ownerEmailForCleanout(ctx, listing.cleanoutId);
    return { listing, itemName: item?.name ?? listing.title, ownerEmail };
  },
});

export const ownerEmailForListing = internalQuery({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) return null;
    return await ownerEmailForCleanout(ctx, listing.cleanoutId);
  },
});
```

In `sendDecisionEmail`, change the context type annotation and the recipient lookup. Replace:

```ts
    const context: { listing: Doc<"listings">; itemName: string } | null = await ctx.runQuery(
      internal.agentMail.contextForListing,
      { listingId: args.listingId },
    );
    if (context === null) return null;

    const notifyEmail = env.USER_NOTIFY_EMAIL?.trim();
```

with:

```ts
    const context: {
      listing: Doc<"listings">;
      itemName: string;
      ownerEmail: string | null;
    } | null = await ctx.runQuery(internal.agentMail.contextForListing, {
      listingId: args.listingId,
    });
    if (context === null) return null;

    const notifyEmail = context.ownerEmail;
```

In `handleInboundReply`, add `from` to the args. Replace:

```ts
  args: { messageId: v.string(), threadId: v.string(), text: v.string() },
```

with:

```ts
  args: {
    messageId: v.string(),
    threadId: v.string(),
    text: v.string(),
    from: v.optional(v.string()),
  },
```

Right after the line `if (lookup.listing === null) return null;`, insert:

```ts
    const ownerEmail: string | null = await ctx.runQuery(
      internal.agentMail.ownerEmailForListing,
      { listingId: lookup.listing._id },
    );
    // Only the owner can act on their listing by email.
    if (!senderMatchesOwner(args.from, ownerEmail)) return null;
```

In the clarification block near the end of `handleInboundReply`, replace:

```ts
      const notifyEmail = env.USER_NOTIFY_EMAIL?.trim();
      const mailKey = env.AGENTMAIL_API_KEY?.trim();
```

with:

```ts
      const notifyEmail = ownerEmail;
      const mailKey = env.AGENTMAIL_API_KEY?.trim();
```

Append this new action at the end of the file:

```ts
export const sendListingLiveEmail = internalAction({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    const context: {
      listing: Doc<"listings">;
      itemName: string;
      ownerEmail: string | null;
    } | null = await ctx.runQuery(internal.agentMail.contextForListing, {
      listingId: args.listingId,
    });
    if (context === null) return null;

    const { listing, ownerEmail } = context;
    const apiKey = env.AGENTMAIL_API_KEY?.trim();
    if (!ownerEmail || !apiKey || !listing.ebayListingUrl) return null;

    const { subject, text } = listingLiveEmail({
      title: listing.title,
      price: listing.price,
      url: listing.ebayListingUrl,
      mode: listing.publishMode ?? "mock",
    });

    const inbox = await getOrCreateInbox(apiKey, env.AGENTMAIL_INBOX_ID?.trim());
    await sendMessage(apiKey, inbox.inboxId, { to: ownerEmail, subject, text });

    return null;
  },
});
```

- [ ] **Step 8: Pass the sender through the webhook, in `convex/http.ts`**

In the `/agentmail/webhook` handler, replace:

```ts
    await ctx.runAction(internal.agentMail.handleInboundReply, { messageId, threadId, text });
```

with:

```ts
    const rawFrom = message?.from ?? message?.from_;
    const from =
      typeof rawFrom === "string"
        ? rawFrom
        : Array.isArray(rawFrom) && typeof rawFrom[0] === "string"
          ? rawFrom[0]
          : undefined;

    await ctx.runAction(internal.agentMail.handleInboundReply, {
      messageId,
      threadId,
      text,
      from,
    });
```

- [ ] **Step 9: Send the "listing is live" email from `markPublished`, in `convex/listingPublish.ts`**

In `markPublished`, add this immediately after the line `await ctx.db.patch("items", listing.itemId, { status: "listed" });`:

```ts
    await ctx.scheduler.runAfter(0, internal.agentMail.sendListingLiveEmail, {
      listingId: args.listingId,
    });
```

- [ ] **Step 10: Remove `USER_NOTIFY_EMAIL` from `convex/convex.config.ts`**

Delete these two lines from the `env` block:

```ts
    /** The single demo owner's real address — this app has no per-user email. */
    USER_NOTIFY_EMAIL: v.optional(v.string()),
```

Verify nothing else references it:

```bash
grep -rn "USER_NOTIFY_EMAIL" convex src tests --include=*.ts --include=*.tsx | grep -v _generated
```

Expected: no output.

- [ ] **Step 11: Run all tests, typecheck, push, commit**

```bash
npx vitest run
npx tsc --noEmit -p convex/tsconfig.json
npx convex dev --once
git add convex/access.ts convex/agentMail.ts convex/agentMail/sender.ts convex/agentMail/messages.ts convex/http.ts convex/listingPublish.ts convex/convex.config.ts convex/_generated/api.d.ts tests/agentMail/sender.test.ts tests/agentMail/messages.test.ts tests/convex/email.test.ts
git commit -m "feat: email each owner at their own address; live-listing confirmation; reply sender check" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Expected: all test files pass; typecheck prints nothing; push succeeds.

---

### Task 7: Frontend sign-in gate and account menu

**Files:**
- Create: `src/components/AuthGate.tsx`, `src/components/SignIn.tsx`, `src/components/AccountMenu.tsx`
- Modify: `src/main.tsx`, `src/App.tsx`, `src/components/TopNav.tsx`, `src/components/Workspace.tsx`, `src/components/SaleReview.tsx`, `src/components/EbayConnectButton.tsx` (full rewrite), `src/components/ListingsBar.tsx`, `src/components/AgentTab.tsx`
- Delete: `src/lib/session.ts`

**Interfaces:**
- Consumes: `api.users.me`, `api.cleanouts.latestForUser`, `api.cleanouts.start({ title })`, `api.demo.seedRoom({ storageId, imageWidth?, imageHeight? })`, `api.dev.resetDemoData({})`, `api.ebayAuth.connect/connectionStatus/disconnect({})`, `api.listingPublish.publish({ listingId })`, `api.listingPublish.publishApproved({ cleanoutId })`.
- Produces: the signed-in-only app shell.

- [ ] **Step 1: Create `src/components/SignIn.tsx`**

```tsx
import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn("google");
    } catch {
      setError("Couldn't start Google sign-in. Please try again.");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-ink text-white shadow-sm">
        <Scan className="size-6" strokeWidth={1.75} />
      </span>
      <h1 className="mt-6 text-3xl font-semibold tracking-[-0.045em]">Roomsale</h1>
      <p className="mt-3 text-sm text-muted">
        Sign in to scan a room, price what's in it, and list it for sale.
      </p>
      <Button size="lg" className="mt-8 w-full" disabled={busy} onClick={() => void handleSignIn()}>
        {busy ? (
          <>
            <Loader2 className="animate-spin" />
            Redirecting to Google…
          </>
        ) : (
          "Continue with Google"
        )}
      </Button>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Create `src/components/AuthGate.tsx`**

```tsx
import type { ReactNode } from "react";
import { useConvexAuth } from "convex/react";
import { Loader2 } from "lucide-react";
import SignIn from "@/components/SignIn";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading">
        <Loader2 className="size-6 animate-spin text-muted" />
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <SignIn />;
}
```

- [ ] **Step 3: Create `src/components/AccountMenu.tsx`**

```tsx
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut } from "lucide-react";
import { api } from "../../convex/_generated/api";

export default function AccountMenu() {
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();

  if (!me) return null;
  const label = me.name ?? me.email ?? "Account";

  return (
    <div className="flex items-center gap-2">
      {me.image ? (
        <img
          src={me.image}
          alt=""
          referrerPolicy="no-referrer"
          className="size-8 rounded-full ring-1 ring-black/5"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-line text-xs font-medium text-ink-soft"
        >
          {label.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="hidden max-w-[10rem] truncate text-xs font-medium text-ink-soft lg:inline">
        {label}
      </span>
      <button
        onClick={() => void signOut()}
        title="Sign out"
        aria-label="Sign out"
        className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/5 hover:text-ink"
      >
        <LogOut className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "@/App";
import AuthGate from "@/components/AuthGate";
import { ToastProvider } from "@/components/Toaster";
import "@/index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error(
    "VITE_CONVEX_URL is not set. Run `npx convex dev` to provision a deployment.",
  );
}

const convex = new ConvexReactClient(convexUrl);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <ToastProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </ToastProvider>
    </ConvexAuthProvider>
  </StrictMode>,
);
```

- [ ] **Step 5: Edit `src/App.tsx`**

Apply each replacement:

1. Delete the line `import { useSessionId } from "@/lib/session";`.
2. Replace
```tsx
  const sessionId = useSessionId();
  const workspace = useQuery(api.cleanouts.latestForSession, { sessionId });
```
with
```tsx
  const workspace = useQuery(api.cleanouts.latestForUser);
```
3. Replace `cleanoutId = await startCleanoutMutation({ sessionId, title });` with `cleanoutId = await startCleanoutMutation({ title });`.
4. In the `startCleanout` dependency array, delete the line `      sessionId,`.
5. In `startDemo`, replace
```tsx
      await seedDemoRoom({
        sessionId,
        storageId,
```
with
```tsx
      await seedDemoRoom({
        storageId,
```
and replace `[generateUploadUrl, seedDemoRoom, sessionId]` with `[generateUploadUrl, seedDemoRoom]`.
6. In `handleReset`, replace `await resetDemoData({ sessionId });` with `await resetDemoData({});` and replace `[resetDemoData, sessionId]` with `[resetDemoData]`.
7. Delete the line `                sessionId={sessionId}` from the `<Workspace ... />` props.

- [ ] **Step 6: Edit `src/components/TopNav.tsx`**

Add below the lucide import:

```tsx
import AccountMenu from "@/components/AccountMenu";
```

Add `<AccountMenu />` as the last child inside `<nav ...>`, right after the "New room" `<button>...</button>`.

- [ ] **Step 7: Edit `src/components/Workspace.tsx`**

1. In the `Props` type, delete the line `  sessionId: string;`.
2. In the destructured parameters, change `hoveredId, drawing, sessionId,` to `hoveredId, drawing,`.
3. In the `<SaleReview ...>` element, change `listings={listings} sessionId={sessionId}` to `listings={listings}`.

- [ ] **Step 8: Edit `src/components/SaleReview.tsx`**

1. In `Props`, delete `  sessionId: string;`.
2. In the component signature, change `listings, sessionId, onEdit,` to `listings, onEdit,`.
3. Replace `useQuery(api.ebayAuth.connectionStatus, { sessionId })` with `useQuery(api.ebayAuth.connectionStatus)`.
4. Replace `publish({ listingId: listing._id, sessionId })` with `publish({ listingId: listing._id })`.
5. Replace `<EbayConnectButton sessionId={sessionId} />` with `<EbayConnectButton />`.

- [ ] **Step 9: Rewrite `src/components/EbayConnectButton.tsx`** (full replacement)

```tsx
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function EbayConnectButton() {
  const status = useQuery(api.ebayAuth.connectionStatus);
  const connect = useMutation(api.ebayAuth.connect);
  const disconnect = useMutation(api.ebayAuth.disconnect);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex items-center gap-2">
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      <button
        onClick={async () => {
          setConnecting(true);
          setError(null);
          try {
            const result = await connect({});
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
        className="h-10 rounded-full bg-accent-deep px-5 text-sm font-medium text-white transition-colors hover:bg-[#0077ed] disabled:opacity-50"
      >
        {connecting ? "Connecting…" : "Connect eBay"}
      </button>
    </div>
  );
}
```

- [ ] **Step 10: Edit `src/components/ListingsBar.tsx`**

1. In `Props`, delete `  sessionId: string;`.
2. Change the signature `{ cleanoutId, sessionId, listings, onReviewAll }` to `{ cleanoutId, listings, onReviewAll }`.
3. Change `publishApproved({ cleanoutId, sessionId })` to `publishApproved({ cleanoutId })`.

- [ ] **Step 11: Edit `src/components/AgentTab.tsx`**

The dev-only "Simulate stale listing" button called a function that is now internal-only. Remove it:

1. Delete the line `  const sendTestPriceDropSuggestion = useMutation(api.agentMail.sendTestPriceDropSuggestion);`.
2. Delete the whole second `<button ...>Simulate stale listing</button>` element (from `<button` with `const suggested = ...` through its closing `</button>`), leaving only the "Simulate offer" button inside the `import.meta.env.DEV` block.

- [ ] **Step 12: Delete the old browser identity**

```bash
git rm src/lib/session.ts
```

- [ ] **Step 13: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both succeed with no errors. If TypeScript flags a leftover `sessionId`, run `grep -rn "sessionId\|useSessionId" src` and remove the remaining reference.

- [ ] **Step 14 (Human): Real sign-in round trip on dev**

Requires H1 and H2 to be done. Start both servers in two terminals:

```bash
npx convex dev
npm run dev
```

Ask the owner to verify, in a browser at http://localhost:5173:

1. The first screen is "Continue with Google" (nothing else is reachable).
2. Clicking it goes to Google, then back, and the app loads with the account menu (photo, name, sign-out icon) in the top bar.
3. "Try a sample room" works, and reloading the page keeps the signed-in state and the room.
4. Sign out returns to the sign-in screen. Signing in with a second Google account shows the empty state (no rooms from the first account).
5. In sample-room mode, "Connect eBay" then "Publish" completes as before (mock mode), and the listing's owner email inbox receives the "(Demo) ... is listed" message if `AGENTMAIL_API_KEY` is set on dev.

Do not continue until the owner confirms 1 to 4.

- [ ] **Step 15: Commit**

```bash
git add src/main.tsx src/App.tsx src/components/AuthGate.tsx src/components/SignIn.tsx src/components/AccountMenu.tsx src/components/TopNav.tsx src/components/Workspace.tsx src/components/SaleReview.tsx src/components/EbayConnectButton.tsx src/components/ListingsBar.tsx src/components/AgentTab.tsx
git commit -m "feat: sign-in gate, account menu, and remove the browser session id" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(The `git rm` in step 12 is already staged; it is included in this commit.)

---

### Task 8: Prod rollout and audit (owner-gated)

Every prod command needs an explicit yes from the owner in chat before it runs (H4).

**Files:**
- Modify: none in the repo (env and deployment only).

- [ ] **Step 1 (Human): Google redirect URI and consent screen**

Confirm with the owner that:

- The prod redirect URI `https://adjoining-gerbil-124.convex.site/api/auth/callback/google` is in the OAuth client (H1 step 4).
- The consent screen is switched from **Testing** to **In production** so anyone can sign in (basic scopes need no Google verification).

- [ ] **Step 2: Generate a fresh key pair for prod and set the prod env**

Ask for a yes, then generate a new key file (do NOT reuse the dev key):

```bash
node -e 'import("jose").then(async({generateKeyPair,exportPKCS8,exportJWK})=>{const k=await generateKeyPair("RS256",{extractable:true});const priv=await exportPKCS8(k.privateKey);const pub=await exportJWK(k.publicKey);process.stdout.write(JSON.stringify({JWT_PRIVATE_KEY:priv.trimEnd().replace(/\n/g," "),JWKS:JSON.stringify({keys:[{use:"sig",...pub}]})}))})' > .auth-keys.prod.json
npx convex env set --prod "JWT_PRIVATE_KEY=$(node -p "require('./.auth-keys.prod.json').JWT_PRIVATE_KEY")"
npx convex env set --prod "JWKS=$(node -p "require('./.auth-keys.prod.json').JWKS")"
npx convex env set --prod SITE_URL https://adjoining-gerbil-124.convex.site
rm .auth-keys.prod.json
```

The owner sets the Google credentials on prod (PowerShell; copy the secret to the clipboard first):

```powershell
npx convex env set --prod AUTH_GOOGLE_ID "<client id>"
Get-Clipboard | npx convex env set --prod AUTH_GOOGLE_SECRET
```

Verify the names (values are not printed):

```bash
npx convex env list --prod | cut -d= -f1
```

Expected: the list includes `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`.

- [ ] **Step 3: Remove the retired env var from both deployments**

```bash
npx convex env remove USER_NOTIFY_EMAIL
npx convex env remove --prod USER_NOTIFY_EMAIL
```

Expected: each succeeds (or reports the variable is already absent).

- [ ] **Step 4: Deploy backend and site to prod**

Ask for a yes, then:

```bash
npm run deploy
```

Expected: the backend deploys to prod and the site uploads. The app is at `https://adjoining-gerbil-124.convex.site`.

- [ ] **Step 5: Smoke-check prod**

```bash
curl -s https://adjoining-gerbil-124.convex.site/.well-known/openid-configuration
curl -s -o /dev/null -w "%{http_code}\n" https://adjoining-gerbil-124.convex.site/
curl -s -X POST -o /dev/null -w "%{http_code}\n" https://adjoining-gerbil-124.convex.site/agentmail/webhook
```

Expected: the first returns JSON with `"issuer":"https://adjoining-gerbil-124.convex.site"`; the second prints `200`; the third prints `400`.

- [ ] **Step 6 (Human): Real sign-in on prod**

The owner opens `https://adjoining-gerbil-124.convex.site`, signs in with Google, and repeats checks 1 to 4 from Task 7 step 14. Signing in with a second Google account must show an empty workspace.

- [ ] **Step 7: Audit the finished code**

Run the `convex-authz` skill over the repo and address every finding in the four shapes it checks (identity from client argument, missing ownership check, leaking public query, write into a container the caller does not own). Then run all tests once more:

```bash
npx vitest run
npm run typecheck
```

Expected: no open authz findings; tests and typecheck clean.

- [ ] **Step 8: Wrap up**

Ask the owner whether to merge `feature/google-auth` into `main`, and whether to refresh `hackathon.md` (its Auth line still says `none`) with the `/hackathon` skill. Do neither without a yes.

---

## Self-review (spec coverage)

| Spec section | Where it is implemented |
|---|---|
| 3.1 Sign-in and identity | Task 1 (backend, keys, routes, `users.me`), Task 7 (provider, sign-in screen, account menu, remove `session.ts`) |
| 3.2 Ownership, `access.ts` and per-function table | Task 3 (cleanouts, items, research, listings, activity, demo, dev), Task 4 (offers, agentMail messages, test hook internal), Task 5 (publish, publishApproved, publishOne, ebaySetup internal) |
| 3.2 "left open by design" routes | Task 5 (callback protected by one-time state), Task 6 (webhook keeps its signature, adds sender check) |
| 3.3 eBay per user and OAuth state | Task 5 |
| 3.4 Emails: per-owner recipient, reply sender check, live email, `USER_NOTIFY_EMAIL` removed | Task 6 (code), Task 8 step 3 (env cleanup) |
| 3.5 Data and rollout: wipe dev, Google client, prod env, order | Task 2, Task 1 step 9, Task 8 |
| 3.6 Testing: two-user suite, nonce tests, sign-in check, `convex-authz` | Tasks 3, 4, 5, 6 (tests), Task 7 step 14 and Task 8 steps 6 to 7 |
| 4 Risks: sender field, route shadowing, missing email | Task 6 step 8 (tolerant sender parse; absent means allowed), Task 1 step 11 and Task 8 step 5 (well-known routes reachable next to static hosting), Task 6 (`ownerEmail` may be null and sends skip) |
| 5 Out of scope | Not planned: signed-out demo, per-user eBay provisioning, production eBay, rate limiting |
