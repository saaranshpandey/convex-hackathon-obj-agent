import type { RequiredDetail } from "./categoryRules";

export const DOES_NOT_APPLY = "Does not apply";

const DEFAULT_MODEL = "gpt-5.6-luna";
const MAX_SHOWN_ALLOWED_VALUES = 60;

export type ItemFacts = {
  genericName: string;
  brand: string | null;
  model: string | null;
  category: string;
  condition: string;
  attributes: string[];
};

const SYSTEM_PROMPT = `You fill in required eBay item details for a used-item listing.

Rules:
- Use ONLY facts stated in the item information you are given. Never guess.
- Never invent measurements, sizes or counts. If a value is not stated, answer "Does not apply".
- Brand: the manufacturer if stated, otherwise "Unbranded".
- For details with a list of choices, answer with exactly one item from that list, copied exactly. If none clearly fits, answer "Does not apply".
- Answers are short values (a few words), never sentences.`;

/** What the photo analysis established, under eBay's most common detail names. */
export function knownDetailValues(facts: ItemFacts): Record<string, string> {
  const known: Record<string, string> = { Type: facts.category };
  if (facts.brand) known.Brand = facts.brand;
  if (facts.model) known.Model = facts.model;
  return known;
}

/** Guarantees every required detail has a valid, non-empty value. */
export function normalizeDetails(
  required: RequiredDetail[],
  raw: Record<string, unknown>,
): Record<string, string[]> {
  const details: Record<string, string[]> = {};

  for (const detail of required) {
    const fallback = detail.name.toLowerCase() === "brand" ? "Unbranded" : DOES_NOT_APPLY;
    const candidate = typeof raw[detail.name] === "string" ? (raw[detail.name] as string).trim() : "";
    let value = candidate === "" ? fallback : candidate;

    if (detail.mode === "SELECTION_ONLY" && detail.allowedValues.length > 0) {
      const match = detail.allowedValues.find(
        (allowed) => allowed.toLowerCase() === value.toLowerCase(),
      );
      value = match ?? DOES_NOT_APPLY;
    }

    details[detail.name] = [value];
  }

  return details;
}

/** Keyed on an index because eBay's detail names can contain odd characters. */
export function buildDetailsSchema(required: RequiredDetail[]) {
  const properties: Record<string, { type: "string" }> = {};
  required.forEach((_, index) => {
    properties[`d${index}`] = { type: "string" };
  });

  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  } as const;
}

export function buildDetailsPrompt(input: {
  required: RequiredDetail[];
  facts: ItemFacts;
  title: string;
  description: string;
}): string {
  const fields = input.required.map((detail, index) => {
    const choices =
      detail.mode === "SELECTION_ONLY" && detail.allowedValues.length > 0
        ? ` — choose exactly one of: ${detail.allowedValues.slice(0, MAX_SHOWN_ALLOWED_VALUES).join(" | ")}`
        : " — free text";
    return `d${index}: ${detail.name}${choices}`;
  });

  const { facts } = input;
  return [
    "Details to fill in:",
    ...fields,
    "",
    "Item information:",
    `Title: ${input.title}`,
    `Description: ${input.description}`,
    `Kind of item: ${facts.genericName} (${facts.category})`,
    `Brand: ${facts.brand ?? "unknown"}`,
    `Model: ${facts.model ?? "unknown"}`,
    `Visible attributes: ${facts.attributes.join("; ") || "none"}`,
  ].join("\n");
}

/**
 * One small OpenAI call fills the category's required details. An OpenAI
 * problem never blocks a publish: it falls back to what we already know.
 */
export async function fillItemDetails(input: {
  apiKey: string;
  model?: string;
  required: RequiredDetail[];
  facts: ItemFacts;
  title: string;
  description: string;
}): Promise<Record<string, string[]>> {
  if (input.required.length === 0) return {};

  const known = knownDetailValues(input.facts);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model ?? DEFAULT_MODEL,
        reasoning_effort: "low",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildDetailsPrompt(input) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ebay_item_details",
            strict: true,
            schema: buildDetailsSchema(input.required),
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned an empty response");
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const byName: Record<string, unknown> = {};
    input.required.forEach((detail, index) => {
      const answer = parsed[`d${index}`];
      const text = typeof answer === "string" ? answer.trim() : "";
      const usable = text !== "" && text.toLowerCase() !== DOES_NOT_APPLY.toLowerCase();
      byName[detail.name] = usable ? text : (known[detail.name] ?? text);
    });

    return normalizeDetails(input.required, byName);
  } catch (error) {
    console.warn(
      "eBay item-detail fill failed; using known values only:",
      error instanceof Error ? error.message : error,
    );
    return normalizeDetails(input.required, known);
  }
}
