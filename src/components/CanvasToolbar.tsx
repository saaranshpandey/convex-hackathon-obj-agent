import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  total: number;
  selectedCount: number;
  drawing: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleDrawing: () => void;
};

export default function CanvasToolbar({
  total,
  selectedCount,
  drawing,
  onSelectAll,
  onClear,
  onToggleDrawing,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <p className="text-sm text-muted">
        <span className="font-medium text-ink">
          {total} {total === 1 ? "object" : "objects"}
        </span>{" "}
        detected
        <span className="px-1.5 text-line-strong">·</span>
        <span className="font-medium text-ink">{selectedCount} selected</span>
      </p>

      <div className="flex items-center gap-1.5">
        <Button
          variant={drawing ? "primary" : "ghost"}
          size="sm"
          onClick={onToggleDrawing}
        >
          <Plus className="size-4" strokeWidth={2.25} />
          {drawing ? "Cancel" : "Add item"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectAll}
          disabled={total === 0 || selectedCount === total}
        >
          Select all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={selectedCount === 0}
        >
          Clear
        </Button>
        <Button variant="accent" className="ml-1.5" disabled={selectedCount === 0}>
          Continue with {selectedCount}
          <ArrowRight className="size-4" strokeWidth={2.25} />
        </Button>
      </div>
    </div>
  );
}
