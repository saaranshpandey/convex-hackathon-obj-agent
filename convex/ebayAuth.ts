import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { env } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUserId } from "./access";
import { sellerSetupValidator } from "./schema";
import { buildAuthorizeUrl } from "./ebay/oauth";
import { isValidPostalCode } from "./ebay/postalCode";
import { getEbayMode } from "./ebay";
import { consumeOauthState, issueOauthState } from "./ebay/oauthState";

async function upsertConnection(
  ctx: MutationCtx,
  fields: {
    userId: Id<"users">;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: number;
    refreshTokenExpiresAt?: number;
    mode: string;
    shipFromPostalCode?: string;
  },
) {
  const existing = await ctx.db
    .query("ebayConnections")
    .withIndex("by_userId", (q) => q.eq("userId", fields.userId))
    .unique();

  const now = Date.now();
  const row = { ...fields, connectedAt: existing?.connectedAt ?? now, updatedAt: now };

  if (existing !== null) {
    await ctx.db.patch("ebayConnections", existing._id, row);
  } else {
    await ctx.db.insert("ebayConnections", row);
  }
}

/** Mock mode connects instantly (no OAuth). Sandbox mode returns the
 * consent URL for the client to open in a popup. */
export const connect = mutation({
  args: { postalCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const mode = getEbayMode();

    if (mode === "mock") {
      const now = Date.now();
      await upsertConnection(ctx, {
        userId,
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
        accessTokenExpiresAt: now + 1000 * 60 * 60 * 24 * 365,
        mode: "mock",
      });
      return { mode: "mock" as const, authorizeUrl: null };
    }

    const postalCode = args.postalCode?.trim();
    if (postalCode === undefined || !isValidPostalCode(postalCode)) {
      throw new Error("Enter a valid US ZIP code (for example 94105).");
    }

    const clientId = env.EBAY_CLIENT_ID?.trim();
    const ruName = env.EBAY_RU_NAME?.trim();
    if (!clientId || !ruName) {
      throw new Error(
        "eBay sandbox isn't configured yet — EBAY_CLIENT_ID and EBAY_RU_NAME must be set in the Convex environment.",
      );
    }

    const state = await issueOauthState(ctx, userId, postalCode);
    const authorizeUrl = buildAuthorizeUrl({ env: "sandbox", clientId, ruName, state });

    return { mode: "sandbox" as const, authorizeUrl };
  },
});

export const consumeState = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, args) => await consumeOauthState(ctx, args.nonce, Date.now()),
});

export const saveConnection = internalMutation({
  args: {
    userId: v.id("users"),
    accessToken: v.string(),
    refreshToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshTokenExpiresAt: v.optional(v.number()),
    mode: v.string(),
    shipFromPostalCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await upsertConnection(ctx, args);
    return null;
  },
});

export const saveSellerSetup = internalMutation({
  args: { userId: v.id("users"), sellerSetup: sellerSetupValidator },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (connection === null) return null;

    await ctx.db.patch("ebayConnections", connection._id, { sellerSetup: args.sellerSetup });
    return null;
  },
});

export const connectionStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const configuredMode = getEbayMode();
    // A demo connection can't publish to real eBay (or the reverse), and a real
    // one needs the seller's ZIP, so after a mode switch or for an older
    // connection the user is asked to connect again instead of failing later.
    const usable =
      connection !== null &&
      connection.mode === configuredMode &&
      (configuredMode === "mock" || connection.shipFromPostalCode !== undefined);

    return {
      connected: usable,
      mode: usable ? connection.mode : null,
      configuredMode,
      shipFromPostalCode: connection?.shipFromPostalCode ?? null,
    };
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (connection !== null) {
      await ctx.db.delete("ebayConnections", connection._id);
    }
    return null;
  },
});

export const connectionForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

export const updateAccessToken = internalMutation({
  args: { userId: v.id("users"), accessToken: v.string(), accessTokenExpiresAt: v.number() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (connection === null) return null;
    await ctx.db.patch("ebayConnections", connection._id, {
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      updatedAt: Date.now(),
    });
    return null;
  },
});
