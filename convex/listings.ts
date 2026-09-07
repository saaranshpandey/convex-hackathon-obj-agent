import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { listingCondition } from "./schema";

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
