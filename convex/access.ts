import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/** MutationCtx is a superset of QueryCtx, so these helpers work in both. */
type ReadCtx = Pick<QueryCtx, "auth" | "db">;

const NOT_FOUND = "Not found";

export async function requireUserId(ctx: Pick<QueryCtx, "auth">): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in required");
  return userId;
}

export async function requireOwnedCleanout(
  ctx: ReadCtx,
  cleanoutId: Id<"cleanouts">,
): Promise<Doc<"cleanouts">> {
  const userId = await requireUserId(ctx);
  const cleanout = await ctx.db.get("cleanouts", cleanoutId);
  if (cleanout === null || cleanout.userId !== userId) throw new Error(NOT_FOUND);
  return cleanout;
}

export async function requireOwnedItem(ctx: ReadCtx, itemId: Id<"items">) {
  const item = await ctx.db.get("items", itemId);
  if (item === null) throw new Error(NOT_FOUND);
  const cleanout = await requireOwnedCleanout(ctx, item.cleanoutId);
  return { item, cleanout };
}

export async function requireOwnedListing(ctx: ReadCtx, listingId: Id<"listings">) {
  const listing = await ctx.db.get("listings", listingId);
  if (listing === null) throw new Error(NOT_FOUND);
  const cleanout = await requireOwnedCleanout(ctx, listing.cleanoutId);
  return { listing, cleanout };
}

export async function requireOwnedOffer(ctx: ReadCtx, offerId: Id<"offers">) {
  const offer = await ctx.db.get("offers", offerId);
  if (offer === null) throw new Error(NOT_FOUND);
  const { listing, cleanout } = await requireOwnedListing(ctx, offer.listingId);
  return { offer, listing, cleanout };
}
