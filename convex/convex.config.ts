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
  },
});
