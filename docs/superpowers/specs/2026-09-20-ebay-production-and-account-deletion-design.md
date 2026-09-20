# eBay production mode and account-deletion notifications: design

Date: 2026-09-20
Status: design approved in conversation; awaiting spec review before the implementation plan.

## 1. Goal

Let real customers connect their real eBay accounts:

1. Meet eBay's requirement to handle **marketplace account deletion notifications**, which eBay enforces before it activates a production keyset.
2. Add a **production mode** so prod uses the production keyset and eBay's production hosts, while dev stays on sandbox.

## 2. Decisions

| Question | Decision |
|---|---|
| Deletion requirement | Subscribe with a real endpoint (do not take the exemption: the app stores eBay tokens) |
| Notification authenticity | Verify eBay's `X-EBAY-SIGNATURE` (ECDSA with SHA-1) before acting |
| What a deletion removes | The matching seller's stored eBay connection (tokens, ZIP, setup IDs). The person's own rooms and listing drafts are app data and stay |
| Mode setting | `EBAY_MODE` accepts `mock`, `sandbox`, `production` |
| Demo rooms in production mode | Publish through the simulated publisher, never to real eBay |
| eBay user ID | Saved at connect from the Identity API; if the lookup fails the connection is not saved |
| Rollout | Two prod deploys, each on the owner's yes: (1) endpoint, then the owner registers it in the portal; (2) production mode and settings |

Facts checked against eBay's docs on 2026-09-20: a production keyset activates only after the developer subscribes to or opts out of deletion notifications. eBay validates the endpoint with a GET carrying `challenge_code`. Notifications are signed; the header is base64 JSON (`alg`, `kid`, `signature`, `digest`); only ECDSA with SHA-1 is used; the public key comes from the Notification API by `kid` and should be cached (about an hour). The Identity API is `GET https://apiz.ebay.com/commerce/identity/v1/user/` (sandbox `apiz.sandbox.ebay.com`) with scope `commerce.identity.readonly`.

## 3. Design

### 3.1 Deletion endpoint

- Route `/ebay/account-deletion` in `convex/http.ts`. Registered endpoint URL: `<CONVEX_SITE_URL>/ebay/account-deletion`.
- GET: read `challenge_code`; respond `200` JSON `{ "challengeResponse": <hex SHA-256 of challengeCode + verificationToken + endpointUrl> }`. The token is env `EBAY_DELETION_VERIFICATION_TOKEN` (about 48 random characters, generated once and given to the owner to paste into the portal). Missing token or code: `400`.
- POST: verify the signature, then act.
  - `convex/ebay/notificationSignature.ts` (pure helpers, WebCrypto): `decodeSignatureHeader(header)` returns `{ kid, signature }`; `challengeResponse(code, token, endpoint)`; `verifyEbaySignature({ publicKeyPem, body, signature })` converts eBay's DER signature to raw and verifies ECDSA with SHA-1. Checked on 2026-09-20 on Convex's own runtime with a Node-produced signature (valid accepted, tampered rejected), so no Node action is needed.
  - `convex/ebayNotifications.ts` (internal action `process`, plus a small key cache): fetches the public key for `kid` with an app token (`getPublicKey`, cached in a small `ebayPublicKeys` table for one hour), verifies the raw body, and only on success calls `internal.ebayAuth.deleteByEbayUserId`.
  - Invalid or unverifiable signature: respond `412`, delete nothing. Valid: respond `200` (also when no matching seller exists). eBay unreachable while fetching the key: respond `500` so eBay retries.
- `internal.ebayAuth.deleteByEbayUserId({ ebayUserId })` deletes every `ebayConnections` row with that `ebayUserId`.
- Schema: `ebayConnections.ebayUserId?: string` with index `by_ebayUserId`; new table `ebayPublicKeys` (`kid`, `pem`, `fetchedAt`, index `by_kid`).

### 3.2 Production mode

- `getEbayMode()` returns `"mock" | "sandbox" | "production"`; a new `getEbayEnv()` maps sandbox/production to eBay's `EbayEnv` (`"sandbox" | "production"`). Every hard-coded `"sandbox"` in `convex/http.ts` (callback), `convex/ebayAuth.ts` (`connect`), `convex/listingPublish.ts` (refresh, app token, seller setup, category lookups, publisher input) and `convex/ebay/index.ts` (publisher) uses the mode's environment. Saved connections record their mode (`"production"` for production).
- `oauth.ts` already builds production URLs; the shared request helper already switches hosts. A new `apizBase(env)` gives the Identity API host.
- Scopes: add `commerce.identity.readonly` to the consent request.
- UI: the ZIP field shows whenever `configuredMode !== "mock"`; the review footer says "eBay" for production and "eBay sandbox" for sandbox.
- Demo safety: `contextForPublish` also returns the room's `isDemo`; in production mode a demo room's listing goes through the mock publisher (recorded with mode `mock`, so the live-listing email says "(Demo)").

### 3.3 Saving the eBay user ID

- After the token exchange, the callback calls `GET <apiz>/commerce/identity/v1/user/` with the new access token, reads `userId`, and saves it via `saveConnection` (`ebayUserId`). Failure: the callback shows the error page and saves nothing.
- `connectionStatus`: in production mode a connection counts only with a ZIP and an `ebayUserId`; in sandbox mode only a ZIP is required (older sandbox connections keep working).

### 3.4 Testing

- Pure (node): handshake hash against a known vector; header decoding; signature verification with a generated P-256 key pair (valid passes, tampered body fails, wrong key fails); Identity response parsing.
- Convex (`convex-test`): a valid deletion removes only the matching seller's connection; an unknown user is a no-op; `ebayUserId` and mode travel through connect and callback state; production-mode `connectionStatus` rules; demo room in production mode publishes via the mock path.
- HTTP: GET handshake returns the expected JSON; POST with a bad signature returns 412 and deletes nothing.

### 3.5 Rollout

1. Deploy the endpoint and token to prod (owner's yes). Owner registers endpoint URL, token and an alert email in the portal (Application Keys, production, Alerts and Notifications). eBay sends the handshake; the keyset activates.
2. Deploy production mode (owner's yes). Set on prod: `EBAY_CLIENT_ID` (production App ID), `EBAY_CLIENT_SECRET` (owner, by clipboard), `EBAY_RU_NAME` (production RuName), `EBAY_MODE=production`. Dev unchanged (sandbox).
3. First real test: connect a real eBay account with a ZIP, publish one cheap item, end the listing in Seller Hub.

## 4. Risks and open points

- Publishing in production creates real, live listings that can carry fees; the seller account must be eligible (verified, payments set up, possible new-seller limits).
- The Identity API scope may not be enabled on the production keyset; connect would then fail visibly (invalid scope). The owner confirms scopes in the portal.
- eBay's notification payload fields (`userId`, `username`, `eiasToken`) are taken from eBay's docs and community examples, not verified against a live notification; the endpoint reads `userId` defensively and acknowledges anything it cannot match.
- Sandbox has no equivalent notification setup, so signature verification is tested with generated keys, not live traffic.
- Shipping cost and package size are still placeholders (flat $5, default box); unsuitable for real furniture sales.

## 5. Out of scope

Buyer-offer sync from real eBay (still simulated), real shipping calculation, retrieving notification history, multi-marketplace support, the Application Growth Check.
