import { v, type Infer } from "convex/values";
import { query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { activityType } from "./schema";
import { requireOwnedCleanout } from "./access";

/**
 * Shared writer used by every mutation that should leave a trace. Not a Convex
 * function — plain helpers in `convex/` are ignored by function registration.
 */
export async function recordActivity(
  ctx: MutationCtx,
  entry: {
    cleanoutId: Id<"cleanouts">;
    itemId?: Id<"items">;
    type: Infer<typeof activityType>;
    message: string;
  },
) {
  await ctx.db.insert("activity", { ...entry, createdAt: Date.now() });
}

export const list = query({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    await requireOwnedCleanout(ctx, args.cleanoutId);

    return await ctx.db
      .query("activity")
      .withIndex("by_cleanoutId_and_createdAt", (q) =>
        q.eq("cleanoutId", args.cleanoutId),
      )
      .order("desc")
      .take(30);
  },
});
