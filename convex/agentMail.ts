import { v, type Infer } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { pendingDecisionKind, pendingDecisionValidator } from "./schema";
import { getOrCreateInbox, sendMessage } from "./agentMail/client";
import { parseReply, type ParsedAction } from "./agentMail/parseReply";
import { isValidAmount } from "./money";
import { ownerEmailForCleanout, requireOwnedListing } from "./access";
import { senderMatchesOwner } from "./agentMail/sender";
import { listingLiveEmail } from "./agentMail/messages";

const CONFIDENCE_THRESHOLD = 0.6;

type PendingDecision = Infer<typeof pendingDecisionValidator>;

export const messagesForListing = query({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    await requireOwnedListing(ctx, args.listingId);

    return await ctx.db
      .query("agentMessages")
      .withIndex("by_listingId_and_createdAt", (q) => q.eq("listingId", args.listingId))
      .order("asc")
      .take(100);
  },
});

/**
 * Simulated buyer offers now live in `offers.simulateBuyerOffer`, so that a
 * demo offer creates a real offer row and travels the same path a marketplace
 * offer will. Price-drop suggestions have no offer behind them, so they stay
 * here.
 */
export const sendTestPriceDropSuggestion = internalMutation({
  args: { listingId: v.id("listings"), suggestedPrice: v.number() },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) throw new Error("Listing not found");
    if (listing.status !== "live") {
      throw new Error("Only a live listing can get a price-drop suggestion");
    }
    if (!isValidAmount(args.suggestedPrice) || args.suggestedPrice >= listing.price) {
      throw new Error("The suggested price must be a valid amount lower than the current price");
    }

    await ctx.db.patch("listings", args.listingId, {
      pendingDecision: { kind: "price_drop", amount: args.suggestedPrice, createdAt: Date.now() },
    });

    await ctx.scheduler.runAfter(0, internal.agentMail.sendDecisionEmail, {
      listingId: args.listingId,
      kind: "price_drop",
      amount: args.suggestedPrice,
    });

    return null;
  },
});

export const contextForListing = internalQuery({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) return null;
    const item = await ctx.db.get("items", listing.itemId);
    const ownerEmail = await ownerEmailForCleanout(ctx, listing.cleanoutId);
    return { listing, itemName: item?.name ?? listing.title, ownerEmail };
  },
});

export const ownerEmailForListing = internalQuery({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) return null;
    return await ownerEmailForCleanout(ctx, listing.cleanoutId);
  },
});

export const recordOutbound = internalMutation({
  args: {
    listingId: v.id("listings"),
    offerId: v.optional(v.id("offers")),
    kind: v.union(
      v.literal("offer_notice"),
      v.literal("price_drop_suggestion"),
      v.literal("confirmation"),
      v.literal("clarification"),
    ),
    text: v.string(),
    amount: v.optional(v.number()),
    agentMailMessageId: v.optional(v.string()),
    agentMailThreadId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentMessages", {
      listingId: args.listingId,
      offerId: args.offerId,
      direction: "outbound",
      kind: args.kind,
      text: args.text,
      amount: args.amount,
      agentMailMessageId: args.agentMailMessageId,
      agentMailThreadId: args.agentMailThreadId,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const sendDecisionEmail = internalAction({
  args: {
    listingId: v.id("listings"),
    kind: pendingDecisionKind,
    amount: v.number(),
    offerId: v.optional(v.id("offers")),
  },
  handler: async (ctx, args) => {
    const context: {
      listing: Doc<"listings">;
      itemName: string;
      ownerEmail: string | null;
    } | null = await ctx.runQuery(internal.agentMail.contextForListing, {
      listingId: args.listingId,
    });
    if (context === null) return null;

    const notifyEmail = context.ownerEmail;
    const apiKey = env.AGENTMAIL_API_KEY?.trim();
    // Nothing to send to/from — the pending decision still shows in the UI.
    if (!notifyEmail || !apiKey) return null;

    const { listing, itemName } = context;

    const subject =
      args.kind === "offer"
        ? `Your ${itemName} has a $${args.amount} offer`
        : `Your ${itemName} hasn't sold yet`;

    // Suggest a counter between the offer and the asking price. Echoing the
    // offer amount back (as this once did) suggests countering at exactly what
    // the buyer already offered, which is just accepting.
    const midpoint = Math.round((args.amount + listing.price) / 2);
    const suggestedCounter = Math.min(
      Math.max(midpoint, args.amount + 1),
      Math.max(listing.price - 1, args.amount + 1),
    );

    const text =
      args.kind === "offer"
        ? `Your ${itemName} is listed at $${listing.price}.\n\nA buyer offered $${args.amount}.\n\nReply ACCEPT, DECLINE, or COUNTER ${suggestedCounter}`
        : `Your ${itemName} has had no interest for 5 days.\nI recommend lowering $${listing.price} → $${args.amount}.\nReply YES or KEEP.`;

    const inbox = await getOrCreateInbox(apiKey, env.AGENTMAIL_INBOX_ID?.trim());
    const result = await sendMessage(apiKey, inbox.inboxId, { to: notifyEmail, subject, text });

    await ctx.runMutation(internal.agentMail.recordOutbound, {
      listingId: args.listingId,
      offerId: args.offerId,
      kind: args.kind === "offer" ? "offer_notice" : "price_drop_suggestion",
      text,
      amount: args.amount,
      agentMailMessageId: result.messageId,
      agentMailThreadId: result.threadId,
    });

    return null;
  },
});

export const findListingByThread = internalQuery({
  args: { threadId: v.string(), messageId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentMessages")
      .withIndex("by_agentMailMessageId", (q) => q.eq("agentMailMessageId", args.messageId))
      .unique();
    if (existing !== null) return { duplicate: true as const, listing: null, offerId: null };

    const priorMessage = await ctx.db
      .query("agentMessages")
      .withIndex("by_agentMailThreadId", (q) => q.eq("agentMailThreadId", args.threadId))
      .order("desc")
      .first();
    if (priorMessage === null) {
      return { duplicate: false as const, listing: null, offerId: null };
    }

    // The offer this thread is about. Walk back through the thread if the most
    // recent message didn't carry one (e.g. a clarification).
    let offerId = priorMessage.offerId ?? null;
    if (offerId === null) {
      const thread = await ctx.db
        .query("agentMessages")
        .withIndex("by_agentMailThreadId", (q) =>
          q.eq("agentMailThreadId", args.threadId),
        )
        .order("desc")
        .take(20);
      offerId = thread.find((m) => m.offerId !== undefined)?.offerId ?? null;
    }

    const listing = await ctx.db.get("listings", priorMessage.listingId);
    return { duplicate: false as const, listing, offerId };
  },
});

/**
 * Records the owner's reply.
 *
 * The duplicate re-check matters: `findListingByThread` reads in a separate
 * transaction, so two concurrent redeliveries of the same webhook could both
 * pass it. This insert is the atomic guard that makes redelivery safe.
 */
export const recordInboundMessage = internalMutation({
  args: {
    listingId: v.id("listings"),
    text: v.string(),
    agentMailMessageId: v.string(),
    agentMailThreadId: v.string(),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentMessages")
      .withIndex("by_agentMailMessageId", (q) =>
        q.eq("agentMailMessageId", args.agentMailMessageId),
      )
      .first();
    if (existing !== null) return { duplicate: true as const };

    await ctx.db.insert("agentMessages", {
      listingId: args.listingId,
      direction: "inbound",
      kind: "reply",
      text: args.text,
      amount: args.amount,
      agentMailMessageId: args.agentMailMessageId,
      agentMailThreadId: args.agentMailThreadId,
      createdAt: Date.now(),
    });

    return { duplicate: false as const };
  },
});

/**
 * Price-drop suggestions only. Offers go through `offers.applyDecision` — the
 * same path the web UI uses — so there is exactly one place that resolves them.
 */
export const resolvePriceDrop = internalMutation({
  args: {
    listingId: v.id("listings"),
    approve: v.boolean(),
    agentMailThreadId: v.string(),
  },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) return { resolved: false as const };

    const pending = listing.pendingDecision;
    if (pending === undefined || pending.kind !== "price_drop") {
      return { resolved: false as const };
    }

    const text = args.approve
      ? `Price updated to $${pending.amount}.`
      : `Kept the price at $${listing.price}.`;

    await ctx.db.patch("listings", args.listingId, {
      price: args.approve ? pending.amount : listing.price,
      pendingDecision: undefined,
    });

    await ctx.db.insert("agentMessages", {
      listingId: args.listingId,
      direction: "outbound",
      kind: "confirmation",
      text,
      agentMailThreadId: args.agentMailThreadId,
      createdAt: Date.now(),
    });

    return { resolved: true as const };
  },
});

export const handleInboundReply = internalAction({
  args: {
    messageId: v.string(),
    threadId: v.string(),
    text: v.string(),
    from: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const lookup: {
      duplicate: boolean;
      listing: Doc<"listings"> | null;
      offerId: Id<"offers"> | null;
    } = await ctx.runQuery(internal.agentMail.findListingByThread, {
      threadId: args.threadId,
      messageId: args.messageId,
    });

    if (lookup.duplicate) return null;
    if (lookup.listing === null) return null;

    const ownerEmail: string | null = await ctx.runQuery(
      internal.agentMail.ownerEmailForListing,
      { listingId: lookup.listing._id },
    );
    // Only the owner can act on their listing by email.
    if (!senderMatchesOwner(args.from, ownerEmail)) return null;

    const listing = lookup.listing;
    const pending: PendingDecision | undefined = listing.pendingDecision;

    const openaiKey = env.OPENAI_API_KEY?.trim();
    let parsed: ParsedAction = { action: "unknown", confidence: 0 };
    if (pending !== undefined && openaiKey) {
      try {
        parsed = await parseReply({
          apiKey: openaiKey,
          replyText: args.text,
          pendingDecision: pending,
        });
      } catch {
        parsed = { action: "unknown", confidence: 0 };
      }
    }

    const record: { duplicate: boolean } = await ctx.runMutation(
      internal.agentMail.recordInboundMessage,
      {
        listingId: listing._id,
        text: args.text,
        agentMailMessageId: args.messageId,
        agentMailThreadId: args.threadId,
        amount: parsed.amount,
      },
    );
    // Lost the race against a concurrent redelivery; that one is handling it.
    if (record.duplicate) return null;

    // Nothing was asked, so there is nothing to act on — the reply is logged.
    if (pending === undefined) return null;

    const { action, amount, confidence } = parsed;
    const confident = action !== "unknown" && confidence >= CONFIDENCE_THRESHOLD;

    let resolved = false;

    if (confident && pending.kind === "offer") {
      const counterValid = action !== "counter" || isValidAmount(amount);
      if (counterValid && (action === "accept" || action === "decline" || action === "counter")) {
        // Resolve the offer this thread is actually about. Falling back to
        // "newest pending offer" would let a reply to an older email settle a
        // different, newer offer.
        const targetOfferId = lookup.offerId ?? pending.offerId ?? null;
        if (targetOfferId !== null) {
          // The same call the web UI's buttons make.
          const outcome: { ok: boolean; reason?: string } = await ctx.runAction(
            internal.offers.applyDecision,
            { offerId: targetOfferId, action, amount },
          );
          resolved = outcome.ok;
        }
      }
    } else if (
      confident &&
      pending.kind === "price_drop" &&
      (action === "approve_price_change" || action === "decline")
    ) {
      const outcome: { resolved: boolean } = await ctx.runMutation(
        internal.agentMail.resolvePriceDrop,
        {
          listingId: listing._id,
          approve: action === "approve_price_change",
          agentMailThreadId: args.threadId,
        },
      );
      resolved = outcome.resolved;
    }

    if (!resolved) {
      const clarificationText =
        pending.kind === "offer"
          ? "I didn't quite catch that — reply with ACCEPT, COUNTER <amount>, or DECLINE."
          : "I didn't quite catch that — reply YES or KEEP.";

      const notifyEmail = ownerEmail;
      const mailKey = env.AGENTMAIL_API_KEY?.trim();
      if (notifyEmail && mailKey) {
        const inbox = await getOrCreateInbox(mailKey, env.AGENTMAIL_INBOX_ID?.trim());
        await sendMessage(mailKey, inbox.inboxId, {
          to: notifyEmail,
          subject: "Quick clarification needed",
          text: clarificationText,
        });
      }

      await ctx.runMutation(internal.agentMail.recordOutbound, {
        listingId: listing._id,
        kind: "clarification",
        text: clarificationText,
        agentMailThreadId: args.threadId,
      });
    }

    return null;
  },
});

export const sendListingLiveEmail = internalAction({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    const context: {
      listing: Doc<"listings">;
      itemName: string;
      ownerEmail: string | null;
    } | null = await ctx.runQuery(internal.agentMail.contextForListing, {
      listingId: args.listingId,
    });
    if (context === null) return null;

    const { listing, ownerEmail } = context;
    const apiKey = env.AGENTMAIL_API_KEY?.trim();
    if (!ownerEmail || !apiKey || !listing.ebayListingUrl) return null;

    const { subject, text } = listingLiveEmail({
      title: listing.title,
      price: listing.price,
      url: listing.ebayListingUrl,
      mode: listing.publishMode ?? "mock",
    });

    const inbox = await getOrCreateInbox(apiKey, env.AGENTMAIL_INBOX_ID?.trim());
    await sendMessage(apiKey, inbox.inboxId, { to: ownerEmail, subject, text });

    return null;
  },
});
