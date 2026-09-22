import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Operator tooling, run from the CLI (`npx convex run internal.admin.…`).
 *
 * Internal on purpose: these take the account as an argument instead of reading
 * it from the caller, so they must never be reachable from a client.
 */

/** A listing in one of these reached eBay; deleting the row doesn't end it there. */
const ON_EBAY: Doc<"listings">["status"][] = [
  "live",
  "publishing",
  "sold",
  "ended",
  "listed",
];

/**
 * Looks the account up by address. `users` comes from authTables and carries no
 * email index, so this reads the table and matches in memory rather than adding
 * an index to the auth schema for one operator command.
 */
async function roomsFor(
  ctx: MutationCtx,
  email: string,
): Promise<{ userId: Id<"users">; rooms: Doc<"cleanouts">[] }> {
  const wanted = email.trim().toLowerCase();
  const users = await ctx.db.query("users").take(1000);
  const matches = users.filter((user) => user.email?.toLowerCase() === wanted);

  if (matches.length === 0) throw new Error("No user with that email address");
  if (matches.length > 1) {
    throw new Error(`${matches.length} users share that email; refusing to guess`);
  }

  const rooms = await ctx.db
    .query("cleanouts")
    .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", matches[0]._id))
    .take(200);

  return { userId: matches[0]._id, rooms };
}

/**
 * Deletes every room belonging to one account and everything hanging off it:
 * items and their masks, the room photo, activity, listings, and each listing's
 * offers and agent messages.
 *
 * `dev.resetDemoData` predates listings and leaves listings, offers and agent
 * messages orphaned, which is why this exists separately.
 *
 * Counts without deleting unless `apply` is true, so the damage reads first.
 */
export const deleteRoomsForEmail = internalMutation({
  args: {
    email: v.string(),
    /** Omitted or false: report what would go, change nothing. */
    apply: v.optional(v.boolean()),
    /**
     * Rooms holding a listing that reached eBay are skipped by default —
     * deleting the row here leaves a real listing live on eBay with nothing
     * pointing at it. Pass true only once those listings are ended on eBay.
     */
    includeListingsOnEbay: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const apply = args.apply === true;
    const { rooms } = await roomsFor(ctx, args.email);

    const summary = {
      apply,
      roomsFound: rooms.length,
      roomsDeleted: 0,
      titles: [] as string[],
      items: 0,
      masks: 0,
      photos: 0,
      activity: 0,
      listings: 0,
      offers: 0,
      agentMessages: 0,
      skipped: [] as string[],
    };

    for (const room of rooms) {
      const listings = await ctx.db
        .query("listings")
        .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", room._id))
        .take(200);

      const onEbay = listings.filter((listing) => ON_EBAY.includes(listing.status));
      if (onEbay.length > 0 && args.includeListingsOnEbay !== true) {
        summary.skipped.push(
          `${room.title} — ${onEbay
            .map(
              (listing) =>
                `"${listing.title}" ${listing.status}/${listing.publishMode ?? "unknown"}` +
                (listing.ebayListingUrl ? ` ${listing.ebayListingUrl}` : ""),
            )
            .join(" | ")}`,
        );
        continue;
      }

      for (const listing of listings) {
        const offers = await ctx.db
          .query("offers")
          .withIndex("by_listingId_and_createdAt", (q) => q.eq("listingId", listing._id))
          .take(200);
        const messages = await ctx.db
          .query("agentMessages")
          .withIndex("by_listingId_and_createdAt", (q) => q.eq("listingId", listing._id))
          .take(200);

        summary.offers += offers.length;
        summary.agentMessages += messages.length;

        if (apply) {
          for (const offer of offers) await ctx.db.delete("offers", offer._id);
          for (const message of messages) {
            await ctx.db.delete("agentMessages", message._id);
          }
          await ctx.db.delete("listings", listing._id);
        }
      }
      summary.listings += listings.length;

      const items = await ctx.db
        .query("items")
        .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", room._id))
        .take(500);
      for (const item of items) {
        if (item.maskStorageId !== undefined) {
          summary.masks += 1;
          if (apply) await ctx.storage.delete(item.maskStorageId);
        }
        if (apply) await ctx.db.delete("items", item._id);
      }
      summary.items += items.length;

      const activity = await ctx.db
        .query("activity")
        .withIndex("by_cleanoutId_and_createdAt", (q) => q.eq("cleanoutId", room._id))
        .take(1000);
      summary.activity += activity.length;
      if (apply) {
        for (const event of activity) await ctx.db.delete("activity", event._id);
      }

      if (room.imageStorageId !== undefined) {
        summary.photos += 1;
        if (apply) await ctx.storage.delete(room.imageStorageId);
      }

      summary.titles.push(room.title);
      summary.roomsDeleted += 1;
      if (apply) await ctx.db.delete("cleanouts", room._id);
    }

    return summary;
  },
});
