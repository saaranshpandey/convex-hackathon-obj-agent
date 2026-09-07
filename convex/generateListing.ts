/**
 * Generates a marketplace-ready listing draft from an item's identification
 * and resale research. Grounded strictly in that evidence — never invents a
 * spec, feature, or accessory the earlier stages didn't establish.
 */

import { ResearchError, type IdentificationResult } from "./identify";

const DEFAULT_MODEL = "gpt-5.6-luna";
const REASONING_EFFORT = "low";

export type ListingCondition = "new" | "like_new" | "good" | "fair" | "poor";

export type ListingDraft = {
  title: string;
  description: string;
  category: string;
  condition: ListingCondition;
  price: number;
};

const SYSTEM_PROMPT = `You write a marketplace listing draft for a second-hand item, for eBay.

Use ONLY the identification and pricing research you are given. Never invent a specification, feature, model number, or accessory that isn't stated in that information.

Produce:
- title: a concise, searchable listing title (under 80 characters). Include the brand and model only if they were actually identified; otherwise describe it generically and honestly.
- description: 2-4 sentences a buyer would read: what it is, its condition, and any notable given attributes. Do not mention research sources, dollar ranges, or how the price was determined.
- category: a plausible eBay-style category name for this item (e.g. "Video Games & Consoles", "Home & Garden > Small Kitchen Appliances").
- condition: the closest match from new, like_new, good, fair, poor, based on the condition description given.
- price: the listing price. Use the recommended price you are given unless a very slightly different, cleaner round number reads better for a listing.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    category: { type: "string" },
    condition: { type: "string", enum: ["new", "like_new", "good", "fair", "poor"] },
    price: { type: "number" },
  },
  required: ["title", "description", "category", "condition", "price"],
  additionalProperties: false,
} as const;

function buildPrompt(input: {
  identification: IdentificationResult;
  estimatedLow: number;
  estimatedHigh: number;
  recommendedPrice: number;
  rationale: string;
}): string {
  const { identification } = input;
  return [
    `Generic name: ${identification.genericName}`,
    identification.brand ? `Brand: ${identification.brand}` : "Brand: unknown",
    identification.model ? `Model: ${identification.model}` : "Model: unknown",
    `Category (detected): ${identification.category}`,
    `Condition (observed): ${identification.condition}`,
    `Attributes: ${identification.attributes.join(", ") || "none noted"}`,
    `Identification confidence: ${identification.confidence}`,
    `Estimated resale range: $${input.estimatedLow}-$${input.estimatedHigh}`,
    `Recommended price: $${input.recommendedPrice}`,
    `Pricing rationale: ${input.rationale}`,
  ].join("\n");
}

export async function generateListing(input: {
  apiKey: string;
  model?: string;
  identification: IdentificationResult;
  estimatedLow: number;
  estimatedHigh: number;
  recommendedPrice: number;
  rationale: string;
}): Promise<ListingDraft> {
  const model = input.model ?? DEFAULT_MODEL;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning_effort: REASONING_EFFORT,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "listing_draft",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new ResearchError(
        "OpenAI rejected the API key. Check OPENAI_API_KEY in your Convex environment.",
      );
    }
    if (response.status === 429) {
      throw new ResearchError(
        "OpenAI rate limit reached. Wait a moment and try again.",
        429,
      );
    }
    throw new ResearchError(
      `OpenAI listing request failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string; refusal?: string } }[];
  };

  const message = payload.choices?.[0]?.message;
  if (message?.refusal) {
    throw new ResearchError("The model declined to draft a listing.");
  }

  const content = message?.content;
  if (!content) {
    throw new ResearchError("OpenAI returned an empty listing response.");
  }

  let parsed: Partial<ListingDraft>;
  try {
    parsed = JSON.parse(content) as Partial<ListingDraft>;
  } catch {
    throw new ResearchError(
      "OpenAI returned a listing response that was not valid JSON.",
    );
  }

  if (
    typeof parsed.title !== "string" ||
    typeof parsed.description !== "string" ||
    typeof parsed.category !== "string" ||
    typeof parsed.price !== "number" ||
    (parsed.condition !== "new" &&
      parsed.condition !== "like_new" &&
      parsed.condition !== "good" &&
      parsed.condition !== "fair" &&
      parsed.condition !== "poor")
  ) {
    throw new ResearchError("OpenAI returned a listing in an unexpected shape.");
  }

  return {
    title: parsed.title.slice(0, 80),
    description: parsed.description,
    category: parsed.category,
    condition: parsed.condition,
    price: Math.max(0, Math.round(parsed.price)),
  };
}
