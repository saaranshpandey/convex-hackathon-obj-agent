import { useEffect, useState } from "react";
import type { WorkspaceItem } from "@/lib/geometry";

export type MaskEntry = {
  /** Cleaned silhouette, ready to draw. */
  source: HTMLCanvasElement;
  /** Normalised point near the object's top edge, for the check badge. */
  anchor: { x: number; y: number } | null;
};

/** Masks are only ever drawn at canvas size, so this is plenty of detail. */
const WORK_MAX = 1024;
/** Below this, a pixel is fringe rather than mask. */
const ALPHA_CUTOFF = 128;
/** Islands smaller than this share of the largest one are noise. */
const MIN_ISLAND_RATIO = 0.02;
const MIN_ISLAND_PX = 24;

/**
 * SAM regularly leaks small fragments of neighbouring objects into a mask —
 * a desk mask arrives speckled with bits of the things sitting on it. Every
 * fragment becomes its own outline once the edge is derived, which reads as
 * visual noise. Keeping only islands of meaningful size removes them while
 * preserving genuinely disconnected parts of one object (a sofa split by
 * something occluding its middle).
 */
function cleanMask(image: HTMLImageElement): MaskEntry | null {
  const scale = Math.min(1, WORK_MAX / image.naturalWidth);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) return null;

  context.drawImage(image, 0, 0, width, height);

  let imageData: ImageData;
  try {
    imageData = context.getImageData(0, 0, width, height);
  } catch {
    // Cross-origin taint: use the mask as-is rather than losing it entirely.
    return { source: canvas, anchor: null };
  }

  const pixels = imageData.data;
  const count = width * height;

  const solid = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    solid[i] = pixels[i * 4 + 3] >= ALPHA_CUTOFF ? 1 : 0;
  }

  // Iterative flood fill; 8-connected so thin necks stay attached.
  const labels = new Int32Array(count);
  const stack = new Int32Array(count);
  const areas: number[] = [0];
  let label = 0;

  for (let start = 0; start < count; start += 1) {
    if (solid[start] === 0 || labels[start] !== 0) continue;

    label += 1;
    let area = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;

    while (top > 0) {
      const point = stack[--top];
      area += 1;
      const x = point % width;
      const y = (point / width) | 0;

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const neighbour = ny * width + nx;
          if (solid[neighbour] === 1 && labels[neighbour] === 0) {
            labels[neighbour] = label;
            stack[top++] = neighbour;
          }
        }
      }
    }

    areas.push(area);
  }

  const largest = areas.reduce((a, b) => Math.max(a, b), 0);
  const threshold = Math.max(MIN_ISLAND_PX, largest * MIN_ISLAND_RATIO);

  const keep = new Uint8Array(areas.length);
  for (let i = 1; i < areas.length; i += 1) {
    keep[i] = areas[i] >= threshold ? 1 : 0;
  }

  // Zero the rejected islands, leaving kept edges antialiased as they were.
  for (let i = 0; i < count; i += 1) {
    const owner = labels[i];
    if (owner === 0 || keep[owner] === 0) pixels[i * 4 + 3] = 0;
  }
  context.putImageData(imageData, 0, 0);

  // Topmost surviving row gives the badge somewhere sensible to sit.
  let anchor: { x: number; y: number } | null = null;
  for (let y = 0; y < height && anchor === null; y += 1) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 40) {
        if (first === -1) first = x;
        last = x;
      }
    }
    if (first !== -1) {
      anchor = { x: (first + last) / 2 / width, y: y / height };
    }
  }

  return { source: canvas, anchor };
}

/**
 * Loads each ready mask exactly once and reports progress as they arrive, so
 * silhouettes replace boxes one at a time rather than all at the end.
 */
export function useMaskImages(items: WorkspaceItem[]): Map<string, MaskEntry> {
  const [entries, setEntries] = useState<Map<string, MaskEntry>>(new Map());

  const signature = items
    .filter((item) => item.maskStatus === "ready" && item.maskUrl)
    .map((item) => `${item._id}:${item.maskUrl}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;
    const started = new Set<string>();

    for (const item of items) {
      if (item.maskStatus !== "ready" || !item.maskUrl) continue;
      if (started.has(item._id)) continue;
      started.add(item._id);

      setEntries((current) => {
        if (current.has(item._id)) return current;

        const image = new Image();
        // Required for the pixel reads that drive cleaning and hit testing.
        image.crossOrigin = "anonymous";
        image.onload = () => {
          if (cancelled) return;
          const cleaned = cleanMask(image);
          if (cleaned === null) return;
          setEntries((next) => {
            if (next.has(item._id)) return next;
            const updated = new Map(next);
            updated.set(item._id, cleaned);
            return updated;
          });
        };
        image.src = item.maskUrl as string;

        return current;
      });
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return entries;
}
