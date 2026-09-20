import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { env } from "./_generated/server";
import { internal } from "./_generated/api";
import { EbayError, getEbayEnv } from "./ebay";
import { ebayRequest } from "./ebay/http";
import { decodeSignatureHeader, readDeletedUserId, verifyEbaySignature } from "./ebay/notificationSignature";
import { getAppAccessToken } from "./ebay/oauth";

const KEY_TTL_MS = 60 * 60 * 1000;

export const cachedPublicKey = internalQuery({
  args: { kid: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("ebayPublicKeys")
      .withIndex("by_kid", (q) => q.eq("kid", args.kid))
      .unique();
    if (row === null || row.fetchedAt < args.now - KEY_TTL_MS) return null;
    return row.pem;
  },
});

export const cachePublicKey = internalMutation({
  args: { kid: v.string(), pem: v.string(), fetchedAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ebayPublicKeys")
      .withIndex("by_kid", (q) => q.eq("kid", args.kid))
      .unique();
    if (existing !== null) {
      await ctx.db.patch("ebayPublicKeys", existing._id, { pem: args.pem, fetchedAt: args.fetchedAt });
    } else {
      await ctx.db.insert("ebayPublicKeys", args);
    }
    return null;
  },
});

/**
 * Handles one eBay marketplace account-deletion notification: nothing is
 * deleted unless eBay's signature on the exact body verifies.
 */
export const handle = internalAction({
  args: { body: v.string(), signatureHeader: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ status: number }> => {
    const ebayEnv = getEbayEnv();
    if (ebayEnv === null) return { status: 200 };

    const decoded = decodeSignatureHeader(args.signatureHeader);
    if (decoded === null) return { status: 412 };

    const clientId = env.EBAY_CLIENT_ID?.trim();
    const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return { status: 500 };

    const now = Date.now();
    let pem: string | null = await ctx.runQuery(internal.ebayNotifications.cachedPublicKey, {
      kid: decoded.kid,
      now,
    });

    if (pem === null) {
      try {
        const appToken = await getAppAccessToken({ env: ebayEnv, clientId, clientSecret });
        const response = await ebayRequest(
          ebayEnv,
          appToken,
          "GET",
          `/commerce/notification/v1/public_key/${encodeURIComponent(decoded.kid)}`,
        );
        if (typeof response.key !== "string") return { status: 412 };
        pem = response.key;
        await ctx.runMutation(internal.ebayNotifications.cachePublicKey, {
          kid: decoded.kid,
          pem,
          fetchedAt: now,
        });
      } catch (error) {
        return { status: error instanceof EbayError && error.status === 404 ? 412 : 500 };
      }
    }

    const valid = await verifyEbaySignature({
      publicKeyPem: pem,
      body: args.body,
      signature: decoded.signature,
    });
    if (!valid) return { status: 412 };

    const ebayUserId = readDeletedUserId(args.body);
    if (ebayUserId !== null) {
      await ctx.runMutation(internal.ebayAuth.deleteByEbayUserId, { ebayUserId });
    }
    return { status: 200 };
  },
});
