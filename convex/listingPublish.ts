import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { EbayError, getEbayMode, getEbayPublisher } from "./ebay";
import { refreshAccessToken } from "./ebay/oauth";

/**
 * Publishing claims the job by flipping status to "publishing" inside the
 * mutation (a transaction) before scheduling the actual eBay call — a second
 * click sees the non-"approved"/"failed" status and is rejected here, not
 * just disabled client-side, so duplicate clicks can never create duplicate
 * eBay listings.
 */
export const publish = mutation({
  args: { listingId: v.id("listings"), sessionId: v.string() },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) throw new Error("Listing not found");
    if (listing.status !== "approved" && listing.status !== "failed") return null;

    await ctx.db.patch("listings", args.listingId, {
      status: "publishing",
      publishError: undefined,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.listingPublish.publishOne, {
      listingId: args.listingId,
      sessionId: args.sessionId,
    });

    return null;
  },
});

export const publishApproved = mutation({
  args: { cleanoutId: v.id("cleanouts"), sessionId: v.string() },
  handler: async (ctx, args) => {
    const listings = await ctx.db
      .query("listings")
      .withIndex("by_cleanoutId", (q) => q.eq("cleanoutId", args.cleanoutId))
      .take(50);

    const toPublish = listings.filter((listing) => listing.status === "approved");
    for (const listing of toPublish) {
      await ctx.db.patch("listings", listing._id, {
        status: "publishing",
        publishError: undefined,
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.listingPublish.publishOne, {
        listingId: listing._id,
        sessionId: args.sessionId,
      });
    }

    return { queued: toPublish.length };
  },
});

export const contextForPublish = internalQuery({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) return null;

    const item = await ctx.db.get("items", listing.itemId);
    if (item === null) return null;

    const cleanout = await ctx.db.get("cleanouts", listing.cleanoutId);
    const imageUrl = cleanout?.imageStorageId
      ? await ctx.storage.getUrl(cleanout.imageStorageId)
      : null;

    return {
      listing,
      imageUrl,
      brand: item.identification?.brand ?? null,
      itemType: item.identification?.category ?? null,
      detectionBox: item.detectionBox,
    };
  },
});

export const markPublished = internalMutation({
  args: {
    listingId: v.id("listings"),
    ebayListingId: v.string(),
    ebayOfferId: v.string(),
    ebayListingUrl: v.string(),
    mode: v.string(),
  },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) return null;

    await ctx.db.patch("listings", args.listingId, {
      status: "live",
      ebayListingId: args.ebayListingId,
      ebayOfferId: args.ebayOfferId,
      ebayListingUrl: args.ebayListingUrl,
      publishMode: args.mode,
      publishError: undefined,
      updatedAt: Date.now(),
    });

    await ctx.db.patch("items", listing.itemId, { status: "listed" });

    return null;
  },
});

export const markPublishFailed = internalMutation({
  args: { listingId: v.id("listings"), error: v.string() },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get("listings", args.listingId);
    if (listing === null) return null;

    await ctx.db.patch("listings", args.listingId, {
      status: "failed",
      publishError: args.error.slice(0, 300),
      updatedAt: Date.now(),
    });

    return null;
  },
});

/** Returns null if there's no eBay connection for this session at all. */
async function getValidAccessToken(
  ctx: ActionCtx,
  sessionId: string,
): Promise<{ accessToken: string; mode: string } | null> {
  const connection = await ctx.runQuery(internal.ebayAuth.connectionForSession, { sessionId });
  if (connection === null) return null;
  if (connection.mode === "mock") return { accessToken: connection.accessToken, mode: "mock" };

  // A minute of headroom avoids racing eBay's own expiry check.
  if (connection.accessTokenExpiresAt > Date.now() + 60_000) {
    return { accessToken: connection.accessToken, mode: connection.mode };
  }

  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new EbayError(
      "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set — cannot refresh the eBay connection.",
    );
  }

  const refreshed = await refreshAccessToken({
    env: "sandbox",
    clientId,
    clientSecret,
    refreshToken: connection.refreshToken,
  });

  await ctx.runMutation(internal.ebayAuth.updateAccessToken, {
    sessionId,
    accessToken: refreshed.accessToken,
    accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
  });

  return { accessToken: refreshed.accessToken, mode: connection.mode };
}

export const publishOne = internalAction({
  args: { listingId: v.id("listings"), sessionId: v.string() },
  handler: async (ctx, args) => {
    try {
      const context = await ctx.runQuery(internal.listingPublish.contextForPublish, {
        listingId: args.listingId,
      });
      if (context === null) throw new Error("This listing or its item no longer exists.");
      if (context.imageUrl === null) {
        throw new Error("The source photo could not be read from storage.");
      }

      const auth = await getValidAccessToken(ctx, args.sessionId);
      if (auth === null) throw new Error("Connect your eBay account before publishing.");

      // Mock mode never looks at the image — skip the crop so it stays free.
      const productImageUrl: string =
        getEbayMode() === "mock"
          ? context.imageUrl
          : await ctx.runAction(internal.imageCrop.cropToBox, {
              imageUrl: context.imageUrl,
              box: context.detectionBox,
            });

      const publisher = getEbayPublisher();
      const result = await publisher.publish({
        accessToken: auth.accessToken,
        env: "sandbox",
        merchantLocationKey: env.EBAY_MERCHANT_LOCATION_KEY?.trim(),
        fulfillmentPolicyId: env.EBAY_FULFILLMENT_POLICY_ID?.trim(),
        paymentPolicyId: env.EBAY_PAYMENT_POLICY_ID?.trim(),
        returnPolicyId: env.EBAY_RETURN_POLICY_ID?.trim(),
        categoryId: env.EBAY_CATEGORY_ID?.trim(),
        listing: {
          sku: context.listing._id,
          title: context.listing.title,
          description: context.listing.description,
          price: context.listing.price,
          condition: context.listing.condition,
          imageUrl: productImageUrl,
          brand: context.brand,
          itemType: context.itemType,
        },
      });

      await ctx.runMutation(internal.listingPublish.markPublished, {
        listingId: args.listingId,
        ebayListingId: result.ebayListingId,
        ebayOfferId: result.ebayOfferId,
        ebayListingUrl: result.ebayListingUrl,
        mode: auth.mode,
      });
    } catch (error) {
      await ctx.runMutation(internal.listingPublish.markPublishFailed, {
        listingId: args.listingId,
        error: error instanceof Error ? error.message : "Publishing failed for an unknown reason.",
      });
    }

    return null;
  },
});
