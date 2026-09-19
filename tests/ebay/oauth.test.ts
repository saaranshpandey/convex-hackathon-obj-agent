import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppAccessToken } from "../../convex/ebay/oauth";
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
