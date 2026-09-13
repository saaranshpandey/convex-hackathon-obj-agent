import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { WorkspaceItem } from "@/lib/geometry";
import { canPublish } from "@/lib/saleFlow";
import ObjectThumb from "@/components/ObjectThumb";
import AgentTab from "@/components/AgentTab";
import { Button } from "@/components/ui/button";

const CONDITIONS: Doc<"listings">["condition"][] = ["new", "like_new", "good", "fair", "poor"];

type Props = {
  imageUrl: string;
  listing: Doc<"listings">;
  item: WorkspaceItem;
  onClose: () => void;
};

export default function ListingDrawer({ imageUrl, listing, item, onClose }: Props) {
  const updateListing = useMutation(api.listings.update);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [price, setPrice] = useState(String(listing.price));
  const [condition, setCondition] = useState(listing.condition);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = canPublish(listing);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
    };
  }, []);

  const save = async () => {
    if (submitting.current || !editable) return;
    if (!title.trim() || !Number.isFinite(Number(price)) || Number(price) <= 0) {
      setError("Add a title and a price greater than $0.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await updateListing({ listingId: listing._id, title: title.trim(), description, category: listing.category, condition, price: Number(price) });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save. Please try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="listing-editor-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/30">
      <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 id="listing-editor-title" className="text-lg font-semibold">{editable ? "Edit listing" : "Manage listing"}</h2>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose} aria-label="Close listing"><X /></Button>
        </div>
        <div className="my-5 flex items-center gap-4 rounded-xl bg-canvas p-4">
          <ObjectThumb imageUrl={imageUrl} bbox={item.bbox} className="h-20 max-w-28" />
          <p className="text-sm font-medium">{item.name}</p>
        </div>
        <fieldset disabled={busy || !editable} className="space-y-4 disabled:opacity-80">
          <label className="block text-sm">Title
            <input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5" />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm">Price ($)
              <input required type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5" />
            </label>
            <label className="block text-sm">Condition
              <select value={condition} onChange={(event) => setCondition(event.target.value as Doc<"listings">["condition"])} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5">
                {CONDITIONS.map((value) => <option key={value} value={value}>{value.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase())}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-sm">Description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className="mt-1.5 w-full resize-y rounded-lg border border-line px-3 py-2.5" />
          </label>
        </fieldset>
        {item.researchSources && item.researchSources.length > 0 && <details className="mt-4 border-t border-line pt-4">
          <summary className="cursor-pointer text-xs text-muted">How this price was estimated</summary>
          <ul className="mt-3 space-y-3">{item.researchSources.map((source, index) => <li key={index} className="text-xs"><p className="font-medium">{source.source} · {source.price}</p><p className="mt-1 text-muted">{source.description}</p></li>)}</ul>
        </details>}
        {!editable && listing.status !== "publishing" && <details className="mt-4 border-t border-line pt-4"><summary className="cursor-pointer text-sm">Offers & activity</summary><AgentTab listing={listing} /></details>}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <div className="sticky bottom-0 mt-5 flex justify-end gap-2 border-t border-line bg-surface py-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{editable ? "Cancel" : "Done"}</Button>
          {editable && <Button type="submit" disabled={busy}>{busy ? <><Loader2 className="animate-spin" />Saving…</> : "Save changes"}</Button>}
        </div>
      </form>
    </dialog>
  );
}
