import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";

/**
 * One-off operator utility: provisions the sandbox seller-account resources
 * (merchant location + fulfillment/payment/return policies) that real eBay
 * listing creation requires, using the caller's already-connected OAuth
 * token. Not part of the app's regular user-facing surface — run once per eBay
 * account from the CLI, e.g.
 * `npx convex run ebaySetup:provisionSellerAccount '{"userId":"<users id>"}'`.
 * These are internal functions, so they can never be called from a browser.
 */

const SANDBOX_API = "https://api.sandbox.ebay.com";
const MERCHANT_LOCATION_KEY = "roomsale-default-location";

export const connectionAccessToken = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("ebayConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (connection === null || connection.mode !== "sandbox") return null;
    return connection.accessToken;
  },
});

async function ebayCall(
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${SANDBOX_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { status: response.status, json };
}

export const provisionLocationOnly = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const accessToken: string | null = await ctx.runQuery(
      internal.ebaySetup.connectionAccessToken,
      { userId: args.userId },
    );
    if (accessToken === null) {
      throw new Error("No connected sandbox eBay account found for that userId.");
    }

    const location = await ebayCall(
      accessToken,
      "POST",
      `/sell/inventory/v1/location/${MERCHANT_LOCATION_KEY}`,
      {
        location: {
          address: {
            addressLine1: "1 Market St",
            city: "San Francisco",
            stateOrProvince: "CA",
            postalCode: "94105",
            country: "US",
          },
        },
        locationTypes: ["WAREHOUSE"],
        name: "Roomsale Default Location",
        merchantLocationStatus: "ENABLED",
      },
    );

    return { status: location.status, body: location.json };
  },
});

/** Taxonomy lookups use an app-level token (client_credentials), not the
 * user's OAuth token — no user reconnect needed for this one. */
async function getAppAccessToken(): Promise<string> {
  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set.");
  }

  const response = await fetch("https://api.sandbox.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }).toString(),
  });

  const payload = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Client-credentials token request failed: ${payload.error_description ?? response.status}`);
  }
  return payload.access_token;
}

export const suggestCategory = internalAction({
  args: { query: v.string() },
  handler: async (_ctx, args) => {
    const accessToken = await getAppAccessToken();

    const result = await ebayCall(
      accessToken,
      "GET",
      `/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(args.query)}`,
    );
    return { status: result.status, body: result.json };
  },
});

export const conditionPolicies = internalAction({
  args: { userId: v.id("users"), categoryId: v.string() },
  handler: async (ctx, args) => {
    const accessToken: string | null = await ctx.runQuery(
      internal.ebaySetup.connectionAccessToken,
      { userId: args.userId },
    );
    if (accessToken === null) {
      throw new Error("No connected sandbox eBay account found for that userId.");
    }

    const result = await ebayCall(
      accessToken,
      "GET",
      `/sell/metadata/v1/marketplace/EBAY_US/item_condition_policies?filter=${encodeURIComponent(`categoryIds:{${args.categoryId}}`)}`,
    );
    return { status: result.status, body: result.json };
  },
});

export const retryWithCondition = internalAction({
  args: { userId: v.id("users"), sku: v.string(), offerId: v.string(), condition: v.string() },
  handler: async (ctx, args) => {
    const accessToken: string | null = await ctx.runQuery(
      internal.ebaySetup.connectionAccessToken,
      { userId: args.userId },
    );
    if (accessToken === null) {
      throw new Error("No connected sandbox eBay account found for that userId.");
    }

    const existing = await ebayCall(accessToken, "GET", `/sell/inventory/v1/inventory_item/${args.sku}`);
    if (existing.status !== 200) {
      return { step: "get", status: existing.status, body: existing.json };
    }

    const updated = await ebayCall(accessToken, "PUT", `/sell/inventory/v1/inventory_item/${args.sku}`, {
      ...existing.json,
      condition: args.condition,
    });
    if (updated.status >= 300) {
      return { step: "put", status: updated.status, body: updated.json };
    }

    const published = await ebayCall(accessToken, "POST", `/sell/inventory/v1/offer/${args.offerId}/publish`);
    return { step: "publish", status: published.status, body: published.json };
  },
});

export const retryWithAspects = internalAction({
  args: {
    userId: v.id("users"),
    sku: v.string(),
    offerId: v.string(),
    aspects: v.record(v.string(), v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const accessToken: string | null = await ctx.runQuery(
      internal.ebaySetup.connectionAccessToken,
      { userId: args.userId },
    );
    if (accessToken === null) {
      throw new Error("No connected sandbox eBay account found for that userId.");
    }

    const existing = await ebayCall(accessToken, "GET", `/sell/inventory/v1/inventory_item/${args.sku}`);
    if (existing.status !== 200) {
      return { step: "get", status: existing.status, body: existing.json };
    }

    const currentProduct = (existing.json.product as Record<string, unknown> | undefined) ?? {};
    const updated = await ebayCall(accessToken, "PUT", `/sell/inventory/v1/inventory_item/${args.sku}`, {
      ...existing.json,
      product: { ...currentProduct, aspects: args.aspects },
    });
    if (updated.status >= 300) {
      return { step: "put", status: updated.status, body: updated.json };
    }

    const published = await ebayCall(accessToken, "POST", `/sell/inventory/v1/offer/${args.offerId}/publish`);
    return { step: "publish", status: published.status, body: published.json };
  },
});

export const retryPublishOffer = internalAction({
  args: { userId: v.id("users"), offerId: v.string() },
  handler: async (ctx, args) => {
    const accessToken: string | null = await ctx.runQuery(
      internal.ebaySetup.connectionAccessToken,
      { userId: args.userId },
    );
    if (accessToken === null) {
      throw new Error("No connected sandbox eBay account found for that userId.");
    }

    const result = await ebayCall(
      accessToken,
      "POST",
      `/sell/inventory/v1/offer/${args.offerId}/publish`,
    );
    return { status: result.status, body: result.json };
  },
});

export const provisionSellerAccount = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const accessToken: string | null = await ctx.runQuery(
      internal.ebaySetup.connectionAccessToken,
      { userId: args.userId },
    );
    if (accessToken === null) {
      throw new Error("No connected sandbox eBay account found for that userId.");
    }

    const steps: Record<string, unknown> = {};

    const optIn = await ebayCall(accessToken, "POST", "/sell/account/v1/program/opt_in", {
      programType: "SELLING_POLICY_MANAGEMENT",
    });
    steps.optIn = { status: optIn.status, body: optIn.json };

    const location = await ebayCall(
      accessToken,
      "POST",
      `/sell/inventory/v1/location/${MERCHANT_LOCATION_KEY}`,
      {
        location: {
          address: {
            addressLine1: "1 Market St",
            city: "San Francisco",
            stateOrProvince: "CA",
            postalCode: "94105",
            country: "US",
          },
        },
        locationTypes: ["WAREHOUSE"],
        name: "Roomsale Default Location",
        merchantLocationStatus: "ENABLED",
      },
    );
    steps.location = { status: location.status, body: location.json };

    const fulfillment = await ebayCall(accessToken, "POST", "/sell/account/v1/fulfillment_policy", {
      name: "Roomsale Standard Shipping",
      marketplaceId: "EBAY_US",
      categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
      handlingTime: { value: 3, unit: "DAY" },
      shippingOptions: [
        {
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [
            {
              sortOrder: 1,
              shippingCarrierCode: "USPS",
              shippingServiceCode: "USPSPriority",
              shippingCost: { value: "5.00", currency: "USD" },
              freeShipping: false,
            },
          ],
        },
      ],
    });
    steps.fulfillment = { status: fulfillment.status, body: fulfillment.json };

    const payment = await ebayCall(accessToken, "POST", "/sell/account/v1/payment_policy", {
      name: "Roomsale Standard Payment",
      marketplaceId: "EBAY_US",
      categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
      immediatePay: false,
    });
    steps.payment = { status: payment.status, body: payment.json };

    const returns = await ebayCall(accessToken, "POST", "/sell/account/v1/return_policy", {
      name: "Roomsale Standard Returns",
      marketplaceId: "EBAY_US",
      categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: "DAY" },
      refundMethod: "MONEY_BACK",
      returnShippingCostPayer: "BUYER",
    });
    steps.returns = { status: returns.status, body: returns.json };

    return steps;
  },
});
