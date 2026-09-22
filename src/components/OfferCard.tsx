import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toaster";

type Decision = "accept" | "decline" | "counter";

/**
 * The offer state of a live listing. Deliberately no views or watchers — those
 * are a next-day traffic report on real eBay, so showing them live would be
 * fiction.
 */
export default function OfferCard({ listing }: { listing: Doc<"listings"> }) {
  const offers = useQuery(api.offers.listForListing, { listingId: listing._id });
  const decide = useAction(api.offers.decide);
  const simulateBuyerAccepts = useMutation(api.offers.simulateBuyerAcceptsCounter);

  const toast = useToast();
  // Which decision is in flight — `decide` calls the marketplace, so the button
  // that was pressed has to say it is working, not just go dim.
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = pending !== null;

  if (offers === undefined) {
    return <div className="h-24 animate-pulse rounded-xl bg-canvas" />;
  }

  // Show the offer that settled the sale if there is one, otherwise whichever
  // is still open. Falling back to "most recent" alone would surface a sibling
  // that expired when the item sold, hiding the sale itself.
  const offer =
    offers.find((o) => o.status === "accepted" || o.status === "buyer_accepted") ??
    offers.find((o) => o.status === "pending" || o.status === "countered") ??
    offers[0];
  if (offer === undefined) return null;

  const run = async (action: Decision, amount?: number) => {
    setPending(action);
    setError(null);
    try {
      const result = await decide({ offerId: offer._id, action, amount });
      if (result.ok) {
        toast.success(
          action === "accept"
            ? "Offer accepted."
            : action === "decline"
              ? "Offer declined."
              : `Counter sent at $${amount}.`,
        );
      } else {
        const reason = result.reason ?? "That didn't go through.";
        setError(reason);
        toast.error(reason);
      }
    } finally {
      setPending(null);
    }
  };

  const settled = offer.status === "accepted" || offer.status === "buyer_accepted";

  const label = (action: Decision, idle: string, working: string) =>
    pending === action ? (
      <>
        <Loader2 className="animate-spin" />
        {working}
      </>
    ) : (
      idle
    );

  return (
    <div className="rounded-xl bg-canvas p-4">
      {/* A simulated offer reads exactly like a real one. What produced it is
          still recorded on `offers.source`. */}
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted">
          Listed at <span className="font-medium text-ink">${listing.price}</span>
        </p>
      </div>

      {offer.status === "pending" && (
        <>
          <p className="mt-3 text-xs font-medium tracking-wide text-muted uppercase">
            Offer received
          </p>
          <p className="text-2xl font-semibold tracking-[-0.02em] text-ink">
            ${offer.amount}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="accent" disabled={busy} onClick={() => void run("accept")}>
              {label("accept", "Accept", "Accepting…")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const midpoint = Math.round((offer.amount + listing.price) / 2);
                const value = window.prompt("Counter at how much?", String(midpoint));
                const amount = value ? Number(value) : NaN;
                if (Number.isFinite(amount) && amount > 0) void run("counter", amount);
              }}
            >
              {label("counter", "Counter", "Sending…")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("decline")}>
              {label("decline", "Decline", "Declining…")}
            </Button>
          </div>
        </>
      )}

      {offer.status === "countered" && (
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Buyer offered</dt>
            <dd className="font-medium text-ink">${offer.amount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">You countered</dt>
            <dd className="font-medium text-ink">${offer.counterAmount}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-1.5">
            <dt className="text-muted">Status</dt>
            <dd className="text-muted">Waiting for buyer</dd>
          </div>
        </dl>
      )}

      {settled && (
        <>
          <p className="mt-3 text-xs font-medium tracking-wide text-muted uppercase">Sold</p>
          <p className="text-2xl font-semibold tracking-[-0.02em] text-ink">${listing.price}</p>
        </>
      )}

      {offer.status === "declined" && (
        <p className="mt-3 text-sm text-muted">
          You declined ${offer.amount}. The listing is still live.
        </p>
      )}

      {offer.status === "expired" && (
        <p className="mt-3 text-sm text-muted">
          This ${offer.amount} offer closed without a sale.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-ink">
          {error}
        </p>
      )}

      {import.meta.env.DEV && offer.status === "countered" && (
        <button
          onClick={() => void simulateBuyerAccepts({ offerId: offer._id })}
          className="mt-4 w-full border-t border-line pt-3 text-center text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          Simulate buyer accepting the counter
        </button>
      )}
    </div>
  );
}
