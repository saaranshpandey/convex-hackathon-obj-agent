import { env } from "../_generated/server";
import { createMockPublisher } from "./mock";
import { createSandboxPublisher } from "./sandbox";
import type { EbayEnv, EbayPublisher } from "./types";

export * from "./types";

export type EbayMode = "mock" | EbayEnv;

/** Defaults to "mock" — an unset EBAY_MODE must never block the demo. */
export function getEbayMode(): EbayMode {
  const value = env.EBAY_MODE?.trim().toLowerCase();
  return value === "sandbox" || value === "production" ? value : "mock";
}

/** eBay's environment for the current mode, or null in demo mode (no eBay calls). */
export function getEbayEnv(): EbayEnv | null {
  const mode = getEbayMode();
  return mode === "mock" ? null : mode;
}

/** `forceMock` is for demo rooms, which must never reach real eBay. */
export function getEbayPublisher(forceMock = false): EbayPublisher {
  const mode = getEbayMode();
  return forceMock || mode === "mock" ? createMockPublisher() : createSandboxPublisher(mode);
}
