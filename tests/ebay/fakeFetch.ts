import { vi } from "vitest";

export type FakeCall = { method: string; path: string; query: string; body: unknown };
export type FakeReply = { status: number; json?: unknown };
export type FakeHandlers = Record<string, (call: FakeCall) => FakeReply>;

/** JSON bodies are parsed; form-encoded ones (eBay's token endpoint) stay raw text. */
function readBody(raw: unknown): unknown {
  if (typeof raw !== "string" || raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Replaces global fetch with a router keyed by `<METHOD> <pathname>`. Any
 * unrouted request answers 599 so a missing handler fails loudly.
 */
export function fakeEbay(handlers: FakeHandlers): FakeCall[] {
  const calls: FakeCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const call: FakeCall = {
        method,
        path: url.pathname,
        query: url.search,
        body: readBody(init?.body),
      };
      calls.push(call);

      const handler = handlers[`${method} ${url.pathname}`];
      if (!handler) return new Response(`no handler for ${method} ${url.pathname}`, { status: 599 });

      const reply = handler(call);
      return new Response(reply.json === undefined ? null : JSON.stringify(reply.json), {
        status: reply.status,
      });
    }),
  );

  return calls;
}
