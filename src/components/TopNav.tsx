import { Plus, RotateCcw, Scan } from "lucide-react";
import AccountMenu from "@/components/AccountMenu";

type Props = {
  onHome: () => void;
  /** Discreet marker that this room's activity is seeded, not real. */
  isDemo?: boolean;
  /** Provided only in development — wipes this session's Convex data. */
  onReset?: () => void;
};

export default function TopNav({
  onHome,
  isDemo = false, onReset }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] w-full max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-8">
        <button
          onClick={onHome}
          className="group flex items-center gap-2.5 rounded-full pr-2 text-left"
          aria-label="Start a new scan"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-ink text-white shadow-sm">
            <Scan className="size-5" strokeWidth={1.75} />
          </span>
          <span className="text-[18px] font-semibold tracking-[-0.04em] text-ink">
            Roomsale
          </span>
        </button>

        <nav aria-label="Main navigation" className="flex items-center gap-1 sm:gap-3">
          {isDemo && (
            <span
              title="You're exploring a room with sample data"
              className="mr-1 rounded-full bg-line px-2.5 py-1 text-[11px] font-medium tracking-wide text-muted uppercase"
            >
              Demo
            </span>
          )}
          {onReset && isDemo && (
            <button
              onClick={onReset}
              title="Reset demo data"
              aria-label="Reset demo data"
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <RotateCcw className="size-3.5" strokeWidth={2} />
              <span className="hidden lg:inline">Reset demo</span>
            </button>
          )}
          <button onClick={onHome} aria-label="Start a new room" className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-medium text-ink shadow-sm ring-1 ring-black/5 transition-colors hover:bg-line sm:px-4">
            <Plus className="size-3.5" /><span className="hidden sm:inline">New room</span>
          </button>
          <AccountMenu />
        </nav>
      </div>
    </header>
  );
}
