import { v } from "convex/values";
import { mutation } from "./_generated/server";

/**
 * Developer helper: wipes everything belonging to one session, including the
 * stored images. Exposed in the UI only when running the dev server.
 */
export const resetDemoData = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const cleanouts = await ctx.db
      .query("cleanouts")
      .withIndex("by_userId_and_createdAt", (q) =>
        q.eq("userId", args.sessionId),
      )
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

