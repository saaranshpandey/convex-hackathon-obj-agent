import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEbayUserId, parseEbayUserId } from "../../convex/ebay/identity";
import { fakeEbay } from "./fakeFetch";

afterEach(() => vi.unstubAllGlobals());

describe("parseEbayUserId", () => {
  it("reads the immutable user ID", () => {
    expect(parseEbayUserId({ userId: "abc123", username: "seller", accountType: "INDIVIDUAL" })).toBe("abc123");
  });

  it("returns null when it is missing or not text", () => {
    expect(parseEbayUserId({})).toBeNull();
    expect(parseEbayUserId({ userId: "" })).toBeNull();
    expect(parseEbayUserId({ userId: 5 })).toBeNull();
    expect(parseEbayUserId(null)).toBeNull();
  });
});

describe("fetchEbayUserId", () => {
  it("asks the Identity API host, not the regular one", async () => {
    const calls = fakeEbay({
      "GET /commerce/identity/v1/user/": () => ({ status: 200, json: { userId: "u1", username: "seller" } }),
    });

    expect(await fetchEbayUserId("production", "seller-token")).toBe("u1");
    expect(calls[0].host).toBe("apiz.ebay.com");

    await fetchEbayUserId("sandbox", "seller-token");
    expect(calls[1].host).toBe("apiz.sandbox.ebay.com");
  });

  it("fails clearly when eBay does not return an ID", async () => {
    fakeEbay({ "GET /commerce/identity/v1/user/": () => ({ status: 200, json: {} }) });

    await expect(fetchEbayUserId("production", "seller-token")).rejects.toThrow(
      "eBay didn't return your account ID.",
    );
  });
});
