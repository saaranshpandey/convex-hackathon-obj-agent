import { describe, expect, it } from "vitest";
import { listingLiveEmail } from "../../convex/agentMail/messages";

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
