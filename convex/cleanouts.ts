import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { recordActivity } from "./activity";
import { requireOwnedCleanout, requireUserId } from "./access";

const MAX_TITLE_LENGTH = 80;

/** How many rooms the rail shows. There is no pagination behind it. */
const ROOM_LIMIT = 30;

/** Statuses a listing can still be changed or discarded from — nothing here
 *  has reached eBay. Mirrors `canPublish` on the client. */
const EDITABLE_LISTING_STATUSES: Doc<"listings">["status"][] = [
  "draft",
  "approved",
  "failed",
];

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

/** Drops a room's detected items and the masks stored for them. */
async function deleteItems(ctx: MutationCtx, cleanoutId: Id<"cleanouts">) {
  const existing = await ctx.db
    .query("items")
    .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", cleanoutId))
    .take(100);
  for (const item of existing) {
    if (item.maskStorageId !== undefined) {
      await ctx.storage.delete(item.maskStorageId);
    }
    await ctx.db.delete("items", item._id);
  }
}

/** Re-runs detection on a cleanout that failed or found nothing. */
export const retryAnalysis = mutation({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const cleanout = await requireOwnedCleanout(ctx, args.cleanoutId);
    if (cleanout.imageStorageId === undefined) {
      throw new Error("This cleanout has no image to analyse");
    }

    await deleteItems(ctx, args.cleanoutId);

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
 * Swaps the photo of an existing room and scans the new one, so "Change photo"
 * stays in the thread rather than starting a new one. Everything derived from
 * the old photo goes with it — items, masks and any drafts written from them.
 */
export const replaceImage = mutation({
  args: {
    cleanoutId: v.id("cleanouts"),
    storageId: v.id("_storage"),
    imageWidth: v.optional(v.number()),
    imageHeight: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cleanout = await requireOwnedCleanout(ctx, args.cleanoutId);

    const listings = await ctx.db
      .query("listings")
      .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", args.cleanoutId))
      .take(50);

    // A listing that has already reached the marketplace describes an object in
    // the old photo. Deleting it here would orphan a real eBay listing, so the
    // swap is refused instead.
    if (listings.some((listing) => !EDITABLE_LISTING_STATUSES.includes(listing.status))) {
      throw new Error(
        "This room already has listings on eBay. Start a new room for a different photo.",
      );
    }
    for (const listing of listings) {
      await ctx.db.delete("listings", listing._id);
    }

    await deleteItems(ctx, args.cleanoutId);

    if (cleanout.imageStorageId !== undefined) {
      await ctx.storage.delete(cleanout.imageStorageId);
    }

    await ctx.db.patch("cleanouts", args.cleanoutId, {
      imageStorageId: args.storageId,
      imageWidth: args.imageWidth,
      imageHeight: args.imageHeight,
      status: "analyzing",
      selectedCount: 0,
      error: undefined,
      // The seeded objects are gone, so this is an ordinary room now. Leaving
      // the flag set would keep authorising simulated offers on real listings.
      isDemo: undefined,
      provider: undefined,
    });

    await recordActivity(ctx, {
      cleanoutId: args.cleanoutId,
      type: "detection_started",
      message: "Scanning the new photo…",
    });

    await ctx.scheduler.runAfter(0, internal.detection.analyze, {
      cleanoutId: args.cleanoutId,
    });

    return null;
  },
});

/** Renames a room. The rail shows this title. */
export const rename = mutation({
  args: { cleanoutId: v.id("cleanouts"), title: v.string() },
  handler: async (ctx, args) => {
    const title = args.title.trim().slice(0, MAX_TITLE_LENGTH);
    if (title.length === 0) throw new Error("A room needs a name");

    const cleanout = await requireOwnedCleanout(ctx, args.cleanoutId);
    if (cleanout.title === title) return null;

    await ctx.db.patch("cleanouts", cleanout._id, { title });

    return null;
  },
});

/**
 * Every room the caller owns, newest first — one row per thread in the rail.
 * Returns tallies rather than documents: the rail only needs enough to label a
 * room and say where its sale stands, and the open room is read separately.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    const rooms = await ctx.db
      .query("cleanouts")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(ROOM_LIMIT);

    return await Promise.all(
      rooms.map(async (room) => {
        const [items, listings] = await Promise.all([
          ctx.db
            .query("items")
            .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", room._id))
            .take(50),
          ctx.db
            .query("listings")
            .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", room._id))
            .take(50),
        ]);

        const countOf = (...statuses: Doc<"listings">["status"][]) =>
          listings.filter((listing) => statuses.includes(listing.status)).length;

        return {
          _id: room._id,
          title: room.title,
          status: room.status,
          isDemo: room.isDemo === true,
          createdAt: room.createdAt,
          itemCount: items.length,
          selectedCount: items.filter((item) => item.selected).length,
          researching: items.some((item) =>
            ["queued", "identifying", "researching"].includes(item.researchStatus ?? ""),
          ),
          listings: {
            // Everything still editable, whether never approved or failed to publish.
            reviewable: countOf("draft", "approved", "failed"),
            publishing: countOf("publishing"),
            live: countOf("live", "listed"),
            sold: countOf("sold"),
            ended: countOf("ended"),
          },
        };
      }),
    );
  },
});

/**
 * The whole workspace in one reactive read: one of the caller's cleanouts, its
 * signed image URL, its items and its listings. Defaults to the most recent
 * room, which is what a fresh visit should land on.
 */
export const workspace = query({
  args: { cleanoutId: v.optional(v.id("cleanouts")) },
  handler: async (ctx, args) => {
    if (args.cleanoutId !== undefined) {
      return await loadWorkspace(ctx, await requireOwnedCleanout(ctx, args.cleanoutId));
    }

    const userId = await requireUserId(ctx);
    const cleanout = await ctx.db
      .query("cleanouts")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .first();

    return cleanout === null ? null : await loadWorkspace(ctx, cleanout);
  },
});

async function loadWorkspace(ctx: QueryCtx, cleanout: Doc<"cleanouts">) {
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
}
