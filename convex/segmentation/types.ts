/**
 * Provider-neutral segmentation contract.
 *
 * Nothing outside `convex/segmentation/` may know which model produced a
 * result. Coordinates are always normalised to 0..1 against the source image,
 * so a provider that returns pixels must divide before returning.
 */

export type NormalizedPoint = { x: number; y: number };

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SegmentedObject = {
  label: string;
  confidence: number;
  category: string;
  /** Preferred: a true outline. */
  polygon?: NormalizedPoint[];
  /** Fallback when the provider cannot produce a mask. */
  boundingBox?: BoundingBox;
};

export type TokenUsage = { promptTokens: number; completionTokens: number };

export interface SegmentationProvider {
  readonly name: string;
  segmentImage(imageUrl: string): Promise<SegmentedObject[]>;
  /** Set by providers that report usage, read after segmentImage resolves. */
  lastUsage?: TokenUsage;
}

/** Raised for conditions worth showing the user verbatim. */
export class SegmentationError extends Error {
  /** Upstream HTTP status, when there was one. Drives retry decisions. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SegmentationError";
    this.status = status;
  }
}

const CLAMP = (n: number) => Math.min(1, Math.max(0, n));

/** Every provider's output passes through here before it is trusted. */
export function sanitize(objects: SegmentedObject[]): SegmentedObject[] {
  const cleaned: SegmentedObject[] = [];

  for (const object of objects) {
    const label = object.label?.trim();
    if (!label) continue;

    if (object.polygon && object.polygon.length >= 3) {
      cleaned.push({
        ...object,
        label,
        confidence: CLAMP(object.confidence),
        polygon: object.polygon.map((p) => ({ x: CLAMP(p.x), y: CLAMP(p.y) })),
        boundingBox: undefined,
      });
      continue;
    }

    if (object.boundingBox) {
      const x = CLAMP(object.boundingBox.x);
      const y = CLAMP(object.boundingBox.y);
      const width = CLAMP(object.boundingBox.width);
      const height = CLAMP(object.boundingBox.height);

      // Degenerate or full-frame boxes are noise, not objects.
      if (width < 0.01 || height < 0.01) continue;
      if (width > 0.97 && height > 0.97) continue;

      cleaned.push({
        ...object,
        label,
        confidence: CLAMP(object.confidence),
        polygon: undefined,
        boundingBox: {
          x,
          y,
          width: Math.min(width, 1 - x),
          height: Math.min(height, 1 - y),
        },
      });
    }
  }

  return cleaned;
}

/** The tight box around whatever shape a provider returned. */
export function toBoundingBox(object: SegmentedObject): BoundingBox {
  if (object.boundingBox) return object.boundingBox;

  const polygon = object.polygon ?? [];
  if (polygon.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

/** Rectangles become four-point polygons so storage has one shape to hold. */
export function toPolygon(object: SegmentedObject): NormalizedPoint[] {
  if (object.polygon && object.polygon.length >= 3) return object.polygon;

  const box = object.boundingBox;
  if (!box) return [];

  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return [
    { x: box.x, y: box.y },
    { x: right, y: box.y },
    { x: right, y: bottom },
    { x: box.x, y: bottom },
  ];
}
