import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, getAppAccessToken, refreshAccessToken } from "../../convex/ebay/oauth";
import { fakeEbay } from "./fakeFetch";

afterEach(() => vi.unstubAllGlobals());

describe("getAppAccessToken", () => {
  it("asks eBay for a client-credentials token and returns it", async () => {
    const calls = fakeEbay({
      "POST /identity/v1/oauth2/token": () => ({
        status: 200,
        json: { access_token: "app-token", expires_in: 7200, token_type: "Application Access Token" },
      }),
    });

    const token = await getAppAccessToken({ env: "sandbox", clientId: "id", clientSecret: "secret" });

    expect(token).toBe("app-token");
    expect(calls).toHaveLength(1);
  });

  it("rejects when eBay refuses the app credentials", async () => {
    fakeEbay({ "POST /identity/v1/oauth2/token": () => ({ status: 401, json: {} }) });

    await expect(
      getAppAccessToken({ env: "sandbox", clientId: "id", clientSecret: "wrong" }),
    ).rejects.toThrow("eBay rejected the app credentials");
  });
});

describe("consent and refresh scopes", () => {
  it("asks for the identity permission at connect", () => {
    const url = buildAuthorizeUrl({ env: "production", clientId: "id", ruName: "ru", state: "s" });

    expect(url).toContain("auth.ebay.com");
    expect(decodeURIComponent(url)).toContain("commerce.identity.readonly");
  });

  it("refreshes with only the original scopes, so older connections still refresh", async () => {
    const calls = fakeEbay({
      "POST /identity/v1/oauth2/token": () => ({ status: 200, json: { access_token: "fresh", expires_in: 7200 } }),
    });

    await refreshAccessToken({ env: "production", clientId: "id", clientSecret: "secret", refreshToken: "r" });

    const sent = decodeURIComponent(String(calls[0].body));
    expect(sent).toContain("sell.inventory");
    expect(sent).toContain("sell.account");
    expect(sent).not.toContain("commerce.identity");
  });
});
