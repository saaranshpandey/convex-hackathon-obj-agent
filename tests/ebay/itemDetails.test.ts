import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequiredDetail } from "../../convex/ebay/categoryRules";
import {
  buildDetailsPrompt,
  buildDetailsSchema,
  fillItemDetails,
  knownDetailValues,
  normalizeDetails,
  type ItemFacts,
} from "../../convex/ebay/itemDetails";
import { fakeEbay } from "./fakeFetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const required: RequiredDetail[] = [
  { name: "Brand", mode: "FREE_TEXT", allowedValues: [] },
  { name: "Screen Size", mode: "FREE_TEXT", allowedValues: [] },
  { name: "Refresh Rate", mode: "SELECTION_ONLY", allowedValues: ["60 Hz", "144 Hz"] },
];

const facts: ItemFacts = {
  genericName: "computer monitor",
  brand: "Acer",
  model: null,
  category: "computer monitor",
  condition: "Looks lightly used",
  attributes: ["Black bezel", "Curved screen"],
};

describe("knownDetailValues", () => {
  it("offers what the photo analysis established, under eBay's usual names", () => {
    expect(knownDetailValues(facts)).toEqual({ Type: "computer monitor", Brand: "Acer" });
    expect(knownDetailValues({ ...facts, brand: null, model: "DualSense" })).toEqual({
      Type: "computer monitor",
      Model: "DualSense",
    });
  });
});

describe("normalizeDetails", () => {
  it("trims values and fills gaps with Does not apply, and Unbranded for Brand", () => {
    expect(
      normalizeDetails(required, { Brand: "  Acer ", "Screen Size": "", "Refresh Rate": "144 hz" }),
    ).toEqual({
      Brand: ["Acer"],
      "Screen Size": ["Does not apply"],
      "Refresh Rate": ["144 Hz"],
    });

    expect(normalizeDetails(required, {})).toEqual({
      Brand: ["Unbranded"],
      "Screen Size": ["Does not apply"],
      "Refresh Rate": ["Does not apply"],
    });
  });

  it("replaces a restricted-list value that is not on the list", () => {
    expect(normalizeDetails(required, { "Refresh Rate": "240 Hz" })["Refresh Rate"]).toEqual([
      "Does not apply",
    ]);
  });
});

describe("buildDetailsSchema", () => {
  it("keys the schema on an index so odd eBay names cannot break it", () => {
    const schema = buildDetailsSchema(required);

    expect(Object.keys(schema.properties)).toEqual(["d0", "d1", "d2"]);
    expect(schema.required).toEqual(["d0", "d1", "d2"]);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("buildDetailsPrompt", () => {
  it("lists each detail, its choices, and the known facts", () => {
    const prompt = buildDetailsPrompt({
      required,
      facts,
      title: "Acer Curved Monitor",
      description: "27 inch curved monitor",
    });

    expect(prompt).toContain("d0: Brand — free text");
    expect(prompt).toContain("d2: Refresh Rate — choose exactly one of: 60 Hz | 144 Hz");
    expect(prompt).toContain("Title: Acer Curved Monitor");
    expect(prompt).toContain("Brand: Acer");
    expect(prompt).toContain("Model: unknown");
    expect(prompt).toContain("Black bezel; Curved screen");
  });
});

function openAiReturning(content: unknown, status = 200) {
  return fakeEbay({
    "POST /v1/chat/completions": () => ({
      status,
      json: status === 200 ? { choices: [{ message: { content: JSON.stringify(content) } }] } : {},
    }),
  });
}

describe("fillItemDetails", () => {
  const input = {
    apiKey: "key",
    required,
    facts,
    title: "Acer Curved Monitor",
    description: "27 inch curved monitor",
  };

  it("maps the model's indexed answers back to eBay's detail names", async () => {
    const calls = openAiReturning({ d0: "Acer", d1: "27 in", d2: "144 Hz" });

    const details = await fillItemDetails(input);

    expect(details).toEqual({
      Brand: ["Acer"],
      "Screen Size": ["27 in"],
      "Refresh Rate": ["144 Hz"],
    });
    expect(calls).toHaveLength(1);
  });

  it("keeps a known value when the model says Does not apply", async () => {
    openAiReturning({ d0: "Does not apply", d1: "Does not apply", d2: "Does not apply" });

    const details = await fillItemDetails(input);

    expect(details.Brand).toEqual(["Acer"]);
    expect(details["Screen Size"]).toEqual(["Does not apply"]);
  });

  it("falls back to known values when OpenAI fails, instead of blocking publish", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    openAiReturning({}, 500);

    const details = await fillItemDetails(input);

    expect(details).toEqual({
      Brand: ["Acer"],
      "Screen Size": ["Does not apply"],
      "Refresh Rate": ["Does not apply"],
    });
  });

  it("makes no call when the category requires nothing", async () => {
    const calls = openAiReturning({});

    expect(await fillItemDetails({ ...input, required: [] })).toEqual({});
    expect(calls).toHaveLength(0);
  });
});
