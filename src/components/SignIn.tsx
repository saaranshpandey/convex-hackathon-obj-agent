import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn("google");
    } catch {
      setError("Couldn't start Google sign-in. Please try again.");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-ink text-white shadow-sm">
        <Scan className="size-6" strokeWidth={1.75} />
      </span>
      <h1 className="mt-6 text-3xl font-semibold tracking-[-0.045em]">Roomsale</h1>
      <p className="mt-3 text-sm text-muted">
        Sign in to scan a room, price what's in it, and list it for sale.
      </p>
      <Button size="lg" className="mt-8 w-full" disabled={busy} onClick={() => void handleSignIn()}>
        {busy ? (
          <>
            <Loader2 className="animate-spin" />
            Redirecting to Google…
          </>
        ) : (
          "Continue with Google"
        )}
      </Button>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}
