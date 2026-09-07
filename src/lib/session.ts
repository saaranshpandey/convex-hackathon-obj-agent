import { useState } from "react";

const KEY = "roomsale.sessionId";

/**
 * Anonymous, browser-persistent identity. Survives reloads and is shared by
 * every tab in the same browser, which is what makes two windows show the same
 * cleanout. Replaced by a real auth subject in a later phase.
 */
export function useSessionId(): string {
  const [sessionId] = useState(() => {
    // Dev-only override so a session can be opened directly, e.g. by a
    // headless browser or a second window: ?session=<id>
    if (import.meta.env.DEV) {
      const override = new URLSearchParams(window.location.search).get("session");
      if (override) return override;
    }

    try {
      const existing = window.localStorage.getItem(KEY);
      if (existing) return existing;
      const created = crypto.randomUUID();
      window.localStorage.setItem(KEY, created);
      return created;
    } catch {
      // Private mode with storage disabled: fall back to a per-tab identity.
      return crypto.randomUUID();
    }
  });

  return sessionId;
}
