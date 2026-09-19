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
