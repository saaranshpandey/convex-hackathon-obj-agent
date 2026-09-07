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
});
