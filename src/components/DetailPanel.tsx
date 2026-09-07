import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, PackageOpen } from "lucide-react";
import type { DetectedObject } from "@/data/demoObjects";
import ObjectThumb from "@/components/ObjectThumb";
import { cn } from "@/lib/utils";

type Props = {
  imageUrl: string;
  objects: DetectedObject[];
  selected: Set<string>;
  activeId: string | null;
  onToggle: (id: string) => void;
  onActivate: (id: string | null) => void;
  onHover: (id: string | null) => void;
};

export default function DetailPanel({
  imageUrl,
  objects,
  selected,
  activeId,
  onToggle,
  onActivate,
  onHover,
}: Props) {
  const active = objects.find((o) => o.id === activeId) ?? null;

  return (
    <aside className="surface p-5 lg:sticky lg:top-24 lg:self-start">
      <AnimatePresence mode="wait" initial={false}>
        {active ? (
          <motion.div
            key={active.id}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <ObjectDetail
              imageUrl={imageUrl}
              object={active}
              isSelected={selected.has(active.id)}
              onToggle={onToggle}
              onBack={() => onActivate(null)}
            />
          </motion.div>
        ) : (
          <motion.div
            key="summary"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <SelectionSummary
              imageUrl={imageUrl}
              objects={objects}
              selected={selected}
              onActivate={onActivate}
              onHover={onHover}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}

function SelectionSummary({
  imageUrl,
  objects,
  selected,
  onActivate,
  onHover,
}: {
  imageUrl: string;
  objects: DetectedObject[];
  selected: Set<string>;
  onActivate: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const chosen = objects.filter((o) => selected.has(o.id));

  return (
    <div>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
        Selected to sell
      </h2>
      <p className="mt-1 text-sm text-muted">
        {chosen.length === 0
          ? "Nothing selected yet."
          : `${chosen.length} ${chosen.length === 1 ? "item" : "items"} ready for your agents.`}
      </p>

      {chosen.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-xl bg-canvas px-4 py-10 text-center">
          <PackageOpen className="size-5 text-muted" strokeWidth={1.75} />
          <p className="mt-3 max-w-[22ch] text-sm text-muted">
            Tap anything in the photo to add it to the sale.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-1">
          {chosen.map((o) => (
            <li key={o.id}>
              <button
                onClick={() => onActivate(o.id)}
                onPointerEnter={() => onHover(o.id)}
                onPointerLeave={() => onHover(null)}
                className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-canvas"
              >
                <ObjectThumb imageUrl={imageUrl} bbox={o.bbox} className="h-10" />
                <span className="flex-1 text-sm font-medium text-ink">
                  {o.name}
                </span>
                <span className="text-sm text-muted">—</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
        <span className="text-sm text-muted">Estimated total</span>
        <span className="text-sm font-medium text-muted">—</span>
      </div>
    </div>
  );
}

function ObjectDetail({
  imageUrl,
  object,
  isSelected,
  onToggle,
  onBack,
}: {
  imageUrl: string;
  object: DetectedObject;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div>
      <button
        onClick={onBack}
        className="-ml-1.5 flex items-center gap-0.5 rounded-full py-1 pr-3 pl-1 text-sm text-muted transition-colors hover:text-ink"
      >
        <ChevronLeft className="size-4" strokeWidth={2} />
        All selected
      </button>

      <div className="mt-4 flex justify-center rounded-xl bg-canvas p-4">
        <ObjectThumb imageUrl={imageUrl} bbox={object.bbox} className="h-36" />
      </div>

      <h2 className="mt-5 text-xl font-semibold tracking-[-0.02em] text-ink">
        {object.name}
      </h2>

      <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
        <span className="text-sm text-muted">Estimated value</span>
        <span className="text-sm font-medium text-muted">—</span>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
        <span className="text-sm text-ink">Include in sale</span>
        <button
          role="switch"
          aria-checked={isSelected}
          aria-label={`Include ${object.name} in sale`}
          onClick={() => onToggle(object.id)}
          className={cn(
            "relative h-6 w-10 rounded-full transition-colors duration-200",
            isSelected ? "bg-accent-deep" : "bg-line-strong",
          )}
        >
          <motion.span
            layout
            transition={{ type: "spring", stiffness: 700, damping: 34 }}
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-surface shadow-[0_1px_3px_rgb(20_20_18/0.28)]",
              isSelected ? "left-[18px]" : "left-0.5",
            )}
          />
        </button>
      </div>

      <button
        onClick={() => onToggle(object.id)}
        className="mt-5 w-full rounded-full py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
      >
        {isSelected ? "Remove from sale" : "Add to sale"}
      </button>
    </div>
  );
}
