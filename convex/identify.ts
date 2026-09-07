/**
 * Identifies a single detected object inside a room photo: a generic name,
 * best-guess brand/model (never hallucinated), category, condition, and
 * confidence. Perception plus a light guess, not deep reasoning, so this
 * mirrors segmentation/openai.ts's low-effort choice for the same reason.
 */

const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_REASONING_EFFORT = "low";

export class ResearchError extends Error {
  /** Upstream HTTP status, when there was one. Drives retry decisions. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ResearchError";
    this.status = status;
  }
}

export type IdentificationResult = {
  genericName: string;
  brand: string | null;
  model: string | null;
  category: string;
  condition: string;
  attributes: string[];
  confidence: "low" | "medium" | "high";
};

const SYSTEM_PROMPT = `You are identifying ONE specific second-hand object inside a room photo, for a resale listing.

The object is located inside the normalized bounding box you are given (0..1, origin top-left). Ignore every other object in the photo — describe only what is inside that box.

Report:
- genericName: a plain, generic name for the object ("gaming console", "electric guitar"). Never invent a precise model here.
- brand: the manufacturer, ONLY if you can actually see a logo, nameplate, or another unmistakable visual cue. Otherwise null.
- model: the specific model or product line, ONLY if you can actually see or unambiguously infer it from a visible marking or an unmistakable, unique shape. Otherwise null.
- category: a short resale category for this object (e.g. "gaming console", "seating", "kitchen appliance").
- condition: one short phrase describing the item's visible condition from the photo alone (e.g. "Looks lightly used, no visible damage").
- attributes: 2-5 short visible attributes that would help a buyer recognize this exact item (color, finish, notable markings, accessories visible with it).
- confidence: "high" only when you can name a specific brand and model from clear visual evidence; "medium" when the object type is clear but brand/model are uncertain or absent; "low" when even the object type is a guess.

Never invent a precise brand or model you cannot actually confirm from the image — when unsure, leave it null and lower confidence instead.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    genericName: { type: "string" },
    brand: { type: ["string", "null"] },
    model: { type: ["string", "null"] },
    category: { type: "string" },
    condition: { type: "string" },
    attributes: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: [
    "genericName",
    "brand",
    "model",
    "category",
    "condition",
    "attributes",
    "confidence",
  ],
  additionalProperties: false,
} as const;

export async function identifyItem(input: {
  apiKey: string;
  model?: string;
  reasoningEffort?: string;
  imageUrl: string;
  box: { x: number; y: number; width: number; height: number };
  hintLabel: string;
  hintCategory: string;
}): Promise<IdentificationResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const reasoningEffort = input.reasoningEffort ?? DEFAULT_REASONING_EFFORT;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning_effort: reasoningEffort,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Identify the object inside this normalized box: x=${input.box.x.toFixed(3)}, y=${input.box.y.toFixed(3)}, width=${input.box.width.toFixed(3)}, height=${input.box.height.toFixed(3)}. An earlier pass guessed it might be "${input.hintLabel}" (category: ${input.hintCategory}) — treat that only as a hint, not a fact.`,
            },
            {
              type: "image_url",
              image_url: { url: input.imageUrl, detail: "high" },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "item_identification",
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
    if (response.status === 404) {
      throw new ResearchError(
        `The model "${model}" is not available on this OpenAI account. Set OPENAI_VISION_MODEL to one you can use.`,
      );
    }
    if (response.status === 429) {
      throw new ResearchError(
        "OpenAI rate limit reached. Wait a moment and try again.",
        429,
      );
    }
    throw new ResearchError(
      `OpenAI request failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string; refusal?: string } }[];
  };

  const message = payload.choices?.[0]?.message;
  if (message?.refusal) {
    throw new ResearchError("The model declined to identify this item.");
  }

  const content = message?.content;
  if (!content) {
    throw new ResearchError("OpenAI returned an empty response.");
  }

  let parsed: Partial<IdentificationResult>;
  try {
    parsed = JSON.parse(content) as Partial<IdentificationResult>;
  } catch {
    throw new ResearchError(
      "OpenAI returned a response that was not valid JSON.",
    );
  }

  if (
    typeof parsed.genericName !== "string" ||
    typeof parsed.category !== "string" ||
    typeof parsed.condition !== "string" ||
    !Array.isArray(parsed.attributes) ||
    (parsed.confidence !== "low" &&
      parsed.confidence !== "medium" &&
      parsed.confidence !== "high")
  ) {
    throw new ResearchError(
      "OpenAI returned identification in an unexpected shape.",
    );
  }

  return {
    genericName: parsed.genericName,
    brand: typeof parsed.brand === "string" ? parsed.brand : null,
    model: typeof parsed.model === "string" ? parsed.model : null,
    category: parsed.category,
    condition: parsed.condition,
    attributes: parsed.attributes
      .filter((a): a is string => typeof a === "string")
      .slice(0, 6),
    confidence: parsed.confidence,
  };
}
