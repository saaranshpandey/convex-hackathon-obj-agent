# eBay per-seller setup and per-item categories: design

Date: 2026-09-19
Status: design approved in conversation; awaiting spec review before the implementation plan.

## 1. Goal

Make eBay publishing work for any customer who connects their own eBay account, instead of only the developer's seller account:

1. Each seller gets their own shipping location and business policies, created with their own token.
2. Each listing goes into the right eBay category, with that category's required item details and a valid condition.

This closes gaps 2 and 3 from the eBay architecture review. Gap 1 (production keyset instead of sandbox) is separate.

## 2. Decisions

| Question | Decision |
|---|---|
| Ship-from address | Ask each seller for their US ZIP code when they connect eBay |
| Required item details | AI-filled from the photo analysis; unknown values sent as "Does not apply" |
| When the work happens | At publish time inside the background publish job (self-healing) |
| No category found | Fail the listing with a clear message; never fall back to a wrong category |
| Old operator tools (`ebaySetup.ts`) | Deleted; superseded by the new modules |
| Global eBay env vars | `EBAY_MERCHANT_LOCATION_KEY`, `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_CATEGORY_ID` removed from code, dev and prod |

What eBay's sandbox returned for our kinds of items (checked 2026-09-19 with an app token): the category finder gives sensible top suggestions (controller: Controllers & Attachments; monitor: Monitors; desk: Home Office Desks; guitar: Acoustic Guitars; speaker: Audio Docks & Mini Speakers; kettle: Tea Kettles). Required item details differ per category (monitor: Brand, Screen Size; desk: Brand, Color, Item Height, Item Length, Item Width, Type; speaker: Brand, Model, Type, Connectivity; kettle: Brand, Model; guitar: Brand). All were free-text. Valid conditions per category are available from eBay (New, Open box, Used, For parts or not working; kettles also Seller refurbished).

## 3. Design

### 3.1 Seller setup

- Data: `ebayConnections` gains `shipFromPostalCode?: string` and `sellerSetup?: { locationKey, fulfillmentPolicyId, paymentPolicyId, returnPolicyId }`. `ebayOauthStates` gains `postalCode?: string`.
- ZIP flow (real eBay mode only): the UI asks for a ZIP; `ebayAuth.connect({ postalCode })` validates it (`12345` or `12345-6789`), stores it on the one-time state row; `consumeState` returns `{ userId, postalCode }`; the callback passes it to `saveConnection`. Demo mode ignores ZIP.
- `convex/ebay/sellerSetup.ts` (plain fetch functions, no database access):
  - `isValidPostalCode(zip)`, `locationKeyFor(zip)` (returns `roomsale-<zip>`).
  - `ensureSellerSetup({ env, accessToken, postalCode })` returns a `SellerSetup`:
    1. Opt in to `SELLING_POLICY_MANAGEMENT`; an "already opted in" outcome is fine.
    2. Location: `GET /sell/inventory/v1/location/{key}`; on 404, create it with `{ postalCode, country: "US" }`.
    3. Fulfillment, payment and return policies: list the seller's policies for `EBAY_US`, reuse one whose name matches ours (`Roomsale Standard Shipping`, `Roomsale Standard Payment`, `Roomsale Standard Returns`), otherwise create it.
  - Defaults unchanged from today: flat $5 USPS Priority, 3-day handling; payment not immediate; 30-day returns, buyer pays return shipping.
- A stored `sellerSetup` is reused while `sellerSetup.locationKey === locationKeyFor(shipFromPostalCode)`; otherwise the setup is re-run (idempotent) and saved via `internal.ebayAuth.saveSellerSetup`.

### 3.2 Category, condition and item details

Lookups use an app-level token (client credentials), not the seller's.

- `convex/ebay/oauth.ts` gains `getAppAccessToken(env, clientId, clientSecret)`.
- `convex/ebay/categoryRules.ts`:
  - `buildCategoryQuery(identification)`: brand, model and generic name joined (for example "Acer computer monitor"). The generic name is always included because eBay's category finder is text-based and a brand alone gives poor matches.
  - `suggestCategory(appToken, query)`: Taxonomy `get_category_suggestions` on tree `0`; returns the top `{ categoryId, categoryName }` or `null`. If null, retry once with the listing title.
  - `getCategoryRules(appToken, categoryId)`: `get_item_aspects_for_category` for required details (name, mode, allowed values) and Metadata `get_item_condition_policies` for valid condition IDs.
  - `pickCondition(condition, validConditionIds)`: each of our five conditions has an ordered preference list of eBay condition enums; the first whose condition ID is valid for the category wins.
- `convex/ebay/itemDetails.ts`: `fillItemDetails(...)` makes one OpenAI chat call with a strict JSON schema built from the required detail names. Rules: use only stated facts; never guess measurements; unknown becomes "Does not apply"; unknown brand becomes "Unbranded"; where eBay restricts values the answer must match an allowed value. `normalizeDetails(...)` (pure) guarantees every required name has a non-empty value and that restricted values are valid, else "Does not apply".
- Only required details are sent.
- `convex/ebay/prepare.ts`: `resolveListingSpec(...)` composes the above and returns `{ categoryId, categoryName, ebayCondition, aspects }`, or throws `Couldn't find an eBay category for "<query>".`.

### 3.3 Publish flow and cleanup

- `publishOne` in real eBay mode: token (mismatched-mode connection counts as not connected) → require ZIP (else fail: "Reconnect eBay and enter your ZIP code") → ensure seller setup → `resolveListingSpec` → publisher. Demo mode is unchanged and makes no eBay or OpenAI calls.
- `PublishInput` (in `convex/ebay/types.ts`): the publisher receives `categoryId`, `merchantLocationKey` and the three policy IDs from the seller's setup, and `listing.ebayCondition` and `listing.aspects` already resolved. `brand`/`itemType` and the sandbox `CONDITION_MAP` are removed. The inventory item, offer reuse, publish and "retry as Used on error 25021" logic are unchanged.
- Shared eBay request helper (`apiBase`, `ebayRequest`) moves from `convex/ebay/sandbox.ts` to `convex/ebay/http.ts`.
- Delete `convex/ebaySetup.ts`. Remove the five env vars from `convex/convex.config.ts`, dev and prod.
- `ebayAuth.connectionStatus` also returns `configuredMode` and `shipFromPostalCode` (null when absent). In sandbox mode a connection without a ZIP counts as not connected, so existing connections are asked for their ZIP immediately instead of failing at publish.

### 3.4 UI

`EbayConnectButton`, when not connected and `configuredMode` is `sandbox`: a ZIP field beside Connect, prefilled from the stored ZIP; Connect is disabled until the ZIP is valid; server errors shown inline. Demo mode is unchanged.

### 3.5 Testing

- Pure (node env, `tests/ebay/`): `pickCondition`, `isValidPostalCode`, `locationKeyFor`, `normalizeDetails`, `buildCategoryQuery`, response parsers against fixtures captured from the sandbox probe, `ensureSellerSetup` against a faked `fetch` (reuse vs create, no duplicates, opt-in tolerated).
- Convex (`tests/convex/`): ZIP travels through the one-time state to the connection; invalid ZIP rejected; `connectionStatus` reports `configuredMode`; a sandbox-mode publish with no ZIP fails with the clear message.
- Live (owner, real sandbox): reconnect with a ZIP; publish a controller, monitor, desk and speaker and confirm they go live in sensible categories with details filled; connect a second sandbox test user and confirm they get their own policies without touching the first seller's.

### 3.6 Rollout

Dev first (push, live check), then prod on the owner's yes; remove the five env vars on dev and prod; the owner reconnects eBay on prod with a ZIP.

## 4. Risks and open points

- The exact response when a seller is already opted in to policy management is unverified for a brand-new sandbox user; the setup treats non-5xx opt-in outcomes as fine and lets policy creation surface real problems.
- The category is eBay's top suggestion and can occasionally be a near-miss; a review or edit step is out of scope.
- Restricted-list details are best effort; "Does not apply" may be rejected for a restricted-list detail, which surfaces as a publish error.
- Publish gets a few seconds slower (lookups plus one OpenAI call), and only the first publish pays for seller setup.
- OpenAI strict JSON schemas are built from detail names at runtime; names come from eBay, so unusual characters are possible and must be handled by keying the schema on an index rather than the raw name.

## 5. Out of scope

Production eBay keyset and its approvals; shipping cost or package size by item; optional (non-required) details; caching of category lookups; editing category or details before publishing; per-seller policy customization.
