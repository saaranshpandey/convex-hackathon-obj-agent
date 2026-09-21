import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Check, CircleCheck } from "lucide-react";
import ObjectThumb from "@/components/ObjectThumb";
import type { WorkspaceItem } from "@/lib/geometry";

export type ItemStatus = "waiting" | "processing" | "complete" | "failed";

export function preparationStatus(item: WorkspaceItem): ItemStatus {
  if (item.researchStatus === "failed") return "failed";
  if (item.researchStatus === "ready_for_review") return "complete";
  if (item.researchStatus === "identifying" || item.researchStatus === "researching") return "processing";
  return "waiting";
}

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function PreparationRow({ item, name, status, imageUrl }: {
  item: WorkspaceItem;
  name: string;
  status: ItemStatus;
  imageUrl: string;
}) {
  const result = item.estimatedLow !== undefined && item.estimatedHigh !== undefined
    ? `${dollars.format(item.estimatedLow)}\u2013${dollars.format(item.estimatedHigh)}`
    : item.recommendedPrice !== undefined ? dollars.format(item.recommendedPrice) : "Ready";
  // These are completed pipeline stages, not an estimate of time remaining.
  const stage = status === "complete" ? 3 : status === "processing"
    ? item.researchStatus === "identifying" ? 1 : 2 : 0;
  const processingLabel = item.researchStatus === "identifying" ? "Identifying" : "Researching";
  const statusLabel = status === "complete" ? result : status === "failed"
    ? "Couldn't prepare" : status === "waiting" ? "Waiting" : processingLabel;
  return (
    <li className="preparation-row flex items-center gap-3 rounded-xl bg-surface p-3 text-sm" data-state={status}>
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-canvas" aria-hidden>
        <ObjectThumb imageUrl={imageUrl} bbox={item.bbox} className="max-h-16 max-w-16 h-16" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold tracking-[-0.015em]" title={name}>{name}</div>
        <div className="preparation-track my-2 h-1 overflow-hidden rounded-full bg-line"
          role="progressbar" aria-label={`${name} preparation`} aria-valuemin={0} aria-valuemax={3}
          aria-valuenow={stage} aria-valuetext={statusLabel}>
          <div className="preparation-fill h-full origin-left rounded-full bg-accent-deep" style={{ transform: `scaleX(${stage / 3})` }} />
        </div>
        <div className="preparation-status text-xs text-muted">
          <span className="preparation-layer" data-visible={status === "waiting"} aria-hidden={status !== "waiting"}>Waiting</span>
          <span className="preparation-layer" data-visible={status === "processing"} aria-hidden={status !== "processing"}>{processingLabel}</span>
          <span className="preparation-layer tabular-nums" data-visible={status === "complete"} aria-hidden={status !== "complete"}>{result}</span>
          <span className="preparation-layer" data-visible={status === "failed"} aria-hidden={status !== "failed"}>Couldn't prepare</span>
        </div>
      </div>
      <div className="size-5 shrink-0" aria-hidden>
        {status === "complete" && <CircleCheck className="preparation-check size-[18px] text-teal-600" strokeWidth={1.8} />}
      </div>
    </li>
  );
}

export default function PreparationCard({ items, imageUrl, working, onSettled }: {
  items: WorkspaceItem[];
  imageUrl: string;
  working: boolean;
  onSettled: () => void;
}) {
  // Identification can refine names elsewhere; keep this card's labels stable.
  const [names] = useState(() => new Map(items.map((item) => [item._id, item.name])));
  const reducedMotion = useReducedMotion();
  const [revealed, setRevealed] = useState(0);
  const currentStatus = items[revealed] ? preparationStatus(items[revealed]) : undefined;
  useEffect(() => {
    if (currentStatus !== "complete" && currentStatus !== "failed") return;
    // Results may arrive out of order. Only pace their reveal, never the work.
    // Leave one transition interval for the result and ring before the next row.
    const timeout = window.setTimeout(() => setRevealed((count) => count + 1), reducedMotion ? 0 : 550);
    return () => window.clearTimeout(timeout);
  }, [revealed, currentStatus, reducedMotion]);
  const rowStatus = (item: WorkspaceItem, index: number): ItemStatus =>
    index <= revealed ? preparationStatus(item) : "waiting";
  const completed = items.filter((item, index) => rowStatus(item, index) === "complete").length;
  const ready = items.length > 0 && completed === items.length;
  const finished = !working && items.every((item, index) => ["complete", "failed"].includes(rowStatus(item, index)));
  useEffect(() => {
    if (!finished) return;
    // Only a presentation hold after real results; never advances item state.
    const timeout = window.setTimeout(onSettled, 1800);
    return () => window.clearTimeout(timeout);
  }, [finished, onSettled]);

  const count = `${items.length} ${items.length === 1 ? "item" : "items"}`;
  const activeItem = items.find((item, index) => rowStatus(item, index) === "processing");
  const heading = activeItem?.researchStatus === "identifying" ? "Identifying"
    : activeItem?.researchStatus === "researching" ? "Researching" : "Preparing";
  return (
    <div className="preparation-enter mx-auto max-w-lg">
      <div className="preparation-card rounded-2xl border border-line bg-surface p-6" data-ready={ready}>
        <div className="mb-5 flex items-center gap-3">
          <span className="preparation-indicator size-5 shrink-0 text-accent-deep" data-ready={ready}>
            <svg viewBox="0 0 24 24" className="preparation-ring size-5" role="progressbar" aria-label="Items priced" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={completed}>
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity=".14" />
              <circle className="preparation-progress" cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap={completed ? "round" : "butt"} pathLength="100" strokeDasharray="100" strokeDashoffset={100 - (items.length ? completed / items.length * 100 : 0)} transform="rotate(-90 12 12)" />
            </svg>
            <Check aria-hidden className="preparation-final-check size-5" />
          </span>
          <span className="preparation-heading text-sm" role="status" aria-live="polite">
            <span className="preparation-layer" data-visible={!finished} aria-hidden={finished}>{heading} {count}</span>
            <span className="preparation-layer" data-visible={finished} aria-hidden={!finished}>{ready ? `${count} ready` : `${completed} of ${count} ready`}</span>
          </span>
        </div>
        <ul className="space-y-2">{items.map((item, index) => <PreparationRow key={item._id} item={item} imageUrl={imageUrl} status={rowStatus(item, index)} name={names.get(item._id) ?? item.name} />)}</ul>
      </div>
    </div>
  );
}
