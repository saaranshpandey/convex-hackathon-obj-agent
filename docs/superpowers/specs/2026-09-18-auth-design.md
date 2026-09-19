# Auth design: Google sign-in, per-user rooms, per-user emails

Date: 2026-09-18
Status: design approved in conversation; awaiting spec review before the implementation plan.

## 1. Goal

Replace the anonymous browser-UUID identity (`sessionId`) with real sign-in so many people can use one deployment without seeing or changing each other's data.

Today nothing in `convex/` checks who is calling. Identity is a UUID in `localStorage` sent as an argument, and most public functions take only a document id and never check ownership, so anyone holding an id can read or change that data.

## 2. Decisions

| Question | Decision |
|---|---|
| Sign-in method | Google OAuth |
| Auth stack | `@convex-dev/auth` (runs inside Convex; no extra vendor) |
| In scope beyond core | Offer emails go to each user's own Google email; "your listing is live" confirmation email |
| Out of scope | Signed-out demo room; per-user eBay location/policy setup; production eBay; upload/scan emails |
| Existing dev data | Wiped, not migrated (test data; prod is empty) |
| Confirmation email trigger | When a listing goes live |

Core (always included): sign-in, per-user rooms, ownership checks on every public function, per-user eBay connection.

## 3. Design

### 3.1 Sign-in and identity

- Backend: `convex/auth.ts` (Google provider), `convex/auth.config.ts`, auth routes added in `convex/http.ts`, the library's tables (`authTables`, which include `users` with name, email, photo) spread into `schema.ts`.
- Keys are generated headlessly with `jose` (never the interactive wizard). Env per deployment: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`.
- `SITE_URL`: dev `http://localhost:5173`; prod `https://adjoining-gerbil-124.convex.site`.
- Frontend: `ConvexProvider` becomes `ConvexAuthProvider` in `src/main.tsx`. Signed out: one screen, "Continue with Google". Signed in: the current app plus an account menu (name, photo, Sign out). `src/lib/session.ts` and every `sessionId` prop/argument are deleted.
- Rule: the server derives the caller from the login token via `getAuthUserId(ctx)`. No function accepts a user or session id from the client.

### 3.2 Ownership

Chain: user → cleanout (room photo) → items and listings → offers, agent messages, activity. Only `cleanouts` stores an owner: `userId` becomes a required `v.id("users")` (index `by_userId_and_createdAt` keeps its name).

New `convex/access.ts`:

- `requireUserId(ctx)`: throws "Sign in required" when signed out.
- `requireOwnedCleanout / requireOwnedItem / requireOwnedListing`: walk up to the cleanout, compare `cleanout.userId` to the caller, return the document. "Not yours" and "does not exist" produce the same error.
- Actions (`offers.decide`) check through an internal query.

Function-by-function changes:

| File | Functions | Change |
|---|---|---|
| `cleanouts.ts` | `generateUploadUrl`, `start`, `attachImage`, `markUploadFailed`, `retryAnalysis`, `latestForSession` | Require sign-in / ownership; drop `sessionId` args; `latestForSession` becomes `latestForUser` |
| `items.ts` | `toggle`, `setAll`, `rename`, `addManual`, `remove` | Owned-item / owned-cleanout check |
| `research.ts` | `startResearch` | Owned-cleanout check |
| `listings.ts` | `update`, `approve` | Owned-listing check |
| `listingPublish.ts` | `publish`, `publishApproved` | Owned-listing check; use caller's user id for the eBay token; internal `publishOne` carries `userId` |
| `offers.ts` | `listForListing`, `decide`, `simulateBuyerOffer`, `simulateBuyerAcceptsCounter` | Owned-listing check (simulators stay `DEMO_MODE`-gated); `activityMode` returns config only, unchanged |
| `agentMail.ts` | `messagesForListing`; `sendTestPriceDropSuggestion` | Owned-listing check; test hook becomes internal |
| `activity.ts` | `list` | Owned-cleanout check |
| `ebayAuth.ts` | `connect`, `connectionStatus`, `disconnect` | Use caller's user id |
| `demo.ts` | `seedRoom` | Creates the room for the caller |
| `dev.ts` | `resetDemoData` | Deletes only the caller's own data |
| `ebaySetup.ts` | all public actions | Become internal (CLI-only via `npx convex run`); take `userId` |

Left open by design: `/ebay/callback` (protected by the one-time state in 3.3) and `/agentmail/webhook` (Svix signature).

### 3.3 eBay connection per user

- `ebayConnections` is keyed by `userId` (`by_userId` index) instead of `sessionId`.
- The current OAuth `state` is the raw session id, which the callback trusts. With real user ids that would let a crafted link attach one person's eBay account to another user. Fix:
  1. `ebayAuth.connect` (signed-in only) creates a random single-use nonce with `userId` and a 10-minute expiry in a new `ebayOauthStates` table.
  2. The nonce is sent to eBay as `state`.
  3. `/ebay/callback` looks the nonce up, saves tokens for the stored user, deletes the nonce.
  4. Unknown or expired nonce renders the error page.
- Mock mode still connects instantly, per user.
- Known limit (unchanged, out of scope): publishing still uses one seller account's location, policy and category IDs from env vars, and eBay stays sandbox-only. Only accounts able to use those policies can publish.

### 3.4 Emails

- Offer and price-drop emails go to the listing owner's Google email (listing → cleanout → `users.email`). `USER_NOTIFY_EMAIL` is removed. A user with no email on file is skipped and logged.
- Inbound replies are still matched to the listing by AgentMail thread id. Additionally require the sender to match the owner's email, if the webhook payload exposes the sender (verify against a real payload during implementation; if absent, thread id remains the only check).
- New "your listing is live" email: after `markPublished`, an internal action emails the owner the title, price and eBay link. Mock mode labels it "(demo listing)". A send failure never changes the publish result.
- One shared AgentMail inbox sends for everyone; replies route back by thread.

### 3.5 Data and rollout

- Dev data is cleared with a one-off job (with the owner's OK) before the schema change is pushed; prod needs no migration.
- Order: build and verify on dev (real Google sign-in round trip), then configure prod and deploy only on the owner's go-ahead.
- Google OAuth client (Web application). Authorized redirect URIs:
  - `https://scrupulous-newt-316.convex.site/api/auth/callback/google`
  - `https://adjoining-gerbil-124.convex.site/api/auth/callback/google`
- Google consent screen in "Testing" only admits listed test users. Publish it to "In production" so anyone can sign in (basic scopes need no Google verification).
- Prod env: the five auth vars above set on `adjoining-gerbil-124`.

### 3.6 Testing

- Automated (vitest, already in the repo): a two-user suite. User B cannot read, change or delete user A's cleanout, items, listings, offers, messages or eBay connection; signed-out calls fail; the eBay nonce works once and expires.
- Manual: real Google sign-in on dev; then run the `convex-authz` audit skill over the finished code.

## 4. Risks and open points

- AgentMail webhook payload may not include the sender address (see 3.4).
- Convex Auth routes and the static-hosting routes share `http.ts`; confirm on dev that `/api/auth/*` is not shadowed by the static fallback.
- `users.email` should be present for Google accounts but is not guaranteed; email sends must tolerate absence.
- `@convex-dev/auth` is younger than hosted alternatives; there is no built-in admin dashboard for users.

## 5. Out of scope

Signed-out demo room, per-user eBay provisioning, production eBay keys, upload/scan emails, per-user AgentMail inboxes, rate limiting and cost controls (a separate follow-up before opening to the public).
