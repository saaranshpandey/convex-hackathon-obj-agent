import { afterEach, describe, expect, it, vi } from "vitest";
import { createSandboxPublisher } from "../../convex/ebay/sandbox";
import type { PublishInput } from "../../convex/ebay/types";
import { fakeEbay, type FakeHandlers } from "./fakeFetch";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const input: PublishInput = {
  accessToken: "seller-token",
  env: "production",
  categoryId: "80053",
  merchantLocationKey: "roomsale-94105",
  fulfillmentPolicyId: "F1",
  paymentPolicyId: "P1",
  returnPolicyId: "R1",
  listing: {
    sku: "sku-1",
    title: "Acer monitor",
    description: "A monitor",
    price: 100,
    imageUrl: "https://example.convex.cloud/api/storage/abc",
    ebayCondition: "USED_EXCELLENT",
    aspects: { Brand: ["Acer"] },
  },
};

const systemError = {
  errors: [
    {
      errorId: 25001,
      domain: "API_INVENTORY",
      message: "A system error has occurred. Core Inventory Service internal error",
    },
  ],
};

const restOfPublish: FakeHandlers = {
  "POST /sell/inventory/v1/offer": () => ({ status: 201, json: { offerId: "111" } }),
  "POST /sell/inventory/v1/offer/111/publish": () => ({ status: 200, json: { listingId: "222" } }),
};

const saves = (calls: { method: string }[]) => calls.filter((call) => call.method === "PUT");

describe("saving the inventory item", () => {
  it("retries eBay's server errors, then publishes", async () => {
    vi.useFakeTimers();
    let puts = 0;
    const calls = fakeEbay({
      "PUT /sell/inventory/v1/inventory_item/sku-1": () =>
        ++puts === 1 ? { status: 500, json: systemError } : { status: 204 },
      ...restOfPublish,
    });

    const publishing = createSandboxPublisher("production").publish(input);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await publishing).toEqual({
      ebayListingId: "222",
      ebayOfferId: "111",
      ebayListingUrl: "https://www.ebay.com/itm/222",
    });
    expect(saves(calls)).toHaveLength(2);
  });

  it("gives up after three server errors and logs what it sent, never the token", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = fakeEbay({
      "PUT /sell/inventory/v1/inventory_item/sku-1": () => ({ status: 500, json: systemError }),
    });

    const publishing = createSandboxPublisher("production").publish(input);
    const failure = expect(publishing).rejects.toThrow("Core Inventory Service internal error");
    await vi.advanceTimersByTimeAsync(10_000);
    await failure;

    expect(saves(calls)).toHaveLength(3);
    const logged = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("sku-1");
    expect(logged).toContain("Acer monitor");
    expect(logged).not.toContain("seller-token");
  });

  it("does not retry a request eBay rejected", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = fakeEbay({
      "PUT /sell/inventory/v1/inventory_item/sku-1": () => ({
        status: 400,
        json: { errors: [{ errorId: 25709, message: "Invalid value for imageUrls" }] },
      }),
    });

    await expect(createSandboxPublisher("production").publish(input)).rejects.toThrow(
      "Invalid value for imageUrls",
    );
    expect(saves(calls)).toHaveLength(1);
  });
});
