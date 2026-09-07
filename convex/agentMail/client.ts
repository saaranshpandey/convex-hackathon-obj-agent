/**
 * Plain REST client for AgentMail — inbox creation, sending, and webhook
 * management. No SDK dependency; every call is a direct fetch, matching
 * this codebase's existing style for external APIs.
 */

const BASE_URL = "https://api.agentmail.to";
/** Fixed so re-running setup returns the same inbox instead of a new one. */
const INBOX_CLIENT_ID = "roomsale-owner-inbox";

async function agentMailRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new Error("AgentMail rejected the API key. Check AGENTMAIL_API_KEY.");
    }
    throw new Error(`AgentMail ${method} ${path} failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export async function getOrCreateInbox(apiKey: string): Promise<{ inboxId: string; email: string }> {
  const payload = await agentMailRequest(apiKey, "POST", "/v0/inboxes", {
    client_id: INBOX_CLIENT_ID,
    display_name: "Roomsale selling agent",
  });

  const inboxId = payload.inbox_id;
  const email = payload.email;
  if (typeof inboxId !== "string" || typeof email !== "string") {
    throw new Error("AgentMail returned an unexpected inbox response.");
  }

  return { inboxId, email };
}

export async function sendMessage(
  apiKey: string,
  inboxId: string,
  input: { to: string; subject: string; text: string },
): Promise<{ messageId: string; threadId: string }> {
  const payload = await agentMailRequest(apiKey, "POST", `/v0/inboxes/${inboxId}/messages/send`, input);

  const messageId = payload.message_id;
  const threadId = payload.thread_id;
  if (typeof messageId !== "string" || typeof threadId !== "string") {
    throw new Error("AgentMail returned an unexpected send response.");
  }

  return { messageId, threadId };
}

export type AgentMailWebhook = { webhookId: string; url: string; eventTypes: string[] };

export async function listWebhooks(apiKey: string): Promise<AgentMailWebhook[]> {
  const payload = await agentMailRequest(apiKey, "GET", "/v0/webhooks");
  const webhooks = payload.webhooks;
  if (!Array.isArray(webhooks)) return [];

  return webhooks.flatMap((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).webhook_id !== "string" ||
      typeof (entry as Record<string, unknown>).url !== "string"
    ) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    return [
      {
        webhookId: record.webhook_id as string,
        url: record.url as string,
        eventTypes: Array.isArray(record.event_types) ? (record.event_types as string[]) : [],
      },
    ];
  });
}

export async function createWebhook(
  apiKey: string,
  input: { url: string },
): Promise<{ webhookId: string; secret: string }> {
  const payload = await agentMailRequest(apiKey, "POST", "/v0/webhooks", {
    url: input.url,
    event_types: ["message.received"],
    client_id: "roomsale-inbound-webhook",
  });

  const webhookId = payload.webhook_id;
  const secret = payload.secret;
  if (typeof webhookId !== "string" || typeof secret !== "string") {
    throw new Error("AgentMail returned an unexpected webhook response.");
  }

  return { webhookId, secret };
}
