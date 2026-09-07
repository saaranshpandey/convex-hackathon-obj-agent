/**
 * Turns one owner reply email into the spec's exact safe action schema.
 * Told what's actually pending so it can reject a reply that doesn't match
 * (e.g. "ACCEPT" when a price-drop suggestion, not an offer, is pending).
 */

const DEFAULT_MODEL = "gpt-5.6-luna";
const REASONING_EFFORT = "low";

export type ParsedAction = {
  action: "accept" | "decline" | "counter" | "approve_price_change" | "unknown";
  amount?: number;
  confidence: number;
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["accept", "decline", "counter", "approve_price_change", "unknown"],
    },
    amount: { type: ["number", "null"] },
    confidence: { type: "number" },
  },
  required: ["action", "amount", "confidence"],
  additionalProperties: false,
} as const;

function systemPrompt(pending: { kind: "offer" | "price_drop"; amount: number }): string {
  const context =
    pending.kind === "offer"
      ? `A buyer offered $${pending.amount} on this item. The owner was asked to reply ACCEPT, COUNTER <amount>, or DECLINE.`
      : `The agent suggested dropping the price to $${pending.amount} after no interest. The owner was asked to reply YES or KEEP.`;

  return `You read one email reply from an item owner to their AI selling agent and turn it into a safe, structured action.

${context}

Valid actions:
- "accept": clearly accepts the pending offer. Only valid when an offer is pending.
- "decline": clearly rejects whatever is pending — a buyer's offer, or a suggested price drop (e.g. "KEEP", "no", "leave it").
- "counter": proposes a different price for a pending offer. Only valid when an offer is pending. Extract the number into amount.
- "approve_price_change": approves a suggested price drop. Only valid when a price drop is pending.
- "unknown": anything else — a reply that doesn't clearly answer the pending question, an action that doesn't match what's actually pending, or plain ambiguity.

amount is required only for "counter" — a plain number, no currency symbol. Otherwise null.

confidence is 0 to 1: how certain you are this is the correct, complete interpretation. Never invent a confident answer for an ambiguous reply — use "unknown" and a low confidence instead.`;
}

export async function parseReply(input: {
  apiKey: string;
  model?: string;
  replyText: string;
  pendingDecision: { kind: "offer" | "price_drop"; amount: number };
}): Promise<ParsedAction> {
  const model = input.model ?? DEFAULT_MODEL;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning_effort: REASONING_EFFORT,
      messages: [
        { role: "system", content: systemPrompt(input.pendingDecision) },
        { role: "user", content: input.replyText },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "owner_reply_action", strict: true, schema: RESPONSE_SCHEMA },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}) while parsing a reply.`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string; refusal?: string } }[];
  };

  const message = payload.choices?.[0]?.message;
  if (message?.refusal) {
    throw new Error("The model declined to parse this reply.");
  }

  const content = message?.content;
  if (!content) throw new Error("OpenAI returned an empty response while parsing a reply.");

  const parsed = JSON.parse(content) as { action?: string; amount?: number | null; confidence?: number };

  const validActions = ["accept", "decline", "counter", "approve_price_change", "unknown"];
  if (
    typeof parsed.action !== "string" ||
    !validActions.includes(parsed.action) ||
    typeof parsed.confidence !== "number"
  ) {
    throw new Error("OpenAI returned an action in an unexpected shape.");
  }

  return {
    action: parsed.action as ParsedAction["action"],
    amount: typeof parsed.amount === "number" ? parsed.amount : undefined,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
  };
}
