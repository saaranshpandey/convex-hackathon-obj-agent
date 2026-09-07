# Phase 5: Listing Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once an item's Phase 4 research completes, automatically generate a marketplace-ready draft listing (title, description, category, condition, price) grounded strictly in that item's identification and pricing research. Keep the user in the same workspace: the right panel becomes a "Ready to sell" card list, clicking Review opens a new overlay drawer to edit and approve a listing (with Next/Previous to step through every draft), and a fixed bottom bar lets the user bulk-publish every approved listing.

**Architecture:** Extends Phase 4's per-item pipeline in `convex/research.ts` with one more automatic stage after pricing succeeds: generate a listing draft (OpenAI, grounded in the identification + pricing already computed) and upsert it into a new `listings` table, one row per item. A listing-generation failure is isolated in its own try/catch so it never undoes a successful identification+price (the item just won't have a listing draft yet). All listing state changes (edit, approve, bulk-list) are plain public mutations the frontend calls directly — no new orchestration needed there, since a listing's lifecycle (draft → approved → listed) is just status patches, not an async job.

**Tech Stack:** Same as Phase 4 — Convex (schema, mutations, internal actions), OpenAI Chat Completions with `response_format: json_schema` (`gpt-5.6-luna`), React 19 + Tailwind + `motion/react`. New UI pattern: a fixed-position overlay drawer (backdrop + slide-in panel), which nothing in this codebase has done yet.

**Spec:** Given verbatim by the user in conversation — reproduced below so it travels with the plan.

```text
PHASE 5: LISTING GENERATION

For every researched item generate a marketplace-ready draft.

Schema: listings — itemId, marketplace, title, description, category,
condition, price, status, createdAt, updatedAt. For now marketplace = ebay.

OpenAI generates: concise listing title, description, condition description,
suggested category, price. The AI must use information from the object
analysis and Firecrawl research. Never invent specifications that cannot be
inferred.

UI: keep user in the SAME workspace. After research completes, transform the
right panel into: "Ready to sell / 4 listings prepared". Each card: name,
price, "Ready", [Review]. Clicking Review opens a polished side drawer: image
crop, title editable, price editable, condition dropdown, description
editable, research summary collapsed below. Buttons: Save, Approve listing.
At bottom of screen: "4 listings ready", [Review all], [List approved items].
Allow multi-item approval. AI does 95%, user only verifies.

TEST: drafts persist; editable fields persist; approve individual item;
approve all; rejected/unapproved listings do not publish; changing price
updates Convex immediately; build/typecheck passes. Stop after Phase 5.
```

## Global Constraints

- **Automatic generation, not a separate manual step.** "For every researched item generate a marketplace-ready draft" plus "after research completes, transform the right panel" reads as automatic: `research.ts`'s per-item pipeline gains a third stage (identify → price → **draft listing**) after Phase 4's second stage succeeds. No new "Generate listings" button.
- **Side drawer = new overlay component** (confirmed with the user): a fixed backdrop + slide-in panel from the right edge, independent of the existing sticky right-column panel, with Next/Previous so "Review all" means something (step through every draft) rather than duplicating each card's own [Review].
- **The drawer batches edits locally; "Save" and "Approve listing" both persist.** The spec lists explicit Save/Approve buttons (unlike Phase 4's item rename, which saves on blur with no button) — title/price/condition/description live in local component state until one of those buttons is clicked. "Save" persists the edits without changing status; "Approve listing" persists the edits **and** sets status to `"approved"` in one mutation call. The TEST bullet "changing price updates Convex immediately" is read as: after Save/Approve, the change is reflected in Convex right away and the reactive query re-renders elsewhere (the card's price) — not that every keystroke fires a mutation.
- **No real eBay API call.** "For now marketplace = ebay" is just a fixed string field. "List approved items" is a local status transition (`approved` → `listed`) plus setting the pre-existing `items.status` field (`"detected" | "listed"`, unused until now) to `"listed"` — nothing external is published.
- **A listing-generation failure doesn't undo a successful price.** Wrapped in its own try/catch inside the per-item worker: if it throws, the item stays `researchStatus: "ready_for_review"` (Phase 4's view keeps working) and simply has no listing draft yet — it won't appear in the "Ready to sell" list.
- Re-running research (clicking "Continue with N" again) discards any existing listing for the re-queued items too, mirroring how it already discards stale identification/pricing.
- No new test framework, matching Phase 4's decision — verify via the running app, Convex data/run tools, and `tsc`/`vite build`.
- `ctx.db.get`/`.patch`/`.delete`/`.insert` take the table name as the first argument in this codebase's Convex version — match exactly.
- Match existing code style: no comments explaining *what*, one-line *why* comments only, no unrelated refactors.

---

### Task 1: Schema — `listings` table

**Files:**
- Modify: `convex/schema.ts`

**Interfaces:**
- Produces: `listingStatus` validator (`"draft" | "approved" | "listed"`), `listingCondition` validator (`"new" | "like_new" | "good" | "fair" | "poor"`), and the `listings` table (fields: `cleanoutId`, `itemId`, `marketplace`, `title`, `description`, `category`, `condition`, `price`, `status`, `createdAt`, `updatedAt`; indexes `by_cleanoutId`, `by_itemId`). Consumed by every later task.

- [ ] **Step 1: Add the validators**

In `convex/schema.ts`, add these exported validators right after `researchSourceValidator` (before `export const activityType = ...`):

```ts
export const listingStatus = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("listed"),
);

export const listingCondition = v.union(
  v.literal("new"),
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("poor"),
);
```

- [ ] **Step 2: Add the `listings` table**

In the `defineSchema({...})` call, add a new table after the `activity` table (before the closing `});`):

```ts
  listings: defineTable({
    cleanoutId: v.id("cleanouts"),
    itemId: v.id("items"),
    /** Fixed to "ebay" for now — a later phase may add other marketplaces. */
    marketplace: v.string(),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    condition: listingCondition,
    price: v.number(),
    status: listingStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_cleanoutId", ["cleanoutId"])
    .index("by_itemId", ["itemId"]),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts
git commit -m "feat: add listings table for Phase 5"
```

---

### Task 2: OpenAI listing-generation helper

**Files:**
- Create: `convex/generateListing.ts`

**Interfaces:**
- Consumes: `ResearchError` from `./identify` (existing); `IdentificationResult` type from `./identify` (existing).
- Produces: `export type ListingCondition = "new" | "like_new" | "good" | "fair" | "poor"`, `export type ListingDraft = { title: string; description: string; category: string; condition: ListingCondition; price: number }`, `export async function generateListing(input: { apiKey: string; model?: string; identification: IdentificationResult; estimatedLow: number; estimatedHigh: number; recommendedPrice: number; rationale: string }): Promise<ListingDraft>`. Task 4 (`research.ts`) imports `generateListing` and `ListingDraft`.

- [ ] **Step 1: Write the file**

```ts
/**
 * Generates a marketplace-ready listing draft from an item's identification
 * and resale research. Grounded strictly in that evidence — never invents a
 * spec, feature, or accessory the earlier stages didn't establish.
 */

import { ResearchError, type IdentificationResult } from "./identify";

const DEFAULT_MODEL = "gpt-5.6-luna";
const REASONING_EFFORT = "low";

export type ListingCondition = "new" | "like_new" | "good" | "fair" | "poor";

export type ListingDraft = {
  title: string;
  description: string;
  category: string;
  condition: ListingCondition;
  price: number;
};

const SYSTEM_PROMPT = `You write a marketplace listing draft for a second-hand item, for eBay.

Use ONLY the identification and pricing research you are given. Never invent a specification, feature, model number, or accessory that isn't stated in that information.

Produce:
- title: a concise, searchable listing title (under 80 characters). Include the brand and model only if they were actually identified; otherwise describe it generically and honestly.
- description: 2-4 sentences a buyer would read: what it is, its condition, and any notable given attributes. Do not mention research sources, dollar ranges, or how the price was determined.
- category: a plausible eBay-style category name for this item (e.g. "Video Games & Consoles", "Home & Garden > Small Kitchen Appliances").
- condition: the closest match from new, like_new, good, fair, poor, based on the condition description given.
- price: the listing price. Use the recommended price you are given unless a very slightly different, cleaner round number reads better for a listing.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    category: { type: "string" },
    condition: { type: "string", enum: ["new", "like_new", "good", "fair", "poor"] },
    price: { type: "number" },
  },
  required: ["title", "description", "category", "condition", "price"],
  additionalProperties: false,
} as const;

function buildPrompt(input: {
  identification: IdentificationResult;
  estimatedLow: number;
  estimatedHigh: number;
  recommendedPrice: number;
  rationale: string;
}): string {
  const { identification } = input;
  return [
    `Generic name: ${identification.genericName}`,
    identification.brand ? `Brand: ${identification.brand}` : "Brand: unknown",
    identification.model ? `Model: ${identification.model}` : "Model: unknown",
    `Category (detected): ${identification.category}`,
    `Condition (observed): ${identification.condition}`,
    `Attributes: ${identification.attributes.join(", ") || "none noted"}`,
    `Identification confidence: ${identification.confidence}`,
    `Estimated resale range: $${input.estimatedLow}-$${input.estimatedHigh}`,
    `Recommended price: $${input.recommendedPrice}`,
    `Pricing rationale: ${input.rationale}`,
  ].join("\n");
}

export async function generateListing(input: {
  apiKey: string;
  model?: string;
  identification: IdentificationResult;
  estimatedLow: number;
  estimatedHigh: number;
  recommendedPrice: number;
  rationale: string;
}): Promise<ListingDraft> {
  const model = input.model ?? DEFAULT_MODEL;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning_effort: REASONING_EFFORT,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "listing_draft",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new ResearchError(
        "OpenAI rejected the API key. Check OPENAI_API_KEY in your Convex environment.",
      );
    }
    if (response.status === 429) {
      throw new ResearchError(
        "OpenAI rate limit reached. Wait a moment and try again.",
        429,
      );
    }
    throw new ResearchError(
      `OpenAI listing request failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string; refusal?: string } }[];
  };

  const message = payload.choices?.[0]?.message;
  if (message?.refusal) {
    throw new ResearchError("The model declined to draft a listing.");
  }

  const content = message?.content;
  if (!content) {
    throw new ResearchError("OpenAI returned an empty listing response.");
  }

  let parsed: Partial<ListingDraft>;
  try {
    parsed = JSON.parse(content) as Partial<ListingDraft>;
  } catch {
    throw new ResearchError(
      "OpenAI returned a listing response that was not valid JSON.",
    );
  }

  if (
    typeof parsed.title !== "string" ||
    typeof parsed.description !== "string" ||
    typeof parsed.category !== "string" ||
    typeof parsed.price !== "number" ||
    (parsed.condition !== "new" &&
      parsed.condition !== "like_new" &&
      parsed.condition !== "good" &&
      parsed.condition !== "fair" &&
      parsed.condition !== "poor")
  ) {
    throw new ResearchError("OpenAI returned a listing in an unexpected shape.");
  }

  return {
    title: parsed.title.slice(0, 80),
    description: parsed.description,
    category: parsed.category,
    condition: parsed.condition,
    price: Math.max(0, Math.round(parsed.price)),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/generateListing.ts
git commit -m "feat: add OpenAI listing-draft generation helper"
```

---

### Task 3: Listings Convex functions + include listings in the workspace query

**Files:**
- Create: `convex/listings.ts`
- Modify: `convex/cleanouts.ts`

**Interfaces:**
- Consumes: `listingStatus`, `listingCondition` from `./schema` (Task 1).
- Produces: `internal.listings.saveDraft` (upserts the draft for an item — consumed by Task 4), `internal.listings.clearForItem` (consumed by Task 4's `startResearch` re-queue and by this same task's nothing-else), `api.listings.update`, `api.listings.approve`, `api.listings.listApproved` (all consumed by the frontend in Tasks 5-7). `cleanouts.latestForSession`'s return type gains a `listings: Doc<"listings">[]` field, consumed by `App.tsx` in Task 7.

- [ ] **Step 1: Write `convex/listings.ts`**

```ts
import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { listingCondition, listingStatus } from "./schema";

/** One listing per item — a fresh draft replaces whatever was there before. */
export const saveDraft = internalMutation({
  args: {
    cleanoutId: v.id("cleanouts"),
    itemId: v.id("items"),
    marketplace: v.string(),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    condition: listingCondition,
    price: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("listings")
      .withIndex("by_itemId", (q) => q.eq("itemId", args.itemId))
      .unique();

    if (existing !== null) {
      await ctx.db.delete("listings", existing._id);
    }

    const now = Date.now();
    await ctx.db.insert("listings", {
      cleanoutId: args.cleanoutId,
      itemId: args.itemId,
      marketplace: args.marketplace,
      title: args.title,
      description: args.description,
      category: args.category,
      condition: args.condition,
      price: args.price,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });

    return null;
  },
});

export const clearForItem = internalMutation({
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("listings")
      .withIndex("by_itemId", (q) => q.eq("itemId", args.itemId))
      .unique();
    if (existing !== null) {
      await ctx.db.delete("listings", existing._id);
    }
    return null;
  },
});

export const update = mutation({
  args: {
    listingId: v.id("listings"),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    condition: listingCondition,
    price: v.number(),
  },
  handler: async (ctx, args) => {
    const title = args.title.trim();
    if (title.length === 0) throw new Error("A listing needs a title");
    if (args.price <= 0) throw new Error("Price must be greater than $0");

    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) throw new Error("Listing not found");

    await ctx.db.patch("listings", args.listingId, {
      title,
      description: args.description,
      category: args.category,
      condition: args.condition,
      price: args.price,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const approve = mutation({
  args: {
    listingId: v.id("listings"),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    condition: listingCondition,
    price: v.number(),
  },
  handler: async (ctx, args) => {
    const title = args.title.trim();
    if (title.length === 0) throw new Error("A listing needs a title");
    if (args.price <= 0) throw new Error("Price must be greater than $0");

    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) throw new Error("Listing not found");

    await ctx.db.patch("listings", args.listingId, {
      title,
      description: args.description,
      category: args.category,
      condition: args.condition,
      price: args.price,
      status: "approved",
      updatedAt: Date.now(),
    });

    return null;
  },
});

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

- [ ] **Step 2: Include listings in `cleanouts.latestForSession`**

In `convex/cleanouts.ts`, modify the `latestForSession` query's handler to also fetch listings for the cleanout and include them in the returned object. The current end of the handler reads:

```ts
    // Masks arrive one at a time; each ready item carries its own signed URL.
    const withMasks = await Promise.all(
      items.map(async (item) => ({
        ...item,
        maskUrl: item.maskStorageId
          ? await ctx.storage.getUrl(item.maskStorageId)
          : null,
      })),
    );

    return { cleanout, imageUrl, items: withMasks };
```

Replace it with:

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: fails with a TS error that `internal.listings` doesn't exist yet — that's expected (codegen hasn't run since this file is new). Run `npx convex dev --once` to push and regenerate `api.d.ts`, then re-run the typecheck.
Expected after regen: no errors.

- [ ] **Step 4: Commit**

```bash
git add convex/listings.ts convex/cleanouts.ts
git commit -m "feat: add listings CRUD/approve/list-approved mutations"
```

---

### Task 4: Auto-generate a listing draft at the end of the research pipeline

**Files:**
- Modify: `convex/research.ts`

**Interfaces:**
- Consumes: `generateListing`, `ListingDraft` from `./generateListing` (Task 2); `internal.listings.saveDraft`, `internal.listings.clearForItem` (Task 3).

- [ ] **Step 1: Import the new helper**

In `convex/research.ts`, add to the existing imports:

```ts
import { generateListing } from "./generateListing";
```

- [ ] **Step 2: Clear any stale listing when re-queuing an item**

In `startResearch`, the loop that resets each selected item currently reads:

```ts
    for (const item of selected) {
      await ctx.db.patch("items", item._id, {
        researchStatus: "queued",
        researchError: undefined,
        identification: undefined,
        estimatedLow: undefined,
        estimatedHigh: undefined,
        recommendedPrice: undefined,
        pricingRationale: undefined,
        researchSources: undefined,
      });
    }
```

Add a call to clear that item's listing right after the patch:

```ts
    for (const item of selected) {
      await ctx.db.patch("items", item._id, {
        researchStatus: "queued",
        researchError: undefined,
        identification: undefined,
        estimatedLow: undefined,
        estimatedHigh: undefined,
        recommendedPrice: undefined,
        pricingRationale: undefined,
        researchSources: undefined,
      });
      await ctx.runMutation(internal.listings.clearForItem, { itemId: item._id });
    }
```

- [ ] **Step 3: Generate the listing draft after pricing succeeds**

In `researchCleanout`'s `processOne`, the `try` block currently ends right after the `savePricing` call:

```ts
        await ctx.runMutation(internal.research.savePricing, {
          itemId: item._id,
          estimatedLow: pricing.estimatedLow,
          estimatedHigh: pricing.estimatedHigh,
          recommendedPrice: pricing.recommendedPrice,
          rationale: pricing.rationale,
          sources: pricing.sources,
        });
      } catch (error) {
        await ctx.runMutation(internal.research.markResearchFailed, {
          itemId: item._id,
          error:
            error instanceof Error
              ? error.message
              : "Research failed for an unknown reason.",
        });
      }
    };
```

Insert a listing-generation step between the `savePricing` call and the `catch`, in its **own** try/catch so a listing-draft failure never undoes the successful price:

```ts
        await ctx.runMutation(internal.research.savePricing, {
          itemId: item._id,
          estimatedLow: pricing.estimatedLow,
          estimatedHigh: pricing.estimatedHigh,
          recommendedPrice: pricing.recommendedPrice,
          rationale: pricing.rationale,
          sources: pricing.sources,
        });

        // A listing-draft failure doesn't undo a successful identification +
        // price — the item stays ready_for_review, it just has no draft yet.
        try {
          const listing = await withRetry(() =>
            generateListing({
              apiKey: openaiKey,
              model,
              identification,
              estimatedLow: pricing.estimatedLow,
              estimatedHigh: pricing.estimatedHigh,
              recommendedPrice: pricing.recommendedPrice,
              rationale: pricing.rationale,
            }),
          );

          await ctx.runMutation(internal.listings.saveDraft, {
            cleanoutId: args.cleanoutId,
            itemId: item._id,
            marketplace: "ebay",
            title: listing.title,
            description: listing.description,
            category: listing.category,
            condition: listing.condition,
            price: listing.price,
          });
        } catch {
          // Swallowed intentionally — see comment above.
        }
      } catch (error) {
        await ctx.runMutation(internal.research.markResearchFailed, {
          itemId: item._id,
          error:
            error instanceof Error
              ? error.message
              : "Research failed for an unknown reason.",
        });
      }
    };
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add convex/research.ts
git commit -m "feat: auto-generate a listing draft after each item's research completes"
```

---

### Task 5: Right panel — "Ready to sell" card list

**Files:**
- Create: `src/components/ReadyToSell.tsx`
- Modify: `src/components/DetailPanel.tsx`

**Interfaces:**
- Consumes: `WorkspaceItem` (existing); `Doc<"listings">` (Task 1, via generated types).
- Produces: `ReadyToSell` default export, props `{ imageUrl: string; items: WorkspaceItem[]; listings: Doc<"listings">[]; onReview: (listingId: Id<"listings">) => void; onHover: (id: Id<"items"> | null) => void }`. `DetailPanel` gains `listings: Doc<"listings">[]` and `onReviewListing: (listingId: Id<"listings">) => void` props, consumed by Task 7's `Workspace.tsx` wiring.

- [ ] **Step 1: Create `src/components/ReadyToSell.tsx`**

```tsx
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { WorkspaceItem } from "@/lib/geometry";
import ObjectThumb from "@/components/ObjectThumb";

type Props = {
  imageUrl: string;
  items: WorkspaceItem[];
  listings: Doc<"listings">[];
  onReview: (listingId: Id<"listings">) => void;
  onHover: (id: Id<"items"> | null) => void;
};

const STATUS_LABEL: Record<Doc<"listings">["status"], string> = {
  draft: "Ready",
  approved: "Approved",
  listed: "Listed",
};

export default function ReadyToSell({
  imageUrl,
  items,
  listings,
  onReview,
  onHover,
}: Props) {
  return (
    <div>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
        Ready to sell
      </h2>
      <p className="mt-1 text-sm text-muted">
        {listings.length} {listings.length === 1 ? "listing" : "listings"} prepared
      </p>

      <ul className="mt-5 space-y-1">
        {listings.map((listing) => {
          const item = items.find((candidate) => candidate._id === listing.itemId);
          if (!item) return null;
          return (
            <li key={listing._id}>
              <div
                onPointerEnter={() => onHover(item._id)}
                onPointerLeave={() => onHover(null)}
                className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-canvas"
              >
                <ObjectThumb imageUrl={imageUrl} bbox={item.bbox} className="h-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                  <p className="text-sm text-muted">${listing.price}</p>
                </div>
                <span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-medium text-ink-soft ring-1 ring-line ring-inset">
                  {STATUS_LABEL[listing.status]}
                </span>
                <button
                  onClick={() => onReview(listing._id)}
                  className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
                >
                  Review
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Wire `DetailPanel.tsx` to show it once listings exist**

Add `Doc` to the existing `Id` import (currently `import type { Id } from "../../convex/_generated/dataModel";`):

```ts
import type { Doc, Id } from "../../convex/_generated/dataModel";
```

Add the new component import:

```ts
import ReadyToSell from "@/components/ReadyToSell";
```

Add `listings` and `onReviewListing` to `Props` and destructure them:

```ts
type Props = {
  cleanoutId: Id<"cleanouts">;
  imageUrl: string;
  items: WorkspaceItem[];
  listings: Doc<"listings">[];
  activeId: Id<"items"> | null;
  provider?: string;
  onToggle: (id: Id<"items">) => void;
  onActivate: (id: Id<"items"> | null) => void;
  onHover: (id: Id<"items"> | null) => void;
  onRename: (id: Id<"items">, name: string) => void;
  onRemove: (id: Id<"items">) => void;
  onReviewListing: (listingId: Id<"listings">) => void;
};
```

```ts
export default function DetailPanel({
  cleanoutId,
  imageUrl,
  items,
  listings,
  activeId,
  provider,
  onToggle,
  onActivate,
  onHover,
  onRename,
  onRemove,
  onReviewListing,
}: Props) {
```

Replace the two-branch `AnimatePresence` (currently `{active ? (...ItemDetail...) : (...SelectionSummary...)}`) with a three-branch version — active item first, then Ready to sell once any listing exists, then the original summary:

```tsx
      <AnimatePresence mode="wait" initial={false}>
        {active ? (
          <motion.div
            key={active._id}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <ItemDetail
              imageUrl={imageUrl}
              item={active}
              onToggle={onToggle}
              onRename={onRename}
              onRemove={onRemove}
              onBack={() => onActivate(null)}
            />
          </motion.div>
        ) : listings.length > 0 ? (
          <motion.div
            key="ready-to-sell"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <ReadyToSell
              imageUrl={imageUrl}
              items={items}
              listings={listings}
              onReview={onReviewListing}
              onHover={onHover}
            />
          </motion.div>
        ) : (
          <motion.div
            key="summary"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <SelectionSummary
              cleanoutId={cleanoutId}
              imageUrl={imageUrl}
              items={items}
              provider={provider}
              onActivate={onActivate}
              onHover={onHover}
            />
          </motion.div>
        )}
      </AnimatePresence>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: fails — `Workspace.tsx` doesn't pass `listings`/`onReviewListing` to `DetailPanel` yet. That's expected; it's fixed in Task 7. Confirm the only errors are at the `<DetailPanel .../>` call site in `Workspace.tsx` (missing props), not inside the two files just written.

- [ ] **Step 4: Commit**

```bash
git add src/components/ReadyToSell.tsx src/components/DetailPanel.tsx
git commit -m "feat: show Ready to sell card list in the right panel"
```

---

### Task 6: Listing review drawer

**Files:**
- Create: `src/components/ListingDrawer.tsx`

**Interfaces:**
- Consumes: `api.listings.update`, `api.listings.approve` (Task 3); `WorkspaceItem` (existing); `Doc<"listings">`.
- Produces: `ListingDrawer` default export, props `{ imageUrl: string; listing: Doc<"listings">; item: WorkspaceItem; hasPrev: boolean; hasNext: boolean; onNavigate: (direction: "prev" | "next") => void; onClose: () => void }`, consumed by Task 7's `Workspace.tsx`.

- [ ] **Step 1: Write the file**

```tsx
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { WorkspaceItem } from "@/lib/geometry";
import ObjectThumb from "@/components/ObjectThumb";
import { Button } from "@/components/ui/button";

const CONDITIONS: { value: Doc<"listings">["condition"]; label: string }[] = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
];

type Props = {
  imageUrl: string;
  listing: Doc<"listings">;
  item: WorkspaceItem;
  hasPrev: boolean;
  hasNext: boolean;
  onNavigate: (direction: "prev" | "next") => void;
  onClose: () => void;
};

export default function ListingDrawer({
  imageUrl,
  listing,
  item,
  hasPrev,
  hasNext,
  onNavigate,
  onClose,
}: Props) {
  const updateListing = useMutation(api.listings.update);
  const approveListing = useMutation(api.listings.approve);

  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [price, setPrice] = useState(String(listing.price));
  const [condition, setCondition] = useState(listing.condition);
  const [researchOpen, setResearchOpen] = useState(false);

  // A different listing (nav, or a fresh generation) replaces the local draft.
  useEffect(() => {
    setTitle(listing.title);
    setDescription(listing.description);
    setPrice(String(listing.price));
    setCondition(listing.condition);
    setResearchOpen(false);
  }, [listing._id, listing.title, listing.description, listing.price, listing.condition]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const draft = () => ({
    listingId: listing._id,
    title,
    description,
    category: listing.category,
    condition,
    price: Number(price) || 0,
  });

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-40 bg-ink/30"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="surface fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onNavigate("prev")}
              disabled={!hasPrev}
              className="rounded-full p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink disabled:pointer-events-none disabled:opacity-30"
              aria-label="Previous listing"
            >
              <ChevronLeft className="size-4" strokeWidth={2} />
            </button>
            <button
              onClick={() => onNavigate("next")}
              disabled={!hasNext}
              className="rounded-full p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink disabled:pointer-events-none disabled:opacity-30"
              aria-label="Next listing"
            >
              <ChevronRight className="size-4" strokeWidth={2} />
            </button>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink"
            aria-label="Close"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>

        <div className="mt-4 flex justify-center rounded-xl bg-canvas p-4">
          <ObjectThumb imageUrl={imageUrl} bbox={item.bbox} className="h-36" />
        </div>

        <label className="mt-5 block text-xs font-medium tracking-wide text-muted uppercase">
          Title
        </label>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-1.5 w-full rounded-lg bg-canvas px-3 py-2 text-sm text-ink outline-none"
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium tracking-wide text-muted uppercase">
              Price
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="mt-1.5 w-full rounded-lg bg-canvas px-3 py-2 text-sm text-ink outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium tracking-wide text-muted uppercase">
              Condition
            </label>
            <select
              value={condition}
              onChange={(event) =>
                setCondition(event.target.value as Doc<"listings">["condition"])
              }
              className="mt-1.5 w-full rounded-lg bg-canvas px-3 py-2 text-sm text-ink outline-none"
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="mt-4 block text-xs font-medium tracking-wide text-muted uppercase">
          Description
        </label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          className="mt-1.5 w-full resize-none rounded-lg bg-canvas px-3 py-2 text-sm text-ink outline-none"
        />

        <details
          open={researchOpen}
          onToggle={(event) => setResearchOpen(event.currentTarget.open)}
          className="mt-4 border-t border-line pt-4"
        >
          <summary className="cursor-pointer text-xs font-medium tracking-wide text-muted uppercase">
            Research summary
          </summary>
          <div className="mt-2 space-y-2 text-sm">
            {item.identification && (
              <p className="text-ink-soft">
                {item.identification.confidence} confidence
                {(item.identification.brand || item.identification.model) &&
                  ` · ${[item.identification.brand, item.identification.model].filter(Boolean).join(" ")}`}
              </p>
            )}
            {item.estimatedLow !== undefined && item.estimatedHigh !== undefined && (
              <p className="text-ink-soft">
                Estimated resale ${item.estimatedLow}–${item.estimatedHigh}
              </p>
            )}
            {item.researchSources?.map((source, index) => (
              <div key={index} className="rounded-lg bg-canvas px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink">{source.source}</span>
                  <span className="text-xs font-medium text-ink">{source.price}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{source.description}</p>
              </div>
            ))}
          </div>
        </details>

        <div className="mt-5 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => void updateListing(draft())}
          >
            Save
          </Button>
          <Button
            variant="accent"
            className="flex-1"
            onClick={() => void approveListing(draft())}
          >
            Approve listing
          </Button>
        </div>
      </motion.aside>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors from this file (the pre-existing `Workspace.tsx`/`DetailPanel.tsx` prop-mismatch errors from Task 5 are unrelated and fixed in Task 7).

- [ ] **Step 3: Commit**

```bash
git add src/components/ListingDrawer.tsx
git commit -m "feat: add listing review drawer with Save/Approve and navigation"
```

---

### Task 7: Bottom bar + wire everything together

**Files:**
- Create: `src/components/ListingsBar.tsx`
- Modify: `src/components/Workspace.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `api.listings.listApproved` (Task 3); `ReadyToSell`/`DetailPanel` (Task 5); `ListingDrawer` (Task 6).
- Produces: `ListingsBar` default export. `Workspace` gains `listings`, `reviewingListingId`, `onReviewListing`, `onCloseDrawer`, `onNavigateListing` props.

- [ ] **Step 1: Create `src/components/ListingsBar.tsx`**

```tsx
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

type Props = {
  cleanoutId: Id<"cleanouts">;
  listings: Doc<"listings">[];
  onReviewAll: () => void;
};

export default function ListingsBar({ cleanoutId, listings, onReviewAll }: Props) {
  const listApproved = useMutation(api.listings.listApproved);
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
          onClick={() => void listApproved({ cleanoutId })}
        >
          List approved items
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `Workspace.tsx`**

Add imports (`Doc` and `Id` are already imported on the existing `import type { Doc, Id } from "../../convex/_generated/dataModel";` line — don't duplicate them):

```ts
import { AnimatePresence } from "motion/react";
import ListingsBar from "@/components/ListingsBar";
import ListingDrawer from "@/components/ListingDrawer";
```

Add to `Props` (and destructure in the function signature):

```ts
  listings: Doc<"listings">[];
  reviewingListingId: Id<"listings"> | null;
  onReviewListing: (listingId: Id<"listings">) => void;
  onCloseDrawer: () => void;
  onNavigateListing: (direction: "prev" | "next") => void;
```

Right after the existing `researching` computation, derive the active listing and its item:

```ts
  const activeListing =
    listings.find((listing) => listing._id === reviewingListingId) ?? null;
  const activeListingItem = activeListing
    ? (items.find((item) => item._id === activeListing.itemId) ?? null)
    : null;
  const activeListingIndex = activeListing
    ? listings.findIndex((listing) => listing._id === activeListing._id)
    : -1;
```

Pass `listings` and `onReviewListing` to `DetailPanel`:

```tsx
      {(ready || revealing) && (
        <DetailPanel
          cleanoutId={cleanout._id}
          imageUrl={imageUrl}
          items={items}
          listings={listings}
          activeId={activeId}
          provider={cleanout.provider}
          onToggle={onToggle}
          onActivate={onActivate}
          onHover={onHover}
          onRename={onRename}
          onRemove={onRemove}
          onReviewListing={onReviewListing}
        />
      )}
```

Right after the closing `</div>` of the grid (before the final `</div>` and `);`), add the bar and the drawer:

```tsx
      <ListingsBar
        cleanoutId={cleanout._id}
        listings={listings}
        onReviewAll={() => {
          if (listings[0]) onReviewListing(listings[0]._id);
        }}
      />

      <AnimatePresence>
        {activeListing && activeListingItem && (
          <ListingDrawer
            key={activeListing._id}
            imageUrl={imageUrl}
            listing={activeListing}
            item={activeListingItem}
            hasPrev={activeListingIndex > 0}
            hasNext={activeListingIndex < listings.length - 1}
            onNavigate={onNavigateListing}
            onClose={onCloseDrawer}
          />
        )}
      </AnimatePresence>
```

- [ ] **Step 3: Wire `App.tsx`**

Add `Id<"listings">` state near the other `useState` calls:

```ts
  const [reviewingListingId, setReviewingListingId] = useState<Id<"listings"> | null>(null);
```

Derive `listings` from the workspace query, right after the existing `items` `useMemo`:

```ts
  const listings = workspace?.listings ?? [];
```

Pass the new props into `<Workspace .../>`:

```tsx
                listings={listings}
                reviewingListingId={reviewingListingId}
                onReviewListing={setReviewingListingId}
                onCloseDrawer={() => setReviewingListingId(null)}
                onNavigateListing={(direction) => {
                  setReviewingListingId((current) => {
                    if (current === null) return current;
                    const index = listings.findIndex((listing) => listing._id === current);
                    if (index === -1) return current;
                    const nextIndex = direction === "next" ? index + 1 : index - 1;
                    return listings[nextIndex]?._id ?? current;
                  });
                }}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/ListingsBar.tsx src/components/Workspace.tsx src/App.tsx
git commit -m "feat: wire listings bar and review drawer into the workspace"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the app locally**

Ensure `npx convex dev` and `npm run dev` are running (reuse the ones from Phase 4 if still up; otherwise start them, same as Phase 4 Task 7 Step 2).

- [ ] **Step 2: Drive the real pipeline via Convex tools**

Using the `mcp__plugin_convex_convex__run`/`data`/`runOneoffQuery` tools (same approach as Phase 4's verification, to control API spend): pick a cleanout with a few selected items, call `research.js:startResearch`, wait for it to finish, then read the `listings` table for those items. Confirm:
- Every item that reached `ready_for_review` in Phase 4 now has exactly one `listings` row (unless the listing-generation step legitimately failed — check logs).
- `title`/`description`/`category`/`condition`/`price` are all populated and don't contain anything not present in that item's `identification`/pricing (spot-check one item against its identification for invented specs).
- `status` is `"draft"` for all of them at first.

- [ ] **Step 3: Exercise update/approve/list via Convex tools**

With at least 3 listings from Step 2: call `listings.js:update` on one with a changed price — confirm (via `data`/`runOneoffQuery`) the row's `price` and `updatedAt` changed, `status` stayed `"draft"` (proves "changing price updates Convex immediately" without also approving). Call `listings.js:approve` on **two** of the others (proves "approve individual item" and, together, "approve all" / multi-item approval), confirming each one's `status` became `"approved"` and its edited fields persisted. Leave the first (updated-but-not-approved) listing as `"draft"`. Call `listings.js:listApproved` with the cleanoutId — confirm the two approved listings flipped to `"listed"` and their `items` rows' `status` field became `"listed"`, while the untouched draft did **not** change status (proves "rejected/unapproved listings do not publish").

- [ ] **Step 4: Confirm reload / reactivity**

Re-run the `cleanouts.js:latestForSession` query (or read the `cleanouts`/`listings` tables directly) and confirm the returned `listings` array reflects every change from Step 3 — proves both "drafts persist" / "editable fields persist" and that the frontend's `useQuery` would see the same state on a fresh load with no extra client-side state involved.

- [ ] **Step 5: Note what could not be verified without a browser**

Same limitation as Phase 4 — no browser-automation tool is available in this environment. State plainly that the drawer's Save/Approve buttons, Next/Previous navigation, the condition dropdown, and the bottom bar's layout were not visually confirmed, and point the user at the running `http://localhost:<port>` to check them directly.

- [ ] **Step 6: Full build**

Run: `npm run build`
Expected: `tsc --noEmit && vite build` both succeed with no errors.

- [ ] **Step 7: Report results to the user**

Summarize what was verified and what wasn't (per Step 5), and stop — per the spec, "Stop after Phase 5." Do not commit further, deploy, or move to a Phase 6.
