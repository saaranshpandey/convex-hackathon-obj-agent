import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Outline point in normalised image space (0..1), resolution independent. */
export const pointValidator = v.object({ x: v.number(), y: v.number() });

export const cleanoutStatus = v.union(
  v.literal("uploading"),
  v.literal("analyzing"),
  v.literal("objects_found"),
  v.literal("ready"),
  v.literal("failed"),
);

export const itemStatus = v.union(v.literal("detected"), v.literal("listed"));

export const itemSource = v.union(v.literal("detected"), v.literal("manual"));

export const boxValidator = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

/**
 * Mask refinement is independent of detection. "failed" also covers "never
 * attempted" (refinement switched off) — in both cases the UI keeps the box.
 */
export const maskStatus = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
);

export const researchStatus = v.union(
  v.literal("queued"),
  v.literal("identifying"),
  v.literal("researching"),
  v.literal("ready_for_review"),
  v.literal("failed"),
);

export const identificationConfidence = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

export const identificationValidator = v.object({
  genericName: v.string(),
  // Always present but nullable, matching OpenAI's strict-schema output
  // (identify.ts's IdentificationResult) — never absent/undefined.
  brand: v.union(v.string(), v.null()),
  model: v.union(v.string(), v.null()),
  category: v.string(),
  condition: v.string(),
  attributes: v.array(v.string()),
  confidence: identificationConfidence,
});

export const researchSourceValidator = v.object({
  source: v.string(),
  price: v.string(),
  description: v.string(),
  url: v.string(),
});

export const listingStatus = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("publishing"),
  v.literal("live"),
  v.literal("failed"),
  v.literal("ended"),
  v.literal("sold"),
  // Legacy alias from Phase 5's bulk "List approved items" — no code path
  // produces this anymore (superseded by "live"), kept so existing rows
  // don't need a migration.
  v.literal("listed"),
);

export const listingCondition = v.union(
  v.literal("new"),
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("poor"),
);

export const agentMessageDirection = v.union(v.literal("outbound"), v.literal("inbound"));

export const agentMessageKind = v.union(
  v.literal("offer_notice"),
  v.literal("price_drop_suggestion"),
  v.literal("reply"),
  v.literal("confirmation"),
  v.literal("clarification"),
);

export const pendingDecisionKind = v.union(v.literal("offer"), v.literal("price_drop"));

export const pendingDecisionValidator = v.object({
  kind: pendingDecisionKind,
  amount: v.number(),
  createdAt: v.number(),
});

export const activityType = v.union(
  v.literal("cleanout_created"),
  v.literal("detection_started"),
  v.literal("detection_completed"),
  v.literal("detection_failed"),
  v.literal("detection_retried"),
  v.literal("item_selected"),
  v.literal("item_deselected"),
  v.literal("item_renamed"),
  v.literal("item_added"),
  v.literal("item_removed"),
  v.literal("selection_bulk"),
  v.literal("research_started"),
  v.literal("research_completed"),
  v.literal("research_failed"),
);

export default defineSchema({
  cleanouts: defineTable({
    // Anonymous session id for now; becomes a real auth subject in a later phase.
    userId: v.optional(v.string()),
    title: v.string(),
    // Absent only while the upload is still in flight.
    imageStorageId: v.optional(v.id("_storage")),
    status: cleanoutStatus,
    selectedCount: v.number(),
    /** Pixel dimensions, supplied by the client; box prompts need them. */
    imageWidth: v.optional(v.number()),
    imageHeight: v.optional(v.number()),
    /** Which segmentation provider produced this cleanout's items. */
    provider: v.optional(v.string()),
    /** Benchmark instrumentation. */
    detectionLatencyMs: v.optional(v.number()),
    detectionPromptTokens: v.optional(v.number()),
    detectionCompletionTokens: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_userId_and_createdAt", ["userId", "createdAt"]),

  items: defineTable({
    cleanoutId: v.id("cleanouts"),
    name: v.string(),
    category: v.string(),
    selected: v.boolean(),
    confidence: v.number(),
    /** Outline drawn until a mask arrives; a rectangle for box providers. */
    polygon: v.array(pointValidator),
    /** Normalised detection box — the prompt sent to the mask model. */
    detectionBox: boxValidator,
    source: itemSource,

    // Asynchronous mask refinement.
    maskStatus: maskStatus,
    maskStorageId: v.optional(v.id("_storage")),
    maskError: v.optional(v.string()),
    maskLatencyMs: v.optional(v.number()),
    segmentationProvider: v.optional(v.string()),

    // Phase 4: identification + resale research, independent per item.
    researchStatus: v.optional(researchStatus),
    researchError: v.optional(v.string()),
    identification: v.optional(identificationValidator),
    recommendedPrice: v.optional(v.number()),
    pricingRationale: v.optional(v.string()),
    researchSources: v.optional(v.array(researchSourceValidator)),

    estimatedLow: v.optional(v.number()),
    estimatedHigh: v.optional(v.number()),
    status: itemStatus,
    createdAt: v.number(),
  }).index("by_cleanoutId", ["cleanoutId"]),

  activity: defineTable({
    cleanoutId: v.id("cleanouts"),
    itemId: v.optional(v.id("items")),
    type: activityType,
    message: v.string(),
    createdAt: v.number(),
  }).index("by_cleanoutId_and_createdAt", ["cleanoutId", "createdAt"]),

  listings: defineTable({
    cleanoutId: v.id("cleanouts"),
    itemId: v.id("items"),
    /** Fixed to "ebay" for now — a later phase may add other marketplaces. */
    marketplace: v.string(),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    condition: listingCondition,
    price: v.number(),
    status: listingStatus,
    createdAt: v.number(),
    updatedAt: v.number(),

    // Phase 6: eBay publish result, independent per listing.
    ebayListingId: v.optional(v.string()),
    ebayOfferId: v.optional(v.string()),
    ebayListingUrl: v.optional(v.string()),
    publishError: v.optional(v.string()),
    /** "mock" | "sandbox" — which mode actually produced this result. */
    publishMode: v.optional(v.string()),

    // Phase 7: the one open question the owner needs to answer, if any.
    pendingDecision: v.optional(pendingDecisionValidator),
  })
    .index("by_cleanoutId", ["cleanoutId"])
    .index("by_itemId", ["itemId"]),

  ebayConnections: defineTable({
    sessionId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshTokenExpiresAt: v.optional(v.number()),
    /** "mock" | "sandbox". */
    mode: v.string(),
    connectedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_sessionId", ["sessionId"]),

  agentMessages: defineTable({
    listingId: v.id("listings"),
    direction: agentMessageDirection,
    kind: agentMessageKind,
    text: v.string(),
    amount: v.optional(v.number()),
    agentMailMessageId: v.optional(v.string()),
    agentMailThreadId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_listingId_and_createdAt", ["listingId", "createdAt"])
    .index("by_agentMailThreadId", ["agentMailThreadId"])
    .index("by_agentMailMessageId", ["agentMailMessageId"]),
});
