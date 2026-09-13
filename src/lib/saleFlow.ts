import type { Doc } from "../../convex/_generated/dataModel";
import type { WorkspaceItem } from "./geometry";

export const canPublish = (listing: Pick<Doc<"listings">, "status">) =>
  ["draft", "approved", "failed"].includes(listing.status);

export function saleFlow(items: WorkspaceItem[], listings: Doc<"listings">[]) {
  const selected = items.filter((item) => item.selected);
  const selectedIds = new Set(selected.map((item) => item._id));
  const included = listings.filter((listing) => selectedIds.has(listing.itemId));
  const working = selected.some((item) =>
    ["queued", "identifying", "researching"].includes(item.researchStatus ?? ""),
  );
  const started = selected.some((item) => item.researchStatus !== undefined) || included.length > 0;
  const publishing = included.some((listing) => listing.status === "publishing");
  const remaining = included.filter(canPublish);
  const complete = selected.length > 0 && included.length === selected.length && remaining.length === 0 && !publishing;
  return { selected, included, working, started, publishing, remaining, complete };
}

/** Only publish the reviewed snapshot. Never include unselected or already-live listings. */
export async function publishSelection(
  listings: Doc<"listings">[],
  approve: (listing: Doc<"listings">) => Promise<unknown>,
  publish: (listing: Doc<"listings">) => Promise<unknown>,
) {
  const failures: string[] = [];
  for (const listing of listings.filter(canPublish)) {
    try {
      if (listing.status === "draft") await approve(listing);
      await publish(listing);
    } catch {
      failures.push(listing.title);
    }
  }
  return failures;
}
