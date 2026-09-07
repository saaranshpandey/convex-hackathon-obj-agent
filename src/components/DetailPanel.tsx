import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, Loader2, PackageOpen, Pencil, Trash2 } from "lucide-react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { WorkspaceItem } from "@/lib/geometry";
import ObjectThumb from "@/components/ObjectThumb";
import ActivityFeed from "@/components/ActivityFeed";
import ReadyToSell from "@/components/ReadyToSell";
import { cn } from "@/lib/utils";

type Props = {
  cleanoutId: Id<"cleanouts">;
  imageUrl: string;
  items: WorkspaceItem[];
  listings: Doc<"listings">[];
  activeId: Id<"items"> | null;
  provider?: string;
  onToggle: (id: Id<"items">) => void;
  onActivate: (id: Id<"items"> | null) => void;
  onHover: (id: Id<"items"> | null) => void;
  onRename: (id: Id<"items">, name: string) => void;
  onRemove: (id: Id<"items">) => void;
  onReviewListing: (listingId: Id<"listings">) => void;
};

export default function DetailPanel({
  cleanoutId,
  imageUrl,
  items,
  listings,
  activeId,
  provider,
  onToggle,
  onActivate,
  onHover,
  onRename,
  onRemove,
  onReviewListing,
}: Props) {
  const active = items.find((item) => item._id === activeId) ?? null;

  return (
    <aside className="surface p-5 lg:sticky lg:top-24 lg:self-start">
      <AnimatePresence mode="wait" initial={false}>
        {active ? (
          <motion.div
            key={active._id}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <ItemDetail
              imageUrl={imageUrl}
              item={active}
              onToggle={onToggle}
              onRename={onRename}
              onRemove={onRemove}
              onBack={() => onActivate(null)}
            />
          </motion.div>
        ) : listings.length > 0 ? (
          <motion.div
            key="ready-to-sell"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <ReadyToSell
              imageUrl={imageUrl}
              items={items}
              listings={listings}
              onReview={onReviewListing}
              onHover={onHover}
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
              cleanoutId={cleanoutId}
              imageUrl={imageUrl}
              items={items}
              provider={provider}
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
  cleanoutId,
  imageUrl,
  items,
  provider,
  onActivate,
  onHover,
}: {
  cleanoutId: Id<"cleanouts">;
  imageUrl: string;
  items: WorkspaceItem[];
  provider?: string;
  onActivate: (id: Id<"items">) => void;
  onHover: (id: Id<"items"> | null) => void;
}) {
  const chosen = items.filter((item) => item.selected);

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
          {chosen.map((item) => (
            <li key={item._id}>
              <button
                onClick={() => onActivate(item._id)}
                onPointerEnter={() => onHover(item._id)}
                onPointerLeave={() => onHover(null)}
                className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-canvas"
              >
                <ObjectThumb
                  imageUrl={imageUrl}
                  bbox={item.bbox}
                  className="h-10"
                />
                <span className="flex-1 text-sm font-medium text-ink">
                  {item.name}
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

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
            Activity
          </h3>
          {provider && (
            <span className="text-[11px] text-muted/80">{provider}</span>
          )}
        </div>
        <ActivityFeed cleanoutId={cleanoutId} />
      </div>
    </div>
  );
}

function ItemDetail({
  imageUrl,
  item,
  onToggle,
  onRename,
  onRemove,
  onBack,
}: {
  imageUrl: string;
  item: WorkspaceItem;
  onToggle: (id: Id<"items">) => void;
  onRename: (id: Id<"items">, name: string) => void;
  onRemove: (id: Id<"items">) => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);

  // A rename from another window should win over a stale local draft.
  useEffect(() => {
    setDraft(item.name);
    setEditing(false);
  }, [item._id, item.name]);

  const commit = () => {
    const next = draft.trim();
    if (next.length > 0 && next !== item.name) onRename(item._id, next);
    else setDraft(item.name);
    setEditing(false);
  };

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
        <ObjectThumb imageUrl={imageUrl} bbox={item.bbox} className="h-36" />
      </div>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setDraft(item.name);
              setEditing(false);
            }
          }}
          className="mt-5 w-full rounded-lg bg-canvas px-3 py-2 text-xl font-semibold tracking-[-0.02em] text-ink outline-none"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="group mt-5 flex w-full items-center gap-2 rounded-lg text-left"
          title="Rename"
        >
          <span className="text-xl font-semibold tracking-[-0.02em] text-ink">
            {item.name}
          </span>
          <Pencil
            className="size-3.5 text-muted opacity-0 transition-opacity group-hover:opacity-100"
            strokeWidth={2}
          />
        </button>
      )}

      <p className="mt-1 text-sm text-muted">
        {item.category.replace(/_/g, " ")}
        {item.source === "detected" && (
          <>
            <span className="px-1.5 text-line-strong">·</span>
            {Math.round(item.confidence * 100)}% confident
          </>
        )}
        {item.source === "manual" && (
          <>
            <span className="px-1.5 text-line-strong">·</span>
            added by you
          </>
        )}
      </p>

      {item.researchStatus &&
        item.researchStatus !== "ready_for_review" &&
        item.researchStatus !== "failed" && (
          <p className="mt-4 flex items-center gap-2 border-t border-line pt-4 text-sm text-muted">
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            {item.researchStatus === "queued" && "Queued for resale research…"}
            {item.researchStatus === "identifying" && "Identifying this item…"}
            {item.researchStatus === "researching" && "Researching resale prices…"}
          </p>
        )}

      {item.researchStatus === "failed" && (
        <p className="mt-4 border-t border-line pt-4 text-sm text-muted">
          Couldn't estimate resale value{item.researchError ? `: ${item.researchError}` : "."}
        </p>
      )}

      {item.identification && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Identification confidence</span>
            <span className="text-sm font-medium text-ink capitalize">
              {item.identification.confidence}
            </span>
          </div>
          {(item.identification.brand || item.identification.model) && (
            <p className="mt-1 text-xs text-muted">
              {[item.identification.brand, item.identification.model]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
        <span className="text-sm text-muted">Estimated resale</span>
        <span className="text-sm font-medium text-muted">
          {item.estimatedLow !== undefined && item.estimatedHigh !== undefined
            ? `$${item.estimatedLow}–$${item.estimatedHigh}`
            : "—"}
        </span>
      </div>

      {item.recommendedPrice !== undefined && (
        <div className="flex items-baseline justify-between pt-1.5">
          <span className="text-sm text-muted">Recommended</span>
          <span className="text-sm font-semibold text-ink">
            ${item.recommendedPrice}
          </span>
        </div>
      )}

      {item.researchSources && item.researchSources.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            {item.researchSources.length} market{" "}
            {item.researchSources.length === 1 ? "comparison" : "comparisons"}
          </p>
          <ul className="mt-2 space-y-2">
            {item.researchSources.map((source, index) => (
              <li key={index} className="rounded-lg bg-canvas px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink">{source.source}</span>
                  <span className="text-xs font-medium text-ink">{source.price}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{source.description}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
        <span className="text-sm text-ink">Include in sale</span>
        <button
          role="switch"
          aria-checked={item.selected}
          aria-label={`Include ${item.name} in sale`}
          onClick={() => onToggle(item._id)}
          className={cn(
            "relative h-6 w-10 rounded-full transition-colors duration-200",
            item.selected ? "bg-accent-deep" : "bg-line-strong",
          )}
        >
          <motion.span
            layout
            transition={{ type: "spring", stiffness: 700, damping: 34 }}
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-surface shadow-[0_1px_3px_rgb(20_20_18/0.28)]",
              item.selected ? "left-[18px]" : "left-0.5",
            )}
          />
        </button>
      </div>

      <button
        onClick={() => onToggle(item._id)}
        className="mt-5 w-full rounded-full py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
      >
        {item.selected ? "Remove from sale" : "Add to sale"}
      </button>

      {item.source === "manual" && (
        <button
          onClick={() => onRemove(item._id)}
          className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-medium text-muted transition-colors hover:bg-canvas hover:text-ink"
        >
          <Trash2 className="size-3.5" strokeWidth={2} />
          Delete this item
        </button>
      )}
    </div>
  );
}
