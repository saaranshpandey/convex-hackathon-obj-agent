import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

/** One row of `cleanouts.list` — tallies, not documents. */
export type RoomSummary = FunctionReturnType<typeof api.cleanouts.list>[number];

/**
 * "busy" means something is running right now, so the rail pulses; "live" and
 * "done" are outcomes; "warn" needs the owner. This is the only place a room's
 * status wording lives — `saleFlow` covers the open room, which reads whole
 * documents, while this reads one room's tallies.
 */
export type RoomTone = "busy" | "live" | "done" | "warn" | "neutral" | "muted";

export function roomStatus(room: RoomSummary): { label: string; tone: RoomTone } {
  if (room.status === "uploading") return { label: "Adding photo", tone: "busy" };
  if (room.status === "analyzing") return { label: "Scanning", tone: "busy" };
  if (room.status === "failed") return { label: "Needs a new photo", tone: "warn" };
  if (room.researching) return { label: "Preparing", tone: "busy" };

  // Anything still editable is what the owner needs next, so it outranks an
  // outcome — the same rule `saleFlow.complete` uses for the open room.
  const { reviewable, publishing, live, sold, ended } = room.listings;
  if (publishing > 0) return { label: "Publishing", tone: "busy" };
  if (reviewable > 0) return { label: "In review", tone: "neutral" };
  if (live > 0) return { label: `Live · ${live}`, tone: "live" };
  if (sold > 0) return { label: "Sold", tone: "done" };
  if (ended > 0) return { label: "Ended", tone: "muted" };

  if (room.selectedCount > 0) {
    return { label: `${room.selectedCount} selected`, tone: "neutral" };
  }
  if (room.itemCount > 0) return { label: "Choose items", tone: "neutral" };
  return { label: "No items found", tone: "muted" };
}

/** "IMG_4821.HEIC" → "IMG_4821". A room's title is read far more than the file. */
export function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, "").trim();
  return withoutExtension.length > 0 ? withoutExtension : fileName;
}
