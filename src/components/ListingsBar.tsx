import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

type Props = {
  cleanoutId: Id<"cleanouts">;
  listings: Doc<"listings">[];
  onReviewAll: () => void;
};

export default function ListingsBar({ cleanoutId, listings, onReviewAll }: Props) {
  const listApproved = useMutation(api.listings.listApproved);
  const approvedCount = listings.filter((listing) => listing.status === "approved").length;

  if (listings.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-6 pb-6">
      <div className="surface flex items-center gap-4 px-5 py-3">
        <span className="text-sm font-medium text-ink">
          {listings.length} {listings.length === 1 ? "listing" : "listings"} ready
        </span>
        <Button variant="outline" size="sm" onClick={onReviewAll}>
          Review all
        </Button>
        <Button
          variant="accent"
          size="sm"
          disabled={approvedCount === 0}
          onClick={() => void listApproved({ cleanoutId })}
        >
          List approved items
        </Button>
      </div>
    </div>
  );
}
