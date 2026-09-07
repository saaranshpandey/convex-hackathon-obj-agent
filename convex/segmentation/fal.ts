import { SegmentationError, type BoundingBox } from "./types";

const DEFAULT_MODEL = "fal-ai/sam2/image";

export type MaskRefinerInput = {
  imageUrl: string;
  /** Normalised 0..1; converted to pixels for the box prompt. */
  box: BoundingBox;
  imageWidth: number;
  imageHeight: number;
};

export type MaskRefinerResult = {
  bytes: ArrayBuffer;
  contentType: string;
  /** Time spent inside the model call, excluding our own storage write. */
  modelMs: number;
};

export interface MaskRefiner {
  readonly name: string;
  refine(input: MaskRefinerInput): Promise<MaskRefinerResult>;
}

/**
 * Pulls the mask URL out of fal's response.
 *
 * The published schema documents a single `image`, but sibling SAM endpoints
 * return `images`/`masks` arrays. Accepting all of them keeps one bad guess
 * from failing every refinement.
 */
function extractMaskUrl(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;

  const single = record.image ?? record.mask;
  if (typeof single === "object" && single !== null) {
    const url = (single as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }

  for (const key of ["images", "masks", "individual_masks"]) {
    const list = record[key];
    if (Array.isArray(list) && list.length > 0) {
      const first = list[0];
      if (typeof first === "string") return first;
      if (typeof first === "object" && first !== null) {
        const url = (first as Record<string, unknown>).url;
        if (typeof url === "string") return url;
      }
    }
  }

  return null;
}

export function createFalMaskRefiner(
  apiKey: string,
  model: string = DEFAULT_MODEL,
): MaskRefiner {
  return {
    // Stable label stored on items, independent of the underlying model path.
    name: "fal-sam2",

    async refine({
      imageUrl,
      box,
      imageWidth,
      imageHeight,
    }: MaskRefinerInput): Promise<MaskRefinerResult> {
      const clampX = (n: number) => Math.min(imageWidth, Math.max(0, Math.round(n)));
      const clampY = (n: number) => Math.min(imageHeight, Math.max(0, Math.round(n)));

      const boxPrompt = {
        x_min: clampX(box.x * imageWidth),
        y_min: clampY(box.y * imageHeight),
        x_max: clampX((box.x + box.width) * imageWidth),
        y_max: clampY((box.y + box.height) * imageHeight),
      };

      if (boxPrompt.x_max <= boxPrompt.x_min || boxPrompt.y_max <= boxPrompt.y_min) {
        throw new SegmentationError("Detection box collapsed to zero area.");
      }

      const started = Date.now();

      const response = await fetch(`https://fal.run/${model}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_url: imageUrl,
          box_prompts: [boxPrompt],
          // Transparent cut-out, so the PNG's alpha channel is the mask and the
          // browser can tint it without us decoding anything server-side.
          apply_mask: true,
          output_format: "png",
        }),
      });

      if (!response.ok) {
        const body = await response.text();

        // fal puts the real reason in `detail` — an account lock and a bad key
        // both arrive as 403, and conflating them sends you debugging the wrong
        // thing. Surface what fal actually said.
        let detail = body.slice(0, 200);
        try {
          const parsed = JSON.parse(body) as { detail?: unknown };
          if (typeof parsed.detail === "string") detail = parsed.detail;
        } catch {
          // Not JSON; the raw snippet is the best we have.
        }

        throw new SegmentationError(
          `fal ${response.status}: ${detail}`,
          response.status,
        );
      }

      const payload: unknown = await response.json();
      const maskUrl = extractMaskUrl(payload);
      if (maskUrl === null) {
        throw new SegmentationError(
          `Could not find a mask URL in the fal response: ${JSON.stringify(payload).slice(0, 200)}`,
        );
      }

      const modelMs = Date.now() - started;

      const file = await fetch(maskUrl);
      if (!file.ok) {
        throw new SegmentationError(
          `Could not download the mask from fal (${file.status}).`,
        );
      }

      return {
        bytes: await file.arrayBuffer(),
        contentType: file.headers.get("content-type") ?? "image/png",
        modelMs,
      };
    },
  };
}
