/**
 * Second stage of the selling agent: turns an identification into a priced
 * listing. Firecrawl supplies observed evidence (raw search snippets); a
 * second OpenAI call turns that evidence into a price range, a recommended
 * price, and at most 3 cited market comparisons — kept explicitly separate
 * from the AI's own inference in the rationale it writes.
 */

import { ResearchError, type IdentificationResult } from "./identify";

const SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const DEFAULT_MODEL = "gpt-5.6-luna";
const PRICING_REASONING_EFFORT = "medium";
const RESULTS_PER_QUERY = 5;
const MAX_RESULTS = 12;
const MAX_SOURCES = 3;

export type ResearchSource = {
  source: string;
  price: string;
  description: string;
  url: string;
};

export type PricingResult = {
  estimatedLow: number;
  estimatedHigh: number;
  recommendedPrice: number;
  rationale: string;
  sources: ResearchSource[];
};

type SearchResult = { query: string; title: string; description: string; url: string };

function buildQueries(identification: IdentificationResult): string[] {
  const subject =
    [identification.brand, identification.model]
      .filter((v): v is string => !!v)
      .join(" ") || identification.genericName;

  return [
    `${subject} used price`,
    `${subject} for sale`,
    `${subject} ${identification.condition} price`,
  ];
}

async function searchOne(apiKey: string, query: string): Promise<SearchResult[]> {
  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      limit: RESULTS_PER_QUERY,
      sources: [{ type: "web" }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new ResearchError(
        "Firecrawl rejected the API key. Check FIRECRAWL_API_KEY in your Convex environment.",
      );
    }
    if (response.status === 429) {
      throw new ResearchError(
        "Firecrawl rate limit reached. Wait a moment and try again.",
        429,
      );
    }
    throw new ResearchError(
      `Firecrawl search failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    data?: { web?: { title?: string; description?: string; url?: string }[] };
  };

  return (payload.data?.web ?? []).flatMap((item) =>
    item.url && item.title
      ? [{ query, title: item.title, description: item.description ?? "", url: item.url }]
      : [],
  );
}

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    out.push(result);
  }
  return out;
}

const PRICING_SYSTEM_PROMPT = `You are a resale pricing analyst. You are given an item identification and a list of raw web search snippets gathered about that item being sold or discussed online.

Using ONLY the evidence in the snippets:
- Estimate a realistic resale price range (estimatedLow, estimatedHigh) for a used item in the described condition.
- Give one recommendedPrice within that range.
- Write a short (1-2 sentence) rationale that says what the evidence showed and where you had to infer rather than observe.
- Choose at most 3 of the most relevant, credible snippets as market comparisons. For each, give: source (the site or publisher name), price (the price mentioned in that snippet, or "Not listed" if none is mentioned), description (a one-sentence description of what that source shows), and url (copied exactly from the snippet).

If the snippets contain little or no useful pricing evidence, keep the range wide, say so plainly in the rationale, and return fewer (or zero) sources rather than inventing one.

Never quote or repeat large blocks of the raw snippet text — summarize in your own words.`;

const PRICING_SCHEMA = {
  type: "object",
  properties: {
    estimatedLow: { type: "number" },
    estimatedHigh: { type: "number" },
    recommendedPrice: { type: "number" },
    rationale: { type: "string" },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          price: { type: "string" },
          description: { type: "string" },
          url: { type: "string" },
        },
        required: ["source", "price", "description", "url"],
        additionalProperties: false,
      },
    },
  },
  required: ["estimatedLow", "estimatedHigh", "recommendedPrice", "rationale", "sources"],
  additionalProperties: false,
} as const;

function buildPricingPrompt(
  identification: IdentificationResult,
  evidence: SearchResult[],
): string {
  const header =
    `Item: ${identification.genericName}` +
    (identification.brand ? `, brand: ${identification.brand}` : "") +
    (identification.model ? `, model: ${identification.model}` : "") +
    `\nCondition: ${identification.condition}`;

  const body =
    evidence.length === 0
      ? "No search snippets were found for this item."
      : evidence
          .map((e, i) => `${i + 1}. [${e.query}] ${e.title} — ${e.description} (${e.url})`)
          .join("\n");

  return `${header}\n\nSearch snippets:\n${body}`;
}

export async function priceItem(input: {
  firecrawlApiKey: string;
  openaiApiKey: string;
  model?: string;
  identification: IdentificationResult;
}): Promise<PricingResult> {
  const queries = buildQueries(input.identification);
  const settled = await Promise.allSettled(
    queries.map((q) => searchOne(input.firecrawlApiKey, q)),
  );

  const collected = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (collected.length === 0) {
    const failure = settled.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (failure) {
      throw failure.reason instanceof Error
        ? failure.reason
        : new ResearchError("Firecrawl search failed.");
    }
  }

  const evidence = dedupeByUrl(collected).slice(0, MAX_RESULTS);
  const model = input.model ?? DEFAULT_MODEL;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning_effort: PRICING_REASONING_EFFORT,
      messages: [
        { role: "system", content: PRICING_SYSTEM_PROMPT },
        { role: "user", content: buildPricingPrompt(input.identification, evidence) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "resale_pricing",
          strict: true,
          schema: PRICING_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new ResearchError(
        "OpenAI rejected the API key. Check OPENAI_API_KEY in your Convex environment.",
      );
    }
    if (response.status === 429) {
      throw new ResearchError(
        "OpenAI rate limit reached. Wait a moment and try again.",
        429,
      );
    }
    throw new ResearchError(
      `OpenAI pricing request failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string; refusal?: string } }[];
  };

  const message = payload.choices?.[0]?.message;
  if (message?.refusal) {
    throw new ResearchError("The model declined to produce a pricing estimate.");
  }

  const content = message?.content;
  if (!content) {
    throw new ResearchError("OpenAI returned an empty pricing response.");
  }

  let parsed: Partial<PricingResult>;
  try {
    parsed = JSON.parse(content) as Partial<PricingResult>;
  } catch {
    throw new ResearchError(
      "OpenAI returned a pricing response that was not valid JSON.",
    );
  }

  if (
    typeof parsed.estimatedLow !== "number" ||
    typeof parsed.estimatedHigh !== "number" ||
    typeof parsed.recommendedPrice !== "number" ||
    typeof parsed.rationale !== "string" ||
    !Array.isArray(parsed.sources)
  ) {
    throw new ResearchError("OpenAI returned pricing in an unexpected shape.");
  }

  const low = Math.max(0, Math.min(parsed.estimatedLow, parsed.estimatedHigh));
  const high = Math.max(low, parsed.estimatedHigh);
  const recommended = Math.min(Math.max(parsed.recommendedPrice, low), high);

  const sources: ResearchSource[] = parsed.sources
    .filter(
      (s): s is ResearchSource =>
        !!s &&
        typeof s.source === "string" &&
        typeof s.price === "string" &&
        typeof s.description === "string" &&
        typeof s.url === "string",
    )
    .slice(0, MAX_SOURCES);

  return {
    estimatedLow: Math.round(low),
    estimatedHigh: Math.round(high),
    recommendedPrice: Math.round(recommended),
    rationale: parsed.rationale,
    sources,
  };
}
