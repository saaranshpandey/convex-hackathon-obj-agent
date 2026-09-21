import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import TopNav from "@/components/TopNav";
import EmptyState from "@/components/EmptyState";
import RoomRail from "@/components/RoomRail";
import Workspace from "@/components/Workspace";
import WorkspaceSkeleton from "@/components/WorkspaceSkeleton";
import demoRoom from "@/assets/demo-room.svg";
import { useToast } from "@/components/Toaster";
import { prepareUpload } from "@/lib/image";
import { titleFromFileName } from "@/lib/rooms";
import { bboxOf, type Rect, type WorkspaceItem } from "@/lib/geometry";

export default function App() {
  /** Which thread is open. Null means the newest room, so a fresh visit lands there. */
  const [activeRoomId, setActiveRoomId] = useState<Id<"cleanouts"> | null>(null);
  const rooms = useQuery(api.cleanouts.list);
  const workspace = useQuery(api.cleanouts.workspace, {
    cleanoutId: activeRoomId ?? undefined,
  });

  const generateUploadUrl = useMutation(api.cleanouts.generateUploadUrl);
  const startCleanoutMutation = useMutation(api.cleanouts.start);
  const renameRoom = useMutation(api.cleanouts.rename);
  const attachImage = useMutation(api.cleanouts.attachImage);
  const replaceImage = useMutation(api.cleanouts.replaceImage);
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

  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composingNew, setComposingNew] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
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

  /** Downscales, uploads, and hands back what every photo mutation needs. */
  const uploadPhoto = useCallback(
    async (blob: Blob) => {
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
      const { storageId } = (await result.json()) as { storageId: Id<"_storage"> };

      return {
        storageId,
        imageWidth: prepared.width || undefined,
        imageHeight: prepared.height || undefined,
      };
    },
    [generateUploadUrl],
  );

  const startCleanout = useCallback(
    async (blob: Blob, title: string) => {
      setBusy(true);
      setError(null);

      let cleanoutId: Id<"cleanouts"> | undefined;
      try {
        cleanoutId = await startCleanoutMutation({ title });
        // The workspace can now show its uploading state.
        setActiveRoomId(cleanoutId);
        setActiveId(null);
        setComposingNew(false);

        await attachImage({ cleanoutId, ...(await uploadPhoto(blob)) });
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
    [attachImage, markUploadFailed, startCleanoutMutation, uploadPhoto],
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
      const cleanoutId = await seedDemoRoom(await uploadPhoto(await response.blob()));

      setActiveRoomId(cleanoutId);
      setActiveId(null);
      setComposingNew(false);
    } catch {
      setError("Could not start the demo room.");
    } finally {
      setBusy(false);
    }
  }, [seedDemoRoom, uploadPhoto]);

  const handleReset = useCallback(async () => {
    setBusy(true);
    try {
      await resetDemoData({});
      setActiveRoomId(null);
      setActiveId(null);
      setComposingNew(false);
      setDrawing(false);
      setError(null);
    } finally {
      setBusy(false);
    }
  }, [resetDemoData]);

  /**
   * Swaps this room's photo in place rather than starting a thread. A failed
   * upload must not destroy what the room already has, so the error goes to a
   * toast instead of onto the cleanout.
   */
  const replacePhoto = useCallback(
    async (cleanoutId: Id<"cleanouts">, blob: Blob) => {
      setReplacing(true);
      try {
        await replaceImage({ cleanoutId, ...(await uploadPhoto(blob)) });
        setActiveId(null);
        setHoveredId(null);
        setReviewingListingId(null);
        setDrawing(false);
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : "Couldn't use that photo. Try another.",
        );
      } finally {
        setReplacing(false);
      }
    },
    [replaceImage, toast, uploadPhoto],
  );

  /** Opening a thread clears everything scoped to the one being left behind. */
  const openRoom = useCallback((cleanoutId: Id<"cleanouts">) => {
    setActiveRoomId(cleanoutId);
    setComposingNew(false);
    setRailOpen(false);
    setDrawing(false);
    setActiveId(null);
    setHoveredId(null);
    setReviewingListingId(null);
    setError(null);
  }, []);

  const openComposer = useCallback(() => {
    setComposingNew(true);
    setRailOpen(false);
    setDrawing(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!railOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRailOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [railOpen]);

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

  const rail = (
    <RoomRail
      rooms={rooms}
      activeId={workspace?.cleanout._id ?? activeRoomId}
      composing={showEmptyState}
      onSelect={openRoom}
      onNew={openComposer}
      onRename={(cleanoutId, title) => void renameRoom({ cleanoutId, title })}
    />
  );

  return (
    <MotionConfig reducedMotion="user"><div className="min-h-dvh">
      <TopNav
        onHome={openComposer}
        onReset={import.meta.env.DEV ? handleReset : undefined}
        isDemo={workspace?.cleanout.isDemo === true}
        onToggleRail={() => setRailOpen((open) => !open)}
      />

      <div className="mx-auto flex w-full max-w-[1320px] gap-6 px-4 pb-6 sm:px-8">
        <aside className="sticky top-[72px] hidden h-[calc(100dvh-72px)] w-60 shrink-0 overflow-y-auto py-6 lg:block">
          {rail}
        </aside>

        {/* Under lg the rail is a slide-over; the overlay closes it. */}
        <AnimatePresence>
          {railOpen && (
            <motion.div
              key="rail-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-ink/30 lg:hidden"
              onClick={() => setRailOpen(false)}
            >
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                onClick={(event) => event.stopPropagation()}
                className="h-full w-72 max-w-[80%] overflow-y-auto bg-canvas p-3 shadow-[var(--shadow-lift)]"
              >
                {rail}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="min-w-0 flex-1">
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
                onUpload={(file) =>
                  void startCleanout(file, titleFromFileName(file.name))
                }
                onDemo={() => void startDemo()}
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
                key={workspace.cleanout._id}
                cleanout={workspace.cleanout}
                imageUrl={workspace.imageUrl}
                items={items}
                listings={listings}
                activeId={activeId}
                hoveredId={hoveredId}
                drawing={drawing}
                reviewingListingId={reviewingListingId}
                onToggle={(itemId) => {
                  setActiveId(itemId);
                  void toggleItem({ itemId });
                }}
                onHover={setHoveredId}
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
                onNewPhoto={openComposer}
                replacing={replacing}
                onReplacePhoto={(file) =>
                  void replacePhoto(workspace.cleanout._id, file)
                }
                onContinue={() =>
                  startResearch({ cleanoutId: workspace.cleanout._id })
                }
                onReviewListing={setReviewingListingId}
                onCloseDrawer={() => setReviewingListingId(null)}
              />
            </motion.div>
          )}
          </AnimatePresence>
        </main>
      </div>
    </div></MotionConfig>
  );
}
