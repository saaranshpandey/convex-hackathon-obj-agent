import { describe, expect, it } from "vitest";
import { getCategoryRules, suggestCategory } from "../../convex/ebay/categoryRules";
import { getAppAccessToken } from "../../convex/ebay/oauth";

const live =
  process.env.EBAY_LIVE === "1" && !!process.env.EBAY_CLIENT_ID && !!process.env.EBAY_CLIENT_SECRET;

describe.skipIf(!live)("eBay sandbox lookups (live)", () => {
  it("finds sensible categories and their rules for real items", async () => {
    const appToken = await getAppAccessToken({
      env: "sandbox",
      clientId: process.env.EBAY_CLIENT_ID!,
      clientSecret: process.env.EBAY_CLIENT_SECRET!,
    });

    const controller = await suggestCategory("sandbox", appToken, "Sony DualSense wireless controller");
    expect(controller?.categoryId).toBe("117042");

    const monitor = await suggestCategory("sandbox", appToken, "Acer curved computer monitor");
    expect(monitor?.categoryId).toBe("80053");

    const rules = await getCategoryRules("sandbox", appToken, monitor!.categoryId);
    expect(rules.requiredDetails.map((detail) => detail.name)).toEqual(
      expect.arrayContaining(["Brand", "Screen Size"]),
    );
    expect(rules.validConditionIds).toContain(3000);
  });
});
