import { ebayRequest } from "./http";
import { EbayError, type EbayEnv } from "./types";

export function parseEbayUserId(payload: unknown): string | null {
  const userId = (payload as { userId?: unknown } | null)?.userId;
  return typeof userId === "string" && userId !== "" ? userId : null;
}

/** eBay's own immutable ID for the seller who just connected. */
export async function fetchEbayUserId(env: EbayEnv, accessToken: string): Promise<string> {
  const payload = await ebayRequest(
    env,
    accessToken,
    "GET",
    "/commerce/identity/v1/user/",
    undefined,
    "apiz",
  );
  const userId = parseEbayUserId(payload);
  if (userId === null) throw new EbayError("eBay didn't return your account ID.");
  return userId;
}
