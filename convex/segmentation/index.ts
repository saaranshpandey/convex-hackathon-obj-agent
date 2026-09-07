import { env } from "../_generated/server";
import { createMockProvider } from "./mock";
import { createOpenAIProvider } from "./openai";
import { createFalMaskRefiner, type MaskRefiner } from "./fal";
import { SegmentationError, type SegmentationProvider, type SegmentedObject } from "./types";

export * from "./types";
export type { MaskRefiner } from "./fal";

/**
 * Resolves the active provider from configuration.
 *
 * SEGMENTATION_MODE forces a choice; otherwise a present OPENAI_API_KEY means
 * live detection and its absence means mock. Swapping in a mask model later is
 * a new case here plus one file — no caller changes.
 */
export function getSegmentationProvider(): SegmentationProvider {
  const mode = env.SEGMENTATION_MODE?.trim().toLowerCase();
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_VISION_MODEL?.trim() || undefined;
  const effort = env.OPENAI_REASONING_EFFORT?.trim() || undefined;

  if (mode === "mock") return createMockProvider();

  // Test seam: the only reliable way to exercise the recoverable failure UI.
  if (mode === "fail") {
    return {
      name: "fail",
      async segmentImage(): Promise<SegmentedObject[]> {
        throw new SegmentationError(
          "Detection is disabled by SEGMENTATION_MODE=fail.",
        );
      },
    };
  }

  if (mode === "openai") {
    if (!apiKey) {
      throw new SegmentationError(
        "SEGMENTATION_MODE is \"openai\" but OPENAI_API_KEY is not set in the Convex environment.",
      );
    }
    return createOpenAIProvider(apiKey, model, effort);
  }

  if (mode && mode !== "auto") {
    throw new SegmentationError(
      `Unknown SEGMENTATION_MODE "${mode}". Use "openai", "mock", "fail" or "auto".`,
    );
  }

  return apiKey
    ? createOpenAIProvider(apiKey, model, effort)
    : createMockProvider();
}

/** The one entry point the rest of the backend is allowed to call. */
export async function segmentImage(
  imageUrl: string,
): Promise<SegmentedObject[]> {
  return await getSegmentationProvider().segmentImage(imageUrl);
}

/**
 * Optional second stage: turns a detection box into a precise mask.
 *
 * Returns null when refinement is switched off or unconfigured, which callers
 * treat as "keep the box" rather than as an error. Detection never depends on
 * this succeeding.
 */
export function getMaskRefiner(): MaskRefiner | null {
  const mode = env.MASK_MODE?.trim().toLowerCase();
  if (mode === "off") return null;

  const apiKey = env.FAL_KEY?.trim();
  if (!apiKey) {
    if (mode === "fal") {
      throw new SegmentationError(
        'MASK_MODE is "fal" but FAL_KEY is not set in the Convex environment.',
      );
    }
    return null;
  }

  return createFalMaskRefiner(apiKey, env.FAL_MASK_MODEL?.trim() || undefined);
}
