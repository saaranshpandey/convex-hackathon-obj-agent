import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  busy: boolean;
  error: string | null;
  onUpload: (file: File) => void;
  onDemo: () => void;
};

export default function EmptyState({ busy, error, onUpload, onDemo }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const accept = (files: FileList | null) => {
    if (busy) return;
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFileError("Choose a photo in JPG, PNG or HEIC format.");
      return;
    }
    setFileError(null);
    onUpload(file);
  };

  return (
    <section className="mx-auto max-w-lg py-12 text-center sm:py-20">
      <p className="text-xs font-medium text-muted">Photo → Choose items → Review & publish</p>
      <h1 className="mt-6 text-4xl font-semibold tracking-[-0.045em]">What would you like to sell?</h1>
      <p className="mt-3 text-sm text-muted">Add a photo. We'll find the items and suggest prices.</p>
      <div
        className={cn("mt-8 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-10 transition-colors", dragging && "border-accent-deep bg-accent")}
        onDragEnter={(event) => { event.preventDefault(); dragDepth.current += 1; if (!busy) setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => { dragDepth.current -= 1; if (dragDepth.current <= 0) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); accept(event.dataTransfer.files); }}
        aria-busy={busy}
      >
        {busy ? <Loader2 className="size-8 animate-spin text-muted" /> : <ImagePlus className="size-8 text-muted" strokeWidth={1.5} />}
        <Button className="mt-6" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Adding your photo…" : "Choose photo"}</Button>
        <p className="mt-4 text-xs text-muted">or drop it here · JPG, PNG, HEIC</p>
        <input ref={inputRef} type="file" accept="image/*" aria-label="Choose a room photo" className="hidden" onChange={(event) => { accept(event.target.files); event.target.value = ""; }} />
      </div>
      {(fileError || error) && <p role="alert" className="mt-4 text-sm text-red-700">{fileError || error}</p>}
      <Button variant="ghost" disabled={busy} onClick={onDemo} className="mt-5">Try a sample room</Button>
    </section>
  );
}
