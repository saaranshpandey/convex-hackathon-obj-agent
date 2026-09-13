import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { WorkspaceItem } from "../../src/lib/geometry";
import { publishSelection, saleFlow } from "../../src/lib/saleFlow";

const item = (id: string, selected = true, researchStatus?: WorkspaceItem["researchStatus"]) =>
  ({ _id: id as Id<"items">, selected, researchStatus }) as WorkspaceItem;
const listing = (id: string, itemId: string, status: Doc<"listings">["status"] = "draft") =>
  ({ _id: id, itemId, status, title: id, price: 20 }) as Doc<"listings">;

describe("guided sale flow", () => {
  it("keeps unselected drafts out of review and publishing", () => {
    const flow = saleFlow([item("a"), item("b", false)], [listing("one", "a"), listing("two", "b", "approved")]);
    expect(flow.included.map((draft) => draft._id)).toEqual(["one"]);
    expect(flow.remaining).toEqual(flow.included);
  });

  it("waits for selected research, but ignores work on skipped items", () => {
    expect(saleFlow([item("a", true, "researching")], []).working).toBe(true);
    expect(saleFlow([item("a", false, "researching"), item("b")], []).working).toBe(false);
  });

  it("does not call an incomplete or still-publishing batch complete", () => {
    expect(saleFlow([], []).complete).toBe(false);
    expect(saleFlow([item("a"), item("b")], [listing("one", "a", "live")]).complete).toBe(false);
    expect(saleFlow([item("a")], [listing("one", "a", "publishing")]).complete).toBe(false);
    expect(saleFlow([item("a")], [listing("one", "a", "live")]).complete).toBe(true);
  });

  it("approves a draft before publishing and skips listings already submitted", async () => {
    const calls: string[] = [];
    const failures = await publishSelection([
      listing("draft", "a"), listing("approved", "b", "approved"),
      listing("retry", "c", "failed"), listing("live", "d", "live"), listing("working", "e", "publishing"),
    ], async (draft) => { calls.push(`approve:${draft._id}`); }, async (draft) => { calls.push(`publish:${draft._id}`); });
    expect(calls).toEqual(["approve:draft", "publish:draft", "publish:approved", "publish:retry"]);
    expect(failures).toEqual([]);
  });

  it("never publishes a draft whose approval failed and still submits other items", async () => {
    const publish = vi.fn(async (_listing: Doc<"listings">) => {});
    const failures = await publishSelection([listing("broken", "a"), listing("good", "b")],
      async (draft) => { if (draft._id === "broken") throw new Error("Disconnected"); }, publish);
    expect(failures).toEqual(["broken"]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toMatchObject({ _id: "good" });
  });

  it("reports partial submission failures so successful items are not retried", async () => {
    const failures = await publishSelection([listing("broken", "a", "approved"), listing("good", "b", "approved")],
      async () => {}, async (draft) => { if (draft._id === "broken") throw new Error("Offline"); });
    expect(failures).toEqual(["broken"]);
    const flow = saleFlow([item("a"), item("b")], [listing("broken", "a", "approved"), listing("good", "b", "publishing")]);
    expect(flow.remaining.map((draft) => draft._id)).toEqual(["broken"]);
  });
});
