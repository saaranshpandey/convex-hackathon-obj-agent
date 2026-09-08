/**
 * Demo mode: a seeded room that exercises the whole product without touching
 * OpenAI, fal, Firecrawl or AgentMail.
 *
 * Every stage is a scheduled Convex mutation rather than a client-side timer,
 * so the progression arrives through the same reactive subscriptions the live
 * pipeline uses. To the UI a demo room is an ordinary room that happens to
 * carry `isDemo`.
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { recordActivity } from "./activity";
import { MOCK_DETECTIONS } from "./mockDetection";
import { DEMO_ITEMS } from "./demoData";

/** Paced to read as work happening, not as an artificial wait. */
const SCAN_MS = 1300;
const REVEAL_MS = 500;
const IDENTIFY_MS = 900;
const RESEARCH_MS = 1500;
const DRAFT_MS = 1200;

function boxOf(polygon: { x: number; y: number }[]) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Starts a demo room. The client uploads the bundled room image first so the
 * photo comes from Convex file storage exactly as a real upload would.
 */
export const seedRoom = mutation({
  args: {
    sessionId: v.string(),
    storageId: v.id("_storage"),
    imageWidth: v.optional(v.number()),
    imageHeight: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cleanoutId = await ctx.db.insert("cleanouts", {
      userId: args.sessionId,
      title: "Demo room",
      imageStorageId: args.storageId,
      imageWidth: args.imageWidth,
      imageHeight: args.imageHeight,
      status: "analyzing",
      selectedCount: 0,
      isDemo: true,
      provider: "demo",
      createdAt: Date.now(),
    });

    await recordActivity(ctx, {
      cleanoutId,
      type: "cleanout_created",
      message: "Started “Demo room”",
    });
    await recordActivity(ctx, {
      cleanoutId,
      type: "detection_started",
      message: "Scanning the room…",
    });

    await ctx.scheduler.runAfter(SCAN_MS, internal.demo.revealObjects, { cleanoutId });

    return cleanoutId;
  },
});

export const revealObjects = internalMutation({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const cleanout = await ctx.db.get("cleanouts", args.cleanoutId);
    if (cleanout === null) return null;

    const now = Date.now();
    let created = 0;

    for (const seed of DEMO_ITEMS) {
      const detection = MOCK_DETECTIONS.find((d) => d.name === seed.name);
      if (detection === undefined) continue;

      await ctx.db.insert("items", {
        cleanoutId: args.cleanoutId,
        name: seed.name,
        category: seed.category,
        selected: true,
        confidence: seed.confidence,
        polygon: detection.polygon,
        detectionBox: boxOf(detection.polygon),
        source: "detected",
        status: "detected",
        // Pre-traced outlines stand in for a refined mask; no fal call is made.
        maskStatus: "failed",
        maskError: "Demo room uses pre-traced outlines.",
        createdAt: now,
      });
      created += 1;
    }

    await ctx.db.patch("cleanouts", args.cleanoutId, {
      status: "objects_found",
      selectedCount: created,
    });

    await recordActivity(ctx, {
      cleanoutId: args.cleanoutId,
      type: "detection_completed",
      message: `Found ${created} things worth selling`,
    });

    await ctx.scheduler.runAfter(REVEAL_MS, internal.demo.finishScan, {
      cleanoutId: args.cleanoutId,
    });

    return null;
  },
});

export const finishScan = internalMutation({
  args: { cleanoutId: v.id("cleanouts") },
  handler: async (ctx, args) => {
    const cleanout = await ctx.db.get("cleanouts", args.cleanoutId);
    if (cleanout === null || cleanout.status !== "objects_found") return null;
    await ctx.db.patch("cleanouts", args.cleanoutId, { status: "ready" });
    return null;
  },
});

/**
 * Stands in for the real research pipeline on a demo room. Entered from
 * `research.startResearch`, so the user's interaction is identical.
 */
export const simulateResearch = internalMutation({
  args: { cleanoutId: v.id("cleanouts"), itemIds: v.array(v.id("items")) },
  handler: async (ctx, args) => {
    for (const itemId of args.itemIds) {
      const item = await ctx.db.get("items", itemId);
      if (item === null) continue;
      await ctx.db.patch("items", itemId, { researchStatus: "identifying" });
    }

    await ctx.scheduler.runAfter(IDENTIFY_MS, internal.demo.applyIdentification, {
      cleanoutId: args.cleanoutId,
      itemIds: args.itemIds,
    });

    return null;
  },
});

export const applyIdentification = internalMutation({
  args: { cleanoutId: v.id("cleanouts"), itemIds: v.array(v.id("items")) },
  handler: async (ctx, args) => {
    for (const itemId of args.itemIds) {
      const item = await ctx.db.get("items", itemId);
      if (item === null) continue;
      const seed = DEMO_ITEMS.find((d) => d.name === item.name);
      if (seed === undefined) continue;

      await ctx.db.patch("items", itemId, {
        identification: seed.identification,
        researchStatus: "researching",
      });
    }

    await ctx.scheduler.runAfter(RESEARCH_MS, internal.demo.applyPricing, {
      cleanoutId: args.cleanoutId,
      itemIds: args.itemIds,
    });

    return null;
  },
});

export const applyPricing = internalMutation({
  args: { cleanoutId: v.id("cleanouts"), itemIds: v.array(v.id("items")) },
  handler: async (ctx, args) => {
    for (const itemId of args.itemIds) {
      const item = await ctx.db.get("items", itemId);
      if (item === null) continue;
      const seed = DEMO_ITEMS.find((d) => d.name === item.name);
      if (seed === undefined) continue;

      await ctx.db.patch("items", itemId, {
        estimatedLow: seed.estimatedLow,
        estimatedHigh: seed.estimatedHigh,
        recommendedPrice: seed.recommendedPrice,
        pricingRationale: seed.pricingRationale,
        researchSources: seed.researchSources,
        researchStatus: "ready_for_review",
      });
    }

    await ctx.scheduler.runAfter(DRAFT_MS, internal.demo.draftListings, {
      cleanoutId: args.cleanoutId,
      itemIds: args.itemIds,
    });

    return null;
  },
});

export const draftListings = internalMutation({
  args: { cleanoutId: v.id("cleanouts"), itemIds: v.array(v.id("items")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    let drafted = 0;

    for (const itemId of args.itemIds) {
      const item = await ctx.db.get("items", itemId);
      if (item === null) continue;
      const seed = DEMO_ITEMS.find((d) => d.name === item.name);
      if (seed === undefined) continue;

      const existing = await ctx.db
        .query("listings")
        .withIndex("by_itemId", (q) => q.eq("itemId", itemId))
        .first();
      if (existing !== null) continue;

      await ctx.db.insert("listings", {
        cleanoutId: args.cleanoutId,
        itemId,
        marketplace: "ebay",
        title: seed.listing.title,
        description: seed.listing.description,
        category: seed.listing.category,
        condition: seed.listing.condition,
        price: seed.recommendedPrice,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      });
      drafted += 1;
    }

    await recordActivity(ctx, {
      cleanoutId: args.cleanoutId,
      type: "research_completed",
      message: `Prepared ${drafted} ${drafted === 1 ? "listing" : "listings"} for review`,
    });

    return null;
  },
});

export type DemoCleanoutId = Id<"cleanouts">;
