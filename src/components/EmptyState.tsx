import { useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, ChevronLeft, ImagePlus, Loader2, ScanLine, Sparkles, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import demoRoom from "@/assets/demo-room.svg";

type Props = { busy: boolean; error: string | null; onUpload: (file: File) => void; onDemo: () => void; onBack?: () => void; };

export default function EmptyState({ busy, error, onUpload, onDemo, onBack }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const accept = (files: FileList | null) => {
    if (busy) return;
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setFileError("Choose an image file to start your room scan."); return; }
    setFileError(null);
    onUpload(file);
  };
  return (
    <div className="landing">
      {onBack && <button onClick={onBack} className="mb-5 flex items-center gap-1 rounded-full text-sm text-ink-soft"><ChevronLeft className="size-4" />Back to your room</button>}
      <section className="hero-heading">
        <span className="eyebrow"><Sparkles className="size-3.5" /> A little less stuff. A lot more possibility.</span>
        <h1>Your next fresh start.<br /><span>Already in the room.</span></h1>
        <p>Turn the things you no longer need into something more.<br className="hidden sm:block" /> One photo. A few taps. Your agents take it from there.</p>
      </section>
      <section className="start-grid" aria-label="Start a room sale">
        <div className={cn("upload-panel", dragging && "is-dragging")}
          onDragEnter={(event) => { event.preventDefault(); dragDepth.current += 1; if (!busy) setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => { dragDepth.current -= 1; if (dragDepth.current <= 0) setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); accept(event.dataTransfer.files); }} aria-busy={busy}>
          <div className="upload-icon" aria-hidden="true">{busy ? <Loader2 className="size-7 animate-spin" strokeWidth={1.5} /> : <ImagePlus className="size-7" strokeWidth={1.5} />}</div>
          <span className="mt-7 text-xs font-semibold tracking-[0.13em] text-muted uppercase">Start with a photo</span>
          <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.04em]">Make room for what's next.</h2>
          <p className="mt-3 max-w-[30ch] text-sm leading-6 text-muted">Drop a photo of your space here.<br />We'll help you see what it could be worth.</p>
          <Button size="lg" disabled={busy} className="mt-7 min-w-44" onClick={() => inputRef.current?.click()}>{busy ? "Preparing your room…" : "Choose a photo"}{!busy && <ArrowRight />}</Button>
          <p className="mt-4 text-xs text-muted">JPG, PNG or HEIC</p>
          <input ref={inputRef} type="file" accept="image/*" aria-label="Choose a room photo" className="hidden" onChange={(event) => { accept(event.target.files); event.target.value = ""; }} />
          {(fileError || error) && <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-red-700"><AlertCircle className="mt-0.5 size-4 shrink-0" />{fileError || error}</p>}
        </div>
        <div className="demo-panel">
          <div className="flex items-center justify-between px-6 pt-6 sm:px-8"><span className="text-xs font-medium text-ink-soft">A glimpse of what's possible</span><span className="preview-badge">Demo room</span></div>
          <div className="room-preview">
            <img src={demoRoom} alt="Example room with a guitar, desk, monitor, chair and printer" width="1600" height="1000" />
            <span className="object-marker marker-guitar"><Check className="size-3" /> Acoustic guitar</span>
            <span className="object-marker marker-monitor"><Check className="size-3" /> Monitor</span>
            <span className="object-marker marker-chair"><Check className="size-3" /> Office chair</span>
            <div className="preview-insight"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-accent-deep"><ScanLine className="size-5" /></span><div><p className="text-sm font-semibold">Everyday things. New possibilities.</p><p className="mt-0.5 text-xs text-muted">See how a room becomes a sale.</p></div></div>
          </div>
          <div className="demo-bottom"><div><h2 className="text-base font-semibold tracking-tight">Take a look around.</h2><p className="mt-1 text-xs text-muted">Explore the experience with a sample room.</p></div><button disabled={busy} onClick={onDemo} className="demo-link">Try demo <ArrowRight className="size-4" /></button></div>
        </div>
      </section>
      <section className="how-it-works" aria-label="How Roomsale works">
        {[
          { icon: ImagePlus, number: "01", title: "Capture your space", text: "One photo is all you need to get started." },
          { icon: ScanLine, number: "02", title: "Choose what goes", text: "Select the things you're ready to part with." },
          { icon: Tag, number: "03", title: "Leave the busywork to us", text: "Your agents research prices and prepare listings." },
        ].map(({ icon: Icon, number, title, text }) => <div key={number} className="step"><span className="step-icon"><Icon className="size-5" strokeWidth={1.5} /></span><div><p className="text-sm font-semibold tracking-tight"><span className="mr-2 text-xs font-normal text-muted">{number}</span>{title}</p><p className="mt-1.5 text-xs leading-5 text-muted">{text}</p></div></div>)}
      </section>
      <footer className="landing-footer"><span>Less clutter. More possibility.</span><span>You choose what sells. Always.</span></footer>
    </div>
  );
}
