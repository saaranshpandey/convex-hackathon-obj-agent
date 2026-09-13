import { useRef } from "react";
import { Image, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkspaceTab = "items" | "listings";

type Props = {
  active: WorkspaceTab;
  itemsDisabled: boolean;
  listingsDisabled: boolean;
  onChange: (tab: WorkspaceTab) => void;
};

export default function WorkspaceTabs({ active, itemsDisabled, listingsDisabled, onChange }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = [
    { id: "items" as const, label: "Items", icon: Image, disabled: itemsDisabled },
    { id: "listings" as const, label: "Listings", icon: List, disabled: listingsDisabled },
  ];

  return (
    <div role="tablist" aria-label="Your sale" className="sticky top-[72px] z-20 mb-8 flex justify-center border-b border-line bg-canvas/95 backdrop-blur-sm">
      {tabs.map(({ id, label, icon: Icon, disabled }, index) => (
        <button key={id} ref={(element) => { refs.current[index] = element; }}
          id={`sale-tab-${id}`} role="tab" aria-selected={active === id}
          aria-controls={`sale-panel-${id}`} tabIndex={active === id ? 0 : -1}
          disabled={disabled} onClick={() => onChange(id)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const enabled = tabs.map((tab, i) => ({ ...tab, index: i })).filter((tab) => !tab.disabled);
            const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1) : enabled.find((tab) => tab.index !== index);
            if (next) { onChange(next.id); refs.current[next.index]?.focus(); }
          }}
          className={cn("flex min-w-32 items-center justify-center gap-2 border-b-2 px-6 py-4 text-sm font-medium transition-colors disabled:cursor-default disabled:opacity-40",
            active === id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}
        >
          <Icon className="size-4" strokeWidth={1.75} />{label}
        </button>
      ))}
    </div>
  );
}
