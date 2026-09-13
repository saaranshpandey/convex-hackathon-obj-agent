import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Check, ExternalLink, Loader2, Pencil } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { WorkspaceItem } from "@/lib/geometry";
import { canPublish, publishSelection, saleFlow } from "@/lib/saleFlow";
import ObjectThumb from "@/components/ObjectThumb";
import EbayConnectButton from "@/components/EbayConnectButton";
import { Button } from "@/components/ui/button";

type Props = {
  imageUrl: string;
  items: WorkspaceItem[];
  listings: Doc<"listings">[];
  sessionId: string;
  onEdit: (id: Id<"listings">) => void;
  onBack: () => void;
  onSkip: (id: Id<"items">) => void;
  onNewPhoto: () => void;
};

export default function SaleReview({ imageUrl, items, listings, sessionId, onEdit, onBack, onSkip, onNewPhoto }: Props) {
  const connection = useQuery(api.ebayAuth.connectionStatus, { sessionId });
  const approve = useMutation(api.listings.approve);
  const publish = useMutation(api.listingPublish.publish);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const flow = saleFlow(items, listings);
  const locked = busy || flow.publishing;
  const canGoBack = !locked && flow.included.every(canPublish);
  const modeLabel = connection?.mode === "sandbox" ? "eBay sandbox" : "eBay";
  const total = flow.remaining.reduce((sum, listing) => sum + listing.price, 0);

  const handlePublish = async () => {
    if (submitting.current || locked || !connection?.connected || flow.remaining.length === 0) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const failures = await publishSelection(flow.remaining,
        (listing) => approve({ listingId: listing._id, title: listing.title, description: listing.description, category: listing.category, condition: listing.condition, price: listing.price }),
        (listing) => publish({ listingId: listing._id, sessionId }),
      );
      if (failures.length) setError(`Couldn't submit ${failures.length} ${failures.length === 1 ? "listing" : "listings"}. Please try again.`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <ul className="divide-y divide-line">
          {flow.selected.map((item) => {
            const listing = flow.included.find((candidate) => candidate.itemId === item._id);
            return (
              <li key={item._id} className="flex items-center gap-4 p-4 sm:p-5">
                <ObjectThumb imageUrl={imageUrl} bbox={item.bbox} className="h-14 max-w-20" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{listing?.title ?? item.name}</p>
                  <p className="mt-1 text-xs text-muted">
                    {!listing ? item.researchStatus === "failed" ? "Couldn't prepare this item" : "Waiting for the listing draft" :
                      listing.status === "publishing" ? "Publishing…" : listing.status === "failed" ? "Couldn't publish — try again" :
                      canPublish(listing) ? listing.condition.replace(/_/g, " ") :
                      listing.publishMode === "mock" ? "Demo listing created" : listing.publishMode === "sandbox" ? "Listed in eBay sandbox" : listing.status === "sold" ? "Sold" : listing.status === "ended" ? "Ended" : "Listed"}
                  </p>
                  {listing?.publishError && <p className="mt-1 text-xs text-red-700">{listing.publishError}</p>}
                </div>
                {listing ? <>
                  <span className="text-sm font-medium tabular-nums">${listing.price.toFixed(2)}</span>
                  {listing.status === "publishing" ? <Loader2 aria-label="Publishing" className="size-4 animate-spin text-muted" /> :
                    canPublish(listing) ? <Button variant="ghost" size="sm" disabled={locked} onClick={() => onEdit(listing._id)} aria-label={`Edit ${item.name}`}><Pencil /><span className="hidden sm:inline">Edit</span></Button> :
                    <Button variant="ghost" size="sm" disabled={locked} onClick={() => onEdit(listing._id)}>Manage</Button>}
                  {listing.ebayListingUrl && listing.publishMode !== "mock" && <a href={listing.ebayListingUrl} target="_blank" rel="noreferrer" aria-label={`View ${item.name} on eBay`} className="rounded p-2 text-muted"><ExternalLink className="size-4" /></a>}
                </> : <Button variant="ghost" size="sm" disabled={locked} onClick={() => onSkip(item._id)}>Skip</Button>}
              </li>
            );
          })}
        </ul>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <div className="sticky bottom-0 mt-6 border-t border-line bg-canvas/95 py-5 backdrop-blur-sm">
        {flow.complete ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p role="status" className="flex items-center gap-2 text-sm"><Check className="size-4 text-accent-deep" />{flow.included.length} {flow.included.length === 1 ? "listing" : "listings"} ready to manage</p>
            <Button onClick={onNewPhoto}>Sell more items</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              {canGoBack ? <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft />Change items</Button> : <span className="text-sm text-muted">{locked ? "Publishing your listings…" : "Your listings"}</span>}
              <div className="flex w-full flex-wrap items-center justify-between gap-4 sm:w-auto sm:justify-end">
                {flow.remaining.length > 0 && <span className="text-sm tabular-nums">${total.toFixed(2)} total</span>}
                {!connection?.connected && connection !== undefined && flow.remaining.length > 0 ? <EbayConnectButton sessionId={sessionId} /> :
                  <Button disabled={locked || !connection?.connected || flow.remaining.length === 0} onClick={() => void handlePublish()}>
                    {locked ? <><Loader2 className="animate-spin" />Publishing…</> : `Publish ${flow.remaining.length} ${flow.remaining.length === 1 ? "listing" : "listings"}`}
                  </Button>}
              </div>
            </div>
            <p className="mt-3 text-right text-xs text-muted" aria-live="polite">
              {connection === undefined ? "Checking eBay connection…" : !connection.connected ? "Connect eBay to publish. Your drafts are saved." :
                flow.remaining.length > 0 ? connection.mode === "mock" ? "Creates demo listings. Nothing is published to eBay." : `Publishes these ${flow.remaining.length} listings to ${modeLabel}.` :
                  locked ? "You can see each listing's status above." : "Drafts appear here as they're ready. Skip an item or go back to try again."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
