import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut } from "lucide-react";
import { api } from "../../convex/_generated/api";

export default function AccountMenu() {
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();

  if (!me) return null;
  const label = me.name ?? me.email ?? "Account";

  return (
    <div className="flex items-center gap-2">
      {me.image ? (
        <img
          src={me.image}
          alt=""
          referrerPolicy="no-referrer"
          className="size-8 rounded-full ring-1 ring-black/5"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-line text-xs font-medium text-ink-soft"
        >
          {label.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="hidden max-w-[10rem] truncate text-xs font-medium text-ink-soft lg:inline">
        {label}
      </span>
      <button
        onClick={() => void signOut()}
        title="Sign out"
        aria-label="Sign out"
        className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/5 hover:text-ink"
      >
        <LogOut className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}
