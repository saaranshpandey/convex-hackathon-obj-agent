import { AnimatePresence } from "motion/react";
import { AlertCircle, Loader2, SearchX } from "lucide-react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { Rect, WorkspaceItem } from "@/lib/geometry";
import PhotoCanvas from "@/components/PhotoCanvas";
import CanvasToolbar from "@/components/CanvasToolbar";
import ObjectChips from "@/components/ObjectChips";
import DetailPanel from "@/components/DetailPanel";
import ResearchStatusBar from "@/components/ResearchStatusBar";
import ListingsBar from "@/components/ListingsBar";
import ListingDrawer from "@/components/ListingDrawer";
import { Button } from "@/components/ui/button";

type Props = {
  cleanout: Doc<"cleanouts">;
  imageUrl: string | null;
  items: WorkspaceItem[];
  listings: Doc<"listings">[];
  activeId: Id<"items"> | null;
  hoveredId: Id<"items"> | null;
  drawing: boolean;
  sessionId: string;
  reviewingListingId: Id<"listings"> | null;
  onToggle: (id: Id<"items">) => void;
  onHover: (id: Id<"items"> | null) => void;
  onActivate: (id: Id<"items"> | null) => void;
  onRename: (id: Id<"items">, name: string) => void;
  onRemove: (id: Id<"items">) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleDrawing: () => void;
  onAddItem: (name: string, box: Rect) => void;
  onRetry: () => void;
  onNewPhoto: () => void;
  onContinue: () => void;
  onReviewListing: (listingId: Id<"listings">) => void;
  onCloseDrawer: () => void;
  onNavigateListing: (direction: "prev" | "next") => void;
};

export default function Workspace({
  cleanout,
  imageUrl,
  items,
  listings,
  activeId,
  hoveredId,
  drawing,
  sessionId,
  reviewingListingId,
  onToggle,
  onHover,
  onActivate,
  onRename,
  onRemove,
  onSelectAll,
  onClear,
  onToggleDrawing,
  onAddItem,
  onRetry,
  onNewPhoto,
  onContinue,
  onReviewListing,
  onCloseDrawer,
  onNavigateListing,
}: Props) {
  if (cleanout.status === "uploading") {
    return (
      <Card>
        <Loader2 className="size-5 animate-spin text-muted" strokeWidth={1.75} />
        <p className="mt-4 text-sm text-ink-soft">Uploading your photo…</p>
      </Card>
    );
  }

  if (cleanout.status === "failed") {
    return (
      <Card>
        <AlertCircle className="size-5 text-muted" strokeWidth={1.75} />
        <h2 className="mt-4 text-[15px] font-semibold text-ink">
          That scan didn't work
        </h2>
        <p className="mt-2 text-sm text-pretty text-ink-soft">
          {cleanout.error ?? "Detection failed for this photo."}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {cleanout.imageStorageId && (
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onNewPhoto}>
            Use a different photo
          </Button>
        </div>
      </Card>
    );
  }

  if (imageUrl === null) {
    return (
      <Card>
        <AlertCircle className="size-5 text-muted" strokeWidth={1.75} />
        <p className="mt-4 text-sm text-ink-soft">
          That room photo is no longer available in storage.
        </p>
        <Button size="sm" variant="outline" className="mt-6" onClick={onNewPhoto}>
          Upload another
        </Button>
      </Card>
    );
  }

  const scanning = cleanout.status === "analyzing";
  const revealing = cleanout.status === "objects_found";
  const ready = cleanout.status === "ready";
  const foundNothing = ready && items.length === 0;
  const selectedCount = items.filter((item) => item.selected).length;
  const researching = items.some(
    (item) =>
      item.selected &&
      (item.researchStatus === "queued" ||
        item.researchStatus === "identifying" ||
        item.researchStatus === "researching"),
  );
  const activeListing =
    listings.find((listing) => listing._id === reviewingListingId) ?? null;
  const activeListingItem = activeListing
    ? (items.find((item) => item._id === activeListing.itemId) ?? null)
    : null;
  const activeListingIndex = activeListing
    ? listings.findIndex((listing) => listing._id === activeListing._id)
    : -1;

  return (
    <div className="space-y-5 pt-3">
      <ResearchStatusBar items={items} />
      <div className="grid gap-7 lg:grid-cols-[minmax(0,2.05fr)_minmax(0,1fr)] lg:gap-8">
      <div className="min-w-0 space-y-5">
        <PhotoCanvas
          imageUrl={imageUrl}
          items={items}
          scanning={scanning}
          scanLabel="Scanning room…"
          drawing={drawing}
          hoveredId={hoveredId}
          activeId={activeId}
          onToggle={onToggle}
          onHover={onHover}
          onAddItem={onAddItem}
          onCancelDrawing={onToggleDrawing}
        />

        {foundNothing && (
          <div className="surface flex flex-col items-center px-8 py-8 text-center">
            <SearchX className="size-5 text-muted" strokeWidth={1.75} />
            <h2 className="mt-4 text-[15px] font-semibold text-ink">
              Nothing sellable in this one
            </h2>
            <p className="mt-2 max-w-sm text-sm text-pretty text-ink-soft">
              The scan finished but didn't find any discrete objects worth
              listing. You can scan again, add something by hand, or try a
              different photo.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" onClick={onRetry}>
                Scan again
              </Button>
              <Button size="sm" variant="outline" onClick={onToggleDrawing}>
                Add one by hand
              </Button>
              <Button size="sm" variant="ghost" onClick={onNewPhoto}>
                Different photo
              </Button>
            </div>
          </div>
        )}

        {/* Interactive as soon as boxes exist — the reveal is only visual, and
            mask refinement runs separately without blocking anything here. */}
        {(ready || revealing) && !foundNothing && (
          <>
            <CanvasToolbar
              total={items.length}
              selectedCount={selectedCount}
              drawing={drawing}
              researching={researching}
              onSelectAll={onSelectAll}
              onClear={onClear}
              onToggleDrawing={onToggleDrawing}
              onContinue={onContinue}
            />
            <ObjectChips
              items={items}
              hoveredId={hoveredId}
              onToggle={onToggle}
              onHover={onHover}
            />
          </>
        )}

      </div>

      {(ready || revealing) && (
        <DetailPanel
          cleanoutId={cleanout._id}
          imageUrl={imageUrl}
          items={items}
          listings={listings}
          activeId={activeId}
          provider={cleanout.provider}
          onToggle={onToggle}
          onActivate={onActivate}
          onHover={onHover}
          onRename={onRename}
          onRemove={onRemove}
          onReviewListing={onReviewListing}
        />
      )}
      </div>

      <ListingsBar
        cleanoutId={cleanout._id}
        sessionId={sessionId}
        listings={listings}
        onReviewAll={() => {
          if (listings[0]) onReviewListing(listings[0]._id);
        }}
      />

      <AnimatePresence>
        {activeListing && activeListingItem && (
          <ListingDrawer
            key={activeListing._id}
            imageUrl={imageUrl}
            listing={activeListing}
            item={activeListingItem}
            sessionId={sessionId}
            hasPrev={activeListingIndex > 0}
            hasNext={activeListingIndex < listings.length - 1}
            onNavigate={onNavigateListing}
            onClose={onCloseDrawer}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface mx-auto mt-16 flex max-w-md flex-col items-center px-8 py-12 text-center">
      {children}
    </div>
  );
}
