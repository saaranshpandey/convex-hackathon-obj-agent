import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { recordActivity } from "./activity";
import { boxValidator, pointValidator } from "./schema";
import {
  getMaskRefiner,
  getSegmentationProvider,
  toBoundingBox,
  toPolygon,
} from "./segmentation";

/** Objects reveal one after another; `ready` lands once the last one has. */
const REVEAL_BASE_MS = 500;
const REVEAL_MS_PER_ITEM = 90;

export const imageForAnalysis = internalQuery({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const cleanout = await ctx.db.get("cleanouts", args.cleanoutId);
    if (cleanout === null) return null;

    return {
      imageUrl: cleanout.imageStorageId
        ? await ctx.storage.getUrl(cleanout.imageStorageId)
        : null,
    };
  },
});

/**
 * Orchestrates one scan. Knows nothing about which model runs — that is the
 * segmentation module's business.
 */
export const analyze = internalAction({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const info = await ctx.runQuery(internal.detection.imageForAnalysis, {
      cleanoutId: args.cleanoutId,
    });

    // Cleanout was deleted while the scan was queued.
    if (info === null) return null;

    if (info.imageUrl === null) {
      await ctx.runMutation(internal.detection.markFailed, {
        cleanoutId: args.cleanoutId,
        error: "The uploaded photo could not be read back from storage.",
      });
      return null;
    }

    try {
      const provider = getSegmentationProvider();

      const started = Date.now();
      const detected = await provider.segmentImage(info.imageUrl);
      const detectionLatencyMs = Date.now() - started;

      const objects = detected
        .map((object) => ({
          label: object.label,
          confidence: object.confidence,
          category: object.category,
          polygon: toPolygon(object),
          detectionBox: toBoundingBox(object),
        }))
        .filter((object) => object.polygon.length >= 3);

      // Refinement being unavailable is not a detection failure.
      let refineMasks = false;
      try {
        refineMasks = getMaskRefiner() !== null;
      } catch {
        refineMasks = false;
      }

      await ctx.runMutation(internal.detection.saveObjects, {
        cleanoutId: args.cleanoutId,
        provider: provider.name,
        detectionLatencyMs,
        promptTokens: provider.lastUsage?.promptTokens,
        completionTokens: provider.lastUsage?.completionTokens,
        refineMasks,
        objects,
      });
    } catch (error) {
      await ctx.runMutation(internal.detection.markFailed, {
        cleanoutId: args.cleanoutId,
        error:
          error instanceof Error
            ? error.message
            : "Detection failed for an unknown reason.",
      });
    }

    return null;
  },
});

export const saveObjects = internalMutation({
  args: {
    cleanoutId: v.id("cleanouts"),
    provider: v.string(),
    detectionLatencyMs: v.optional(v.number()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    refineMasks: v.optional(v.boolean()),
    objects: v.array(
      v.object({
        label: v.string(),
        confidence: v.number(),
        category: v.string(),
        polygon: v.array(pointValidator),
        detectionBox: boxValidator,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const cleanout = await ctx.db.get("cleanouts", args.cleanoutId);
    if (cleanout === null) return null;

    // A scan replaces whatever the previous scan produced. Clearing here rather
    // than relying on the caller keeps selectedCount and the item rows in step.
    const previous = await ctx.db
      .query("items")
      .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", args.cleanoutId))
      .take(100);
    for (const item of previous) {
      if (item.maskStorageId !== undefined) {
        await ctx.storage.delete(item.maskStorageId);
      }
      await ctx.db.delete("items", item._id);
    }

    const refine = args.refineMasks ?? false;
    const now = Date.now();

    for (const object of args.objects) {
      await ctx.db.insert("items", {
        cleanoutId: args.cleanoutId,
        name: object.label,
        category: object.category,
        selected: true,
        confidence: object.confidence,
        polygon: object.polygon,
        detectionBox: object.detectionBox,
        source: "detected",
        status: "detected",
        maskStatus: refine ? "pending" : "failed",
        maskError: refine ? undefined : "Mask refinement is not configured.",
        createdAt: now,
      });
    }

    await ctx.db.patch("cleanouts", args.cleanoutId, {
      status: "objects_found",
      selectedCount: args.objects.length,
      provider: args.provider,
      detectionLatencyMs: args.detectionLatencyMs,
      detectionPromptTokens: args.promptTokens,
      detectionCompletionTokens: args.completionTokens,
      error: undefined,
    });

    await recordActivity(ctx, {
      cleanoutId: args.cleanoutId,
      type: "detection_completed",
      message:
        args.objects.length === 0
          ? "Couldn’t find anything sellable in this photo"
          : `Found ${args.objects.length} ${args.objects.length === 1 ? "thing" : "things"} worth selling`,
    });

    await ctx.scheduler.runAfter(
      REVEAL_BASE_MS + args.objects.length * REVEAL_MS_PER_ITEM,
      internal.detection.finalize,
      { cleanoutId: args.cleanoutId },
    );

    // Runs alongside the reveal; nothing downstream waits on it.
    if (refine && args.objects.length > 0) {
      await ctx.scheduler.runAfter(0, internal.masks.refineCleanout, {
        cleanoutId: args.cleanoutId,
      });
    }

    return null;
  },
});

export const finalize = internalMutation({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const cleanout = await ctx.db.get("cleanouts", args.cleanoutId);
    if (cleanout === null) return null;

    // A retry may have moved the cleanout on since this was scheduled.
    if (cleanout.status !== "objects_found") return null;

    await ctx.db.patch("cleanouts", args.cleanoutId, { status: "ready" });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { cleanoutId: v.id("cleanouts"), error: v.string() },
  handler: async (ctx, args) => {
    const cleanout = await ctx.db.get("cleanouts", args.cleanoutId);
    if (cleanout === null) return null;

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
