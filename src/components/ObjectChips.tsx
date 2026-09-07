import { Check } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import type { WorkspaceItem } from "@/lib/geometry";
import { cn } from "@/lib/utils";

type Props = {
  items: WorkspaceItem[];
  hoveredId: Id<"items"> | null;
  onToggle: (id: Id<"items">) => void;
  onHover: (id: Id<"items"> | null) => void;
};

export default function ObjectChips({
  items,
  hoveredId,
  onToggle,
  onHover,
}: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item._id}
          onClick={() => onToggle(item._id)}
          onPointerEnter={() => onHover(item._id)}
          onPointerLeave={() => onHover(null)}
          aria-pressed={item.selected}
          className={cn(
            "flex items-center gap-1.5 rounded-full py-1.5 pr-3.5 text-sm font-medium transition-all duration-150",
            item.selected
              ? "bg-ink pl-2.5 text-canvas"
              : "bg-surface pl-3.5 text-ink-soft ring-1 ring-line ring-inset",
            hoveredId === item._id &&
              (item.selected ? "bg-ink/85" : "text-ink ring-line-strong"),
          )}
        >
          {item.selected && (
            <Check className="size-3.5 text-accent" strokeWidth={3} />
          )}
          {item.name}
        </button>
      ))}
    </div>
  );
}
