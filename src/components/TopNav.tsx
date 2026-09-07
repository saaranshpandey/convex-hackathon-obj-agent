import { Scan } from "lucide-react";

export default function TopNav({ onHome }: { onHome: () => void }) {
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
