import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { roomStatus, titleFromFileName, type RoomSummary } from "../../src/lib/rooms";

const room = (overrides: Partial<RoomSummary> = {}): RoomSummary =>
  ({
    _id: "room" as Id<"cleanouts">,
    title: "Living room",
    status: "objects_found",
    isDemo: false,
    createdAt: 0,
    itemCount: 4,
    selectedCount: 0,
    researching: false,
    listings: { reviewable: 0, publishing: 0, live: 0, sold: 0, ended: 0 },
    ...overrides,
  }) as RoomSummary;

const label = (overrides: Partial<RoomSummary>) => roomStatus(room(overrides)).label;

describe("room status", () => {
  it("reports the room's own lifecycle before anything else", () => {
    expect(roomStatus(room({ status: "uploading" }))).toEqual({
      label: "Adding photo",
      tone: "busy",
    });
    expect(roomStatus(room({ status: "analyzing" }))).toEqual({
      label: "Scanning",
      tone: "busy",
    });
    expect(roomStatus(room({ status: "failed" }))).toEqual({
      label: "Needs a new photo",
      tone: "warn",
    });
  });

  it("shows research in progress even once drafts exist", () => {
    expect(
      label({ researching: true, listings: { reviewable: 2, publishing: 0, live: 0, sold: 0, ended: 0 } }),
    ).toBe("Preparing");
  });

  it("puts what still needs the owner ahead of an outcome", () => {
    expect(label({ listings: { reviewable: 1, publishing: 1, live: 0, sold: 0, ended: 0 } })).toBe(
      "Publishing",
    );
    // A sold item does not mean the room is done while a draft is still open.
    expect(label({ listings: { reviewable: 1, publishing: 0, live: 1, sold: 1, ended: 0 } })).toBe(
      "In review",
    );
  });

  it("counts only what is actually live", () => {
    expect(roomStatus(room({ listings: { reviewable: 0, publishing: 0, live: 2, sold: 1, ended: 0 } }))).toEqual(
      { label: "Live · 2", tone: "live" },
    );
    expect(roomStatus(room({ listings: { reviewable: 0, publishing: 0, live: 0, sold: 3, ended: 0 } }))).toEqual(
      { label: "Sold", tone: "done" },
    );
    expect(label({ listings: { reviewable: 0, publishing: 0, live: 0, sold: 0, ended: 1 } })).toBe("Ended");
  });

  it("falls back to where the selection stands", () => {
    expect(label({ selectedCount: 3 })).toBe("3 selected");
    expect(label({ selectedCount: 0 })).toBe("Choose items");
    expect(label({ selectedCount: 0, itemCount: 0 })).toBe("No items found");
  });
});

describe("titleFromFileName", () => {
  it("drops the extension without mangling the name", () => {
    expect(titleFromFileName("IMG_4821.HEIC")).toBe("IMG_4821");
    expect(titleFromFileName("living room v2.final.jpg")).toBe("living room v2.final");
    expect(titleFromFileName("bedroom")).toBe("bedroom");
  });

  it("keeps the original when stripping would leave nothing", () => {
    expect(titleFromFileName(".jpg")).toBe(".jpg");
  });
});
