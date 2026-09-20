import { env } from "../_generated/server";
import { createMockPublisher } from "./mock";
import { createSandboxPublisher } from "./sandbox";
import type { EbayEnv, EbayPublisher } from "./types";

export * from "./types";

/** Defaults to "mock" — an unset EBAY_MODE must never block the demo. */
export function getEbayMode(): "mock" | "sandbox" {
  return env.EBAY_MODE?.trim().toLowerCase() === "sandbox" ? "sandbox" : "mock";
}

/** eBay's environment for the current mode, or null in demo mode (no eBay calls). */
export function getEbayEnv(): EbayEnv | null {
  const mode = getEbayMode();
  return mode === "mock" ? null : mode;
}

export function getEbayPublisher(): EbayPublisher {
  return getEbayMode() === "mock" ? createMockPublisher() : createSandboxPublisher("sandbox");
}
