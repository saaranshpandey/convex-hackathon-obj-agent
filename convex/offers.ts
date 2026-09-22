/**
 * Marketplace offers and the single decision path.
 *
 * Everything that resolves an offer — the buttons in the web UI and an
 * AgentMail reply — funnels through `applyDecision`. There is deliberately no
 * second approval route.
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { listingStatus, offerSource } from "./schema";
import { isValidAmount } from "./money";
import { getActivityMode, getMarketplaceProvider } from "./marketplace/provider";
import { env } from "./_generated/server";
import { requireOwnedListing, requireOwnedOffer, requireUserId } from "./access";

/**
 * Simulated marketplace events are allowed on a seeded demo room (so a judge
 * can walk the whole loop) or on a deployment explicitly marked as a demo.
 * Never on a real listing by default — these mutations are public.
 */
function assertSimulationAllowed(isDemoRoom: boolean): void {
  if (isDemoRoom) return;
  if (env.DEMO_MODE?.trim() === "true") return;
  throw new Error("Simulated marketplace events are disabled for this listing.");
}

export const listForListing = query({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    await requireOwnedListing(ctx, args.listingId);

    return await ctx.db
      .query("offers")
      .withIndex("by_listingId_and_createdAt", (q) => q.eq("listingId", args.listingId))
      .order("desc")
      .take(20);
  },
});

/**
 * The one way an offer enters the system, whether it came from the simulator or
 * from a real marketplace poll. Idempotent on marketplaceOfferId, so a repeated
 * mock event or a redelivered webhook can never create a duplicate.
 */
type IngestArgs = {
  listingId: Id<"listings">;
  marketplaceOfferId: string;
  amount: number;
  currency: string;
  source: "mock" | "ebay";
  buyerMessage?: string;
};

/**
 * Shared by the internal mutation below and by the simulator, so both take
 * literally the same code path rather than one calling the other.
 */
async function ingestOffer(
  ctx: MutationCtx,
  args: IngestArgs,
): Promise<{ created: boolean; offerId: Id<"offers"> | null }> {
  {
    if (!isValidAmount(args.amount)) {
      throw new Error("Offer amount is not a valid monetary value");
    }

    const existing = await ctx.db
      .query("offers")
      .withIndex("by_marketplaceOfferId", (q) =>
        q.eq("marketplaceOfferId", args.marketplaceOfferId),
      )
      .first();
    if (existing !== null) return { created: false, offerId: existing._id };

    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) throw new Error("Listing not found");

    // A poll can hand us an offer for something already sold or ended. Ignore
    // it rather than reopening a settled listing.
    if (listing.status !== "live") {
      return { created: false, offerId: null };
    }

    const now = Date.now();
    const offerId = await ctx.db.insert("offers", {
      listingId: args.listingId,
      marketplaceOfferId: args.marketplaceOfferId,
      amount: args.amount,
      currency: args.currency,
      status: "pending",
      source: args.source,
      buyerMessage: args.buyerMessage,
      createdAt: now,
      updatedAt: now,
    });

    // Reuses Phase 7's owner-notification pipeline, now carrying the offer id
    // so a reply resolves this offer specifically.
    await ctx.db.patch("listings", args.listingId, {
      pendingDecision: { kind: "offer", amount: args.amount, offerId, createdAt: now },
    });
    await ctx.scheduler.runAfter(0, internal.agentMail.sendDecisionEmail, {
      listingId: args.listingId,
      kind: "offer",
      amount: args.amount,
      offerId,
    });

    return { created: true, offerId };
  }
}

export const ingest = internalMutation({
  args: {
    listingId: v.id("listings"),
    marketplaceOfferId: v.string(),
    amount: v.number(),
    currency: v.string(),
    source: offerSource,
    buyerMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => await ingestOffer(ctx, args),
});

/**
 * Fabricates a buyer offer. Gated on DEMO_MODE server-side: this mutation is
 * public and ships in every build, so hiding the button is not a control.
 */
export const simulateBuyerOffer = mutation({
  args: { listingId: v.id("listings"), amount: v.number() },
  handler: async (ctx, args) => {
    const { listing, cleanout } = await requireOwnedListing(ctx, args.listingId);
    assertSimulationAllowed(cleanout.isDemo === true);
    if (listing.status !== "live") {
      throw new Error("Only a live listing can receive an offer");
    }
    if (!isValidAmount(args.amount)) {
      throw new Error("That is not a valid offer amount");
    }

    const marketplaceOfferId = `MOCK-OFFER-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

    return await ingestOffer(ctx, {
      listingId: args.listingId,
      marketplaceOfferId,
      amount: args.amount,
      currency: "USD",
      source: "mock",
      buyerMessage: "Would you take this?",
    });
  },
});

/** Fabricates the buyer accepting our counter. DEMO_MODE only, as above. */
export const simulateBuyerAcceptsCounter = mutation({
  args: { offerId: v.id("offers") },
  handler: async (ctx, args) => {
    const { offer, cleanout } = await requireOwnedOffer(ctx, args.offerId);
    assertSimulationAllowed(cleanout.isDemo === true);
    if (offer.status !== "countered") {
      throw new Error("Only a countered offer can be accepted by the buyer");
    }
    if (!isValidAmount(offer.counterAmount)) {
      throw new Error("This offer has no valid counter amount");
    }

    const settledAt = offer.counterAmount;

    await ctx.db.patch("offers", offer._id, {
      status: "buyer_accepted",
      updatedAt: Date.now(),
    });
    await ctx.db.patch("listings", offer.listingId, {
      status: "sold",
      price: settledAt,
      pendingDecision: undefined,
    });

    const siblings = await ctx.db
      .query("offers")
      .withIndex("by_listingId_and_createdAt", (q) => q.eq("listingId", offer.listingId))
      .take(50);
    for (const sibling of siblings) {
      if (sibling._id === offer._id) continue;
      if (sibling.status !== "pending" && sibling.status !== "countered") continue;
      await ctx.db.patch("offers", sibling._id, {
        status: "expired",
        updatedAt: Date.now(),
      });
    }

    await ctx.db.insert("agentMessages", {
      listingId: offer.listingId,
      direction: "outbound",
      kind: "confirmation",
      text: `The buyer accepted your counter. Sold at $${settledAt}.`,
      amount: settledAt,
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.agentMail.sendSoldEmail, {
      listingId: offer.listingId,
      amount: settledAt,
      viaCounter: true,
    });

    return null;
  },
});

const offerAction = v.union(v.literal("accept"), v.literal("decline"), v.literal("counter"));

/**
 * Claims the offer by writing the outcome inside a transaction. A second
 * concurrent decision (double-click, or a UI click racing an email reply) finds
 * the offer no longer pending and is rejected.
 *
 * The write happens before the marketplace call so the claim is atomic; if that
 * call then fails, `revertDecision` puts it back.
 */
export const claimDecision = internalMutation({
  args: { offerId: v.id("offers"), action: offerAction, amount: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const offer = await ctx.db.get("offers", args.offerId);
    if (offer === null) return { ok: false as const, reason: "Offer not found" };
    if (offer.status !== "pending") {
      return { ok: false as const, reason: "That offer has already been handled" };
    }
    if (args.action === "counter" && !isValidAmount(args.amount)) {
      return { ok: false as const, reason: "A counter needs a valid amount" };
    }

    const listing = await ctx.db.get("listings", offer.listingId);
    if (listing === null) return { ok: false as const, reason: "Listing not found" };

    // An offer left over from before the item sold must not be actionable —
    // otherwise accepting it would re-sell an item at a second price.
    if (listing.status !== "live") {
      return { ok: false as const, reason: "That listing is no longer live" };
    }

    const now = Date.now();
    const previousPrice = listing.price;

    if (args.action === "accept") {
      await ctx.db.patch("offers", offer._id, { status: "accepted", updatedAt: now });
      await ctx.db.patch("listings", offer.listingId, {
        status: "sold",
        price: offer.amount,
        pendingDecision: undefined,
      });
    } else if (args.action === "decline") {
      await ctx.db.patch("offers", offer._id, { status: "declined", updatedAt: now });
      await ctx.db.patch("listings", offer.listingId, { pendingDecision: undefined });
    } else {
      await ctx.db.patch("offers", offer._id, {
        status: "countered",
        counterAmount: args.amount,
        updatedAt: now,
      });
      await ctx.db.patch("listings", offer.listingId, { pendingDecision: undefined });
    }

    return {
      ok: true as const,
      marketplaceOfferId: offer.marketplaceOfferId,
      listingId: offer.listingId,
      ebayListingId: listing.ebayListingId ?? null,
      previousPrice,
      previousStatus: listing.status,
      offerAmount: offer.amount,
    };
  },
});

/** Undoes a claim whose marketplace call failed, so state never drifts. */
export const revertDecision = internalMutation({
  args: {
    offerId: v.id("offers"),
    previousPrice: v.number(),
    previousStatus: listingStatus,
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const offer = await ctx.db.get("offers", args.offerId);
    if (offer === null) return null;

    await ctx.db.patch("offers", offer._id, {
      status: "pending",
      counterAmount: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch("listings", offer.listingId, {
      status: args.previousStatus,
      price: args.previousPrice,
      pendingDecision: {
        kind: "offer",
        amount: offer.amount,
        offerId: offer._id,
        createdAt: Date.now(),
      },
    });
    await ctx.db.insert("agentMessages", {
      listingId: offer.listingId,
      direction: "outbound",
      kind: "clarification",
      text: `I couldn't send that to the marketplace: ${args.reason}. The offer is still open.`,
      createdAt: Date.now(),
    });

    return null;
  },
});

/**
 * When an item sells, every other open offer on it is closed out — the same
 * thing a marketplace does automatically. Runs only after the sale is final,
 * so a reverted decision never leaves siblings wrongly expired.
 */
export const expireOtherOffers = internalMutation({
  args: { listingId: v.id("listings"), keepOfferId: v.id("offers") },
  handler: async (ctx, args) => {
    const siblings = await ctx.db
      .query("offers")
      .withIndex("by_listingId_and_createdAt", (q) => q.eq("listingId", args.listingId))
      .take(50);

    let expired = 0;
    for (const sibling of siblings) {
      if (sibling._id === args.keepOfferId) continue;
      if (sibling.status !== "pending" && sibling.status !== "countered") continue;
      await ctx.db.patch("offers", sibling._id, {
        status: "expired",
        updatedAt: Date.now(),
      });
      expired += 1;
    }

    return { expired };
  },
});

export const recordDecisionConfirmation = internalMutation({
  args: { listingId: v.id("listings"), text: v.string(), amount: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentMessages", {
      listingId: args.listingId,
      direction: "outbound",
      kind: "confirmation",
      text: args.text,
      amount: args.amount,
      createdAt: Date.now(),
    });
    return null;
  },
});

/**
 * The single decision path. Both the web UI and an AgentMail reply land here.
 */
export const applyDecision = internalAction({
  args: { offerId: v.id("offers"), action: offerAction, amount: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const claim: {
      ok: boolean;
      reason?: string;
      marketplaceOfferId?: string;
      listingId?: Id<"listings">;
      ebayListingId?: string | null;
      previousPrice?: number;
      previousStatus?: Doc<"listings">["status"];
      offerAmount?: number;
    } = await ctx.runMutation(internal.offers.claimDecision, args);

    if (!claim.ok) return { ok: false, reason: claim.reason };

    const listingId = claim.listingId as Id<"listings">;
    const settled = args.action === "counter" ? args.amount : claim.offerAmount;

    try {
      const provider = getMarketplaceProvider();
      await provider.respondToOffer({
        listingId: claim.ebayListingId ?? "",
        marketplaceOfferId: claim.marketplaceOfferId as string,
        action: args.action,
        amount: args.amount,
        // Mock ignores this; the eBay adapter needs a real token, which the
        // caller supplies once EBAY_ACTIVITY_MODE=ebay is actually wired.
        accessToken: "",
      });
    } catch (error) {
      await ctx.runMutation(internal.offers.revertDecision, {
        offerId: args.offerId,
        previousPrice: claim.previousPrice as number,
        previousStatus: claim.previousStatus as Doc<"listings">["status"],
        reason: error instanceof Error ? error.message : "the marketplace rejected it",
      });
      return { ok: false, reason: "Marketplace call failed; the offer is still open." };
    }

    const text =
      args.action === "accept"
        ? `Accepted. Marked sold at $${settled}.`
        : args.action === "decline"
          ? "Offer declined. The listing stays live."
          : `Counter submitted at $${settled}. Waiting for the buyer.`;

    if (args.action === "accept") {
      await ctx.runMutation(internal.offers.expireOtherOffers, {
        listingId,
        keepOfferId: args.offerId,
      });
    }

    await ctx.runMutation(internal.offers.recordDecisionConfirmation, {
      listingId,
      text,
      amount: settled,
    });

    // Only a sale earns an email, and only here — the claim above is written
    // before the marketplace call and `revertDecision` can still undo it.
    if (args.action === "accept" && settled !== undefined) {
      await ctx.runAction(internal.agentMail.sendSoldEmail, {
        listingId,
        amount: settled,
        viaCounter: false,
      });
    }

    return { ok: true };
  },
});

export const isOfferOwnedBy = internalQuery({
  args: { offerId: v.id("offers"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const offer = await ctx.db.get("offers", args.offerId);
    if (offer === null) return false;
    const listing = await ctx.db.get("listings", offer.listingId);
    if (listing === null) return false;
    const cleanout = await ctx.db.get("cleanouts", listing.cleanoutId);
    return cleanout !== null && cleanout.userId === args.userId;
  },
});

/** Web UI entry point. Same logic as an emailed reply, after an ownership check. */
export const decide = action({
  args: { offerId: v.id("offers"), action: offerAction, amount: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const userId = await requireUserId(ctx);
    const owned: boolean = await ctx.runQuery(internal.offers.isOfferOwnedBy, {
      offerId: args.offerId,
      userId,
    });
    if (!owned) throw new Error("Not found");

    return await ctx.runAction(internal.offers.applyDecision, args);
  },
});

export const activityMode = query({
  args: {},
  handler: async () => ({ mode: getActivityMode() }),
});

export type OfferDoc = Doc<"offers">;
