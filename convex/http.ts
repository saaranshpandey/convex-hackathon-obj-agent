import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { auth } from "./auth";
import { env } from "./_generated/server";
import { exchangeCodeForTokens } from "./ebay/oauth";
import { verifySvixSignature } from "./agentMail/verify";

const http = httpRouter();
auth.addHttpRoutes(http);

function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

/** A self-contained confirmation page — the popup closes itself, no redirect
 * back to a guessed frontend URL is needed. */
function page(ok: boolean, message: string): Response {
  const body = ok ? "eBay connected." : `Couldn't connect eBay: ${escapeHtml(message)}`;
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:48px;color:#141412;">
      <p>${body}</p>
      <p>You can close this window.</p>
      <script>setTimeout(function () { window.close(); }, 1500);</script>
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

http.route({
  path: "/ebay/callback",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

    if (oauthError) return page(false, oauthError);
    if (!code || !state) return page(false, "Missing authorization code.");

    const clientId = env.EBAY_CLIENT_ID?.trim();
    const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
    const ruName = env.EBAY_RU_NAME?.trim();
    if (!clientId || !clientSecret || !ruName) {
      return page(false, "eBay is not fully configured on the server.");
    }

    try {
      const tokens = await exchangeCodeForTokens({
        env: "sandbox",
        clientId,
        clientSecret,
        ruName,
        code,
      });

      await ctx.runMutation(internal.ebayAuth.saveConnection, {
        sessionId: state,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? undefined,
        mode: "sandbox",
      });

      return page(true, "");
    } catch (error) {
      return page(false, error instanceof Error ? error.message : "Connection failed.");
    }
  }),
});

http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const bodyText = await req.text();

    const secret = env.AGENTMAIL_WEBHOOK_SECRET?.trim();
    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");

    if (!secret || !svixId || !svixTimestamp || !svixSignature) {
      return new Response("Missing signature", { status: 400 });
    }

    const valid = await verifySvixSignature({
      secret,
      svixId,
      svixTimestamp,
      svixSignature,
      body: bodyText,
    });
    if (!valid) return new Response("Invalid signature", { status: 401 });

    let payload: unknown;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const body = payload as Record<string, unknown>;
    if (body.event_type !== "message.received") {
      return new Response("ignored", { status: 200 });
    }

    const message = body.message as Record<string, unknown> | undefined;
    const messageId = typeof message?.message_id === "string" ? message.message_id : null;
    const threadId = typeof message?.thread_id === "string" ? message.thread_id : null;
    const text =
      typeof message?.text === "string"
        ? message.text
        : typeof message?.extracted_text === "string"
          ? message.extracted_text
          : null;

    if (!messageId || !threadId || text === null) {
      return new Response("ignored", { status: 200 });
    }

    await ctx.runAction(internal.agentMail.handleInboundReply, { messageId, threadId, text });

    return new Response("ok", { status: 200 });
  }),
});

registerStaticRoutes(http, components.staticHosting);

export default http;
