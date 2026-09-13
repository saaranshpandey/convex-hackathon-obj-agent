import { useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AlertCircle, ArrowRight, Check, Loader2, Plus } from "lucide-react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { Rect, WorkspaceItem } from "@/lib/geometry";
import { saleFlow } from "@/lib/saleFlow";
import PhotoCanvas from "@/components/PhotoCanvas";
import ObjectThumb from "@/components/ObjectThumb";
import SaleReview from "@/components/SaleReview";
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
  onRename: (id: Id<"items">, name: string) => void;
  onRemove: (id: Id<"items">) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleDrawing: () => void;
  onAddItem: (name: string, box: Rect) => void;
  onRetry: () => void;
  onNewPhoto: () => void;
  onContinue: () => Promise<unknown>;
  onReviewListing: (listingId: Id<"listings">) => void;
  onCloseDrawer: () => void;
};

export default function Workspace({
  cleanout, imageUrl, items, listings, activeId, hoveredId, drawing, sessionId,
  reviewingListingId, onToggle, onHover, onRename, onRemove, onSelectAll,
  onClear, onToggleDrawing, onAddItem, onRetry, onNewPhoto, onContinue,
  onReviewListing, onCloseDrawer,
}: Props) {
  const [choosing, setChoosing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const flow = saleFlow(items, listings);
  const preparing = starting || flow.working;
  const reviewing = !choosing && flow.started && !preparing;
  const scanning = cleanout.status === "analyzing";
  const activeListing = flow.included.find((listing) => listing._id === reviewingListingId);
  const activeItem = items.find((item) => item._id === activeListing?.itemId);

  const prepare = async () => {
    if (submitting.current || flow.selected.length === 0) return;
    setError(null);
    // Reuse existing drafts, including edits, when only removing items.
    if (flow.included.length === flow.selected.length) {
      setChoosing(false);
      return;
    }
    submitting.current = true;
    setStarting(true);
    try {
      await onContinue();
      setChoosing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't prepare your listings. Try again.");
    } finally {
      submitting.current = false;
      setStarting(false);
    }
  };

  if (cleanout.status === "uploading") {
    return <Card><Loader2 className="size-6 animate-spin text-muted" /><h1 className="mt-4 font-medium">Adding your photo…</h1></Card>;
  }
  if (cleanout.status === "failed" || imageUrl === null) {
    return <Card>
      <AlertCircle className="size-6 text-muted" />
      <h1 className="mt-4 font-medium">We couldn't read that photo</h1>
      <p className="mt-2 text-sm text-muted">{cleanout.error ?? "Try another room photo."}</p>
      <div className="mt-5 flex gap-2">
        {cleanout.imageStorageId && <Button onClick={onRetry}>Try again</Button>}
        <Button variant="ghost" onClick={onNewPhoto}>Change photo</Button>
      </div>
    </Card>;
  }

  return (
    <div className="mx-auto max-w-5xl pb-8 pt-8 sm:pt-12">
      <ol aria-label="Sale progress" className="mb-8 flex justify-center gap-5 sm:gap-10">
        {["Choose items", "Review", "Published"].map((label, index) => {
          const step = flow.complete && !choosing ? 2 : reviewing || preparing ? 1 : 0;
          return <li key={label} aria-current={step === index ? "step" : undefined} className={`flex items-center gap-2 text-xs ${step === index ? "font-medium text-ink" : "text-muted"}`}>
            <span className={`flex size-6 items-center justify-center rounded-full text-[11px] ${step === index ? "bg-ink text-white" : "bg-line text-muted"}`}>{step > index ? <Check className="size-3" /> : index + 1}</span>{label}
          </li>;
        })}
      </ol>
      <div className="mb-7 text-center">
        <h1 className="text-3xl font-semibold tracking-[-0.035em]">
          {preparing ? "Preparing your listings" : reviewing ? flow.complete ? "You're all set" : "Review before publishing" : scanning ? "Finding your items" : "What would you like to sell?"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {preparing ? "Finding prices and writing the details. Nothing is published yet." : reviewing ? flow.complete ? "Manage your listings below." : "Check the prices. Edit anything you want." : scanning ? "This will only take a moment." : "Tap an item in the photo or choose it from the list."}
        </p>
      </div>

      {preparing ? (
        <div className="mx-auto max-w-lg rounded-2xl border border-line bg-surface p-6" role="status" aria-live="polite">
          <div className="mb-5 flex items-center gap-3"><Loader2 className="size-5 animate-spin text-accent-deep" /><span className="text-sm">Preparing {flow.selected.length} {flow.selected.length === 1 ? "item" : "items"}</span></div>
          <ul className="space-y-4">{flow.selected.map((item) => <li key={item._id} className="flex items-center justify-between gap-4 text-sm"><span>{item.name}</span><span className="text-xs text-muted">{item.researchStatus === "failed" ? "Couldn't prepare" : flow.included.some((listing) => listing.itemId === item._id) ? "Ready" : item.researchStatus === "ready_for_review" ? "Writing listing…" : "Finding price…"}</span></li>)}</ul>
        </div>
      ) : reviewing ? (
        <SaleReview imageUrl={imageUrl} items={items} listings={listings} sessionId={sessionId}
          onEdit={onReviewListing} onBack={() => { setChoosing(true); onCloseDrawer(); }}
          onSkip={onToggle} onNewPhoto={onNewPhoto} />
      ) : (
        <>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <PhotoCanvas imageUrl={imageUrl} items={items} scanning={scanning} scanLabel="Finding items…"
                drawing={drawing} hoveredId={hoveredId} activeId={activeId}
                onToggle={onToggle} onHover={onHover} onAddItem={onAddItem} onCancelDrawing={onToggleDrawing} />
              {!scanning && <div className="mt-3 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={onToggleDrawing}><Plus />{drawing ? "Cancel selection" : "Add missing item"}</Button>
                <Button variant="ghost" size="sm" onClick={onNewPhoto}>Change photo</Button>
              </div>}
            </div>
            {!scanning && <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium">{items.length} items found</h2>
                <Button variant="ghost" size="sm" disabled={items.length === 0} onClick={flow.selected.length === items.length ? onClear : onSelectAll}>{flow.selected.length === items.length && items.length > 0 ? "Clear" : "Select all"}</Button>
              </div>
              {items.length === 0 && <p className="py-6 text-sm text-muted">No items found. Use “Add missing item” to select one in the photo.</p>}
              <ul className="space-y-1">{items.map((item) => (
                <li key={item._id} onPointerEnter={() => onHover(item._id)} onPointerLeave={() => onHover(null)}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl p-2 hover:bg-canvas">
                    <input type="checkbox" checked={item.selected} onChange={() => onToggle(item._id)} className="size-4 shrink-0 accent-accent-deep" />
                    <ObjectThumb imageUrl={imageUrl} bbox={item.bbox} className="h-10 max-w-14" />
                    <span className="min-w-0 flex-1 text-sm">{item.name}</span>
                  </label>
                  {item.source === "manual" && <details className="ml-9 text-xs text-muted">
                    <summary className="cursor-pointer py-1">Edit item</summary>
                    <input aria-label={`Rename ${item.name}`} defaultValue={item.name} key={item.name} onBlur={(event) => { if (event.target.value.trim()) onRename(item._id, event.target.value.trim()); }} className="my-2 w-full rounded border border-line px-2 py-1.5" />
                    <button className="mb-2 text-red-700" onClick={() => onRemove(item._id)}>Remove item</button>
                  </details>}
                </li>
              ))}</ul>
            </div>}
          </div>
          {!scanning && <div className="sticky bottom-0 mt-6 border-t border-line bg-canvas/95 py-5 backdrop-blur-sm">
            {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted">{flow.selected.length} {flow.selected.length === 1 ? "item" : "items"} selected</p>
              <Button disabled={flow.selected.length === 0 || drawing} onClick={() => void prepare()}>
                {flow.selected.length > 0 && flow.included.length === flow.selected.length ? "Review listings" : "Prepare listings"}<ArrowRight />
              </Button>
            </div>
            <p className="mt-3 text-right text-xs text-muted">{flow.included.length > 0 && flow.included.length < flow.selected.length ? "Preparing again replaces existing drafts with fresh prices and details." : "Next: review prices and listing details."}</p>
          </div>}
        </>
      )}

      <AnimatePresence>
        {reviewing && activeListing && activeItem && (
          <ListingDrawer key={activeListing._id} imageUrl={imageUrl} listing={activeListing} item={activeItem}
            onClose={onCloseDrawer} />
        )}
      </AnimatePresence>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto mt-16 flex max-w-md flex-col items-center rounded-2xl border border-line bg-surface px-8 py-12 text-center">{children}</div>;
}
