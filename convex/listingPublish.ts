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
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwnedCleanout, requireOwnedListing } from "./access";
import type { IdentificationResult } from "./identify";
import { EbayError, getEbayMode, getEbayPublisher, type PublishInput } from "./ebay";
import { getAppAccessToken, refreshAccessToken } from "./ebay/oauth";
import { locationKeyFor } from "./ebay/postalCode";
import { resolveListingSpec } from "./ebay/prepare";
import { ensureSellerSetup } from "./ebay/sellerSetup";

/**
 * Publishing claims the job by flipping status to "publishing" inside the
 * mutation (a transaction) before scheduling the actual eBay call — a second
 * click sees the non-"approved"/"failed" status and is rejected here, not
 * just disabled client-side, so duplicate clicks can never create duplicate
 * eBay listings.
 */
export const publish = mutation({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args) => {
    const { listing, cleanout } = await requireOwnedListing(ctx, args.listingId);
    if (listing.status !== "approved" && listing.status !== "failed") return null;

    await ctx.db.patch("listings", args.listingId, {
      status: "publishing",
      publishError: undefined,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.listingPublish.publishOne, {
      listingId: args.listingId,
      userId: cleanout.userId,
    });

    return null;
  },
});

export const publishApproved = mutation({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const cleanout = await requireOwnedCleanout(ctx, args.cleanoutId);

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
        userId: cleanout.userId,
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
      identification: item.identification ?? {
        genericName: item.name,
        brand: null,
        model: null,
        category: item.category,
        condition: "unknown",
        attributes: [],
        confidence: "low" as const,
      },
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

    await ctx.scheduler.runAfter(0, internal.agentMail.sendListingLiveEmail, {
      listingId: args.listingId,
    });

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

/** Returns null if this user has no usable connection for the current mode. */
async function getValidAccessToken(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<{ accessToken: string; mode: string; connection: Doc<"ebayConnections"> } | null> {
  const connection = await ctx.runQuery(internal.ebayAuth.connectionForUser, { userId });
  if (connection === null || connection.mode !== getEbayMode()) return null;
  if (connection.mode === "mock") {
    return { accessToken: connection.accessToken, mode: "mock", connection };
  }

  // A minute of headroom avoids racing eBay's own expiry check.
  if (connection.accessTokenExpiresAt > Date.now() + 60_000) {
    return { accessToken: connection.accessToken, mode: connection.mode, connection };
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
    userId,
    accessToken: refreshed.accessToken,
    accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
  });

  return { accessToken: refreshed.accessToken, mode: connection.mode, connection };
}

type PublishContext = {
  listing: Doc<"listings">;
  identification: IdentificationResult;
  detectionBox: { x: number; y: number; width: number; height: number };
};

type PublishBase = { sku: string; title: string; description: string; price: number };

/**
 * Everything a real eBay publish needs beyond the listing itself: the
 * seller's own location and policies, and the item's category, condition and
 * required details.
 */
async function buildSandboxInput(
  ctx: ActionCtx,
  userId: Id<"users">,
  auth: { accessToken: string; connection: Doc<"ebayConnections"> },
  context: PublishContext,
  imageUrl: string,
  base: PublishBase,
): Promise<PublishInput> {
  const postalCode = auth.connection.shipFromPostalCode;
  if (postalCode === undefined) {
    throw new Error(
      "Reconnect eBay and enter your ZIP code — it's needed to set up your shipping location.",
    );
  }

  let setup = auth.connection.sellerSetup;
  if (setup === undefined || setup.locationKey !== locationKeyFor(postalCode)) {
    setup = await ensureSellerSetup({ env: "sandbox", accessToken: auth.accessToken, postalCode });
    await ctx.runMutation(internal.ebayAuth.saveSellerSetup, { userId, sellerSetup: setup });
  }

  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new EbayError("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set in the Convex environment.");
  }
  const openaiApiKey = env.OPENAI_API_KEY?.trim();
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY is not set in the Convex environment.");

  const appToken = await getAppAccessToken({ env: "sandbox", clientId, clientSecret });
  const spec = await resolveListingSpec({
    env: "sandbox",
    appToken,
    openaiApiKey,
    model: env.OPENAI_VISION_MODEL?.trim() || undefined,
    facts: context.identification,
    title: context.listing.title,
    description: context.listing.description,
    condition: context.listing.condition,
  });

  const productImageUrl: string = await ctx.runAction(internal.imageCrop.cropToBox, {
    imageUrl,
    box: context.detectionBox,
  });

  return {
    accessToken: auth.accessToken,
    env: "sandbox",
    categoryId: spec.categoryId,
    merchantLocationKey: setup.locationKey,
    fulfillmentPolicyId: setup.fulfillmentPolicyId,
    paymentPolicyId: setup.paymentPolicyId,
    returnPolicyId: setup.returnPolicyId,
    listing: {
      ...base,
      imageUrl: productImageUrl,
      ebayCondition: spec.ebayCondition,
      aspects: spec.aspects,
    },
  };
}

export const publishOne = internalAction({
  args: { listingId: v.id("listings"), userId: v.id("users") },
  handler: async (ctx, args) => {
    try {
      const context = await ctx.runQuery(internal.listingPublish.contextForPublish, {
        listingId: args.listingId,
      });
      if (context === null) throw new Error("This listing or its item no longer exists.");
      if (context.imageUrl === null) {
        throw new Error("The source photo could not be read from storage.");
      }
      const imageUrl = context.imageUrl;

      const auth = await getValidAccessToken(ctx, args.userId);
      if (auth === null) throw new Error("Connect your eBay account before publishing.");

      const base: PublishBase = {
        sku: context.listing._id,
        title: context.listing.title,
        description: context.listing.description,
        price: context.listing.price,
      };

      // Demo mode never looks at the image or eBay, so it stays free.
      const input: PublishInput =
        auth.mode === "mock"
          ? { accessToken: auth.accessToken, env: "sandbox", listing: { ...base, imageUrl } }
          : await buildSandboxInput(ctx, args.userId, auth, context, imageUrl, base);

      const result = await getEbayPublisher().publish(input);

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
