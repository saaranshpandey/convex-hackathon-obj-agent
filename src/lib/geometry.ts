import type { Doc } from "../../convex/_generated/dataModel";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** An item document, its derived bounding box, and its signed mask URL. */
export type WorkspaceItem = Doc<"items"> & {
  bbox: Rect;
  maskUrl: string | null;
};

export function polygonToPath(polygon: Point[]): string {
  return `${polygon
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`)
    .join(" ")} Z`;
}

/** Derived rather than stored, so it can never drift from the polygon. */
export function bboxOf(polygon: Point[]): Rect {
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
