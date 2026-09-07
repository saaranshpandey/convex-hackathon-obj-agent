/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as cleanouts from "../cleanouts.js";
import type * as detection from "../detection.js";
import type * as dev from "../dev.js";
import type * as identify from "../identify.js";
import type * as items from "../items.js";
import type * as masks from "../masks.js";
import type * as mockDetection from "../mockDetection.js";
import type * as priceResearch from "../priceResearch.js";
import type * as research from "../research.js";
import type * as segmentation_fal from "../segmentation/fal.js";
import type * as segmentation_index from "../segmentation/index.js";
import type * as segmentation_mock from "../segmentation/mock.js";
import type * as segmentation_openai from "../segmentation/openai.js";
import type * as segmentation_types from "../segmentation/types.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  cleanouts: typeof cleanouts;
  detection: typeof detection;
  dev: typeof dev;
  identify: typeof identify;
  items: typeof items;
  masks: typeof masks;
  mockDetection: typeof mockDetection;
  priceResearch: typeof priceResearch;
  research: typeof research;
  "segmentation/fal": typeof segmentation_fal;
  "segmentation/index": typeof segmentation_index;
  "segmentation/mock": typeof segmentation_mock;
  "segmentation/openai": typeof segmentation_openai;
  "segmentation/types": typeof segmentation_types;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
