import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function EbayConnectButton() {
  const status = useQuery(api.ebayAuth.connectionStatus);
  const connect = useMutation(api.ebayAuth.connect);
  const disconnect = useMutation(api.ebayAuth.disconnect);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === undefined) return null;

  if (status.connected) {
    return (
      <button
        onClick={() => void disconnect({})}
        title="Disconnect eBay"
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-ink-soft ring-1 ring-line ring-inset transition-colors hover:bg-canvas"
      >
        <span className="size-1.5 rounded-full bg-accent-deep" />
        eBay ✓ Connected
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      <button
        onClick={async () => {
          setConnecting(true);
          setError(null);
          try {
            const result = await connect({});
            if (result.authorizeUrl) {
              window.open(result.authorizeUrl, "ebay-oauth", "width=500,height=700");
            }
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Couldn't connect eBay.");
          } finally {
            setConnecting(false);
          }
        }}
        disabled={connecting}
        className="h-10 rounded-full bg-accent-deep px-5 text-sm font-medium text-white transition-colors hover:bg-[#0077ed] disabled:opacity-50"
      >
        {connecting ? "Connecting…" : "Connect eBay"}
      </button>
    </div>
  );
}
