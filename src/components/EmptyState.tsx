import { useRef, useState } from "react";
import { AlertCircle, ChevronLeft, ImageUp, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  busy: boolean;
  error: string | null;
  onUpload: (file: File) => void;
  onDemo: () => void;
  /** Present when a cleanout already exists to return to. */
  onBack?: () => void;
};

export default function EmptyState({
  busy,
  error,
  onUpload,
  onDemo,
  onBack,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (files: FileList | null) => {
    const file = files?.[0];
    if (file && file.type.startsWith("image/")) onUpload(file);
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center pt-[9vh] pb-10 text-center sm:pt-[12vh]">
      {onBack && (
        <button
          onClick={onBack}
          className="mb-6 flex items-center gap-0.5 rounded-full py-1 pr-3 pl-1 text-sm text-muted transition-colors hover:text-ink"
        >
          <ChevronLeft className="size-4" strokeWidth={2} />
          Back to your scan
        </button>
      )}

      <h1 className="text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-ink sm:text-6xl">
        Sell what's in the room.
      </h1>
      <p className="mt-5 max-w-md text-[17px] leading-relaxed text-pretty text-muted">
        Upload a photo. Select what you want to sell. Your agents handle the rest.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) accept(e.dataTransfer.files);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={cn(
          "surface mt-11 flex w-full flex-col items-center justify-center px-8 py-16 transition-all duration-200",
          "ring-1 ring-line ring-inset",
          busy ? "cursor-wait opacity-70" : "cursor-pointer hover:shadow-[var(--shadow-lift)]",
          dragging && "ring-2 ring-accent-deep",
        )}
      >
        <span
          className={cn(
            "flex size-12 items-center justify-center rounded-2xl bg-canvas text-ink-soft transition-colors",
            dragging && "bg-accent text-accent-ink",
          )}
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" strokeWidth={1.75} />
          ) : (
            <ImageUp className="size-5" strokeWidth={1.75} />
          )}
        </span>
        <p className="mt-5 text-[15px] font-medium text-ink">
          {busy ? "Uploading to Convex…" : "Drag a photo here"}
        </p>
        <p className="mt-1.5 text-sm text-muted">
          JPG, PNG or HEIC · one room, many things
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = "";
        }}
      />

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm text-ink ring-1 ring-line ring-inset"
        >
          <AlertCircle className="size-4 shrink-0 text-muted" strokeWidth={2} />
          {error}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" disabled={busy} onClick={() => inputRef.current?.click()}>
          Upload photo
        </Button>
        <Button size="lg" variant="outline" disabled={busy} onClick={onDemo}>
          <Sparkles className="size-4" strokeWidth={2} />
          Try demo room
        </Button>
      </div>
    </div>
  );
}
