import { ebayRequest } from "./http";
import { locationKeyFor } from "./postalCode";
import { EbayError, type EbayEnv, type SellerSetup } from "./types";

const CATEGORY_TYPES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

type PolicySpec = {
  name: string;
  path: string;
  listKey: string;
  idKey: string;
  body: Record<string, unknown>;
};

const FULFILLMENT: PolicySpec = {
  name: "Roomly Standard Shipping",
  path: "/sell/account/v1/fulfillment_policy",
  listKey: "fulfillmentPolicies",
  idKey: "fulfillmentPolicyId",
  body: {
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
  },
};

const PAYMENT: PolicySpec = {
  name: "Roomly Standard Payment",
  path: "/sell/account/v1/payment_policy",
  listKey: "paymentPolicies",
  idKey: "paymentPolicyId",
  body: { immediatePay: false },
};

const RETURNS: PolicySpec = {
  name: "Roomly Standard Returns",
  path: "/sell/account/v1/return_policy",
  listKey: "returnPolicies",
  idKey: "returnPolicyId",
  body: {
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: "DAY" },
    refundMethod: "MONEY_BACK",
    returnShippingCostPayer: "BUYER",
  },
};

/**
 * Publishing several listings at once runs one action per listing, so they all
 * reach setup together, all find nothing, and all try to create it. Whoever
 * loses that race gets a duplicate error naming what the winner made — the
 * end state is what we wanted, so adopt it instead of failing the listing.
 */
function duplicateOf(error: unknown, needle: string): string | null {
  if (!(error instanceof EbayError) || error.status !== 400) return null;
  const body = error.body ?? error.message;
  return body.includes(needle) ? body : null;
}

/** eBay returns the surviving policy's id as a `duplicatePolicyId` parameter. */
function duplicatePolicyId(body: string): string | null {
  const match = /"duplicatePolicyId"\s*,\s*"value"\s*:\s*"([^"]+)"/.exec(body);
  return match?.[1] ?? null;
}

/** New sellers must opt in before they can create business policies. */
async function optIn(env: EbayEnv, accessToken: string): Promise<void> {
  try {
    await ebayRequest(env, accessToken, "POST", "/sell/account/v1/program/opt_in", {
      programType: "SELLING_POLICY_MANAGEMENT",
    });
  } catch (error) {
    // "Already opted in" comes back as a 4xx; a real problem shows up when the
    // policies are created. Only a rejected token must stop us here.
    const tolerable =
      error instanceof EbayError &&
      error.status !== undefined &&
      error.status < 500 &&
      error.status !== 401;
    if (!tolerable) throw error;
  }
}

async function ensureLocation(
  env: EbayEnv,
  accessToken: string,
  postalCode: string,
): Promise<string> {
  const key = locationKeyFor(postalCode);

  try {
    await ebayRequest(env, accessToken, "GET", `/sell/inventory/v1/location/${key}`);
    return key;
  } catch (error) {
    if (!(error instanceof EbayError) || error.status !== 404) throw error;
  }

  try {
    await ebayRequest(env, accessToken, "POST", `/sell/inventory/v1/location/${key}`, {
      location: { address: { postalCode: postalCode.trim(), country: "US" } },
      locationTypes: ["WAREHOUSE"],
      name: `Roomly ship-from ${key.slice(-5)}`,
      merchantLocationStatus: "ENABLED",
    });
  } catch (error) {
    // Another publish created it between our GET and our POST.
    if (duplicateOf(error, "merchantLocationKey already exists") === null) throw error;
  }
  return key;
}

async function findOrCreatePolicy(
  env: EbayEnv,
  accessToken: string,
  spec: PolicySpec,
): Promise<string> {
  let existing: unknown[] = [];
  try {
    const listed = await ebayRequest(env, accessToken, "GET", `${spec.path}?marketplace_id=EBAY_US`);
    const candidates = listed[spec.listKey];
    existing = Array.isArray(candidates) ? candidates : [];
  } catch (error) {
    if (!(error instanceof EbayError) || error.status !== 404) throw error;
  }

  for (const policy of existing) {
    const record = policy as Record<string, unknown> | null;
    if (record !== null && record.name === spec.name && typeof record[spec.idKey] === "string") {
      return record[spec.idKey] as string;
    }
  }

  let created: Record<string, unknown>;
  try {
    created = await ebayRequest(env, accessToken, "POST", spec.path, {
      name: spec.name,
      marketplaceId: "EBAY_US",
      categoryTypes: CATEGORY_TYPES,
      ...spec.body,
    });
  } catch (error) {
    // Another publish created it between our list and our POST. eBay names the
    // surviving policy in the error, so take that id rather than failing.
    const duplicate = duplicateOf(error, "Duplicate Policy");
    const existingId = duplicate === null ? null : duplicatePolicyId(duplicate);
    if (existingId === null) throw error;
    return existingId;
  }

  const id = created[spec.idKey];
  if (typeof id !== "string") throw new EbayError(`eBay did not return a ${spec.idKey}.`);
  return id;
}

/**
 * Makes sure this seller has their own shipping location and business
 * policies, reusing ours by name when they exist so a retry never duplicates.
 */
export async function ensureSellerSetup(input: {
  env: EbayEnv;
  accessToken: string;
  postalCode: string;
}): Promise<SellerSetup> {
  await optIn(input.env, input.accessToken);
  const locationKey = await ensureLocation(input.env, input.accessToken, input.postalCode);
  const fulfillmentPolicyId = await findOrCreatePolicy(input.env, input.accessToken, FULFILLMENT);
  const paymentPolicyId = await findOrCreatePolicy(input.env, input.accessToken, PAYMENT);
  const returnPolicyId = await findOrCreatePolicy(input.env, input.accessToken, RETURNS);

  return { locationKey, fulfillmentPolicyId, paymentPolicyId, returnPolicyId };
}
