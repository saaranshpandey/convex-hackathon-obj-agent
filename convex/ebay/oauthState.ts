import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** A random single-use code that stands in for the user across eBay's redirect. */
export async function issueOauthState(
  ctx: MutationCtx,
  userId: Id<"users">,
  postalCode?: string,
): Promise<string> {
  const nonce = crypto.randomUUID();
  await ctx.db.insert("ebayOauthStates", {
    nonce,
    userId,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    postalCode,
  });
  return nonce;
}

/** Deletes the code whether or not it is still valid, so a link can never be replayed. */
export async function consumeOauthState(
  ctx: MutationCtx,
  nonce: string,
  now: number,
): Promise<{ userId: Id<"users">; postalCode: string | null } | null> {
  const row = await ctx.db
    .query("ebayOauthStates")
    .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
    .unique();
  if (row === null) return null;

  await ctx.db.delete("ebayOauthStates", row._id);
  if (row.expiresAt < now) return null;
  return { userId: row.userId, postalCode: row.postalCode ?? null };
}
