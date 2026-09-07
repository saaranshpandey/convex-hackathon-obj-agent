import { useEffect, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { WorkspaceItem } from "@/lib/geometry";
import type { MaskEntry } from "@/lib/masks";

type Props = {
  items: WorkspaceItem[];
  masks: Map<string, MaskEntry>;
  hoveredId: Id<"items"> | null;
  activeId: Id<"items"> | null;
  interactive: boolean;
  onToggle: (id: Id<"items">) => void;
  onHover: (id: Id<"items"> | null) => void;
};

const LIME = "#B8F35A";
const NEUTRAL = "#FFFFFF";
const EDGE_PX = 2;
const FADE_MS = 320;

/** Eight-way dilation offsets, used to derive a silhouette edge from alpha. */
const RING = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const;

type Style = {
  fillAlpha: number;
  edgeAlpha: number;
  edgeColor: string;
};

function maskStyle(selected: boolean, hovered: boolean): Style {
  if (selected) {
    return {
      fillAlpha: hovered ? 0.16 : 0.1,
      edgeAlpha: hovered ? 1 : 0.9,
      edgeColor: LIME,
    };
  }
  return {
    // Deselected: no fill at rest, only the faintest neutral edge.
    fillAlpha: hovered ? 0.07 : 0,
    edgeAlpha: hovered ? 0.55 : 0.16,
    edgeColor: hovered ? LIME : NEUTRAL,
  };
}

export default function ObjectCanvas({
  items,
  masks,
  hoveredId,
  activeId,
  interactive,
  onToggle,
  onHover,
}: Props) {
  const viewRef = useRef<HTMLCanvasElement>(null);
  const pickRef = useRef<HTMLCanvasElement | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const fadeRef = useRef<Map<string, number>>(new Map());
  const frameRef = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Larger objects first, so small ones stay clickable on top of them.
  const ordered = [...items].sort(
    (a, b) => b.bbox.width * b.bbox.height - a.bbox.width * a.bbox.height,
  );

  useEffect(() => {
    const canvas = viewRef.current;
    if (canvas === null) return;

    const parent = canvas.parentElement;
    if (parent === null) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const { width, height } = size;
    if (width === 0 || height === 0) return;

    if (scratchRef.current === null) {
      scratchRef.current = document.createElement("canvas");
    }
    if (pickRef.current === null) {
      pickRef.current = document.createElement("canvas");
    }

    const scratch = scratchRef.current;
    const pick = pickRef.current;
    scratch.width = width;
    scratch.height = height;
    pick.width = width;
    pick.height = height;

    const view = viewRef.current;
    if (view === null) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.width = Math.round(width * dpr);
    view.height = Math.round(height * dpr);

    const ctx = view.getContext("2d");
    const sctx = scratch.getContext("2d");
    const pctx = pick.getContext("2d", { willReadFrequently: true });
    if (ctx === null || sctx === null || pctx === null) return;

    // A mask silhouette, flat-filled with `color`, left in the scratch canvas.
    const tintMask = (image: CanvasImageSource, color: string) => {
      sctx.globalCompositeOperation = "source-over";
      sctx.clearRect(0, 0, width, height);
      sctx.drawImage(image, 0, 0, width, height);
      sctx.globalCompositeOperation = "source-in";
      sctx.fillStyle = color;
      sctx.fillRect(0, 0, width, height);
      sctx.globalCompositeOperation = "source-over";
    };

    // Dilate the silhouette, subtract the original, and what remains is a ring
    // that traces the object's true outline.
    const tintEdge = (image: CanvasImageSource, color: string) => {
      sctx.globalCompositeOperation = "source-over";
      sctx.clearRect(0, 0, width, height);
      for (const [dx, dy] of RING) {
        sctx.drawImage(image, dx * EDGE_PX, dy * EDGE_PX, width, height);
      }
      sctx.globalCompositeOperation = "destination-out";
      sctx.drawImage(image, 0, 0, width, height);
      sctx.globalCompositeOperation = "source-in";
      sctx.fillStyle = color;
      sctx.fillRect(0, 0, width, height);
      sctx.globalCompositeOperation = "source-over";
    };

    const render = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(0, 0, width, height);

      let animating = false;

      ordered.forEach((item) => {
        const index = items.findIndex((candidate) => candidate._id === item._id);
        const pickColor = `rgb(${index + 1},0,0)`;
        const hovered = hoveredId === item._id;
        const entry = masks.get(item._id);
        const ready = item.maskStatus === "ready" && entry !== undefined;

        const box = {
          x: item.bbox.x * width,
          y: item.bbox.y * height,
          w: item.bbox.width * width,
          h: item.bbox.height * height,
        };

        if (ready) {
          const target = 1;
          const current = fadeRef.current.get(item._id) ?? 0;
          const fade = Math.min(target, current + 16 / FADE_MS);
          fadeRef.current.set(item._id, fade);
          if (fade < target) animating = true;

          const style = maskStyle(item.selected, hovered);

          if (style.fillAlpha > 0) {
            tintMask(entry.source, LIME);
            ctx.globalAlpha = style.fillAlpha * fade;
            ctx.drawImage(scratch, 0, 0, width, height);
          }

          if (style.edgeAlpha > 0) {
            tintEdge(entry.source, style.edgeColor);
            ctx.globalAlpha = style.edgeAlpha * fade;
            ctx.drawImage(scratch, 0, 0, width, height);
          }

          ctx.globalAlpha = 1;

          // Hit region: the silhouette itself.
          tintMask(entry.source, pickColor);
          pctx.drawImage(scratch, 0, 0, width, height);
        } else {
          // Temporary detection state: a very thin lime box, minimal fill.
          const selected = item.selected;
          ctx.globalAlpha = 1;
          ctx.fillStyle = LIME;
          ctx.globalAlpha = selected ? (hovered ? 0.1 : 0.07) : hovered ? 0.05 : 0.02;
          ctx.fillRect(box.x, box.y, box.w, box.h);

          ctx.globalAlpha = selected ? 0.9 : hovered ? 0.6 : 0.35;
          ctx.strokeStyle = LIME;
          ctx.lineWidth = 1;
          ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
          ctx.globalAlpha = 1;

          pctx.fillStyle = pickColor;
          pctx.fillRect(box.x, box.y, box.w, box.h);
        }
      });

      if (animating) {
        frameRef.current = requestAnimationFrame(render);
      } else {
        frameRef.current = null;
      }
    };

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(render);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [size, items, masks, hoveredId, activeId, ordered]);

  /** Reads the picking canvas; falls back to boxes if the pixel read fails. */
  const itemAt = (event: React.PointerEvent): WorkspaceItem | null => {
    const canvas = viewRef.current;
    const pick = pickRef.current;
    if (canvas === null || pick === null) return null;

    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) return null;

    const context = pick.getContext("2d", { willReadFrequently: true });
    if (context !== null) {
      try {
        const pixel = context.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        if (pixel[3] > 24) {
          const index = pixel[0] - 1;
          if (index >= 0 && index < items.length) return items[index];
        }
      } catch {
        // Tainted canvas; drop through to geometry.
      }
    }

    const nx = x / bounds.width;
    const ny = y / bounds.height;
    for (const item of ordered.slice().reverse()) {
      const { bbox } = item;
      if (
        nx >= bbox.x &&
        nx <= bbox.x + bbox.width &&
        ny >= bbox.y &&
        ny <= bbox.y + bbox.height
      ) {
        return item;
      }
    }
    return null;
  };

  return (
    <canvas
      ref={viewRef}
      className="absolute inset-0 h-full w-full"
      style={{
        pointerEvents: interactive ? "auto" : "none",
        cursor: hoveredId ? "pointer" : "default",
      }}
      onPointerMove={(event) => {
        const item = itemAt(event);
        onHover(item ? item._id : null);
      }}
      onPointerLeave={() => onHover(null)}
      onClick={(event) => {
        const item = itemAt(event as unknown as React.PointerEvent);
        if (item) onToggle(item._id);
      }}
    />
  );
}
