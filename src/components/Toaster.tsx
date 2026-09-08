import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, TriangleAlert, X } from "lucide-react";

type ToastTone = "success" | "error";
type Toast = { id: number; tone: ToastTone; message: string };

const DURATION_MS = 4200;

const ToastContext = createContext<((tone: ToastTone, message: string) => void) | null>(
  null,
);

/**
 * Feedback for things that finish away from where the user is looking — a
 * publish that failed, an offer that landed. Deliberately tiny: a dependency
 * for this would outweigh the feature.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}

      <div
        // Announced politely so a screen reader hears it without stealing focus.
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-full bg-ink py-2.5 pr-2.5 pl-4 text-sm text-canvas shadow-[var(--shadow-lift)]"
            >
              <span className="mt-0.5 shrink-0">
                {toast.tone === "success" ? (
                  <Check className="size-4 text-accent" strokeWidth={2.5} />
                ) : (
                  <TriangleAlert className="size-4 text-accent" strokeWidth={2.25} />
                )}
              </span>
              <span className="flex-1 leading-snug">{toast.message}</span>
              <button
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="shrink-0 rounded-full p-1 text-canvas/60 transition-colors hover:text-canvas"
              >
                <X className="size-3.5" strokeWidth={2.5} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (push === null) throw new Error("useToast must be used inside a ToastProvider");

  return useMemo(
    () => ({
      success: (message: string) => push("success", message),
      error: (message: string) => push("error", message),
    }),
    [push],
  );
}
