import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import TopNav from "@/components/TopNav";
import EmptyState from "@/components/EmptyState";
import Workspace from "@/components/Workspace";
import demoRoom from "@/assets/demo-room.svg";
import { DEMO_OBJECTS } from "@/data/demoObjects";

type Phase = "empty" | "scanning" | "workspace";

const SCAN_MS = 1100;

const defaultSelection = () =>
  new Set(DEMO_OBJECTS.filter((o) => o.defaultSelected).map((o) => o.id));

export default function App() {
  const [phase, setPhase] = useState<Phase>("empty");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(defaultSelection);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Object URLs from uploads must be released; the bundled demo URL must not be.
  const objectUrlRef = useRef<string | null>(null);

  const loadImage = useCallback((url: string, isObjectUrl: boolean) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = isObjectUrl ? url : null;

    setImageUrl(url);
    setSelected(defaultSelection());
    setActiveId(null);
    setHoveredId(null);
    setPhase("scanning");
  }, []);

  const reset = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setImageUrl(null);
    setPhase("empty");
  }, []);

  useEffect(() => {
    if (phase !== "scanning") return;
    const id = window.setTimeout(() => setPhase("workspace"), SCAN_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setActiveId(id);
  }, []);

  const selectAll = useCallback(
    () => setSelected(new Set(DEMO_OBJECTS.map((o) => o.id))),
    [],
  );
  const clearAll = useCallback(() => setSelected(new Set()), []);

  return (
    <div className="min-h-dvh">
      <TopNav onHome={reset} />

      <main className="mx-auto w-full max-w-[1600px] px-6 pb-16 sm:px-8">
        <AnimatePresence mode="wait">
          {imageUrl === null ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <EmptyState
                onUpload={(file) => loadImage(URL.createObjectURL(file), true)}
                onDemo={() => loadImage(demoRoom, false)}
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
                imageUrl={imageUrl}
                objects={DEMO_OBJECTS}
                scanning={phase === "scanning"}
                selected={selected}
                activeId={activeId}
                hoveredId={hoveredId}
                onToggle={toggle}
                onHover={setHoveredId}
                onActivate={setActiveId}
                onSelectAll={selectAll}
                onClear={clearAll}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
