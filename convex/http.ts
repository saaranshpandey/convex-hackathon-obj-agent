import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";
import { exchangeCodeForTokens } from "./ebay/oauth";

const http = httpRouter();

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

export default http;
