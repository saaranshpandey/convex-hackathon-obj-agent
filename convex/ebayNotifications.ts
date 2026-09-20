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

/** eBay only sees the status, so a refusal is otherwise silent: log why. */
function refuse(status: number, reason: string): { status: number } {
  console.log(`eBay deletion notice refused (${status}): ${reason}`);
  return { status };
}

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
    if (decoded === null) return refuse(412, "missing or unreadable X-EBAY-SIGNATURE header");

    const clientId = env.EBAY_CLIENT_ID?.trim();
    const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return refuse(500, "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set");

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
        if (typeof response.key !== "string") return refuse(412, "eBay's key response had no key");
        pem = response.key;
        await ctx.runMutation(internal.ebayNotifications.cachePublicKey, {
          kid: decoded.kid,
          pem,
          fetchedAt: now,
        });
      } catch (error) {
        const notFound = error instanceof EbayError && error.status === 404;
        const detail = error instanceof Error ? error.message : "unknown error";
        return refuse(notFound ? 412 : 500, `couldn't get eBay's public key for ${decoded.kid} from ${ebayEnv}: ${detail}`);
      }
    }

    const valid = await verifyEbaySignature({
      publicKeyPem: pem,
      body: args.body,
      signature: decoded.signature,
    });
    if (!valid) return refuse(412, "signature did not verify against eBay's public key");

    const ebayUserId = readDeletedUserId(args.body);
    if (ebayUserId !== null) {
      await ctx.runMutation(internal.ebayAuth.deleteByEbayUserId, { ebayUserId });
    }
    return { status: 200 };
  },
});
