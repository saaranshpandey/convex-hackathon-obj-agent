import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import TopNav from "@/components/TopNav";
import EmptyState from "@/components/EmptyState";
import Workspace from "@/components/Workspace";
import WorkspaceSkeleton from "@/components/WorkspaceSkeleton";
import demoRoom from "@/assets/demo-room.svg";
import { useSessionId } from "@/lib/session";
import { prepareUpload } from "@/lib/image";
import { bboxOf, type Rect, type WorkspaceItem } from "@/lib/geometry";

export default function App() {
  const sessionId = useSessionId();
  const workspace = useQuery(api.cleanouts.latestForSession, { sessionId });

  const generateUploadUrl = useMutation(api.cleanouts.generateUploadUrl);
  const startCleanoutMutation = useMutation(api.cleanouts.start);
  const attachImage = useMutation(api.cleanouts.attachImage);
  const markUploadFailed = useMutation(api.cleanouts.markUploadFailed);
  const retryAnalysis = useMutation(api.cleanouts.retryAnalysis);
  const toggleItem = useMutation(api.items.toggle);
  const setAllItems = useMutation(api.items.setAll);
  const renameItem = useMutation(api.items.rename);
  const addManualItem = useMutation(api.items.addManual);
  const removeItem = useMutation(api.items.remove);
  const startResearch = useMutation(api.research.startResearch);
  const seedDemoRoom = useMutation(api.demo.seedRoom);
  const resetDemoData = useMutation(api.dev.resetDemoData);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composingNew, setComposingNew] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [activeId, setActiveId] = useState<Id<"items"> | null>(null);
  const [hoveredId, setHoveredId] = useState<Id<"items"> | null>(null);
  const [reviewingListingId, setReviewingListingId] = useState<Id<"listings"> | null>(
    null,
  );

  const items: WorkspaceItem[] = useMemo(
    () =>
      (workspace?.items ?? []).map((item) => ({
        ...item,
        bbox: bboxOf(item.polygon),
      })),
    [workspace?.items],
  );
  const listings = workspace?.listings ?? [];

  const startCleanout = useCallback(
    async (blob: Blob, title: string) => {
      setBusy(true);
      setError(null);

      let cleanoutId: Id<"cleanouts"> | undefined;
      try {
        cleanoutId = await startCleanoutMutation({ sessionId, title });
        // The workspace can now show its uploading state.
        setActiveId(null);
        setComposingNew(false);

        const prepared = await prepareUpload(blob);

        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": prepared.blob.type },
          body: prepared.blob,
        });
        if (!result.ok) {
          throw new Error(`Upload failed with status ${result.status}`);
        }
        const { storageId } = (await result.json()) as {
          storageId: Id<"_storage">;
        };

        await attachImage({
          cleanoutId,
          storageId,
          imageWidth: prepared.width || undefined,
          imageHeight: prepared.height || undefined,
        });
      } catch (cause) {
        const message =
          cause instanceof Error
            ? cause.message
            : "Something went wrong uploading that photo.";

        if (cleanoutId === undefined) {
          setError(message);
        } else {
          // Surface it on the cleanout so the workspace offers a way out.
          await markUploadFailed({ cleanoutId, error: message }).catch(() => {});
        }
      } finally {
        setBusy(false);
      }
    },
    [
      attachImage,
      generateUploadUrl,
      markUploadFailed,
      sessionId,
      startCleanoutMutation,
    ],
  );

  /**
   * The demo room is seeded rather than detected: the whole flow runs off
   * fixture data, so a judge sees the product even if OpenAI, fal, Firecrawl or
   * AgentMail are unavailable. Only the image upload touches the network.
   */
  const startDemo = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(demoRoom);
      const prepared = await prepareUpload(await response.blob());

      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": prepared.blob.type },
        body: prepared.blob,
      });
      if (!result.ok) throw new Error(`Upload failed with status ${result.status}`);
      const { storageId } = (await result.json()) as { storageId: Id<"_storage"> };

      await seedDemoRoom({
        sessionId,
        storageId,
        imageWidth: prepared.width || undefined,
        imageHeight: prepared.height || undefined,
      });

      setActiveId(null);
      setComposingNew(false);
    } catch {
      setError("Could not start the demo room.");
    } finally {
      setBusy(false);
    }
  }, [generateUploadUrl, seedDemoRoom, sessionId]);

  const handleReset = useCallback(async () => {
    setBusy(true);
    try {
      await resetDemoData({ sessionId });
      setActiveId(null);
      setComposingNew(false);
      setDrawing(false);
      setError(null);
    } finally {
      setBusy(false);
    }
  }, [resetDemoData, sessionId]);

  const handleAddItem = useCallback(
    async (name: string, box: Rect) => {
      if (!workspace) return;
      await addManualItem({
        cleanoutId: workspace.cleanout._id,
        name,
        boundingBox: box,
      });
      setDrawing(false);
    },
    [addManualItem, workspace],
  );

  const showEmptyState = workspace === null || composingNew;

  return (
    <div className="min-h-dvh">
      <TopNav
        onHome={() => {
          setDrawing(false);
          setComposingNew(true);
        }}
        onReset={import.meta.env.DEV ? handleReset : undefined}
        sessionId={sessionId}
        isDemo={workspace?.cleanout.isDemo === true}
      />

      <main className="mx-auto w-full max-w-[1600px] px-6 pb-16 sm:px-8">
        <AnimatePresence mode="wait">
          {workspace === undefined ? (
            <motion.div key="loading" exit={{ opacity: 0 }}>
              <WorkspaceSkeleton />
            </motion.div>
          ) : showEmptyState ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <EmptyState
                busy={busy}
                error={error}
                onUpload={(file) => void startCleanout(file, file.name)}
                onDemo={() => void startDemo()}
                onBack={
                  workspace !== null ? () => setComposingNew(false) : undefined
                }
              />
            </motion.div>
          ) : (
            <motion.div
              key="workspace"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              <Workspace
                cleanout={workspace.cleanout}
                imageUrl={workspace.imageUrl}
                items={items}
                listings={listings}
                activeId={activeId}
                hoveredId={hoveredId}
                drawing={drawing}
                sessionId={sessionId}
                reviewingListingId={reviewingListingId}
                onToggle={(itemId) => {
                  setActiveId(itemId);
                  void toggleItem({ itemId });
                }}
                onHover={setHoveredId}
                onActivate={setActiveId}
                onRename={(itemId, name) => void renameItem({ itemId, name })}
                onRemove={(itemId) => {
                  setActiveId(null);
                  void removeItem({ itemId });
                }}
                onSelectAll={() =>
                  void setAllItems({
                    cleanoutId: workspace.cleanout._id,
                    selected: true,
                  })
                }
                onClear={() =>
                  void setAllItems({
                    cleanoutId: workspace.cleanout._id,
                    selected: false,
                  })
                }
                onToggleDrawing={() => setDrawing((previous) => !previous)}
                onAddItem={handleAddItem}
                onRetry={() =>
                  void retryAnalysis({ cleanoutId: workspace.cleanout._id })
                }
                onNewPhoto={() => {
                  setDrawing(false);
                  setComposingNew(true);
                }}
                onContinue={() =>
                  void startResearch({ cleanoutId: workspace.cleanout._id })
                }
                onReviewListing={setReviewingListingId}
                onCloseDrawer={() => setReviewingListingId(null)}
                onNavigateListing={(direction) => {
                  setReviewingListingId((current) => {
                    if (current === null) return current;
                    const index = listings.findIndex(
                      (listing) => listing._id === current,
                    );
                    if (index === -1) return current;
                    const nextIndex = direction === "next" ? index + 1 : index - 1;
                    return listings[nextIndex]?._id ?? current;
                  });
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
