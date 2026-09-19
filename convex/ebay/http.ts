import { EbayError, type EbayEnv } from "./types";

export function apiBase(env: EbayEnv): string {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

export async function ebayRequest(
  env: EbayEnv,
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiBase(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new EbayError("eBay rejected the access token. Reconnect your eBay account.", 401);
    }
    throw new EbayError(
      `eBay ${method} ${path} failed (${response.status}): ${detail.slice(0, 500)}`,
      response.status,
    );
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}
