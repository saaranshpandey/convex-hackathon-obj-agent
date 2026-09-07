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
