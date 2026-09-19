/** Extracts the bare, lowercased address from "Name <a@b.com>" or "a@b.com". */
export function extractAddress(from: string): string {
  const bracketed = /<([^>]+)>/.exec(from);
  return (bracketed?.[1] ?? from).trim().toLowerCase();
}

/**
 * Whether an inbound reply may act on a listing. A reply whose sender the
 * webhook did not report is allowed (the thread id is still required), but a
 * reported sender that is not the listing owner is not.
 */
export function senderMatchesOwner(from: string | undefined, ownerEmail: string | null): boolean {
  if (from === undefined) return true;
  if (ownerEmail === null) return false;
  return extractAddress(from) === ownerEmail.trim().toLowerCase();
}
