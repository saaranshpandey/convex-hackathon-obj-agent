import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { env } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { buildAuthorizeUrl } from "./ebay/oauth";
import { getEbayMode } from "./ebay";

async function upsertConnection(
  ctx: MutationCtx,
  fields: {
    sessionId: string;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: number;
    refreshTokenExpiresAt?: number;
    mode: string;
  },
) {
  const existing = await ctx.db
    .query("ebayConnections")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", fields.sessionId))
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
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const mode = getEbayMode();

    if (mode === "mock") {
      const now = Date.now();
      await upsertConnection(ctx, {
        sessionId: args.sessionId,
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
        accessTokenExpiresAt: now + 1000 * 60 * 60 * 24 * 365,
        mode: "mock",
      });
      return { mode: "mock" as const, authorizeUrl: null };
    }

    const clientId = env.EBAY_CLIENT_ID?.trim();
    const ruName = env.EBAY_RU_NAME?.trim();
    if (!clientId || !ruName) {
      throw new Error(
        "eBay sandbox isn't configured yet — EBAY_CLIENT_ID and EBAY_RU_NAME must be set in the Convex environment.",
      );
    }

    const authorizeUrl = buildAuthorizeUrl({
      env: "sandbox",
      clientId,
      ruName,
      state: args.sessionId,
    });

    return { mode: "sandbox" as const, authorizeUrl };
  },
});

export const saveConnection = internalMutation({
  args: {
    sessionId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshTokenExpiresAt: v.optional(v.number()),
    mode: v.string(),
  },
  handler: async (ctx, args) => {
    await upsertConnection(ctx, args);
    return null;
  },
});

export const connectionStatus = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    return { connected: connection !== null, mode: connection?.mode ?? null };
  },
});

export const disconnect = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (connection !== null) {
      await ctx.db.delete("ebayConnections", connection._id);
    }
    return null;
  },
});

export const connectionForSession = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ebayConnections")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
  },
});

export const updateAccessToken = internalMutation({
  args: { sessionId: v.string(), accessToken: v.string(), accessTokenExpiresAt: v.number() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
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
