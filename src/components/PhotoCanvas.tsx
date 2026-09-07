import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import type { DetectedObject } from "@/data/demoObjects";
import ObjectOverlay from "@/components/ObjectOverlay";

type Props = {
  imageUrl: string;
  objects: DetectedObject[];
  scanning: boolean;
  selected: Set<string>;
  hoveredId: string | null;
  activeId: string | null;
  onToggle: (id: string) => void;
  onHover: (id: string | null) => void;
};

export default function PhotoCanvas({
  imageUrl,
  objects,
  scanning,
  selected,
  hoveredId,
  activeId,
  onToggle,
  onHover,
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const showObjects = loaded && !scanning;

  return (
    <div className="flex justify-center">
      <div className="relative inline-block overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-lift)]">
        <img
          src={imageUrl}
          alt="Room to sell from"
          onLoad={() => setLoaded(true)}
          className="block max-h-[70vh] w-auto max-w-full select-none"
          draggable={false}
        />

        {showObjects && (
          <ObjectOverlay
            objects={objects}
            selected={selected}
            hoveredId={hoveredId}
            activeId={activeId}
            onToggle={onToggle}
            onHover={onHover}
          />
        )}

        {/* Check badges live outside the SVG so the icon never inherits the
            overlay's non-uniform scaling. */}
        <AnimatePresence>
          {showObjects &&
            objects
              .filter((o) => selected.has(o.id))
              .map((o) => (
                <motion.span
                  key={o.id}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 620, damping: 26 }}
                  style={{
                    left: `${(o.bbox.x + o.bbox.width) * 100}%`,
                    top: `${o.bbox.y * 100}%`,
                  }}
                  className="pointer-events-none absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-accent-ink shadow-[0_2px_6px_rgb(20_20_18/0.28)]"
                >
                  <Check className="size-3" strokeWidth={3.25} />
                </motion.span>
              ))}
        </AnimatePresence>

        <AnimatePresence>
          {scanning && (
            <motion.div
              key="scan"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/12"
            >
              <motion.div
                initial={{ y: "-30%" }}
                animate={{ y: "130%" }}
                transition={{ duration: 1.1, ease: "easeInOut" }}
                className="h-1/3 w-full bg-gradient-to-b from-transparent via-accent/35 to-transparent"
              />
              <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-ink/85 px-3.5 py-1.5 text-xs font-medium text-canvas">
                Finding things to sell…
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
