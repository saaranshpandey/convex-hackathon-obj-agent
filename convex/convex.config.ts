import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    OPENAI_API_KEY: v.optional(v.string()),
    /** Overrides the default vision model. */
    OPENAI_VISION_MODEL: v.optional(v.string()),
    /** "minimal" | "low" | "medium" | "high". Detection is not a reasoning task. */
    OPENAI_REASONING_EFFORT: v.optional(v.string()),
    /** "openai" | "mock" | "fail" | "auto". */
    SEGMENTATION_MODE: v.optional(v.string()),

    /** Enables asynchronous box-prompted mask refinement. */
    FAL_KEY: v.optional(v.string()),
    /** Overrides the fal mask model. */
    FAL_MASK_MODEL: v.optional(v.string()),
    /** "fal" | "off" | "auto". */
    MASK_MODE: v.optional(v.string()),

    /** Enables Phase 4 resale research (Firecrawl web search). */
    FIRECRAWL_API_KEY: v.optional(v.string()),

    /** "mock" | "sandbox". Defaults to "mock" if unset — the demo always works. */
    EBAY_MODE: v.optional(v.string()),
    EBAY_CLIENT_ID: v.optional(v.string()),
    EBAY_CLIENT_SECRET: v.optional(v.string()),
    /** eBay's opaque OAuth redirect identifier for this app + environment — not a URL. */
    EBAY_RU_NAME: v.optional(v.string()),
    EBAY_MERCHANT_LOCATION_KEY: v.optional(v.string()),
    EBAY_FULFILLMENT_POLICY_ID: v.optional(v.string()),
    EBAY_PAYMENT_POLICY_ID: v.optional(v.string()),
    EBAY_RETURN_POLICY_ID: v.optional(v.string()),
    EBAY_CATEGORY_ID: v.optional(v.string()),

    /** Owner communication (never the eBay buyer-messaging channel). */
    AGENTMAIL_API_KEY: v.optional(v.string()),
    AGENTMAIL_WEBHOOK_SECRET: v.optional(v.string()),
    /** The single demo owner's real address — this app has no per-user email. */
    USER_NOTIFY_EMAIL: v.optional(v.string()),
  },
});
