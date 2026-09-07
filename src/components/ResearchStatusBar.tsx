import type { WorkspaceItem } from "@/lib/geometry";

type Props = { items: WorkspaceItem[] };

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued…",
  identifying: "Identifying…",
  researching: "Researching prices…",
};

export default function ResearchStatusBar({ items }: Props) {
  const active = items.filter((item) => item.researchStatus !== undefined);
  if (active.length === 0) return null;

  const working = active.filter(
    (item) =>
      item.researchStatus === "queued" ||
      item.researchStatus === "identifying" ||
      item.researchStatus === "researching",
  ).length;

  return (
    <div className="surface px-5 py-4">
      <p className="text-sm font-medium text-ink">
        {working > 0
          ? `${working} ${working === 1 ? "agent" : "agents"} working`
          : "Research complete"}
      </p>
      <ul className="mt-3 space-y-1.5">
        {active.map((item) => (
          <li
            key={item._id}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-ink-soft">{item.name}</span>
            <span className="text-muted">
              {item.researchStatus === "ready_for_review"
                ? item.estimatedLow !== undefined && item.estimatedHigh !== undefined
                  ? `$${item.estimatedLow}–${item.estimatedHigh} ✓`
                  : "Priced ✓"
                : item.researchStatus === "failed"
                  ? "Couldn't price this"
                  : (STATUS_LABEL[item.researchStatus ?? ""] ?? "")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
