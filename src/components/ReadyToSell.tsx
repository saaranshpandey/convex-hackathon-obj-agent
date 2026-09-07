import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { WorkspaceItem } from "@/lib/geometry";
import ObjectThumb from "@/components/ObjectThumb";

type Props = {
  imageUrl: string;
  items: WorkspaceItem[];
  listings: Doc<"listings">[];
  onReview: (listingId: Id<"listings">) => void;
  onHover: (id: Id<"items"> | null) => void;
};

const STATUS_LABEL: Record<Doc<"listings">["status"], string> = {
  draft: "Ready",
  approved: "Approved",
  publishing: "Publishing…",
  live: "● Live on eBay",
  failed: "Failed",
  ended: "Ended",
  sold: "Sold",
  listed: "Listed",
};

const LIVE_STATUSES = new Set<Doc<"listings">["status"]>(["live", "sold", "ended"]);

export default function ReadyToSell({
  imageUrl,
  items,
  listings,
  onReview,
  onHover,
}: Props) {
  return (
    <div>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
        Ready to sell
      </h2>
      <p className="mt-1 text-sm text-muted">
        {listings.length} {listings.length === 1 ? "listing" : "listings"} prepared
      </p>

      <ul className="mt-5 space-y-1">
        {listings.map((listing) => {
          const item = items.find((candidate) => candidate._id === listing.itemId);
          if (!item) return null;
          return (
            <li key={listing._id}>
              <div
                onPointerEnter={() => onHover(item._id)}
                onPointerLeave={() => onHover(null)}
                className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-canvas"
              >
                <ObjectThumb imageUrl={imageUrl} bbox={item.bbox} className="h-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                  <p className="text-sm text-muted">${listing.price}</p>
                </div>
                <span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-medium text-ink-soft ring-1 ring-line ring-inset">
                  {STATUS_LABEL[listing.status]}
                </span>
                {LIVE_STATUSES.has(listing.status) && listing.ebayListingUrl ? (
                  <a
                    href={listing.ebayListingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
                  >
                    View listing
                  </a>
                ) : (
                  <button
                    onClick={() => onReview(listing._id)}
                    className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
                  >
                    Review
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
