import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Loader2, X } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import type { Rect, WorkspaceItem } from "@/lib/geometry";
import { useMaskImages } from "@/lib/masks";
import ObjectCanvas from "@/components/ObjectCanvas";
import { cn } from "@/lib/utils";

type Props = {
  imageUrl: string;
  items: WorkspaceItem[];
  /** Detection still running — objects are hidden and the sweep plays. */
  scanning: boolean;
  scanLabel: string;
  /** Background work the photo can't show on its own, e.g. mask refinement. */
  statusHint?: string | null;
  drawing: boolean;
  hoveredId: Id<"items"> | null;
  activeId: Id<"items"> | null;
  onToggle: (id: Id<"items">) => void;
  onHover: (id: Id<"items"> | null) => void;
  onAddItem: (name: string, box: Rect) => void;
  onCancelDrawing: () => void;
};

const MIN_BOX = 0.02;

/** Reticle brackets — a viewfinder cue that the instrument is working. */
const CORNERS = [
  { key: "tl", className: "top-4 left-4 border-t-2 border-l-2 rounded-tl-md" },
  { key: "tr", className: "top-4 right-4 border-t-2 border-r-2 rounded-tr-md" },
  { key: "bl", className: "bottom-4 left-4 border-b-2 border-l-2 rounded-bl-md" },
  { key: "br", className: "bottom-4 right-4 border-b-2 border-r-2 rounded-br-md" },
];

export default function PhotoCanvas({
  imageUrl,
  items,
  scanning,
  scanLabel,
  statusHint = null,
  drawing,
  hoveredId,
  activeId,
  onToggle,
  onHover,
  onAddItem,
  onCancelDrawing,
}: Props) {
  // MotionConfig drops transform animations for these users, which would leave
  // the sweep parked off-canvas — so it is centred and still instead.
  const reducedMotion = useReducedMotion();
  const [loaded, setLoaded] = useState(false);
  const [dragRect, setDragRect] = useState<Rect | null>(null);
  const [pendingBox, setPendingBox] = useState<Rect | null>(null);
  const [pendingName, setPendingName] = useState("");

  const surfaceRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const masks = useMaskImages(items);
  const showObjects = loaded && !scanning;

  const pointToNormalized = (event: React.PointerEvent) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const rectFrom = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): Rect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });

  const cancelPending = () => {
    setPendingBox(null);
    setPendingName("");
    setDragRect(null);
    originRef.current = null;
    onCancelDrawing();
  };

  const commitPending = () => {
    if (pendingBox && pendingName.trim().length > 0) {
      onAddItem(pendingName.trim(), pendingBox);
    }
    setPendingBox(null);
    setPendingName("");
    setDragRect(null);
  };

  /** Prefers the mask's own upper edge; falls back to the box corner. */
  const badgePosition = (item: WorkspaceItem) => {
    const anchor = masks.get(item._id)?.anchor;
    if (item.maskStatus === "ready" && anchor) {
      return { left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` };
    }
    return {
      left: `${(item.bbox.x + item.bbox.width) * 100}%`,
      top: `${item.bbox.y * 100}%`,
    };
  };

  return (
    <div className="flex justify-center">
      <div
        ref={surfaceRef}
        className="relative inline-block overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-lift)]"
      >
        <img
          src={imageUrl}
          alt="Room to sell from"
          onLoad={() => setLoaded(true)}
          className="block max-h-[70vh] w-auto max-w-full select-none"
          draggable={false}
        />

        {showObjects && (
          <ObjectCanvas
            items={items}
            masks={masks}
            hoveredId={hoveredId}
            activeId={activeId}
            interactive={!drawing && pendingBox === null}
            onToggle={onToggle}
            onHover={onHover}
          />
        )}

        {/* Badges are DOM, not canvas, so the icon stays crisp at any scale. */}
        <AnimatePresence>
          {showObjects &&
            items
              .filter((item) => item.selected)
              .map((item) => (
                <motion.span
                  key={item._id}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 620, damping: 26 }}
                  style={badgePosition(item)}
                  className="pointer-events-none absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-accent-ink shadow-[0_2px_6px_rgb(20_20_18/0.28)]"
                >
                  <Check className="size-3" strokeWidth={3.25} />
                </motion.span>
              ))}
        </AnimatePresence>

        {/* Drawing surface sits above everything so a drag never toggles. */}
        {drawing && pendingBox === null && (
          <div
            className="absolute inset-0 cursor-crosshair bg-ink/10"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              originRef.current = pointToNormalized(event);
              setDragRect(null);
            }}
            onPointerMove={(event) => {
              if (!originRef.current) return;
              setDragRect(rectFrom(originRef.current, pointToNormalized(event)));
            }}
            onPointerUp={(event) => {
              if (!originRef.current) return;
              const box = rectFrom(originRef.current, pointToNormalized(event));
              originRef.current = null;
              if (box.width < MIN_BOX || box.height < MIN_BOX) {
                setDragRect(null);
                return;
              }
              setPendingBox(box);
              setDragRect(box);
            }}
          >
            <p className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-ink/85 px-3.5 py-1.5 text-xs font-medium text-canvas">
              Drag a box around the thing you want to add
            </p>
          </div>
        )}

        {dragRect && (
          <div
            className="pointer-events-none absolute rounded-sm border-2 border-accent bg-accent/25"
            style={{
              left: `${dragRect.x * 100}%`,
              top: `${dragRect.y * 100}%`,
              width: `${dragRect.width * 100}%`,
              height: `${dragRect.height * 100}%`,
            }}
          />
        )}

        {pendingBox && (
          <div
            className="absolute z-10 w-56 max-w-[80%] rounded-xl bg-surface p-2.5 shadow-[var(--shadow-lift)]"
            style={{
              left: `${Math.min(pendingBox.x, 0.72) * 100}%`,
              top: `${Math.min(pendingBox.y + pendingBox.height + 0.015, 0.88) * 100}%`,
            }}
          >
            <input
              autoFocus
              value={pendingName}
              onChange={(event) => setPendingName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitPending();
                if (event.key === "Escape") cancelPending();
              }}
              placeholder="What is it?"
              className="w-full rounded-lg bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-muted"
            />
            <div className="mt-2 flex items-center justify-end gap-1">
              <button
                onClick={cancelPending}
                className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
              >
                <X className="size-3.5" strokeWidth={2.25} />
                Cancel
              </button>
              <button
                onClick={commitPending}
                disabled={pendingName.trim().length === 0}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  pendingName.trim().length === 0
                    ? "bg-line text-muted"
                    : "bg-ink text-canvas hover:bg-ink/90",
                )}
              >
                Add item
              </button>
            </div>
          </div>
        )}

        <AnimatePresence>
          {scanning && (
            <motion.div
              key="scan"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 overflow-hidden bg-ink/35"
            >
              {/* The band trails the bright edge, so it reads as a line
                  travelling down the photo rather than a wash over it. */}
              <motion.div
                initial={reducedMotion ? { y: "33%" } : { y: "-40%" }}
                animate={reducedMotion ? { y: "33%" } : { y: "140%" }}
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : { duration: 1.6, ease: "easeInOut", repeat: Infinity }
                }
                className="absolute inset-x-0 top-0 h-1/3"
              >
                <div className="h-full w-full bg-gradient-to-b from-transparent via-accent-deep/30 to-accent-deep/55" />
                <div className="h-[2px] w-full bg-white/90 shadow-[0_0_16px_4px_rgb(0_113_227/0.75)]" />
              </motion.div>

              {CORNERS.map(({ key, className }) => (
                <motion.span
                  key={key}
                  aria-hidden
                  initial={{ opacity: 0.35 }}
                  animate={{ opacity: [0.35, 1, 0.35] }}
                  transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
                  className={cn("absolute size-6 border-white/85", className)}
                />
              ))}

              <span
                role="status"
                className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink/85 px-3.5 py-1.5 text-xs font-medium text-canvas"
              >
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} />
                {scanLabel}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {!scanning && statusHint && (
            <motion.span
              key="hint"
              role="status"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink/85 px-3.5 py-1.5 text-xs font-medium text-canvas"
            >
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2.25} />
              {statusHint}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
