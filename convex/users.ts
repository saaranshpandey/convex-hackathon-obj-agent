import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const user = await ctx.db.get("users", userId);
    if (user === null) return null;

    return {
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
    };
  },
});
