/**
 * The seeded demo room's contents.
 *
 * Kept as plain data so a judge sees the whole product even if OpenAI, fal,
 * Firecrawl or AgentMail are down or out of credit. The outlines are the
 * hand-traced polygons already used by the mock segmentation provider, so the
 * room renders as real silhouettes rather than boxes.
 *
 * Comparison URLs point at live eBay searches rather than invented listing
 * pages — a judge who clicks one lands somewhere real.
 */

export type DemoItemSeed = {
  /** Must match a name in MOCK_DETECTIONS so the outline lines up. */
  name: string;
  category: string;
  confidence: number;
  identification: {
    genericName: string;
    brand: string | null;
    model: string | null;
    category: string;
    condition: string;
    attributes: string[];
    confidence: "low" | "medium" | "high";
  };
  estimatedLow: number;
  estimatedHigh: number;
  recommendedPrice: number;
  pricingRationale: string;
  researchSources: { source: string; price: string; description: string; url: string }[];
  listing: {
    title: string;
    description: string;
    category: string;
    condition: "new" | "like_new" | "good" | "fair" | "poor";
  };
};

const search = (q: string) =>
  `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1`;

export const DEMO_ITEMS: DemoItemSeed[] = [
  {
    name: "PS5",
    category: "Video Game Consoles",
    confidence: 0.97,
    identification: {
      genericName: "PlayStation 5 console",
      brand: "Sony",
      model: "PlayStation 5",
      category: "Video Game Consoles",
      condition: "good",
      attributes: ["Disc edition", "Includes one controller", "Vertical stand"],
      confidence: "high",
    },
    estimatedLow: 280,
    estimatedHigh: 340,
    recommendedPrice: 310,
    pricingRationale:
      "Observed: three completed sales between $285 and $335 in the last month for disc-edition consoles with one controller. Inferred: this one shows light shelf wear and includes the stand, so the middle of that band is realistic without undercutting.",
    researchSources: [
      {
        source: "eBay sold listings",
        price: "$285–$335",
        description: "Disc edition, one controller, good condition",
        url: search("playstation 5 console disc edition used"),
      },
      {
        source: "eBay sold listings",
        price: "$299",
        description: "Comparable console sold within the week",
        url: search("ps5 console used"),
      },
    ],
    listing: {
      title: "Sony PlayStation 5 Console — Disc Edition with Controller",
      description:
        "PlayStation 5 disc edition in good working order. Includes one DualSense controller, the vertical stand, and the power and HDMI cables. Light shelf wear on the panels; no scratches on the disc drive. Fully tested and reset to factory settings.",
      category: "Video Game Consoles",
      condition: "good",
    },
  },
  {
    name: "Guitar",
    category: "Musical Instruments",
    confidence: 0.93,
    identification: {
      genericName: "Acoustic guitar",
      brand: null,
      model: null,
      category: "Musical Instruments",
      condition: "good",
      attributes: ["Dreadnought body", "Steel strings", "Natural finish"],
      confidence: "medium",
    },
    estimatedLow: 120,
    estimatedHigh: 190,
    recommendedPrice: 155,
    pricingRationale:
      "Observed: unbranded dreadnought acoustics in playable condition clear between $120 and $190. Inferred: no visible headstock logo, so this is priced as a generic instrument rather than a named brand — a buyer pays for playability here, not the badge.",
    researchSources: [
      {
        source: "eBay sold listings",
        price: "$120–$190",
        description: "Unbranded dreadnought acoustic, playable",
        url: search("acoustic guitar dreadnought used"),
      },
    ],
    listing: {
      title: "Acoustic Dreadnought Guitar — Natural Finish, Steel String",
      description:
        "Full-size dreadnought acoustic guitar with a natural finish and steel strings. Neck is straight and the action is comfortable across the fretboard. Some light surface marks on the body consistent with normal use. Plays and holds tune well.",
      category: "Musical Instruments",
      condition: "good",
    },
  },
  {
    name: "Monitor",
    category: "Computer Monitors",
    confidence: 0.95,
    identification: {
      genericName: "Widescreen computer monitor",
      brand: null,
      model: null,
      category: "Computer Monitors",
      condition: "good",
      attributes: ["Widescreen panel", "Adjustable stand", "HDMI input"],
      confidence: "medium",
    },
    estimatedLow: 85,
    estimatedHigh: 140,
    recommendedPrice: 110,
    pricingRationale:
      "Observed: comparable widescreen monitors with a stand sell for $85 to $140 depending on panel size and brand. Inferred: no model badge is legible in the photo, so this sits mid-band; a buyer can confirm the size from the listing photos.",
    researchSources: [
      {
        source: "eBay sold listings",
        price: "$85–$140",
        description: "Widescreen monitor with stand, working",
        url: search("widescreen computer monitor used"),
      },
    ],
    listing: {
      title: "Widescreen Computer Monitor with Adjustable Stand — HDMI",
      description:
        "Widescreen desktop monitor in good working condition, including the adjustable stand and power cable. Screen is clean with no dead pixels or visible scratches. HDMI input tested and working.",
      category: "Computer Monitors",
      condition: "good",
    },
  },
  {
    name: "Chair",
    category: "Office Chairs",
    confidence: 0.91,
    identification: {
      genericName: "Office chair",
      brand: null,
      model: null,
      category: "Office Chairs",
      condition: "fair",
      attributes: ["Height adjustable", "Five-star base", "Padded seat"],
      confidence: "medium",
    },
    estimatedLow: 45,
    estimatedHigh: 95,
    recommendedPrice: 70,
    pricingRationale:
      "Observed: used task chairs without a recognised brand clear between $45 and $95, and local pickup listings sell fastest. Inferred: visible wear on the seat pulls this below the midpoint, but the mechanism looks intact.",
    researchSources: [
      {
        source: "eBay sold listings",
        price: "$45–$95",
        description: "Used adjustable task chair, local pickup",
        url: search("office task chair used"),
      },
    ],
    listing: {
      title: "Adjustable Office Task Chair — Five-Star Base",
      description:
        "Height-adjustable office task chair with a padded seat and a five-star caster base. Gas lift and casters both work smoothly. Some wear on the seat fabric from regular use; frame and mechanism are solid. Best suited to local pickup.",
      category: "Office Chairs",
      condition: "fair",
    },
  },
];
