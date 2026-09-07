# Hackathon log

- **Project:** Roomsale
- **Event:** Convex All Gas Hackathon
- **What it does:** Upload one photo of a room, get each sellable object segmented and selectable inside the photo, and choose what to put up for sale.
- **Live app:** not deployed
- **Repo:** https://github.com/saaranshpandey/convex-hackathon-obj-agent
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** none
- **Convex features:** schema, tables, indexes, queries, mutations, actions, internal functions, scheduled functions, file storage, realtime queries
- **Auth:** none
- **AI models:** gpt-5.6-luna, fal-ai/sam2/image
- **Started:** 2026-09-07T05:06:14Z
- **Last updated:** 2026-09-07T07:42:32Z

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
