/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as activity from "../activity.js";
import type * as agentMail from "../agentMail.js";
import type * as agentMail_client from "../agentMail/client.js";
import type * as agentMail_parseReply from "../agentMail/parseReply.js";
import type * as agentMail_verify from "../agentMail/verify.js";
import type * as auth from "../auth.js";
import type * as cleanouts from "../cleanouts.js";
import type * as demo from "../demo.js";
import type * as demoData from "../demoData.js";
import type * as detection from "../detection.js";
import type * as dev from "../dev.js";
import type * as ebay_index from "../ebay/index.js";
import type * as ebay_mock from "../ebay/mock.js";
import type * as ebay_oauth from "../ebay/oauth.js";
import type * as ebay_sandbox from "../ebay/sandbox.js";
import type * as ebay_types from "../ebay/types.js";
import type * as ebayAuth from "../ebayAuth.js";
import type * as ebaySetup from "../ebaySetup.js";
import type * as generateListing from "../generateListing.js";
import type * as http from "../http.js";
import type * as identify from "../identify.js";
import type * as imageCrop from "../imageCrop.js";
import type * as items from "../items.js";
import type * as listingPublish from "../listingPublish.js";
import type * as listings from "../listings.js";
import type * as marketplace_ebay from "../marketplace/ebay.js";
import type * as marketplace_ebayXml from "../marketplace/ebayXml.js";
import type * as marketplace_mock from "../marketplace/mock.js";
import type * as marketplace_provider from "../marketplace/provider.js";
import type * as marketplace_types from "../marketplace/types.js";
import type * as masks from "../masks.js";
import type * as mockDetection from "../mockDetection.js";
import type * as money from "../money.js";
import type * as offers from "../offers.js";
import type * as priceResearch from "../priceResearch.js";
import type * as research from "../research.js";
import type * as segmentation_fal from "../segmentation/fal.js";
import type * as segmentation_index from "../segmentation/index.js";
import type * as segmentation_mock from "../segmentation/mock.js";
import type * as segmentation_openai from "../segmentation/openai.js";
import type * as segmentation_types from "../segmentation/types.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  activity: typeof activity;
  agentMail: typeof agentMail;
  "agentMail/client": typeof agentMail_client;
  "agentMail/parseReply": typeof agentMail_parseReply;
  "agentMail/verify": typeof agentMail_verify;
  auth: typeof auth;
  cleanouts: typeof cleanouts;
  demo: typeof demo;
  demoData: typeof demoData;
  detection: typeof detection;
  dev: typeof dev;
  "ebay/index": typeof ebay_index;
  "ebay/mock": typeof ebay_mock;
  "ebay/oauth": typeof ebay_oauth;
  "ebay/sandbox": typeof ebay_sandbox;
  "ebay/types": typeof ebay_types;
  ebayAuth: typeof ebayAuth;
  ebaySetup: typeof ebaySetup;
  generateListing: typeof generateListing;
  http: typeof http;
  identify: typeof identify;
  imageCrop: typeof imageCrop;
  items: typeof items;
  listingPublish: typeof listingPublish;
  listings: typeof listings;
  "marketplace/ebay": typeof marketplace_ebay;
  "marketplace/ebayXml": typeof marketplace_ebayXml;
  "marketplace/mock": typeof marketplace_mock;
  "marketplace/provider": typeof marketplace_provider;
  "marketplace/types": typeof marketplace_types;
  masks: typeof masks;
  mockDetection: typeof mockDetection;
  money: typeof money;
  offers: typeof offers;
  priceResearch: typeof priceResearch;
  research: typeof research;
  "segmentation/fal": typeof segmentation_fal;
  "segmentation/index": typeof segmentation_index;
  "segmentation/mock": typeof segmentation_mock;
  "segmentation/openai": typeof segmentation_openai;
  "segmentation/types": typeof segmentation_types;
  users: typeof users;
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

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
