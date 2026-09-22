import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureSellerSetup } from "../../convex/ebay/sellerSetup";
import { fakeEbay, type FakeHandlers } from "./fakeFetch";

afterEach(() => vi.unstubAllGlobals());

const input = { env: "sandbox" as const, accessToken: "seller-token", postalCode: "94105" };

const freshSeller: FakeHandlers = {
  "POST /sell/account/v1/program/opt_in": () => ({ status: 200 }),
  "GET /sell/inventory/v1/location/roomly-94105": () => ({ status: 404, json: {} }),
  "POST /sell/inventory/v1/location/roomly-94105": () => ({ status: 204 }),
  "GET /sell/account/v1/fulfillment_policy": () => ({ status: 200, json: { total: 0 } }),
  "POST /sell/account/v1/fulfillment_policy": () => ({ status: 201, json: { fulfillmentPolicyId: "F1" } }),
  "GET /sell/account/v1/payment_policy": () => ({ status: 200, json: { total: 0 } }),
  "POST /sell/account/v1/payment_policy": () => ({ status: 201, json: { paymentPolicyId: "P1" } }),
  "GET /sell/account/v1/return_policy": () => ({ status: 200, json: { total: 0 } }),
  "POST /sell/account/v1/return_policy": () => ({ status: 201, json: { returnPolicyId: "R1" } }),
};

const returningSeller: FakeHandlers = {
  "POST /sell/account/v1/program/opt_in": () => ({ status: 409, json: { errors: [{ message: "already" }] } }),
  "GET /sell/inventory/v1/location/roomly-94105": () => ({ status: 200, json: {} }),
  "GET /sell/account/v1/fulfillment_policy": () => ({
    status: 200,
    json: {
      fulfillmentPolicies: [
        { name: "Someone else's policy", fulfillmentPolicyId: "X" },
        { name: "Roomly Standard Shipping", fulfillmentPolicyId: "F9" },
      ],
    },
  }),
  "GET /sell/account/v1/payment_policy": () => ({
    status: 200,
    json: { paymentPolicies: [{ name: "Roomly Standard Payment", paymentPolicyId: "P9" }] },
  }),
  "GET /sell/account/v1/return_policy": () => ({
    status: 200,
    json: { returnPolicies: [{ name: "Roomly Standard Returns", returnPolicyId: "R9" }] },
  }),
};

describe("ensureSellerSetup", () => {
  it("creates the location and all three policies for a brand-new seller", async () => {
    const calls = fakeEbay(freshSeller);

    const setup = await ensureSellerSetup(input);

    expect(setup).toEqual({
      locationKey: "roomly-94105",
      fulfillmentPolicyId: "F1",
      paymentPolicyId: "P1",
      returnPolicyId: "R1",
    });
    const posts = calls.filter((c) => c.method === "POST").map((c) => c.path);
    expect(posts).toEqual([
      "/sell/account/v1/program/opt_in",
      "/sell/inventory/v1/location/roomly-94105",
      "/sell/account/v1/fulfillment_policy",
      "/sell/account/v1/payment_policy",
      "/sell/account/v1/return_policy",
    ]);
    const location = calls.find((c) => c.method === "POST" && c.path.includes("/location/"));
    expect(location?.body).toMatchObject({
      location: { address: { postalCode: "94105", country: "US" } },
    });
    const shipping = calls.find((c) => c.path === "/sell/account/v1/fulfillment_policy" && c.method === "POST");
    expect(shipping?.body).toMatchObject({ name: "Roomly Standard Shipping", marketplaceId: "EBAY_US" });
  });

  it("reuses an existing location and policies, and tolerates 'already opted in'", async () => {
    const calls = fakeEbay(returningSeller);

    const setup = await ensureSellerSetup(input);

    expect(setup).toEqual({
      locationKey: "roomly-94105",
      fulfillmentPolicyId: "F9",
      paymentPolicyId: "P9",
      returnPolicyId: "R9",
    });
    const creates = calls.filter(
      (c) => c.method === "POST" && !c.path.endsWith("/opt_in"),
    );
    expect(creates).toEqual([]);
  });

  it("treats a 404 policy list as empty and creates the policy", async () => {
    fakeEbay({
      ...freshSeller,
      "GET /sell/account/v1/payment_policy": () => ({ status: 404, json: {} }),
    });

    const setup = await ensureSellerSetup(input);

    expect(setup.paymentPolicyId).toBe("P1");
  });

  it("keeps a ZIP+4 in the address but shares the 5-digit location key", async () => {
    const calls = fakeEbay(freshSeller);

    await ensureSellerSetup({ ...input, postalCode: "94105-1234" });

    const location = calls.find((c) => c.method === "POST" && c.path.includes("/location/"));
    expect(location?.body).toMatchObject({ location: { address: { postalCode: "94105-1234" } } });
  });

  it("stops and asks the seller to reconnect when eBay rejects their token", async () => {
    fakeEbay({ "POST /sell/account/v1/program/opt_in": () => ({ status: 401, json: {} }) });

    await expect(ensureSellerSetup(input)).rejects.toThrow("Reconnect your eBay account");
  });
});
