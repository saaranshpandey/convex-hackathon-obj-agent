import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import OfferCard from "@/components/OfferCard";

export default function AgentTab({ listing }: { listing: Doc<"listings"> }) {
  const messages = useQuery(api.agentMail.messagesForListing, { listingId: listing._id });
  const simulateBuyerOffer = useMutation(api.offers.simulateBuyerOffer);
  const sendTestPriceDropSuggestion = useMutation(api.agentMail.sendTestPriceDropSuggestion);

  return (
    <div className="mt-4">
      <OfferCard listing={listing} />

      {listing.pendingDecision && (
        <div className="mt-3 mb-3 rounded-lg bg-canvas px-3 py-2 text-xs text-muted">
          Waiting for your reply via email…
        </div>
      )}

      <div className="space-y-2">
        {messages === undefined ? (
          <div className="h-16 animate-pulse rounded-lg bg-canvas" />
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No agent activity yet for this item.</p>
        ) : (
          messages.map((message) => (
            <div
              key={message._id}
              className={message.direction === "inbound" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  message.direction === "inbound"
                    ? "max-w-[80%] rounded-2xl rounded-br-sm bg-ink px-3 py-2 text-sm text-canvas"
                    : "max-w-[80%] rounded-2xl rounded-bl-sm bg-canvas px-3 py-2 text-sm text-ink"
                }
              >
                <p className="text-[11px] font-medium opacity-70">
                  {message.direction === "inbound" ? "You" : "Agent"}
                </p>
                <p className="whitespace-pre-line">{message.text}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="mt-4 border-t border-line pt-3 text-center text-xs text-muted">
        Your agent emails you only when it needs a decision.
      </p>

      {import.meta.env.DEV && (
        <div className="mt-3 flex justify-center gap-2 border-t border-line pt-3">
          <button
            onClick={() => {
              const value = window.prompt(
                "Simulate a buyer offer of how much?",
                String(Math.round(listing.price * 0.85)),
              );
              const amount = value ? Number(value) : NaN;
              if (Number.isFinite(amount) && amount > 0) {
                void simulateBuyerOffer({ listingId: listing._id, amount });
              }
            }}
            disabled={listing.status !== "live"}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-canvas hover:text-ink disabled:opacity-40"
          >
            Simulate offer
          </button>
          <button
            onClick={() => {
              const suggested = Math.max(1, Math.round(listing.price * 0.9));
              void sendTestPriceDropSuggestion({ listingId: listing._id, suggestedPrice: suggested });
            }}
            disabled={listing.status !== "live"}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-canvas hover:text-ink disabled:opacity-40"
          >
            Simulate stale listing
          </button>
        </div>
      )}
    </div>
  );
}
