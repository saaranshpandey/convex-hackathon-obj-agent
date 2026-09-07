import { MOCK_DETECTIONS } from "../mockDetection";
import type { SegmentationProvider, SegmentedObject } from "./types";

/**
 * Offline provider. Returns the demo room's hand-authored polygons regardless
 * of the image, so the pipeline, the status machine and the UI can be exercised
 * without a network call or an API key.
 */
export function createMockProvider(): SegmentationProvider {
  return {
    name: "mock",

    async segmentImage(): Promise<SegmentedObject[]> {
      return MOCK_DETECTIONS.map(
        (detection): SegmentedObject => ({
          label: detection.name,
          confidence: detection.confidence,
          category: detection.category,
          polygon: detection.polygon,
        }),
      );
    },
  };
}
