import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getMaskRefiner, SegmentationError } from "./segmentation";

/** How many masks may be in flight at once, per fal's account concurrency. */
const MASK_CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [400, 1200];

/** Throttling and transient locks are worth another try; bad input is not. */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof SegmentationError)) return false;
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
 * Second stage of detection: turns each detection box into a precise mask.
 *
 * Deliberately decoupled from cleanout status. Objects are already interactive
 * by the time this runs, every object is refined concurrently, and a failure
 * on one object only means that object keeps its box.
 */

export const pendingForCleanout = internalQuery({
  args: {
    cleanoutId: v.id("cleanouts"),
    itemIds: v.optional(v.array(v.id("items"))),
  },
  handler: async (ctx, args) => {
    const cleanout = await ctx.db.get("cleanouts", args.cleanoutId);
    if (cleanout === null) return null;

    const all = await ctx.db
      .query("items")
      .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", args.cleanoutId))
      .take(50);

    const wanted = args.itemIds ? new Set<string>(args.itemIds) : null;
    const items = all
      .filter((item) => (wanted ? wanted.has(item._id) : true))
      .filter((item) => item.maskStatus === "pending")
      .flatMap((item) =>
        item.detectionBox
          ? [{ _id: item._id, detectionBox: item.detectionBox }]
          : [],
      );

    return {
      imageUrl: cleanout.imageStorageId
        ? await ctx.storage.getUrl(cleanout.imageStorageId)
        : null,
      imageWidth: cleanout.imageWidth ?? null,
      imageHeight: cleanout.imageHeight ?? null,
      items,
    };
  },
});

export const markProcessing = internalMutation({
  args: { itemIds: v.array(v.id("items")) },
  handler: async (ctx, args) => {
    for (const itemId of args.itemIds) {
      const item = await ctx.db.get("items", itemId);
      if (item !== null && item.maskStatus === "pending") {
        await ctx.db.patch("items", itemId, { maskStatus: "processing" });
      }
    }
    return null;
  },
});

export const setMask = internalMutation({
  args: {
    itemId: v.id("items"),
    maskStorageId: v.id("_storage"),
    provider: v.string(),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get("items", args.itemId);
    if (item === null) {
      // The item was deleted mid-refinement; don't orphan the stored mask.
      await ctx.storage.delete(args.maskStorageId);
      return null;
    }

    // Replace rather than accumulate if this item is refined twice.
    if (item.maskStorageId !== undefined) {
      await ctx.storage.delete(item.maskStorageId);
    }

    await ctx.db.patch("items", args.itemId, {
      maskStorageId: args.maskStorageId,
      maskStatus: "ready",
      maskError: undefined,
      maskLatencyMs: args.latencyMs,
      segmentationProvider: args.provider,
    });

    return null;
  },
});

export const setMaskFailed = internalMutation({
  args: {
    itemId: v.id("items"),
    error: v.string(),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get("items", args.itemId);
    if (item === null) return null;

    await ctx.db.patch("items", args.itemId, {
      maskStatus: "failed",
      maskError: args.error.slice(0, 300),
      maskLatencyMs: args.latencyMs,
    });

    return null;
  },
});

export const refineCleanout = internalAction({
  args: {
    cleanoutId: v.id("cleanouts"),
    itemIds: v.optional(v.array(v.id("items"))),
  },
  handler: async (ctx, args) => {
    const info = await ctx.runQuery(internal.masks.pendingForCleanout, {
      cleanoutId: args.cleanoutId,
      itemIds: args.itemIds,
    });

    if (info === null || info.items.length === 0) return null;

    const failAll = async (reason: string) => {
      for (const item of info.items) {
        await ctx.runMutation(internal.masks.setMaskFailed, {
          itemId: item._id,
          error: reason,
        });
      }
    };

    if (info.imageUrl === null) {
      await failAll("The source photo could not be read from storage.");
      return null;
    }
    if (info.imageWidth === null || info.imageHeight === null) {
      await failAll("Image dimensions are unknown, so no box prompt could be built.");
      return null;
    }

    let refiner;
    try {
      refiner = getMaskRefiner();
    } catch (error) {
      await failAll(
        error instanceof Error ? error.message : "Mask refinement is misconfigured.",
      );
      return null;
    }

    if (refiner === null) {
      await failAll("Mask refinement is not configured.");
      return null;
    }

    await ctx.runMutation(internal.masks.markProcessing, {
      itemIds: info.items.map((item) => item._id),
    });

    const imageUrl = info.imageUrl;
    const imageWidth = info.imageWidth;
    const imageHeight = info.imageHeight;
    const activeRefiner = refiner;

    const refineOne = async (item: (typeof info.items)[number]) => {
      const started = Date.now();
      try {
        const result = await withRetry(() =>
          activeRefiner.refine({
            imageUrl,
            box: item.detectionBox,
            imageWidth,
            imageHeight,
          }),
        );

        const storageId = await ctx.storage.store(
          new Blob([result.bytes], { type: result.contentType }),
        );

        await ctx.runMutation(internal.masks.setMask, {
          itemId: item._id,
          maskStorageId: storageId,
          provider: activeRefiner.name,
          latencyMs: Date.now() - started,
        });
      } catch (error) {
        await ctx.runMutation(internal.masks.setMaskFailed, {
          itemId: item._id,
          error:
            error instanceof Error
              ? error.message
              : "Mask refinement failed for an unknown reason.",
          latencyMs: Date.now() - started,
        });
      }
    };

    // Concurrent, but bounded. Firing every object at once trips fal's
    // per-account concurrency cap, which comes back as an instant 403 and
    // loses most of the masks on a busy photo.
    const queue = [...info.items];
    const workers = Array.from(
      { length: Math.min(MASK_CONCURRENCY, queue.length) },
      async () => {
        for (;;) {
          const next = queue.shift();
          if (next === undefined) return;
          await refineOne(next);
        }
      },
    );
    await Promise.allSettled(workers);

    return null;
  },
});
