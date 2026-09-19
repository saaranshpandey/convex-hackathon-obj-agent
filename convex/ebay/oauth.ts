/**
 * eBay's OAuth Identity API: builds the consent URL, exchanges an
 * authorization code for tokens, and refreshes an expired access token.
 * Identical for mock and sandbox — mock mode simply never calls these.
 */

import { EbayError, type EbayEnv, type EbayAccessToken, type EbayTokens } from "./types";

// sell.account is needed to provision the merchant location and the
// fulfillment/payment/return business policies that publishing requires.
const SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
].join(" ");

function authBase(env: EbayEnv): string {
  return env === "production" ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com";
}

function apiBase(env: EbayEnv): string {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

export function buildAuthorizeUrl(input: {
  env: EbayEnv;
  clientId: string;
  ruName: string;
  state: string;
}): string {
  const url = new URL(`${authBase(input.env)}/oauth2/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.ruName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", input.state);
  return url.toString();
}

async function postTokenRequest(
  env: EbayEnv,
  clientId: string,
  clientSecret: string,
  body: URLSearchParams,
): Promise<{ access_token: string; refresh_token?: string; expires_in: number; refresh_token_expires_in?: number }> {
  const response = await fetch(`${apiBase(env)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new EbayError(
        "eBay rejected the app credentials. Check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.",
        401,
      );
    }
    throw new EbayError(
      `eBay token request failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
  };

  if (!payload.access_token || !payload.expires_in) {
    throw new EbayError("eBay returned an unexpected token response.");
  }

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_in: payload.expires_in,
    refresh_token_expires_in: payload.refresh_token_expires_in,
  };
}

export async function exchangeCodeForTokens(input: {
  env: EbayEnv;
  clientId: string;
  clientSecret: string;
  ruName: string;
  code: string;
}): Promise<EbayTokens> {
  const payload = await postTokenRequest(
    input.env,
    input.clientId,
    input.clientSecret,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.ruName,
    }),
  );

  if (!payload.refresh_token) {
    throw new EbayError("eBay did not return a refresh token.");
  }

  const now = Date.now();
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    accessTokenExpiresAt: now + payload.expires_in * 1000,
    refreshTokenExpiresAt: payload.refresh_token_expires_in
      ? now + payload.refresh_token_expires_in * 1000
      : null,
  };
}

/** Refresh responses don't include a new refresh token — the caller keeps
 * whichever one it already had stored. */
export async function refreshAccessToken(input: {
  env: EbayEnv;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<EbayAccessToken> {
  const payload = await postTokenRequest(
    input.env,
    input.clientId,
    input.clientSecret,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      scope: SCOPES,
    }),
  );

  return {
    accessToken: payload.access_token,
    accessTokenExpiresAt: Date.now() + payload.expires_in * 1000,
  };
}

/** App-level token (no user consent) for lookups such as categories and rules. */
export async function getAppAccessToken(input: {
  env: EbayEnv;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const payload = await postTokenRequest(
    input.env,
    input.clientId,
    input.clientSecret,
    new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  );
  return payload.access_token;
}
