# Hackathon log

- **Project:** Roomsale
- **Event:** Convex All Gas Hackathon
- **What it does:** Upload one photo of a room, get each sellable object segmented and selectable inside the photo, and choose what to put up for sale.
- **Live app:** not deployed
- **Repo:** https://github.com/saaranshpandey/convex-hackathon-obj-agent
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** none
- **Convex features:** schema, tables, indexes, queries, mutations, actions, internal functions, scheduled functions, HTTP actions, file storage, realtime queries
- **Auth:** none
- **AI models:** gpt-5.6-luna, fal-ai/sam2/image
- **Started:** 2026-09-07T05:06:14Z
- **Last updated:** 2026-09-07T22:34:36Z

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
