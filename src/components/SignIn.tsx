import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2 } from "lucide-react";
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
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6">
      {/* Ambient wash so the empty canvas reads as depth rather than a void. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 55% at 50% -5%, #e5f0ff 0%, rgba(229,240,255,0) 68%), " +
            "radial-gradient(55% 45% at 50% 105%, #e8eaf0 0%, rgba(232,234,240,0) 70%)",
        }}
      />

      <div className="relative w-full max-w-md rounded-3xl bg-surface px-10 py-11 text-center shadow-[var(--shadow-lift)] ring-1 ring-black/5">
        {/* The lockup carries the wordmark, so the heading is for structure only. */}
        <h1 className="sr-only">Roomly</h1>
        {/* The PNG has no alpha and its ground is #fdfdfd, which shows as a
            faint box on a white card; multiply drops it into the surface. */}
        <img
          src="/roomly-lockup.png"
          alt=""
          width={498}
          height={480}
          className="mx-auto w-40 mix-blend-multiply"
        />

        <p className="mt-5 text-[22px] leading-snug font-semibold tracking-[-0.03em] text-balance text-ink">
          Make room for what's next.
        </p>

        <Button
          size="lg"
          className="mt-8 w-full"
          disabled={busy}
          onClick={() => void handleSignIn()}
        >
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
      </div>
    </main>
  );
}
