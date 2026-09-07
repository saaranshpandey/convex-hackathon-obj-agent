import { v, type Infer } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { pendingDecisionKind, pendingDecisionValidator } from "./schema";
import { getOrCreateInbox, sendMessage } from "./agentMail/client";
import { parseReply, type ParsedAction } from "./agentMail/parseReply";

const CONFIDENCE_THRESHOLD = 0.6;
/** A sanity ceiling, not a business rule — just enough to reject a corrupted
 * or adversarial value (NaN, Infinity, or an absurd magnitude) before it's
 * ever written to a listing's price. */
const MAX_REASONABLE_AMOUNT = 1_000_000;

function isValidAmount(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0 && value <= MAX_REASONABLE_AMOUNT;
}

type PendingDecision = Infer<typeof pendingDecisionValidator>;

export const messagesForListing = query({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentMessages")
      .withIndex("by_listingId_and_createdAt", (q) => q.eq("listingId", args.listingId))
      .order("asc")
      .take(100);
  },
});

/** Dev-only trigger — there's no real eBay Best-Offer integration to source
 * a genuine buyer offer from, so this simulates one for the demo. */
export const sendTestOffer = mutation({
  args: { listingId: v.id("listings"), amount: v.number() },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) throw new Error("Listing not found");
    if (listing.status !== "live") throw new Error("Only a live listing can receive an offer");
    if (!isValidAmount(args.amount)) {
      throw new Error(`Offer amount must be a valid amount between $0 and $${MAX_REASONABLE_AMOUNT}`);
    }

    await ctx.db.patch("listings", args.listingId, {
      pendingDecision: { kind: "offer", amount: args.amount, createdAt: Date.now() },
    });

    await ctx.scheduler.runAfter(0, internal.agentMail.sendDecisionEmail, {
      listingId: args.listingId,
      kind: "offer",
      amount: args.amount,
    });

    return null;
  },
});

export const sendTestPriceDropSuggestion = mutation({
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
    return { listing, itemName: item?.name ?? listing.title };
  },
});

export const recordOutbound = internalMutation({
  args: {
    listingId: v.id("listings"),
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
  },
  handler: async (ctx, args) => {
    const context: { listing: Doc<"listings">; itemName: string } | null = await ctx.runQuery(
      internal.agentMail.contextForListing,
      { listingId: args.listingId },
    );
    if (context === null) return null;

    const notifyEmail = env.USER_NOTIFY_EMAIL?.trim();
    const apiKey = env.AGENTMAIL_API_KEY?.trim();
    // Nothing to send to/from — the pending decision still shows in the UI.
    if (!notifyEmail || !apiKey) return null;

    const { listing, itemName } = context;

    const subject =
      args.kind === "offer"
        ? `Your ${itemName} has a $${args.amount} offer`
        : `Your ${itemName} hasn't sold yet`;

    const text =
      args.kind === "offer"
        ? `Your ${itemName} is listed at $${listing.price}.\n\nA buyer offered $${args.amount}.\n\nReply with:\nACCEPT\nCOUNTER ${args.amount}\nDECLINE`
        : `Your ${itemName} has had no interest for 5 days.\nI recommend lowering $${listing.price} → $${args.amount}.\nReply YES or KEEP.`;

    const inbox = await getOrCreateInbox(apiKey);
    const result = await sendMessage(apiKey, inbox.inboxId, { to: notifyEmail, subject, text });

    await ctx.runMutation(internal.agentMail.recordOutbound, {
      listingId: args.listingId,
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
    if (existing !== null) return { duplicate: true as const, listing: null };

    const priorMessage = await ctx.db
      .query("agentMessages")
      .withIndex("by_agentMailThreadId", (q) => q.eq("agentMailThreadId", args.threadId))
      .order("desc")
      .first();
    if (priorMessage === null) return { duplicate: false as const, listing: null };

    const listing = await ctx.db.get("listings", priorMessage.listingId);
    return { duplicate: false as const, listing };
  },
});

const parsedActionValidator = v.object({
  action: v.union(
    v.literal("accept"),
    v.literal("decline"),
    v.literal("counter"),
    v.literal("approve_price_change"),
    v.literal("unknown"),
  ),
  amount: v.optional(v.number()),
  confidence: v.number(),
});

export const recordInboundAndResolve = internalMutation({
  args: {
    listingId: v.id("listings"),
    text: v.string(),
    agentMailMessageId: v.string(),
    agentMailThreadId: v.string(),
    parsed: parsedActionValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentMessages", {
      listingId: args.listingId,
      direction: "inbound",
      kind: "reply",
      text: args.text,
      amount: args.parsed.amount,
      agentMailMessageId: args.agentMailMessageId,
      agentMailThreadId: args.agentMailThreadId,
      createdAt: Date.now(),
    });

    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null || listing.pendingDecision === undefined) {
      return { outcome: "no_pending" as const };
    }

    const pending = listing.pendingDecision;
    const { action, amount, confidence } = args.parsed;

    const kindMatches =
      action === "accept" || action === "counter"
        ? pending.kind === "offer"
        : action === "approve_price_change"
          ? pending.kind === "price_drop"
          : action === "decline";

    const counterAmountValid = action !== "counter" || isValidAmount(amount);

    if (
      action === "unknown" ||
      confidence < CONFIDENCE_THRESHOLD ||
      !kindMatches ||
      !counterAmountValid
    ) {
      return { outcome: "clarify" as const, pending };
    }

    let confirmationText: string;

    if (action === "accept") {
      await ctx.db.patch("listings", args.listingId, {
        status: "sold",
        price: pending.amount,
        pendingDecision: undefined,
      });
      confirmationText = `Accepted. Marked sold at $${pending.amount}.`;
    } else if (action === "decline" && pending.kind === "offer") {
      await ctx.db.patch("listings", args.listingId, { pendingDecision: undefined });
      confirmationText = `Offer declined. Staying live at $${listing.price}.`;
    } else if (action === "decline") {
      await ctx.db.patch("listings", args.listingId, { pendingDecision: undefined });
      confirmationText = `Kept the price at $${listing.price}.`;
    } else if (action === "counter" && isValidAmount(amount)) {
      await ctx.db.patch("listings", args.listingId, { price: amount, pendingDecision: undefined });
      confirmationText = `Counter submitted at $${amount}.`;
    } else if (action === "approve_price_change") {
      await ctx.db.patch("listings", args.listingId, {
        price: pending.amount,
        pendingDecision: undefined,
      });
      confirmationText = `Price updated to $${pending.amount}.`;
    } else {
      return { outcome: "clarify" as const, pending };
    }

    await ctx.db.insert("agentMessages", {
      listingId: args.listingId,
      direction: "outbound",
      kind: "confirmation",
      text: confirmationText,
      agentMailThreadId: args.agentMailThreadId,
      createdAt: Date.now(),
    });

    return { outcome: "resolved" as const };
  },
});

export const handleInboundReply = internalAction({
  args: { messageId: v.string(), threadId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const lookup: { duplicate: boolean; listing: Doc<"listings"> | null } = await ctx.runQuery(
      internal.agentMail.findListingByThread,
      { threadId: args.threadId, messageId: args.messageId },
    );

    if (lookup.duplicate) return null;
    if (lookup.listing === null) return null;

    const listing = lookup.listing;

    if (listing.pendingDecision === undefined) {
      await ctx.runMutation(internal.agentMail.recordInboundAndResolve, {
        listingId: listing._id,
        text: args.text,
        agentMailMessageId: args.messageId,
        agentMailThreadId: args.threadId,
        parsed: { action: "unknown", confidence: 0 },
      });
      return null;
    }

    const openaiKey = env.OPENAI_API_KEY?.trim();
    let parsed: ParsedAction;
    if (!openaiKey) {
      parsed = { action: "unknown", confidence: 0 };
    } else {
      try {
        parsed = await parseReply({
          apiKey: openaiKey,
          replyText: args.text,
          pendingDecision: listing.pendingDecision,
        });
      } catch {
        parsed = { action: "unknown", confidence: 0 };
      }
    }

    const result: { outcome: "no_pending" } | { outcome: "clarify"; pending: PendingDecision } | { outcome: "resolved" } =
      await ctx.runMutation(internal.agentMail.recordInboundAndResolve, {
        listingId: listing._id,
        text: args.text,
        agentMailMessageId: args.messageId,
        agentMailThreadId: args.threadId,
        parsed,
      });

    if (result.outcome === "clarify") {
      const clarificationText =
        result.pending.kind === "offer"
          ? "I didn't quite catch that — reply with ACCEPT, COUNTER <amount>, or DECLINE."
          : "I didn't quite catch that — reply YES or KEEP.";

      const notifyEmail = env.USER_NOTIFY_EMAIL?.trim();
      const mailKey = env.AGENTMAIL_API_KEY?.trim();
      if (notifyEmail && mailKey) {
        const inbox = await getOrCreateInbox(mailKey);
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
