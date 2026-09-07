import { Check } from "lucide-react";
import type { DetectedObject } from "@/data/demoObjects";
import { cn } from "@/lib/utils";

type Props = {
  objects: DetectedObject[];
  selected: Set<string>;
  hoveredId: string | null;
  onToggle: (id: string) => void;
  onHover: (id: string | null) => void;
};

export default function ObjectChips({
  objects,
  selected,
  hoveredId,
  onToggle,
  onHover,
}: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {objects.map((o) => {
        const isSelected = selected.has(o.id);
        return (
          <button
            key={o.id}
            onClick={() => onToggle(o.id)}
            onPointerEnter={() => onHover(o.id)}
            onPointerLeave={() => onHover(null)}
            aria-pressed={isSelected}
            className={cn(
              "flex items-center gap-1.5 rounded-full py-1.5 pr-3.5 text-sm font-medium transition-all duration-150",
              isSelected
                ? "bg-ink pl-2.5 text-canvas"
                : "bg-surface pl-3.5 text-ink-soft ring-1 ring-line ring-inset",
              hoveredId === o.id &&
                (isSelected ? "bg-ink/85" : "text-ink ring-line-strong"),
            )}
          >
            {isSelected && (
              <Check className="size-3.5 text-accent" strokeWidth={3} />
            )}
            {o.name}
          </button>
        );
      })}
    </div>
  );
}
