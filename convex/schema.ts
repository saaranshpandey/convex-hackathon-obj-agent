import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

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

export const sellerSetupValidator = v.object({
  locationKey: v.string(),
  fulfillmentPolicyId: v.string(),
  paymentPolicyId: v.string(),
  returnPolicyId: v.string(),
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

export const offerStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("countered"),
  v.literal("buyer_accepted"),
  v.literal("expired"),
);

export const offerSource = v.union(v.literal("mock"), v.literal("ebay"));

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
  /**
   * Which offer this decision is about. Always set for kind "offer"; absent for
   * price drops, which have no offer behind them. Optional in the validator
   * only so rows written before this field existed still validate.
   */
  offerId: v.optional(v.id("offers")),
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
  ...authTables,
  cleanouts: defineTable({
    /** The signed-in owner. Every room belongs to exactly one user. */
    userId: v.id("users"),
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
    /**
     * A seeded demo room. Renders identically to a real one apart from a
     * discreet indicator, and is the only place simulated marketplace events
     * may be fabricated when DEMO_MODE is off.
     */
    isDemo: v.optional(v.boolean()),
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

  offers: defineTable({
    listingId: v.id("listings"),
    /** The marketplace's own id — the idempotency key for ingestion. */
    marketplaceOfferId: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: offerStatus,
    source: offerSource,
    /** Set once the owner counters, so the UI can show both figures. */
    counterAmount: v.optional(v.number()),
    buyerMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_listingId_and_createdAt", ["listingId", "createdAt"])
    .index("by_marketplaceOfferId", ["marketplaceOfferId"]),

  ebayConnections: defineTable({
    userId: v.id("users"),
    accessToken: v.string(),
    refreshToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshTokenExpiresAt: v.optional(v.number()),
    /** "mock" | "sandbox". */
    mode: v.string(),
    connectedAt: v.number(),
    updatedAt: v.number(),
    /** Where this seller ships from; used to create their own eBay location. */
    shipFromPostalCode: v.optional(v.string()),
    /** The seller's own location and policy IDs, once they have been created. */
    sellerSetup: v.optional(sellerSetupValidator),
  }).index("by_userId", ["userId"]),

  /** One-time codes that carry a signed-in user through eBay's OAuth redirect. */
  ebayOauthStates: defineTable({
    nonce: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
    /** The ZIP the seller entered before being sent to eBay. */
    postalCode: v.optional(v.string()),
  }).index("by_nonce", ["nonce"]),

  /**
   * Caches priceItem's result (Firecrawl search + pricing) by product
   * identity, so re-researching the same product (a second unit in this
   * cleanout, or a later one) skips the search and OpenAI pricing call.
   */
  priceResearchCache: defineTable({
    key: v.string(),
    estimatedLow: v.number(),
    estimatedHigh: v.number(),
    recommendedPrice: v.number(),
    rationale: v.string(),
    sources: v.array(researchSourceValidator),
    createdAt: v.number(),
  }).index("by_key", ["key"]),

  agentMessages: defineTable({
    listingId: v.id("listings"),
    /**
     * The offer this message is about. Carried on the outbound notice so an
     * inbound reply resolves the offer that was actually asked about, rather
     * than whichever offer happens to be newest.
     */
    offerId: v.optional(v.id("offers")),
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
