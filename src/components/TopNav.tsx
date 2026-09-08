import { RotateCcw, Scan } from "lucide-react";
import EbayConnectButton from "@/components/EbayConnectButton";

type Props = {
  onHome: () => void;
  /** Discreet marker that this room's activity is seeded, not real. */
  isDemo?: boolean;
  /** Provided only in development — wipes this session's Convex data. */
  onReset?: () => void;
  sessionId: string;
};

export default function TopNav({
  onHome,
  isDemo = false, onReset, sessionId }: Props) {
  return (
    <header className="sticky top-0 z-30 bg-canvas/85 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between px-6 sm:px-8">
        <button
          onClick={onHome}
          className="group flex items-center gap-2.5 rounded-full pr-2 text-left"
          aria-label="Start a new scan"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-ink text-canvas">
            <Scan className="size-4" strokeWidth={2.25} />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            Roomsale
          </span>
        </button>

        <nav className="flex items-center gap-1">
          {isDemo && (
            <span
              title="This room's data is seeded so the full flow works offline"
              className="mr-1 rounded-full bg-line px-2.5 py-1 text-[11px] font-medium tracking-wide text-muted uppercase"
            >
              Demo
            </span>
          )}
          {onReset && (
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <RotateCcw className="size-3.5" strokeWidth={2} />
              Reset demo data
            </button>
          )}
          <EbayConnectButton sessionId={sessionId} />
          <span className="hidden cursor-default rounded-full px-3.5 py-1.5 text-sm text-muted sm:inline">
            Sales
          </span>
          <div
            className="ml-2 size-8 rounded-full bg-line-strong ring-1 ring-line ring-inset"
            role="img"
            aria-label="Account"
          />
        </nav>
      </div>
    </header>
  );
}
