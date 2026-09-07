# Phase 4: Identification + Resale Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user clicks "Continue with N" on the workspace toolbar, spin up one independent selling-agent job per selected item that identifies the object (OpenAI structured outputs) and researches its resale value (Firecrawl web search + OpenAI price extraction), persists the result to Convex, and surfaces live per-item progress at the top of the page and full detail (identification, estimated/recommended price, market comparisons) in the right panel when clicking an item.

**Architecture:** Follows this codebase's existing detection/masks pattern exactly: a public mutation flips selected items to `researchStatus: "queued"` and schedules one `internalAction`; that action fetches everything it needs via one `internalQuery`, then runs a bounded worker pool (4 concurrent) over the items, each running `identify → save → price → save` with per-item try/catch so one item's failure never blocks the others. Two new plain helper modules (`convex/identify.ts`, `convex/priceResearch.ts`) hold the raw OpenAI/Firecrawl HTTP calls — no provider-abstraction layer this time (decided against mirroring `convex/segmentation/`'s mock/fail modes to keep this phase simpler); calls go directly to the real APIs and error out clearly if a key is missing.

**Tech Stack:** Convex (schema, mutations, internal actions, scheduler), OpenAI Chat Completions API with `response_format: json_schema` (`gpt-5.6-luna`, same as `convex/segmentation/openai.ts`), Firecrawl `/v2/search` REST API, React 19 + Tailwind (existing component styles).

**Spec:** The Phase 4 spec was given verbatim by the user in conversation (not a separate file) — reproduced in full below so it travels with the plan.

```text
PHASE 4: IDENTIFICATION + RESALE RESEARCH

When the user clicks "Continue with 4", create one selling-agent job for each
selected item. Each item independently transitions: queued -> identifying ->
researching -> ready_for_review.

Use OpenAI structured outputs to identify: generic item name, likely brand,
likely model, category, condition guess, key visible attributes,
identification confidence. If confidence is low, do NOT hallucinate a precise
model. High confidence example: "Sony PlayStation 5 Slim Disc Edition". Low
confidence example: "PlayStation 5 console, exact revision uncertain".

Then use Firecrawl to search public resale information. Generate useful
research searches such as "PS5 Slim Disc used sold price", "PS5 Slim Disc pre
owned price", etc. Store sources in Convex. Produce: estimatedLow,
estimatedHigh, recommendedListingPrice, short pricing rationale. Separate
observed evidence from AI inference.

RIGHT PANEL UI: clicking an object shows the identified name, "Estimated
resale $250-290", "Recommended $279", "Identification confidence High", then
"3 market comparisons" with small source cards (source, price, brief
description). Do not dump raw scraped content.

Top of page: realtime progress, e.g. "4 agents working" with a per-item line
(item name -> current status phrase, or the finished price range with a
checkmark). Status updates reactive through Convex.

TEST: run on at least three item categories; confirm Firecrawl results are
persisted; verify one item's failure does not block other agents; reload
keeps results; activity timeline works; build passes. Stop after Phase 4.
```

## Global Constraints

- No mock/fail provider modes for this phase (explicit user decision) — `identify.ts` and `priceResearch.ts` call the real OpenAI/Firecrawl APIs directly and throw a clear `ResearchError` when a key is missing or a call fails.
- Identification overwrites `item.name` with `identification.genericName` once identification completes (explicit user decision) — every existing component that reads `item.name` (chips, canvas, thumbnails) picks this up with zero extra wiring.
- No new test framework — this project has none (no `convex-test`/vitest, no existing test files); phases 1-3 shipped on manual verification only, and the spec's own TEST section reads as manual/integration checks. Verify via the running app, direct Convex data reads through the `mcp__plugin_convex_convex__*` tools, and `tsc`/`vite build`.
- `ctx.db.get`/`.patch`/`.delete`/`.insert` all take the table name as the first argument in this codebase's Convex version (e.g. `ctx.db.get("items", id)`) — match this exactly, not the single-argument form.
- Bounded arrays only: `researchSources` is capped at 3 entries and written wholesale in one mutation (never appended-to) — consistent with the project guidelines' "no unbounded array fields" rule and with the existing `polygon`/`detectionBox` precedent.
- Every new Convex function needs argument validators (project + Convex house rule).
- Match existing code style: no comments explaining *what* code does, JSDoc-style one-line comments only for non-obvious *why*, no unrelated refactors.

---

### Task 1: Schema — research fields, validators, activity types

**Files:**
- Modify: `convex/schema.ts`

**Interfaces:**
- Produces: `researchStatus` validator (`"queued" | "identifying" | "researching" | "ready_for_review" | "failed"`), `identificationValidator` (object: `genericName: string, brand: string|null, model: string|null, category: string, condition: string, attributes: string[], confidence: "low"|"medium"|"high"`), `researchSourceValidator` (object: `source, price, description, url: string`), all exported from `convex/schema.ts` for reuse by `convex/research.ts`. New optional fields on the `items` table: `researchStatus`, `researchError`, `identification`, `recommendedPrice`, `pricingRationale`, `researchSources`. Reuses the existing `estimatedLow`/`estimatedHigh` fields (already on `items`) for the price range. New `activityType` literals: `"research_started"`, `"research_completed"`, `"research_failed"`.

- [ ] **Step 1: Add the new validators and activity types**

In `convex/schema.ts`, add these exported validators right after the existing `maskStatus` validator (after line 35, before `export const activityType = ...`):

```ts
export const researchStatus = v.union(
  v.literal("queued"),
  v.literal("identifying"),
  v.literal("researching"),
  v.literal("ready_for_review"),
  v.literal("failed"),
);

export const identificationConfidence = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

export const identificationValidator = v.object({
  genericName: v.string(),
  // Always present but nullable, matching OpenAI's strict-schema output
  // (identify.ts's IdentificationResult) — never absent/undefined.
  brand: v.union(v.string(), v.null()),
  model: v.union(v.string(), v.null()),
  category: v.string(),
  condition: v.string(),
  attributes: v.array(v.string()),
  confidence: identificationConfidence,
});

export const researchSourceValidator = v.object({
  source: v.string(),
  price: v.string(),
  description: v.string(),
  url: v.string(),
});
```

Then update the `activityType` union (currently lines 37-49) to add three new literals at the end, right before the closing `);`:

```ts
export const activityType = v.union(
  v.literal("cleanout_created"),
  v.literal("detection_started"),
  v.literal("detection_completed"),
  v.literal("detection_failed"),
  v.literal("detection_retried"),
  v.literal("item_selected"),
  v.literal("item_deselected"),
  v.literal("item_renamed"),
  v.literal("item_added"),
  v.literal("item_removed"),
  v.literal("selection_bulk"),
  v.literal("research_started"),
  v.literal("research_completed"),
  v.literal("research_failed"),
);
```

- [ ] **Step 2: Add the new fields to the `items` table**

In the `items` table definition (currently lines 73-96), add these fields right after `segmentationProvider: v.optional(v.string()),` and before `estimatedLow: v.optional(v.number()),`:

```ts
    // Phase 4: identification + resale research, independent per item.
    researchStatus: v.optional(researchStatus),
    researchError: v.optional(v.string()),
    identification: v.optional(identificationValidator),
    recommendedPrice: v.optional(v.number()),
    pricingRationale: v.optional(v.string()),
    researchSources: v.optional(v.array(researchSourceValidator)),
```

Leave `estimatedLow`/`estimatedHigh` exactly where they are — Phase 4 writes into those existing fields.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors (schema-only change, nothing references the new fields yet).

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts
git commit -m "feat: add Phase 4 research fields to items schema"
```

---

### Task 2: OpenAI identification helper

**Files:**
- Create: `convex/identify.ts`

**Interfaces:**
- Consumes: nothing from other new files.
- Produces: `export class ResearchError extends Error { readonly status?: number }`, `export type IdentificationResult = { genericName: string; brand: string | null; model: string | null; category: string; condition: string; attributes: string[]; confidence: "low" | "medium" | "high" }`, `export async function identifyItem(input: { apiKey: string; model?: string; reasoningEffort?: string; imageUrl: string; box: { x: number; y: number; width: number; height: number }; hintLabel: string; hintCategory: string }): Promise<IdentificationResult>`. Task 3 imports `ResearchError` and `IdentificationResult` from this file; Task 4 imports `identifyItem`, `ResearchError`, `IdentificationResult`.

- [ ] **Step 1: Write the file**

```ts
/**
 * Identifies a single detected object inside a room photo: a generic name,
 * best-guess brand/model (never hallucinated), category, condition, and
 * confidence. Perception plus a light guess, not deep reasoning, so this
 * mirrors segmentation/openai.ts's low-effort choice for the same reason.
 */

const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_REASONING_EFFORT = "low";

export class ResearchError extends Error {
  /** Upstream HTTP status, when there was one. Drives retry decisions. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ResearchError";
    this.status = status;
  }
}

export type IdentificationResult = {
  genericName: string;
  brand: string | null;
  model: string | null;
  category: string;
  condition: string;
  attributes: string[];
  confidence: "low" | "medium" | "high";
};

const SYSTEM_PROMPT = `You are identifying ONE specific second-hand object inside a room photo, for a resale listing.

The object is located inside the normalized bounding box you are given (0..1, origin top-left). Ignore every other object in the photo — describe only what is inside that box.

Report:
- genericName: a plain, generic name for the object ("gaming console", "electric guitar"). Never invent a precise model here.
- brand: the manufacturer, ONLY if you can actually see a logo, nameplate, or another unmistakable visual cue. Otherwise null.
- model: the specific model or product line, ONLY if you can actually see or unambiguously infer it from a visible marking or an unmistakable, unique shape. Otherwise null.
- category: a short resale category for this object (e.g. "gaming console", "seating", "kitchen appliance").
- condition: one short phrase describing the item's visible condition from the photo alone (e.g. "Looks lightly used, no visible damage").
- attributes: 2-5 short visible attributes that would help a buyer recognize this exact item (color, finish, notable markings, accessories visible with it).
- confidence: "high" only when you can name a specific brand and model from clear visual evidence; "medium" when the object type is clear but brand/model are uncertain or absent; "low" when even the object type is a guess.

Never invent a precise brand or model you cannot actually confirm from the image — when unsure, leave it null and lower confidence instead.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    genericName: { type: "string" },
    brand: { type: ["string", "null"] },
    model: { type: ["string", "null"] },
    category: { type: "string" },
    condition: { type: "string" },
    attributes: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: [
    "genericName",
    "brand",
    "model",
    "category",
    "condition",
    "attributes",
    "confidence",
  ],
  additionalProperties: false,
} as const;

export async function identifyItem(input: {
  apiKey: string;
  model?: string;
  reasoningEffort?: string;
  imageUrl: string;
  box: { x: number; y: number; width: number; height: number };
  hintLabel: string;
  hintCategory: string;
}): Promise<IdentificationResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const reasoningEffort = input.reasoningEffort ?? DEFAULT_REASONING_EFFORT;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning_effort: reasoningEffort,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Identify the object inside this normalized box: x=${input.box.x.toFixed(3)}, y=${input.box.y.toFixed(3)}, width=${input.box.width.toFixed(3)}, height=${input.box.height.toFixed(3)}. An earlier pass guessed it might be "${input.hintLabel}" (category: ${input.hintCategory}) — treat that only as a hint, not a fact.`,
            },
            {
              type: "image_url",
              image_url: { url: input.imageUrl, detail: "high" },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "item_identification",
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
    if (response.status === 404) {
      throw new ResearchError(
        `The model "${model}" is not available on this OpenAI account. Set OPENAI_VISION_MODEL to one you can use.`,
      );
    }
    if (response.status === 429) {
      throw new ResearchError(
        "OpenAI rate limit reached. Wait a moment and try again.",
        429,
      );
    }
    throw new ResearchError(
      `OpenAI request failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string; refusal?: string } }[];
  };

  const message = payload.choices?.[0]?.message;
  if (message?.refusal) {
    throw new ResearchError("The model declined to identify this item.");
  }

  const content = message?.content;
  if (!content) {
    throw new ResearchError("OpenAI returned an empty response.");
  }

  let parsed: Partial<IdentificationResult>;
  try {
    parsed = JSON.parse(content) as Partial<IdentificationResult>;
  } catch {
    throw new ResearchError(
      "OpenAI returned a response that was not valid JSON.",
    );
  }

  if (
    typeof parsed.genericName !== "string" ||
    typeof parsed.category !== "string" ||
    typeof parsed.condition !== "string" ||
    !Array.isArray(parsed.attributes) ||
    (parsed.confidence !== "low" &&
      parsed.confidence !== "medium" &&
      parsed.confidence !== "high")
  ) {
    throw new ResearchError(
      "OpenAI returned identification in an unexpected shape.",
    );
  }

  return {
    genericName: parsed.genericName,
    brand: typeof parsed.brand === "string" ? parsed.brand : null,
    model: typeof parsed.model === "string" ? parsed.model : null,
    category: parsed.category,
    condition: parsed.condition,
    attributes: parsed.attributes
      .filter((a): a is string => typeof a === "string")
      .slice(0, 6),
    confidence: parsed.confidence,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/identify.ts
git commit -m "feat: add OpenAI identification helper for resale research"
```

---

### Task 3: Firecrawl + OpenAI pricing helper, and env wiring

**Files:**
- Create: `convex/priceResearch.ts`
- Modify: `convex/convex.config.ts`

**Interfaces:**
- Consumes: `ResearchError`, `IdentificationResult` from `./identify` (Task 2).
- Produces: `export type ResearchSource = { source: string; price: string; description: string; url: string }`, `export type PricingResult = { estimatedLow: number; estimatedHigh: number; recommendedPrice: number; rationale: string; sources: ResearchSource[] }`, `export async function priceItem(input: { firecrawlApiKey: string; openaiApiKey: string; model?: string; identification: IdentificationResult }): Promise<PricingResult>`. Task 4 imports `priceItem`, `ResearchSource`, `PricingResult`. `env.FIRECRAWL_API_KEY` becomes readable from `./_generated/server` after the `convex.config.ts` change (regenerated by the running `convex dev` or a `convex dev --once`).

- [ ] **Step 1: Add `FIRECRAWL_API_KEY` to the app's typed env vars**

In `convex/convex.config.ts`, add one field to the existing `env` object (after `MASK_MODE`):

```ts
    /** Enables Phase 4 resale research (Firecrawl web search). */
    FIRECRAWL_API_KEY: v.optional(v.string()),
```

The full file should read:

```ts
import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    OPENAI_API_KEY: v.optional(v.string()),
    /** Overrides the default vision model. */
    OPENAI_VISION_MODEL: v.optional(v.string()),
    /** "minimal" | "low" | "medium" | "high". Detection is not a reasoning task. */
    OPENAI_REASONING_EFFORT: v.optional(v.string()),
    /** "openai" | "mock" | "fail" | "auto". */
    SEGMENTATION_MODE: v.optional(v.string()),

    /** Enables asynchronous box-prompted mask refinement. */
    FAL_KEY: v.optional(v.string()),
    /** Overrides the fal mask model. */
    FAL_MASK_MODEL: v.optional(v.string()),
    /** "fal" | "off" | "auto". */
    MASK_MODE: v.optional(v.string()),

    /** Enables Phase 4 resale research (Firecrawl web search). */
    FIRECRAWL_API_KEY: v.optional(v.string()),
  },
});
```

- [ ] **Step 2: Write `convex/priceResearch.ts`**

```ts
/**
 * Second stage of the selling agent: turns an identification into a priced
 * listing. Firecrawl supplies observed evidence (raw search snippets); a
 * second OpenAI call turns that evidence into a price range, a recommended
 * price, and at most 3 cited market comparisons — kept explicitly separate
 * from the AI's own inference in the rationale it writes.
 */

import { ResearchError, type IdentificationResult } from "./identify";

const SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const DEFAULT_MODEL = "gpt-5.6-luna";
const PRICING_REASONING_EFFORT = "medium";
const RESULTS_PER_QUERY = 5;
const MAX_RESULTS = 12;
const MAX_SOURCES = 3;

export type ResearchSource = {
  source: string;
  price: string;
  description: string;
  url: string;
};

export type PricingResult = {
  estimatedLow: number;
  estimatedHigh: number;
  recommendedPrice: number;
  rationale: string;
  sources: ResearchSource[];
};

type SearchResult = { query: string; title: string; description: string; url: string };

function buildQueries(identification: IdentificationResult): string[] {
  const subject =
    [identification.brand, identification.model]
      .filter((v): v is string => !!v)
      .join(" ") || identification.genericName;

  return [
    `${subject} used price`,
    `${subject} for sale`,
    `${subject} ${identification.condition} price`,
  ];
}

async function searchOne(apiKey: string, query: string): Promise<SearchResult[]> {
  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      limit: RESULTS_PER_QUERY,
      sources: [{ type: "web" }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new ResearchError(
        "Firecrawl rejected the API key. Check FIRECRAWL_API_KEY in your Convex environment.",
      );
    }
    if (response.status === 429) {
      throw new ResearchError(
        "Firecrawl rate limit reached. Wait a moment and try again.",
        429,
      );
    }
    throw new ResearchError(
      `Firecrawl search failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    data?: { web?: { title?: string; description?: string; url?: string }[] };
  };

  return (payload.data?.web ?? []).flatMap((item) =>
    item.url && item.title
      ? [{ query, title: item.title, description: item.description ?? "", url: item.url }]
      : [],
  );
}

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    out.push(result);
  }
  return out;
}

const PRICING_SYSTEM_PROMPT = `You are a resale pricing analyst. You are given an item identification and a list of raw web search snippets gathered about that item being sold or discussed online.

Using ONLY the evidence in the snippets:
- Estimate a realistic resale price range (estimatedLow, estimatedHigh) for a used item in the described condition.
- Give one recommendedPrice within that range.
- Write a short (1-2 sentence) rationale that says what the evidence showed and where you had to infer rather than observe.
- Choose at most 3 of the most relevant, credible snippets as market comparisons. For each, give: source (the site or publisher name), price (the price mentioned in that snippet, or "Not listed" if none is mentioned), description (a one-sentence description of what that source shows), and url (copied exactly from the snippet).

If the snippets contain little or no useful pricing evidence, keep the range wide, say so plainly in the rationale, and return fewer (or zero) sources rather than inventing one.

Never quote or repeat large blocks of the raw snippet text — summarize in your own words.`;

const PRICING_SCHEMA = {
  type: "object",
  properties: {
    estimatedLow: { type: "number" },
    estimatedHigh: { type: "number" },
    recommendedPrice: { type: "number" },
    rationale: { type: "string" },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          price: { type: "string" },
          description: { type: "string" },
          url: { type: "string" },
        },
        required: ["source", "price", "description", "url"],
        additionalProperties: false,
      },
    },
  },
  required: ["estimatedLow", "estimatedHigh", "recommendedPrice", "rationale", "sources"],
  additionalProperties: false,
} as const;

function buildPricingPrompt(
  identification: IdentificationResult,
  evidence: SearchResult[],
): string {
  const header =
    `Item: ${identification.genericName}` +
    (identification.brand ? `, brand: ${identification.brand}` : "") +
    (identification.model ? `, model: ${identification.model}` : "") +
    `\nCondition: ${identification.condition}`;

  const body =
    evidence.length === 0
      ? "No search snippets were found for this item."
      : evidence
          .map((e, i) => `${i + 1}. [${e.query}] ${e.title} — ${e.description} (${e.url})`)
          .join("\n");

  return `${header}\n\nSearch snippets:\n${body}`;
}

export async function priceItem(input: {
  firecrawlApiKey: string;
  openaiApiKey: string;
  model?: string;
  identification: IdentificationResult;
}): Promise<PricingResult> {
  const queries = buildQueries(input.identification);
  const settled = await Promise.allSettled(
    queries.map((q) => searchOne(input.firecrawlApiKey, q)),
  );

  const collected = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (collected.length === 0) {
    const failure = settled.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (failure) {
      throw failure.reason instanceof Error
        ? failure.reason
        : new ResearchError("Firecrawl search failed.");
    }
  }

  const evidence = dedupeByUrl(collected).slice(0, MAX_RESULTS);
  const model = input.model ?? DEFAULT_MODEL;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning_effort: PRICING_REASONING_EFFORT,
      messages: [
        { role: "system", content: PRICING_SYSTEM_PROMPT },
        { role: "user", content: buildPricingPrompt(input.identification, evidence) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "resale_pricing",
          strict: true,
          schema: PRICING_SCHEMA,
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
      `OpenAI pricing request failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string; refusal?: string } }[];
  };

  const message = payload.choices?.[0]?.message;
  if (message?.refusal) {
    throw new ResearchError("The model declined to produce a pricing estimate.");
  }

  const content = message?.content;
  if (!content) {
    throw new ResearchError("OpenAI returned an empty pricing response.");
  }

  let parsed: Partial<PricingResult>;
  try {
    parsed = JSON.parse(content) as Partial<PricingResult>;
  } catch {
    throw new ResearchError(
      "OpenAI returned a pricing response that was not valid JSON.",
    );
  }

  if (
    typeof parsed.estimatedLow !== "number" ||
    typeof parsed.estimatedHigh !== "number" ||
    typeof parsed.recommendedPrice !== "number" ||
    typeof parsed.rationale !== "string" ||
    !Array.isArray(parsed.sources)
  ) {
    throw new ResearchError("OpenAI returned pricing in an unexpected shape.");
  }

  const low = Math.max(0, Math.min(parsed.estimatedLow, parsed.estimatedHigh));
  const high = Math.max(low, parsed.estimatedHigh);
  const recommended = Math.min(Math.max(parsed.recommendedPrice, low), high);

  const sources: ResearchSource[] = parsed.sources
    .filter(
      (s): s is ResearchSource =>
        !!s &&
        typeof s.source === "string" &&
        typeof s.price === "string" &&
        typeof s.description === "string" &&
        typeof s.url === "string",
    )
    .slice(0, MAX_SOURCES);

  return {
    estimatedLow: Math.round(low),
    estimatedHigh: Math.round(high),
    recommendedPrice: Math.round(recommended),
    rationale: parsed.rationale,
    sources,
  };
}
```

- [ ] **Step 3: Sync the new env var and typecheck**

Run: `npx convex dev --once`
Expected: deploy succeeds and regenerates `convex/_generated/server.d.ts` so `env.FIRECRAWL_API_KEY` typechecks.

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add convex/priceResearch.ts convex/convex.config.ts
git commit -m "feat: add Firecrawl resale research helper and FIRECRAWL_API_KEY env var"
```

---

### Task 4: Research orchestrator

**Files:**
- Create: `convex/research.ts`

**Interfaces:**
- Consumes: `identifyItem`, `ResearchError`, `IdentificationResult` from `./identify` (Task 2); `priceItem` from `./priceResearch` (Task 3); `researchStatus`, `identificationValidator`, `researchSourceValidator` from `./schema` (Task 1); `recordActivity` from `./activity` (existing).
- Produces: `api.research.startResearch` (public mutation, args `{ cleanoutId: Id<"cleanouts"> }`) — this is what the frontend calls in Task 5. Internal functions `internal.research.contextForResearch`, `internal.research.setStatus`, `internal.research.saveIdentification`, `internal.research.savePricing`, `internal.research.markResearchFailed`, `internal.research.researchCleanout` — internal wiring only, not consumed elsewhere.

- [ ] **Step 1: Write the file**

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
import type { Id } from "./_generated/dataModel";
import { recordActivity } from "./activity";
import {
  identificationValidator,
  researchSourceValidator,
  researchStatus,
} from "./schema";
import { identifyItem, ResearchError, type IdentificationResult } from "./identify";
import { priceItem } from "./priceResearch";

/** How many items may be researched at once. Same bound as mask refinement. */
const RESEARCH_CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [400, 1200];

function isRetryable(error: unknown): boolean {
  if (!(error instanceof ResearchError)) return false;
  return error.status === 403 || error.status === 429 || error.status === 503;
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS - 1) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, BACKOFF_MS[attempt] ?? 1200),
      );
    }
  }

  throw lastError;
}

/**
 * Creates one selling-agent job per currently-selected item. Re-running this
 * (e.g. after changing the selection) re-queues every currently-selected
 * item, discarding any previous research on them.
 */
export const startResearch = mutation({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("items")
      .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", args.cleanoutId))
      .take(50);
    const selected = items.filter((item) => item.selected);
    if (selected.length === 0) throw new Error("Select at least one item first");

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

    await recordActivity(ctx, {
      cleanoutId: args.cleanoutId,
      type: "research_started",
      message: `Researching resale value for ${selected.length} ${selected.length === 1 ? "item" : "items"}…`,
    });

    await ctx.scheduler.runAfter(0, internal.research.researchCleanout, {
      cleanoutId: args.cleanoutId,
      itemIds: selected.map((item) => item._id),
    });

    return null;
  },
});

export const contextForResearch = internalQuery({
  args: { cleanoutId: v.id("cleanouts"), itemIds: v.array(v.id("items")) },
  handler: async (ctx, args) => {
    const cleanout = await ctx.db.get("cleanouts", args.cleanoutId);
    if (cleanout === null) return null;

    const items: {
      _id: Id<"items">;
      name: string;
      category: string;
      detectionBox: { x: number; y: number; width: number; height: number };
    }[] = [];

    for (const itemId of args.itemIds) {
      const item = await ctx.db.get("items", itemId);
      if (item !== null && item.researchStatus === "queued") {
        items.push({
          _id: item._id,
          name: item.name,
          category: item.category,
          detectionBox: item.detectionBox,
        });
      }
    }

    return {
      imageUrl: cleanout.imageStorageId
        ? await ctx.storage.getUrl(cleanout.imageStorageId)
        : null,
      items,
    };
  },
});

export const setStatus = internalMutation({
  args: { itemId: v.id("items"), status: researchStatus },
  handler: async (ctx, args) => {
    const item = await ctx.db.get("items", args.itemId);
    if (item === null) return null;
    await ctx.db.patch("items", args.itemId, { researchStatus: args.status });
    return null;
  },
});

export const saveIdentification = internalMutation({
  args: { itemId: v.id("items"), identification: identificationValidator },
  handler: async (ctx, args) => {
    const item = await ctx.db.get("items", args.itemId);
    if (item === null) return null;

    await ctx.db.patch("items", args.itemId, {
      // The AI's refined name replaces the rough detector label everywhere
      // it's shown — chips, canvas outline, thumbnail — with no extra wiring.
      name: args.identification.genericName,
      identification: args.identification,
      researchStatus: "researching",
    });
    return null;
  },
});

export const savePricing = internalMutation({
  args: {
    itemId: v.id("items"),
    estimatedLow: v.number(),
    estimatedHigh: v.number(),
    recommendedPrice: v.number(),
    rationale: v.string(),
    sources: v.array(researchSourceValidator),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get("items", args.itemId);
    if (item === null) return null;

    await ctx.db.patch("items", args.itemId, {
      estimatedLow: args.estimatedLow,
      estimatedHigh: args.estimatedHigh,
      recommendedPrice: args.recommendedPrice,
      pricingRationale: args.rationale,
      researchSources: args.sources,
      researchStatus: "ready_for_review",
    });

    await recordActivity(ctx, {
      cleanoutId: item.cleanoutId,
      itemId: item._id,
      type: "research_completed",
      message: `Priced ${item.name} at $${args.recommendedPrice}`,
    });

    return null;
  },
});

export const markResearchFailed = internalMutation({
  args: { itemId: v.id("items"), error: v.string() },
  handler: async (ctx, args) => {
    const item = await ctx.db.get("items", args.itemId);
    if (item === null) return null;

    await ctx.db.patch("items", args.itemId, {
      researchStatus: "failed",
      researchError: args.error.slice(0, 300),
    });

    await recordActivity(ctx, {
      cleanoutId: item.cleanoutId,
      itemId: item._id,
      type: "research_failed",
      message: `Couldn't price ${item.name}: ${args.error.slice(0, 140)}`,
    });

    return null;
  },
});

/**
 * Runs each queued item's selling agent independently: identify, then price.
 * A failure at either stage fails only that item — every other item in the
 * batch keeps going, mirroring masks.ts's refineCleanout.
 */
export const researchCleanout = internalAction({
  args: { cleanoutId: v.id("cleanouts"), itemIds: v.array(v.id("items")) },
  handler: async (ctx, args) => {
    const context: {
      imageUrl: string | null;
      items: {
        _id: Id<"items">;
        name: string;
        category: string;
        detectionBox: { x: number; y: number; width: number; height: number };
      }[];
    } | null = await ctx.runQuery(internal.research.contextForResearch, {
      cleanoutId: args.cleanoutId,
      itemIds: args.itemIds,
    });

    if (context === null || context.items.length === 0) return null;

    const failAll = async (reason: string) => {
      for (const item of context.items) {
        await ctx.runMutation(internal.research.markResearchFailed, {
          itemId: item._id,
          error: reason,
        });
      }
    };

    if (context.imageUrl === null) {
      await failAll("The source photo could not be read from storage.");
      return null;
    }
    const imageUrl = context.imageUrl;

    const openaiKey = env.OPENAI_API_KEY?.trim();
    const firecrawlKey = env.FIRECRAWL_API_KEY?.trim();
    const model = env.OPENAI_VISION_MODEL?.trim() || undefined;

    if (!openaiKey) {
      await failAll("OPENAI_API_KEY is not set in the Convex environment.");
      return null;
    }
    if (!firecrawlKey) {
      await failAll("FIRECRAWL_API_KEY is not set in the Convex environment.");
      return null;
    }

    const processOne = async (item: (typeof context.items)[number]) => {
      try {
        await ctx.runMutation(internal.research.setStatus, {
          itemId: item._id,
          status: "identifying",
        });

        const identification: IdentificationResult = await withRetry(() =>
          identifyItem({
            apiKey: openaiKey,
            model,
            imageUrl,
            box: item.detectionBox,
            hintLabel: item.name,
            hintCategory: item.category,
          }),
        );

        await ctx.runMutation(internal.research.saveIdentification, {
          itemId: item._id,
          identification,
        });

        const pricing = await withRetry(() =>
          priceItem({
            firecrawlApiKey: firecrawlKey,
            openaiApiKey: openaiKey,
            model,
            identification,
          }),
        );

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

    const queue = [...context.items];
    const workers = Array.from(
      { length: Math.min(RESEARCH_CONCURRENCY, queue.length) },
      async () => {
        for (;;) {
          const next = queue.shift();
          if (next === undefined) return;
          await processOne(next);
        }
      },
    );
    await Promise.allSettled(workers);

    return null;
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/research.ts
git commit -m "feat: add Phase 4 research orchestrator (identify + price per item)"
```

---

### Task 5: Wire the Continue button and add the top-of-page progress bar

**Files:**
- Create: `src/components/ResearchStatusBar.tsx`
- Modify: `src/components/CanvasToolbar.tsx`
- Modify: `src/components/Workspace.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `WorkspaceItem` type from `@/lib/geometry` (existing — automatically includes the new schema fields via `Doc<"items">`); `api.research.startResearch` from Task 4.
- Produces: `ResearchStatusBar` default export, `{ items: WorkspaceItem[] }` props. `CanvasToolbar` gains `researching: boolean` and `onContinue: () => void` props. `Workspace` gains `onContinue: () => void` prop.

- [ ] **Step 1: Create `src/components/ResearchStatusBar.tsx`**

```tsx
import type { WorkspaceItem } from "@/lib/geometry";

type Props = { items: WorkspaceItem[] };

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued…",
  identifying: "Identifying…",
  researching: "Researching prices…",
};

export default function ResearchStatusBar({ items }: Props) {
  const active = items.filter((item) => item.researchStatus !== undefined);
  if (active.length === 0) return null;

  const working = active.filter(
    (item) =>
      item.researchStatus === "queued" ||
      item.researchStatus === "identifying" ||
      item.researchStatus === "researching",
  ).length;

  return (
    <div className="surface px-5 py-4">
      <p className="text-sm font-medium text-ink">
        {working > 0
          ? `${working} ${working === 1 ? "agent" : "agents"} working`
          : "Research complete"}
      </p>
      <ul className="mt-3 space-y-1.5">
        {active.map((item) => (
          <li
            key={item._id}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-ink-soft">{item.name}</span>
            <span className="text-muted">
              {item.researchStatus === "ready_for_review"
                ? item.estimatedLow !== undefined && item.estimatedHigh !== undefined
                  ? `$${item.estimatedLow}–${item.estimatedHigh} ✓`
                  : "Priced ✓"
                : item.researchStatus === "failed"
                  ? "Couldn't price this"
                  : (STATUS_LABEL[item.researchStatus ?? ""] ?? "")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Add `researching`/`onContinue` to `CanvasToolbar`**

In `src/components/CanvasToolbar.tsx`, update the `Props` type (add two fields) and the accent button:

```ts
type Props = {
  total: number;
  selectedCount: number;
  drawing: boolean;
  researching: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleDrawing: () => void;
  onContinue: () => void;
};
```

```tsx
export default function CanvasToolbar({
  total,
  selectedCount,
  drawing,
  researching,
  onSelectAll,
  onClear,
  onToggleDrawing,
  onContinue,
}: Props) {
```

Replace the final button (currently `<Button variant="accent" className="ml-1.5" disabled={selectedCount === 0}>...`) with:

```tsx
        <Button
          variant="accent"
          className="ml-1.5"
          disabled={selectedCount === 0 || researching}
          onClick={onContinue}
        >
          {researching ? "Researching…" : `Continue with ${selectedCount}`}
          <ArrowRight className="size-4" strokeWidth={2.25} />
        </Button>
```

- [ ] **Step 3: Wire `Workspace.tsx`**

Add the import at the top:

```ts
import ResearchStatusBar from "@/components/ResearchStatusBar";
```

Add `onContinue: () => void;` to the `Props` type, and destructure it in the function signature.

Right after the line computing `const selectedCount = ...` (currently line 100), add:

```ts
  const researching = items.some(
    (item) =>
      item.selected &&
      (item.researchStatus === "queued" ||
        item.researchStatus === "identifying" ||
        item.researchStatus === "researching"),
  );
```

Change the main return (currently starting `return (\n    <div className="grid gap-7 pt-3 ...` at line 102-103) to wrap the grid and put the status bar above it, full width:

```tsx
  return (
    <div className="space-y-5 pt-3">
      <ResearchStatusBar items={items} />
      <div className="grid gap-7 lg:grid-cols-[minmax(0,2.05fr)_minmax(0,1fr)] lg:gap-8">
```

(the grid's children stay exactly as they are — only the opening tag loses `pt-3` since it moved to the new wrapper div, and the return statement needs one more closing `</div>` before the final `);`).

Pass the two new props to `CanvasToolbar`:

```tsx
            <CanvasToolbar
              total={items.length}
              selectedCount={selectedCount}
              drawing={drawing}
              researching={researching}
              onSelectAll={onSelectAll}
              onClear={onClear}
              onToggleDrawing={onToggleDrawing}
              onContinue={onContinue}
            />
```

- [ ] **Step 4: Wire `App.tsx`**

Add the mutation hook near the other `useMutation` calls:

```ts
  const startResearch = useMutation(api.research.startResearch);
```

Pass `onContinue` into `<Workspace .../>` (alongside the other handlers):

```tsx
                onContinue={() =>
                  void startResearch({ cleanoutId: workspace.cleanout._id })
                }
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ResearchStatusBar.tsx src/components/CanvasToolbar.tsx src/components/Workspace.tsx src/App.tsx
git commit -m "feat: wire Continue button to Phase 4 research and add progress bar"
```

---

### Task 6: Right panel — identification, pricing, market comparisons

**Files:**
- Modify: `src/components/DetailPanel.tsx`

**Interfaces:**
- Consumes: `WorkspaceItem` (now carrying `researchStatus`, `researchError`, `identification`, `estimatedLow`, `estimatedHigh`, `recommendedPrice`, `researchSources` from Task 1's schema change).

- [ ] **Step 1: Import `Loader2`**

Add `Loader2` to the existing lucide-react import at the top of `src/components/DetailPanel.tsx`:

```ts
import { ChevronLeft, Loader2, PackageOpen, Pencil, Trash2 } from "lucide-react";
```

- [ ] **Step 2: Replace the "Estimated value" block in `ItemDetail`**

Replace this existing block (currently lines 252-259):

```tsx
      <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
        <span className="text-sm text-muted">Estimated value</span>
        <span className="text-sm font-medium text-muted">
          {item.estimatedLow !== undefined && item.estimatedHigh !== undefined
            ? `$${item.estimatedLow}–$${item.estimatedHigh}`
            : "—"}
        </span>
      </div>
```

with:

```tsx
      {item.researchStatus &&
        item.researchStatus !== "ready_for_review" &&
        item.researchStatus !== "failed" && (
          <p className="mt-4 flex items-center gap-2 border-t border-line pt-4 text-sm text-muted">
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            {item.researchStatus === "queued" && "Queued for resale research…"}
            {item.researchStatus === "identifying" && "Identifying this item…"}
            {item.researchStatus === "researching" && "Researching resale prices…"}
          </p>
        )}

      {item.researchStatus === "failed" && (
        <p className="mt-4 border-t border-line pt-4 text-sm text-muted">
          Couldn't estimate resale value{item.researchError ? `: ${item.researchError}` : "."}
        </p>
      )}

      {item.identification && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Identification confidence</span>
            <span className="text-sm font-medium text-ink capitalize">
              {item.identification.confidence}
            </span>
          </div>
          {(item.identification.brand || item.identification.model) && (
            <p className="mt-1 text-xs text-muted">
              {[item.identification.brand, item.identification.model]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
        <span className="text-sm text-muted">Estimated resale</span>
        <span className="text-sm font-medium text-muted">
          {item.estimatedLow !== undefined && item.estimatedHigh !== undefined
            ? `$${item.estimatedLow}–$${item.estimatedHigh}`
            : "—"}
        </span>
      </div>

      {item.recommendedPrice !== undefined && (
        <div className="flex items-baseline justify-between pt-1.5">
          <span className="text-sm text-muted">Recommended</span>
          <span className="text-sm font-semibold text-ink">
            ${item.recommendedPrice}
          </span>
        </div>
      )}

      {item.researchSources && item.researchSources.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            {item.researchSources.length} market{" "}
            {item.researchSources.length === 1 ? "comparison" : "comparisons"}
          </p>
          <ul className="mt-2 space-y-2">
            {item.researchSources.map((source, index) => (
              <li key={index} className="rounded-lg bg-canvas px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink">{source.source}</span>
                  <span className="text-xs font-medium text-ink">{source.price}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{source.description}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/DetailPanel.tsx
git commit -m "feat: show identification, pricing and market comparisons in detail panel"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Confirm the Convex environment actually has both keys**

Use the `mcp__plugin_convex_convex__envList` tool (or `npx convex env list`) against the dev deployment. Expected: `OPENAI_API_KEY` and `FIRECRAWL_API_KEY` both present. If either is missing, stop and ask the user — Task 4's `researchCleanout` will fail every item with a clear message rather than silently doing nothing, but real API testing needs both keys set.

- [ ] **Step 2: Run the app locally**

Run: `npx convex dev` (background) and `npm run dev` (background).
Expected: both start cleanly, no schema push errors (confirms Task 1's schema change deployed).

- [ ] **Step 3: Drive the golden path in a browser**

Load the demo room (or upload a photo with at least 3 different sellable object categories, e.g. electronics + furniture + an instrument, per the spec's "run on at least three item categories"). Select 3+ items, click "Continue with N". Confirm:
- The button switches to a disabled "Researching…" state immediately.
- The `ResearchStatusBar` appears at the top of the page (above both columns) showing "`N` agents working" and one line per item.
- Each item's line moves through the state labels and settles on either `$low–high ✓` or "Couldn't price this".
- Clicking an item once it's `ready_for_review` shows: the refined name as the headline, "Identification confidence", "Estimated resale $low–$high", "Recommended $price", and up to "3 market comparisons" as source cards (source / price / description, no raw scraped text dumped).

- [ ] **Step 4: Confirm persistence and isolation via Convex data**

Use `mcp__plugin_convex_convex__data` (or `mcp__plugin_convex_convex__runOneoffQuery`) against the dev deployment to read a few `items` rows for the cleanout just researched. Expected: `researchSources` is a non-empty array (when Firecrawl found results) with `source`/`price`/`description`/`url` fields — confirms Firecrawl results are actually persisted, not just shown transiently in the browser.

If any item ended up `researchStatus: "failed"`, confirm the *other* items in the same batch still reached `"ready_for_review"` — this is the "one item's failure does not block other agents" requirement. If none failed naturally, this is also acceptable to conclude from code review of Task 4's `processOne`'s per-item try/catch (no shared state or early-return between items in the worker loop).

- [ ] **Step 5: Reload and check the activity timeline**

Reload the page. Expected: the workspace reloads with the same `researchStatus`/`identification`/pricing fields already on the items (proves "reload keeps results" — no client-only state was needed). Check the Activity panel in the right sidebar: expect to see the `research_started` message, and one `research_completed` (or `research_failed`) message per researched item.

- [ ] **Step 6: Full build**

Run: `npm run build`
Expected: `tsc --noEmit && vite build` both succeed with no errors.

- [ ] **Step 7: Report results to the user**

Summarize what was tested, any item that failed and why, and stop — per the spec, "Stop after Phase 4." Do not commit further, deploy, or move to a Phase 5.
