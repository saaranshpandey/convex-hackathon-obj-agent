import type { DetectedObject } from "@/data/demoObjects";
import PhotoCanvas from "@/components/PhotoCanvas";
import CanvasToolbar from "@/components/CanvasToolbar";
import ObjectChips from "@/components/ObjectChips";
import DetailPanel from "@/components/DetailPanel";

type Props = {
  imageUrl: string;
  objects: DetectedObject[];
  scanning: boolean;
  selected: Set<string>;
  activeId: string | null;
  hoveredId: string | null;
  onToggle: (id: string) => void;
  onHover: (id: string | null) => void;
  onActivate: (id: string | null) => void;
  onSelectAll: () => void;
  onClear: () => void;
};

export default function Workspace({
  imageUrl,
  objects,
  scanning,
  selected,
  activeId,
  hoveredId,
  onToggle,
  onHover,
  onActivate,
  onSelectAll,
  onClear,
}: Props) {
  return (
    <div className="grid gap-7 pt-3 lg:grid-cols-[minmax(0,2.05fr)_minmax(0,1fr)] lg:gap-8">
      <div className="min-w-0 space-y-5">
        <PhotoCanvas
          imageUrl={imageUrl}
          objects={objects}
          scanning={scanning}
          selected={selected}
          hoveredId={hoveredId}
          activeId={activeId}
          onToggle={onToggle}
          onHover={onHover}
        />

        {!scanning && (
          <>
            <CanvasToolbar
              total={objects.length}
              selectedCount={selected.size}
              onSelectAll={onSelectAll}
              onClear={onClear}
            />
            <ObjectChips
              objects={objects}
              selected={selected}
              hoveredId={hoveredId}
              onToggle={onToggle}
              onHover={onHover}
            />
          </>
        )}
      </div>

      {!scanning && (
        <DetailPanel
          imageUrl={imageUrl}
          objects={objects}
          selected={selected}
          activeId={activeId}
          onToggle={onToggle}
          onActivate={onActivate}
          onHover={onHover}
        />
      )}
    </div>
  );
}
