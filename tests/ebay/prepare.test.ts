import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveListingSpec } from "../../convex/ebay/prepare";
import { fakeEbay } from "./fakeFetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8"));

const TAXONOMY = "/commerce/taxonomy/v1/category_tree/0";

const input = {
  env: "sandbox" as const,
  appToken: "app-token",
  openaiApiKey: "key",
  facts: {
    genericName: "computer monitor",
    brand: "Acer",
    model: null,
    category: "computer monitor",
    condition: "Looks lightly used",
    attributes: ["Curved screen"],
  },
  title: "Acer Curved Monitor",
  description: "27 inch curved monitor",
  condition: "good" as const,
};

describe("resolveListingSpec", () => {
  it("finds the category, a valid condition, and the required details", async () => {
    const calls = fakeEbay({
      [`GET ${TAXONOMY}/get_category_suggestions`]: () => ({
        status: 200,
        json: fixture("category-suggestions"),
      }),
      [`GET ${TAXONOMY}/get_item_aspects_for_category`]: () => ({
        status: 200,
        json: fixture("category-aspects"),
      }),
      "GET /sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies": () => ({
        status: 200,
        json: fixture("condition-policies"),
      }),
      "POST /v1/chat/completions": () => ({
        status: 200,
        json: {
          choices: [{ message: { content: JSON.stringify({ d0: "Acer", d1: "27 in", d2: "144 Hz" }) } }],
        },
      }),
    });

    const spec = await resolveListingSpec(input);

    expect(spec).toEqual({
      categoryId: "80053",
      categoryName: "Monitors",
      ebayCondition: "USED_EXCELLENT",
      aspects: { Brand: ["Acer"], "Screen Size": ["27 in"], "Refresh Rate": ["144 Hz"] },
    });
    const search = calls.find((call) => call.path.endsWith("get_category_suggestions"));
    expect(decodeURIComponent(search?.query ?? "")).toContain("Acer computer monitor");
  });

  it("retries the category search with the listing title, then gives up clearly", async () => {
    const calls = fakeEbay({
      [`GET ${TAXONOMY}/get_category_suggestions`]: () => ({
        status: 200,
        json: { categorySuggestions: [] },
      }),
    });

    await expect(resolveListingSpec(input)).rejects.toThrow(
      'Couldn\'t find an eBay category for "Acer computer monitor".',
    );
    expect(calls.filter((call) => call.path.endsWith("get_category_suggestions"))).toHaveLength(2);
  });

  it("still resolves when OpenAI is down, using what is known", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeEbay({
      [`GET ${TAXONOMY}/get_category_suggestions`]: () => ({
        status: 200,
        json: fixture("category-suggestions"),
      }),
      [`GET ${TAXONOMY}/get_item_aspects_for_category`]: () => ({
        status: 200,
        json: fixture("category-aspects"),
      }),
      "GET /sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies": () => ({
        status: 200,
        json: fixture("condition-policies"),
      }),
      "POST /v1/chat/completions": () => ({ status: 500, json: {} }),
    });

    const spec = await resolveListingSpec(input);

    expect(spec.aspects).toEqual({
      Brand: ["Acer"],
      "Screen Size": ["Does not apply"],
      "Refresh Rate": ["Does not apply"],
    });
  });
});
