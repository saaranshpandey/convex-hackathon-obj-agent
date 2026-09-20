import { defineApp } from "convex/server";
import { v } from "convex/values";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp({
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
    /** "mock" | "ebay". Source of offer activity; independent of EBAY_MODE. */
    EBAY_ACTIVITY_MODE: v.optional(v.string()),
    /**
     * Must be exactly "true" for the demo simulators (fabricating buyer offers
     * and acceptances) to run. Hiding the buttons in the client is not a
     * control — these mutations ship in every build.
     */
    DEMO_MODE: v.optional(v.string()),
    EBAY_CLIENT_ID: v.optional(v.string()),
    EBAY_CLIENT_SECRET: v.optional(v.string()),
    /** eBay's opaque OAuth redirect identifier for this app + environment — not a URL. */
    EBAY_RU_NAME: v.optional(v.string()),
    /** Proves to eBay that we own the account-deletion endpoint (32-80 chars of A-Za-z0-9_-). */
    EBAY_DELETION_VERIFICATION_TOKEN: v.optional(v.string()),

    /** Owner communication (never the eBay buyer-messaging channel). */
    AGENTMAIL_API_KEY: v.optional(v.string()),
    AGENTMAIL_WEBHOOK_SECRET: v.optional(v.string()),
    /** Reuse an existing inbox instead of creating one (e.g. plan limit reached). */
    AGENTMAIL_INBOX_ID: v.optional(v.string()),
  },
});

app.use(staticHosting);

export default app;
