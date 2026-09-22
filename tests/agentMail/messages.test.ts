import { describe, expect, it } from "vitest";
import { listingLiveEmail, listingSoldEmail } from "../../convex/agentMail/messages";

describe("listingLiveEmail", () => {
  it("names the item, price and link for a real listing", () => {
    const { subject, text } = listingLiveEmail({
      title: "White Desk",
      price: 120,
      url: "https://sandbox.ebay.com/itm/1",
      mode: "sandbox",
    });

    expect(subject).toBe("Your White Desk is live on eBay");
    expect(text).toContain("Price: $120");
    expect(text).toContain("https://sandbox.ebay.com/itm/1");
    expect(text).not.toContain("demo");
  });

  it("labels a mock listing as a demo", () => {
    const { subject, text } = listingLiveEmail({
      title: "White Desk",
      price: 120,
      url: "https://example.com/mock",
      mode: "mock",
    });

    expect(subject).toBe("(Demo) Your White Desk is listed");
    expect(text).toContain("demo listing");
  });
});

describe("listingSoldEmail", () => {
  it("names the item and the settled price when the owner accepted", () => {
    const { subject, text } = listingSoldEmail({
      title: "White Desk",
      price: 160,
      viaCounter: false,
      mode: "production",
    });

    expect(subject).toBe("Your White Desk sold for $160");
    expect(text).toContain("You accepted the offer");
    expect(text).toContain("Sold for: $160");
    expect(text).not.toContain("demo");
  });

  it("says so when the buyer took the counter", () => {
    const { text } = listingSoldEmail({
      title: "White Desk",
      price: 144,
      viaCounter: true,
      mode: "production",
    });

    expect(text).toContain("The buyer accepted your counter");
  });

  /** "Sold" is the strongest claim this app makes; a simulated one must say so. */
  it("labels a mock sale as a demo", () => {
    const { subject, text } = listingSoldEmail({
      title: "White Desk",
      price: 160,
      viaCounter: false,
      mode: "mock",
    });

    expect(subject).toBe("(Demo) Your White Desk sold for $160");
    expect(text).toContain("demo sale");
    expect(text).toContain("nothing was really sold");
  });
});
