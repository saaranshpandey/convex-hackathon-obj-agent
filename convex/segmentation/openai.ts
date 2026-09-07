import {
  SegmentationError,
  sanitize,
  type SegmentationProvider,
  type SegmentedObject,
} from "./types";

const DEFAULT_MODEL = "gpt-5.6-luna";

/**
 * Reading objects out of a photo is perception, not deliberation. Left at the
 * default effort the model burns thousands of reasoning tokens and takes ~20s
 * on a busy room, which defeats the whole point of showing boxes immediately.
 */
const DEFAULT_REASONING_EFFORT = "low";
const MAX_OBJECTS = 10;
const MIN_CONFIDENCE = 0.3;

export const CATEGORIES = [
  "electronics",
  "furniture",
  "instruments",
  "appliances",
  "collectibles",
  "sporting_goods",
  "tools",
  "home_goods",
  "other",
] as const;

/**
 * Structural and architectural features are part of the room, not things you
 * can sell. The model is told to skip them; this is the safety net for when it
 * ignores that instruction.
 */
const NON_SELLABLE = new Set([
  "drink can", "soda can", "can", "beer can", "bottle", "water bottle",
  "cup", "mug", "glass", "food", "snack", "packaging", "wrapper", "trash",
  "rubbish", "cable", "cables", "wire", "wires", "cord", "charger",
  "power adapter", "adapter", "paper", "papers", "document", "documents",
  "notebook paper", "sticky note", "pen", "pencil", "desk setup", "clutter",
  "wall", "walls", "floor", "flooring", "floors", "ceiling", "window",
  "windows", "windowsill", "door", "doors", "doorway", "doorframe",
  "baseboard", "skirting board", "molding", "moulding", "trim", "staircase",
  "stairs", "stair", "railing", "banister", "radiator", "vent", "air vent",
  "outlet", "power outlet", "light switch", "switch", "ceiling light",
  "ceiling fan", "recessed light", "light fixture", "chandelier", "sink",
  "bathtub", "toilet", "countertop", "counter", "cabinetry", "built-in shelf",
  "fireplace", "column", "pillar", "beam", "room", "background", "person",
  "man", "woman", "child", "people", "hand", "dog", "cat", "pet", "plant",
  "houseplant", "shadow", "reflection",
]);

const SYSTEM_PROMPT = `You identify objects in a photo that someone could realistically list and sell second-hand as their own separate listing.

Include: electronics, furniture, appliances, musical instruments, tools, collectibles, and decor or homeware that has meaningful standalone value.

Exclude:
- structural and architectural features: walls, floors, ceilings, windows, doors, trim, stairs, radiators, outlets, built-in lighting and built-in cabinetry
- people, pets and plants
- rubbish, food, drinks, and any food or drink container (cans, bottles, cups, packaging)
- cables, chargers, adapters, papers, documents, stationery and other small incidental clutter
- anything that is a part or accessory of a larger item rather than its own listing (a monitor stand, a keycap, a drawer, a cushion on a sofa)
- the room itself, and groupings like "furniture", "clutter" or "desk setup"

Judge whether an object would stand on its own as a listing, NOT whether it is expensive. Pricing happens later, so an inexpensive but genuinely sellable item still counts.

Report each object once, and never report both a whole item and its parts. Prefer the specific over the generic ("Fender Stratocaster" over "guitar", "guitar" over "instrument") but never invent a brand or model you cannot actually see.

Return only the strongest candidates, ordered by confidence. Even in a very cluttered photo return at most 10, choosing the items most worth listing rather than everything visible.

Coordinates are fractions of the image, with the origin at the top-left: x and y are the top-left corner of the object's tight bounding box, width and height are its size. Every value is between 0 and 1, and x + width and y + height must not exceed 1.

confidence is your certainty that the object is present and correctly identified, from 0 to 1.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    objects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          confidence: { type: "number" },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
        required: [
          "label",
          "category",
          "confidence",
          "x",
          "y",
          "width",
          "height",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["objects"],
  additionalProperties: false,
} as const;

type RawObject = {
  label: string;
  category: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function createOpenAIProvider(
  apiKey: string,
  model: string = DEFAULT_MODEL,
  reasoningEffort: string = DEFAULT_REASONING_EFFORT,
): SegmentationProvider {
  return {
    name: `openai:${model}`,
    lastUsage: undefined,

    async segmentImage(imageUrl: string): Promise<SegmentedObject[]> {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
                  text: "Identify every sellable object in this room photo.",
                },
                {
                  type: "image_url",
                  image_url: { url: imageUrl, detail: "high" },
                },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "sellable_objects",
              strict: true,
              schema: RESPONSE_SCHEMA,
            },
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        if (response.status === 401) {
          throw new SegmentationError(
            "OpenAI rejected the API key. Check OPENAI_API_KEY in your Convex environment.",
          );
        }
        if (response.status === 404) {
          throw new SegmentationError(
            `The model "${model}" is not available on this OpenAI account. Set OPENAI_VISION_MODEL to one you can use.`,
          );
        }
        if (response.status === 429) {
          throw new SegmentationError(
            "OpenAI rate limit reached. Wait a moment and try the scan again.",
          );
        }
        throw new SegmentationError(
          `OpenAI request failed (${response.status}): ${detail.slice(0, 300)}`,
        );
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string; refusal?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      this.lastUsage = {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0,
      };

      const message = payload.choices?.[0]?.message;
      if (message?.refusal) {
        throw new SegmentationError(
          "The vision model declined to analyse this image.",
        );
      }

      const content = message?.content;
      if (!content) {
        throw new SegmentationError("OpenAI returned an empty response.");
      }

      let parsed: { objects?: RawObject[] };
      try {
        parsed = JSON.parse(content) as { objects?: RawObject[] };
      } catch {
        throw new SegmentationError(
          "OpenAI returned a response that was not valid JSON.",
        );
      }

      const raw = Array.isArray(parsed.objects) ? parsed.objects : [];

      const mapped: SegmentedObject[] = raw
        .filter((item) => !NON_SELLABLE.has(item.label?.trim().toLowerCase()))
        .filter((item) => item.confidence >= MIN_CONFIDENCE)
        .map((item) => ({
          label: item.label,
          category: item.category,
          confidence: item.confidence,
          boundingBox: {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
          },
        }));

      return sanitize(mapped)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_OBJECTS);
    },
  };
}
