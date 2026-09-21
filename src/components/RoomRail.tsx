import { useRef, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import { roomStatus, type RoomSummary, type RoomTone } from "@/lib/rooms";
import { cn } from "@/lib/utils";

type Props = {
  rooms: RoomSummary[] | undefined;
  activeId: Id<"cleanouts"> | null;
  /** The composer is open, so no room is the current one. */
  composing: boolean;
  onSelect: (id: Id<"cleanouts">) => void;
  onNew: () => void;
  onRename: (id: Id<"cleanouts">, title: string) => void;
  className?: string;
};

const toneDot: Record<RoomTone, string> = {
  busy: "bg-accent-deep animate-pulse",
  live: "bg-accent-deep",
  done: "bg-ink",
  warn: "bg-red-600",
  neutral: "bg-line-strong",
  muted: "bg-line-strong",
};

export default function RoomRail({
  rooms,
  activeId,
  composing,
  onSelect,
  onNew,
  onRename,
  className,
}: Props) {
  const [editingId, setEditingId] = useState<Id<"cleanouts"> | null>(null);
  // Escape has to win over the blur that follows it, so it flags the cancel.
  const cancelled = useRef(false);

  const commit = (room: RoomSummary, value: string) => {
    const next = value.trim();
    if (!cancelled.current && next.length > 0 && next !== room.title) {
      onRename(room._id, next);
    }
    cancelled.current = false;
    setEditingId(null);
  };

  return (
    <nav aria-label="Your rooms" className={cn("flex flex-col gap-1", className)}>
      <button
        onClick={onNew}
        aria-current={composing ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors",
          composing ? "bg-surface text-ink ring-1 ring-black/5" : "text-ink-soft hover:bg-ink/5 hover:text-ink",
        )}
      >
        <Plus className="size-4 shrink-0" strokeWidth={2} />
        New room
      </button>

      {rooms === undefined ? (
        <div className="mt-2 space-y-1.5 px-3" aria-busy="true" aria-label="Loading your rooms">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-9 animate-pulse rounded-lg bg-surface" />
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted">
          Your rooms will appear here as you add photos.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-0.5">
          {rooms.map((room) => {
            const { label, tone } = roomStatus(room);
            const active = !composing && room._id === activeId;

            if (room._id === editingId) {
              return (
                <li key={room._id}>
                  <input
                    autoFocus
                    defaultValue={room.title}
                    aria-label={`Rename ${room.title}`}
                    maxLength={80}
                    onBlur={(event) => commit(room, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") {
                        cancelled.current = true;
                        event.currentTarget.blur();
                      }
                    }}
                    className="w-full rounded-xl bg-surface px-3 py-2 text-sm text-ink ring-1 ring-accent-deep outline-none"
                  />
                </li>
              );
            }

            return (
              <li key={room._id} className="group relative">
                <button
                  onClick={() => onSelect(room._id)}
                  onDoubleClick={() => setEditingId(room._id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "w-full rounded-xl px-3 py-2 pr-9 text-left transition-colors",
                    active ? "bg-surface ring-1 ring-black/5" : "hover:bg-ink/5",
                  )}
                >
                  <span className="block truncate text-sm font-medium text-ink">{room.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                    <span className={cn("size-1.5 shrink-0 rounded-full", toneDot[tone])} />
                    <span className="truncate">{label}</span>
                    {room.isDemo && (
                      <span className="shrink-0 rounded bg-line px-1 text-[10px] tracking-wide uppercase">
                        Demo
                      </span>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => setEditingId(room._id)}
                  aria-label={`Rename ${room.title}`}
                  className="absolute top-2 right-1.5 rounded-md p-1.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
                >
                  <Pencil className="size-3.5" strokeWidth={1.75} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
