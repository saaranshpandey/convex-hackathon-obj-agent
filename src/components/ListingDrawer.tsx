import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { WorkspaceItem } from "@/lib/geometry";
import ObjectThumb from "@/components/ObjectThumb";
import AgentTab from "@/components/AgentTab";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CONDITIONS: { value: Doc<"listings">["condition"]; label: string }[] = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
];

type Props = {
  imageUrl: string;
  listing: Doc<"listings">;
  item: WorkspaceItem;
  sessionId: string;
  hasPrev: boolean;
  hasNext: boolean;
  onNavigate: (direction: "prev" | "next") => void;
  onClose: () => void;
};

export default function ListingDrawer({
  imageUrl,
  listing,
  item,
  sessionId,
  hasPrev,
  hasNext,
  onNavigate,
  onClose,
}: Props) {
  const updateListing = useMutation(api.listings.update);
  const approveListing = useMutation(api.listings.approve);
  const publishListing = useMutation(api.listingPublish.publish);

  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [price, setPrice] = useState(String(listing.price));
  const [condition, setCondition] = useState(listing.condition);
  const [researchOpen, setResearchOpen] = useState(false);
  const [tab, setTab] = useState<"details" | "agent">("details");

  // A different listing (nav, or a fresh generation) replaces the local draft.
  useEffect(() => {
    setTitle(listing.title);
    setDescription(listing.description);
    setPrice(String(listing.price));
    setCondition(listing.condition);
    setResearchOpen(false);
    setTab("details");
  }, [listing._id, listing.title, listing.description, listing.price, listing.condition]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const draft = () => ({
    listingId: listing._id,
    title,
    description,
    category: listing.category,
    condition,
    price: Number(price) || 0,
  });

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-40 bg-ink/30"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="surface fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onNavigate("prev")}
              disabled={!hasPrev}
              className="rounded-full p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink disabled:pointer-events-none disabled:opacity-30"
              aria-label="Previous listing"
            >
              <ChevronLeft className="size-4" strokeWidth={2} />
            </button>
            <button
              onClick={() => onNavigate("next")}
              disabled={!hasNext}
              className="rounded-full p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink disabled:pointer-events-none disabled:opacity-30"
              aria-label="Next listing"
            >
              <ChevronRight className="size-4" strokeWidth={2} />
            </button>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink"
            aria-label="Close"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>

        <div className="mt-4 flex gap-1 rounded-full bg-canvas p-1">
          <button
            onClick={() => setTab("details")}
            className={cn(
              "flex-1 rounded-full py-1.5 text-sm font-medium transition-colors",
              tab === "details" ? "bg-surface text-ink shadow-sm" : "text-muted",
            )}
          >
            Details
          </button>
          <button
            onClick={() => setTab("agent")}
            className={cn(
              "flex-1 rounded-full py-1.5 text-sm font-medium transition-colors",
              tab === "agent" ? "bg-surface text-ink shadow-sm" : "text-muted",
            )}
          >
            Agent
          </button>
        </div>

        {tab === "agent" ? (
          <AgentTab listing={listing} />
        ) : (
          <>
        <div className="mt-4 flex justify-center rounded-xl bg-canvas p-4">
          <ObjectThumb imageUrl={imageUrl} bbox={item.bbox} className="h-36" />
        </div>

        <label className="mt-5 block text-xs font-medium tracking-wide text-muted uppercase">
          Title
        </label>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-1.5 w-full rounded-lg bg-canvas px-3 py-2 text-sm text-ink outline-none"
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium tracking-wide text-muted uppercase">
              Price
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="mt-1.5 w-full rounded-lg bg-canvas px-3 py-2 text-sm text-ink outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium tracking-wide text-muted uppercase">
              Condition
            </label>
            <select
              value={condition}
              onChange={(event) =>
                setCondition(event.target.value as Doc<"listings">["condition"])
              }
              className="mt-1.5 w-full rounded-lg bg-canvas px-3 py-2 text-sm text-ink outline-none"
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="mt-4 block text-xs font-medium tracking-wide text-muted uppercase">
          Description
        </label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          className="mt-1.5 w-full resize-none rounded-lg bg-canvas px-3 py-2 text-sm text-ink outline-none"
        />

        <details
          open={researchOpen}
          onToggle={(event) => setResearchOpen(event.currentTarget.open)}
          className="mt-4 border-t border-line pt-4"
        >
          <summary className="cursor-pointer text-xs font-medium tracking-wide text-muted uppercase">
            Research summary
          </summary>
          <div className="mt-2 space-y-2 text-sm">
            {item.identification && (
              <p className="text-ink-soft">
                {item.identification.confidence} confidence
                {(item.identification.brand || item.identification.model) &&
                  ` · ${[item.identification.brand, item.identification.model].filter(Boolean).join(" ")}`}
              </p>
            )}
            {item.estimatedLow !== undefined && item.estimatedHigh !== undefined && (
              <p className="text-ink-soft">
                Estimated resale ${item.estimatedLow}–${item.estimatedHigh}
              </p>
            )}
            {item.researchSources?.map((source, index) => (
              <div key={index} className="rounded-lg bg-canvas px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink">{source.source}</span>
                  <span className="text-xs font-medium text-ink">{source.price}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{source.description}</p>
              </div>
            ))}
          </div>
        </details>

        {listing.status === "live" || listing.status === "sold" || listing.status === "ended" ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm text-ink-soft">{title}</p>
            <p className="mt-1 text-sm text-muted">
              ${listing.price} · {listing.condition.replace(/_/g, " ")}
            </p>
            {listing.ebayListingUrl && (
              <a
                href={listing.ebayListingUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block rounded-full bg-canvas px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-line"
              >
                View on eBay
              </a>
            )}
          </div>
        ) : listing.status === "failed" ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm text-muted">
              {listing.publishError ?? "Publishing failed for an unknown reason."}
            </p>
            <Button
              variant="accent"
              className="mt-3 w-full"
              onClick={() => void publishListing({ listingId: listing._id, sessionId })}
            >
              Retry publish
            </Button>
          </div>
        ) : (
          <div className="mt-5 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={listing.status === "publishing"}
              onClick={() => void updateListing(draft())}
            >
              Save
            </Button>
            <Button
              variant="accent"
              className="flex-1"
              disabled={listing.status === "publishing"}
              onClick={() => void approveListing(draft())}
            >
              {listing.status === "publishing" ? "Publishing…" : "Approve listing"}
            </Button>
          </div>
        )}
          </>
        )}
      </motion.aside>
    </>
  );
}
