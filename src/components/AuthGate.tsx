import type { ReactNode } from "react";
import { useConvexAuth } from "convex/react";
import { Loader2 } from "lucide-react";
import SignIn from "@/components/SignIn";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading">
        <Loader2 className="size-6 animate-spin text-muted" />
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <SignIn />;
}
