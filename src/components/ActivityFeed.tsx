import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export default function ActivityFeed({
  cleanoutId,
}: {
  cleanoutId: Id<"cleanouts">;
}) {
  const events = useQuery(api.activity.list, { cleanoutId });

  if (events === undefined) {
    return <div className="mt-3 h-16 animate-pulse rounded-lg bg-canvas" />;
  }

  return (
    <ol className="mt-3 space-y-2">
      {events.slice(0, 5).map((event) => (
        <li key={event._id} className="flex gap-2.5 text-xs text-muted">
          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-line-strong" />
          <span className="flex-1 leading-relaxed">{event.message}</span>
        </li>
      ))}
    </ol>
  );
}
