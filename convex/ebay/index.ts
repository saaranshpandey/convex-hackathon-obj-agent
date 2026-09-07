import { env } from "../_generated/server";
import { createMockPublisher } from "./mock";
import { createSandboxPublisher } from "./sandbox";
import type { EbayPublisher } from "./types";

export * from "./types";

/** Defaults to "mock" — an unset EBAY_MODE must never block the demo. */
export function getEbayMode(): "mock" | "sandbox" {
  return env.EBAY_MODE?.trim().toLowerCase() === "sandbox" ? "sandbox" : "mock";
}

export function getEbayPublisher(): EbayPublisher {
  return getEbayMode() === "mock" ? createMockPublisher() : createSandboxPublisher("sandbox");
}
