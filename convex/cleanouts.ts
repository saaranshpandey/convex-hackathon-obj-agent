import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { recordActivity } from "./activity";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Opens a cleanout before the bytes are uploaded, so the workspace can render
 * an "uploading" state instead of a blank screen while the photo travels.
 */
export const start = mutation({
  args: { sessionId: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    const cleanoutId = await ctx.db.insert("cleanouts", {
      userId: args.sessionId,
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
    const cleanout = await ctx.db.get("cleanouts", args.cleanoutId);
    if (cleanout === null) throw new Error("Cleanout not found");
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
 * The whole workspace in one reactive read: the most recent cleanout for this
 * session, its signed image URL, and its items.
 */
export const latestForSession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const cleanout = await ctx.db
      .query("cleanouts")
      .withIndex("by_userId_and_createdAt", (q) =>
        q.eq("userId", args.sessionId),
      )
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

    return { cleanout, imageUrl, items: withMasks };
  },
});
