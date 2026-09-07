export default function WorkspaceSkeleton() {
  return (
    <div
      className="grid animate-pulse gap-7 pt-3 lg:grid-cols-[minmax(0,2.05fr)_minmax(0,1fr)] lg:gap-8"
      aria-busy="true"
      aria-label="Loading your scan"
    >
      <div className="min-w-0 space-y-5">
        <div className="aspect-[16/10] w-full rounded-[20px] bg-surface shadow-[var(--shadow-card)]" />
        <div className="flex items-center justify-between">
          <div className="h-4 w-44 rounded-full bg-surface" />
          <div className="h-9 w-52 rounded-full bg-surface" />
        </div>
        <div className="flex gap-2">
          {[64, 52, 78, 60, 56].map((w, i) => (
            <div
              key={i}
              className="h-8 rounded-full bg-surface"
              style={{ width: w }}
            />
          ))}
        </div>
      </div>
      <div className="h-72 rounded-[16px] bg-surface shadow-[var(--shadow-card)]" />
    </div>
  );
}
