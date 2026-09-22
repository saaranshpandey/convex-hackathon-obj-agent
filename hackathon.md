# Hackathon log

- **Project:** Roomly
- **Event:** Convex All Gas Hackathon
- **What it does:** Upload one photo of a room, get each sellable object segmented and selectable inside the photo, then price each item, draft eBay listings, publish them to your own eBay account, and handle buyer offers by email.
- **Live app:** https://adjoining-gerbil-124.convex.site
- **Repo:** https://github.com/saaranshpandey/convex-hackathon-obj-agent
- **Frontend:** Convex static hosting
- **Convex deployment:** https://adjoining-gerbil-124.convex.cloud
- **Components:** @convex-dev/static-hosting
- **Convex features:** schema, tables, indexes, queries, mutations, actions, internal functions, scheduled functions, HTTP actions, file storage, realtime queries, environment variables, registered components
- **Auth:** Convex Auth
- **AI models:** gpt-5.6-luna, fal-ai/sam2/image
- **Started:** 2026-09-07T05:06:14Z
- **Last updated:** 2026-09-21T20:54:00Z

## Log

### 2026-09-07 - 9bead84
Built the scanning workspace as the whole product surface: drop in a room photo
or load a bundled demo, see objects outlined directly on the image, and toggle
what goes up for sale by clicking either an outline or its chip. Selection
counts, a contextual detail panel with cropped thumbnails, and sequential reveal
animations all worked against mock detections held in frontend constants. No
backend at this point (`src/App.tsx`, `src/components/PhotoCanvas.tsx`).

### 2026-09-07 - 12e89a7
Moved the app onto Convex and replaced the mock detections with a real pipeline.
Photos go into Convex file storage, then a scheduled action runs OpenAI vision
for labels, confidence and normalized boxes, writes the items, and flips the
cleanout to `objects_found` so the photo is interactive straight away. A second
action refines each box into a true silhouette through fal SAM 2, four at a time
with retry, persisting each mask independently so one failure costs only that
object its outline and never the scan. The browser draws masks on canvas and hit
tests against mask alpha, and users can rename, deselect, delete, or hand-draw
an object the detector missed. Convex features: schema, indexes, queries,
mutations, actions, internal functions, scheduled functions, file storage,
realtime queries (`convex/schema.ts`, `convex/detection.ts`, `convex/masks.ts`,
`convex/segmentation/`, `src/components/ObjectCanvas.tsx`, `src/lib/masks.ts`).

### 2026-09-07 - 433ad38
Added Phase 4: selling agents. Each selected item gets its own job that
identifies it with OpenAI structured outputs (brand and model only when
actually visible, never guessed) then prices it by feeding Firecrawl web
search snippets into a second OpenAI call for a price range, a recommended
price, and up to three cited market comparisons — the rationale it writes
keeps observed evidence separate from inference. Items run independently
(queued → identifying → researching → ready_for_review) so one item's
failure never blocks the others; a status bar shows live per-item progress
and the detail panel shows the full pricing breakdown. Verified against real
OpenAI and Firecrawl calls across three item categories (`convex/research.ts`,
`convex/identify.ts`, `convex/priceResearch.ts`,
`src/components/ResearchStatusBar.tsx`, `src/components/DetailPanel.tsx`).

### 2026-09-07 - 6e76b2e
Added Phase 5: listing generation. Once an item's research completes, one
more automatic stage drafts a marketplace-ready listing — title, description,
category, condition, price — grounded strictly in the identification and
pricing already computed, never inventing a spec the earlier stages didn't
establish. The right panel becomes a "Ready to sell" card list once drafts
exist; clicking Review opens a new overlay drawer (image crop, editable
title/price/condition/description, a collapsed research summary) with Save
and Approve actions and Next/Previous to step through every draft, plus a
fixed bottom bar showing how many listings are ready. Verified against real
OpenAI calls: generated prices matched what Phase 4 had already computed,
and update/approve/bulk actions all persisted correctly with unapproved
drafts left untouched (`convex/generateListing.ts`, `convex/listings.ts`,
`src/components/ReadyToSell.tsx`, `src/components/ListingDrawer.tsx`,
`src/components/ListingsBar.tsx`).

### 2026-09-07 - 23b62b0
Added Phase 6: eBay integration. Users connect a real eBay account through
OAuth — no password is ever collected, only an authorization code and
refreshable tokens — via a popup window and a Convex HTTP endpoint that
receives the callback, so the main tab never navigates away. A mock mode
simulates the same connect-and-publish flow with zero external calls, so the
demo works without eBay sandbox access. Approving a listing and publishing
now creates a real eBay Sell Inventory listing (inventory item → offer →
publish); the mutation claims the job by flipping status inside a
transaction before the eBay call runs, so duplicate clicks can never create
duplicate listings, and failures surface a human-readable message with a
retry action. Cards show the full lifecycle (Ready → Approved → Publishing →
Live on eBay, or Failed) with a direct link to the live listing. Verified
end-to-end in mock mode — connect, publish, duplicate-click rejection,
failed-then-retry, disconnect — plus the sandbox misconfiguration error path;
real sandbox publishing is pending eBay developer credentials
(`convex/ebay/`, `convex/http.ts`, `convex/ebayAuth.ts`,
`convex/listingPublish.ts`, `src/components/EbayConnectButton.tsx`,
`src/components/ListingDrawer.tsx`).

### 2026-09-07 - 9e6c877
Added Phase 7: the selling agent talks to the item's owner by email, and only
when it needs a decision. One AgentMail inbox sends a message for a meaningful
event — an offer worth approving, or a stale listing worth repricing — and the
owner just replies. Inbound replies arrive through a Svix-signed webhook,
get parsed by OpenAI structured outputs into a constrained action
(accept / decline / counter / approve_price_change / unknown, with a confidence
score), and only execute when the model is confident AND the action matches the
question that was actually asked; anything else gets a clarification email
rather than a guess. Each listing's drawer gained an Agent tab that reads as a
conversation instead of raw email. Convex features: HTTP actions, scheduled
functions, actions, mutations, queries, indexes (`convex/agentMail.ts`,
`convex/agentMail/`, `convex/http.ts`, `src/components/AgentTab.tsx`).

### 2026-09-07 - 9d9cb2c
Added Phase 8: marketplace offers behind a provider adapter, so the buy/sell
negotiation works identically whether the offer is simulated or real. An offer
enters through one idempotent ingest keyed on the marketplace's own offer id,
sets the listing's pending decision, and emails the owner. Accepting, declining
and countering all run through a single decision path that the web UI buttons
and an emailed reply both call — there is no second approval route. The outcome
is claimed inside a transaction before the marketplace call, so a double click
loses the race, and a failed call reverts rather than leaving the listing wrong.
Each decision is bound to a specific offer carried on the email thread, so
replying to an older notice can never settle a newer offer, and completing a
sale closes out that item's other open offers the way a marketplace does.
Buyer-initiated Best Offers are Trading-API-only (the REST Sell APIs don't
expose them, and the REST Negotiation API is the opposite direction), so the
real adapter speaks XML; its transport is unverified without eBay credentials,
but its request building and response normalisation are covered by 14 fixture
tests. Demo simulators are gated on a server-side DEMO_MODE rather than hidden
in the client. Convex features: schema, indexes, queries, mutations, actions,
internal functions, scheduled functions (`convex/marketplace/`,
`convex/offers.ts`, `convex/agentMail.ts`, `tests/marketplace/ebayXml.test.ts`,
`src/components/OfferCard.tsx`).

### 2026-09-08 - working tree
Final pass: demo mode, so the product can be walked end to end even when every
external provider is unavailable. "Try demo room" now seeds a room — PS5,
guitar, monitor, chair — and simulates each stage through scheduled Convex
mutations rather than a client timer, so the progression arrives over the same
reactive subscriptions the live pipeline uses; only the image upload touches the
network. The seeded objects reuse the hand-traced outlines already used by the
mock segmentation provider, and the canvas fallback now traces an item's polygon
instead of its bounding box, so they draw as real silhouettes (identical output
for a live box detection, whose polygon is that same rectangle). A demo room is
an ordinary room carrying `isDemo`, shown only as a discreet "Demo" chip, and it
is also what authorises the simulated buyer events — real listings refuse them
without a deployment-wide flag. Added a small toast system with an aria-live
region, currently wired to offer decisions. Verified the whole loop against the
seeded room with no AI calls: scan 1.9s, research to drafts 3.9s, mock publish
0.7s, offer to owner notification 0.1s, counter and buyer acceptance settling
the listing as sold (`convex/demo.ts`, `convex/demoData.ts`, `convex/offers.ts`,
`src/components/Toaster.tsx`, `src/components/ObjectCanvas.tsx`).

### 2026-09-13 - 52aff35
Real eBay publishing works: an approved listing goes out to the eBay sandbox as
an inventory item, an offer and a published listing, and came back with a live
listing URL. Two real failure modes it hit along the way are now handled rather
than surfaced as a dead end. Product photos are cropped to the item's own
bounding box before upload, so an eBay listing shows the object instead of the
whole room (`convex/imageCrop.ts`, jimp). Pricing research is cached by product
identity, so a second unit of the same product — in this room or a later one —
skips both the Firecrawl search and the OpenAI pricing call. The sale flow was
rebuilt around one path: Items and Listings tabs over a single review screen,
with the flow's rules pulled out of the components into a tested helper
(`convex/ebay/sandbox.ts`, `convex/listingPublish.ts`, `convex/priceResearch.ts`,
`convex/schema.ts` `priceResearchCache`, `src/lib/saleFlow.ts`,
`src/components/SaleReview.tsx`, `src/components/WorkspaceTabs.tsx`,
`tests/ui/saleFlow.test.ts`).

### 2026-09-18 - 0deb93e
Added sign-in and made ownership real. Convex Auth with Google replaced the
browser-generated session id, and every surface now derives the caller from the
token: rooms, items, listings, offers and the agent thread all go through one
set of ownership checks, so a second signed-in user asking for someone else's
row gets "Not found" rather than data. eBay connections became per-user, carried
through OAuth on a one-time state code instead of a guessable parameter, and
publishing verifies the listing's owner before it calls eBay. Each owner is
emailed at their own address, an inbound reply is checked against the sender we
wrote to, and going live sends a confirmation. A connection made in one eBay
mode now reads as not connected in the other, so a mode switch asks the user to
reconnect instead of failing mid-publish. Covered by new function tests for
rooms, offers, eBay and email (`convex/auth.ts`, `convex/auth.config.ts`,
`convex/access.ts`, `convex/ebay/oauthState.ts`, `convex/agentMail/sender.ts`,
`src/components/AuthGate.tsx`, `src/components/SignIn.tsx`,
`tests/convex/rooms.test.ts`, `tests/convex/ebay.test.ts`).

### 2026-09-19 - 2c8545d
Publishing stopped depending on one hard-coded seller account. Each seller now
gets their own eBay merchant location and fulfillment, payment and return
policies, created once from the ZIP they enter when connecting and reused after
that; the ZIP travels through eBay's redirect on the same one-time state code.
Each item resolves its own eBay category from its identification, the condition
values that category actually accepts, and the aspects eBay requires for it —
filled from what identification already established and never invented. The
one-off `convex/ebaySetup.ts` script was deleted once the real path covered it.
Category rules, required-detail filling and the resolver each have fixture tests
(`convex/ebay/sellerSetup.ts`, `convex/ebay/categoryRules.ts`,
`convex/ebay/itemDetails.ts`, `convex/ebay/prepare.ts`,
`convex/ebay/postalCode.ts`, `tests/ebay/`).

### 2026-09-20 - 0c802eb
Added production mode, so a real seller can list to real eBay — and with it what
eBay requires before granting production access. Account-deletion notices are
verified against eBay's own signing keys, fetched by key ID and cached, and the
`challenge_code` handshake is served from an HTTP action; a notice that fails
verification is refused with the reason logged rather than silently accepted, and
a verified one deletes that seller's stored connection. Each seller's immutable
eBay user ID is saved at connect time, because that is what a deletion notice is
matched on. A demo room in production is published through the mock publisher, so
seeded objects can never reach real eBay or be billed. Saving an inventory item
retries eBay's 5xx responses and logs what was sent. Convex features: HTTP
actions, actions, internal functions, environment variables
(`convex/ebay/notificationSignature.ts`, `convex/ebayNotifications.ts`,
`convex/ebay/identity.ts`, `convex/ebay/index.ts`, `convex/listingPublish.ts`,
`convex/http.ts`, `tests/convex/ebayNotifications.test.ts`,
`tests/ebay/publisher.test.ts`).

### 2026-09-21 - 012f8a8
Rooms became threads. Every room the signed-in user owns is listed in a rail
alongside the workspace — the way a conversation list works — so an earlier room
stays reachable instead of being replaced by the newest one; opening one loads
that room and the existing flow continues from wherever it left off. Each row
carries a derived status so a glance says whether that sale is done: Scanning,
Preparing, In review, Live · n, Sold. The rail's query returns tallies rather
than documents, and a room can be renamed in place; uploads now title a room
from the filename with its extension dropped. The scanning overlay was rebuilt
so it is actually visible — a bright leading edge with the band trailing behind
it, viewfinder brackets, and a static fallback for reduced-motion users, which
the previous transform-only sweep left blank. Verified with 130 passing tests
including the new room-list, rename and ownership cases (`convex/cleanouts.ts`,
`src/components/RoomRail.tsx`, `src/lib/rooms.ts`, `src/App.tsx`,
`src/components/PhotoCanvas.tsx`, `tests/convex/rooms.test.ts`,
`tests/ui/rooms.test.ts`).

### 2026-09-21 - 76659f6
Replaced the dead wait after "Prepare listings" with a live preparation card.
Every selected item gets a row that moves from Waiting to "Finding price…" to its
price range with a check as its research finishes, under a progress ring that
fills as items complete. The reveal is paced a beat apart so results read one at
a time while the research itself still runs in parallel, up to four items at
once, and the card holds briefly before handing over to review; reduced-motion
users skip the pacing. Starting research is now ignored on the server while a
room's research is already in flight, so a repeated click or a second tab cannot
start overlapping workers. Verified with 134 passing tests including a new one
that demo items are processed together and that a duplicate batch is prevented
(`src/components/PreparationCard.tsx`, `src/components/Workspace.tsx`,
`convex/research.ts`, `src/index.css`, `tests/convex/preparation.test.ts`).
