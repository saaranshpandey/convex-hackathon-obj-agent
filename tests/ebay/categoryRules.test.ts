import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCategoryQuery,
  parseCategorySuggestion,
  parseConditionIds,
  parseRequiredDetails,
  pickCondition,
} from "../../convex/ebay/categoryRules";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8"));

describe("buildCategoryQuery", () => {
  it("joins brand, model and generic name, skipping what is unknown", () => {
    expect(buildCategoryQuery({ brand: "Acer", model: null, genericName: "computer monitor" })).toBe(
      "Acer computer monitor",
    );
    expect(
      buildCategoryQuery({ brand: "Sony", model: "DualSense", genericName: "game controller" }),
    ).toBe("Sony DualSense game controller");
    expect(buildCategoryQuery({ brand: null, model: null, genericName: "desk" })).toBe("desk");
  });
});

describe("parseCategorySuggestion", () => {
  it("returns eBay's top suggestion", () => {
    expect(parseCategorySuggestion(fixture("category-suggestions"))).toEqual({
      categoryId: "80053",
      categoryName: "Monitors",
    });
  });

  it("returns null when there is nothing usable", () => {
    expect(parseCategorySuggestion({ categorySuggestions: [] })).toBeNull();
    expect(parseCategorySuggestion({})).toBeNull();
    expect(parseCategorySuggestion(null)).toBeNull();
    expect(parseCategorySuggestion({ categorySuggestions: [{ category: {} }] })).toBeNull();
  });
});

describe("parseRequiredDetails", () => {
  it("keeps only required details, with allowed values only for restricted ones", () => {
    expect(parseRequiredDetails(fixture("category-aspects"))).toEqual([
      { name: "Brand", mode: "FREE_TEXT", allowedValues: [] },
      { name: "Screen Size", mode: "FREE_TEXT", allowedValues: [] },
      { name: "Refresh Rate", mode: "SELECTION_ONLY", allowedValues: ["60 Hz", "144 Hz"] },
    ]);
  });

  it("returns nothing for an unexpected payload", () => {
    expect(parseRequiredDetails({})).toEqual([]);
    expect(parseRequiredDetails(null)).toEqual([]);
  });
});

describe("parseConditionIds", () => {
  it("reads the valid condition IDs for the category as numbers", () => {
    expect(parseConditionIds(fixture("condition-policies"))).toEqual([1000, 1500, 2500, 3000, 7000]);
  });

  it("returns nothing for an unexpected payload", () => {
    expect(parseConditionIds({})).toEqual([]);
    expect(parseConditionIds({ itemConditionPolicies: [{ itemConditions: [{ conditionId: null }] }] })).toEqual([]);
  });
});

describe("pickCondition", () => {
  it("takes the first preferred condition the category accepts", () => {
    expect(pickCondition("new", [1000, 1500, 3000])).toBe("NEW");
    expect(pickCondition("like_new", [1000, 2750, 3000])).toBe("LIKE_NEW");
    expect(pickCondition("good", [1000, 4000, 5000])).toBe("USED_GOOD");
    expect(pickCondition("fair", [1000, 5000])).toBe("USED_GOOD");
  });

  it("falls back to plain Used when the category only allows that", () => {
    expect(pickCondition("good", [1000, 3000])).toBe("USED_EXCELLENT");
    expect(pickCondition("new", [3000, 7000])).toBe("USED_EXCELLENT");
    expect(pickCondition("poor", [1000, 3000])).toBe("USED_EXCELLENT");
  });

  it("keeps the first preference when nothing matches, so publish still tries", () => {
    expect(pickCondition("poor", [1000])).toBe("USED_ACCEPTABLE");
    expect(pickCondition("good", [])).toBe("USED_GOOD");
  });
});
