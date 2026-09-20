// @vitest-environment edge-runtime
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { fakeEbay, type FakeHandlers } from "../ebay/fakeFetch";
import {
  notificationBody,
  notificationPublicKeyPem,
  notificationSignatureDer,
  notificationUserId,
  otherPublicKeyPem,
} from "../ebay/notificationVector";
import { createUser, newTest, type TestConvex } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const header = (signature: string, kid = "test-kid") =>
  btoa(JSON.stringify({ alg: "ecdsa", kid, signature, digest: "SHA1" }));

const tokenHandler: FakeHandlers = {
  "POST /identity/v1/oauth2/token": () => ({
    status: 200,
    json: { access_token: "app-token", expires_in: 7200, token_type: "Application Access Token" },
  }),
};

const keyHandler = (pem: string): FakeHandlers => ({
  ...tokenHandler,
  "GET /commerce/notification/v1/public_key/test-kid": () => ({
    status: 200,
    json: { algorithm: "ECDSA", digest: "SHA1", key: pem },
  }),
});

async function withEbayEnv<T>(run: () => Promise<T>): Promise<T> {
  process.env.EBAY_MODE = "sandbox";
  process.env.EBAY_CLIENT_ID = "client-id";
  process.env.EBAY_CLIENT_SECRET = "client-secret";
  try {
    return await run();
  } finally {
    delete process.env.EBAY_MODE;
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
  }
}

async function connectionFor(t: TestConvex, email: string, ebayUserId: string) {
  const user = await createUser(t, email);
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("ebayConnections", {
      userId: user.userId,
      accessToken: "token",
      refreshToken: "refresh",
      accessTokenExpiresAt: now + 3_600_000,
      mode: "sandbox",
      connectedAt: now,
      updatedAt: now,
      shipFromPostalCode: "94105",
      ebayUserId,
    });
  });
  return user;
}

const remaining = async (t: TestConvex) =>
  await t.run(async (ctx) => (await ctx.db.query("ebayConnections").take(50)).map((row) => row.ebayUserId));

describe("eBay account-deletion notifications", () => {
  it("deletes only the matching seller's connection when the signature is valid", async () => {
    const t = newTest();
    await connectionFor(t, "alice@example.com", notificationUserId);
    await connectionFor(t, "bob@example.com", "someone-else");
    fakeEbay(keyHandler(notificationPublicKeyPem));

    const result = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: notificationBody,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    expect(result).toEqual({ status: 200 });
    expect(await remaining(t)).toEqual(["someone-else"]);
  });

  it("acknowledges a valid notification for a seller we do not know", async () => {
    const t = newTest();
    await connectionFor(t, "bob@example.com", "someone-else");
    fakeEbay(keyHandler(notificationPublicKeyPem));

    const result = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: notificationBody,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    expect(result).toEqual({ status: 200 });
    expect(await remaining(t)).toEqual(["someone-else"]);
  });

  it("refuses a tampered body and deletes nothing", async () => {
    const t = newTest();
    await connectionFor(t, "alice@example.com", notificationUserId);
    fakeEbay(keyHandler(notificationPublicKeyPem));

    const result = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: `${notificationBody} `,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    expect(result).toEqual({ status: 412 });
    expect(await remaining(t)).toEqual([notificationUserId]);
  });

  it("refuses a signature that does not match eBay's key", async () => {
    const t = newTest();
    await connectionFor(t, "alice@example.com", notificationUserId);
    fakeEbay(keyHandler(otherPublicKeyPem));

    const result = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: notificationBody,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    expect(result).toEqual({ status: 412 });
    expect(await remaining(t)).toEqual([notificationUserId]);
  });

  it("refuses a missing or malformed signature header without calling eBay", async () => {
    const t = newTest();
    await connectionFor(t, "alice@example.com", notificationUserId);
    const calls = fakeEbay(keyHandler(notificationPublicKeyPem));

    const missing = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, { body: notificationBody }),
    );
    const malformed = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, { body: notificationBody, signatureHeader: "garbage!!" }),
    );

    expect(missing).toEqual({ status: 412 });
    expect(malformed).toEqual({ status: 412 });
    expect(calls).toHaveLength(0);
    expect(await remaining(t)).toEqual([notificationUserId]);
  });

  it("caches eBay's public key instead of fetching it every time", async () => {
    const t = newTest();
    const calls = fakeEbay(keyHandler(notificationPublicKeyPem));
    const args = { body: notificationBody, signatureHeader: header(notificationSignatureDer) };

    await withEbayEnv(async () => {
      await t.action(internal.ebayNotifications.handle, args);
      await t.action(internal.ebayNotifications.handle, args);
    });

    expect(calls.filter((call) => call.path.includes("/public_key/"))).toHaveLength(1);
  });

  it("asks eBay to retry when its key service is down, and refuses an unknown key ID", async () => {
    const t = newTest();
    await connectionFor(t, "alice@example.com", notificationUserId);

    fakeEbay({
      ...tokenHandler,
      "GET /commerce/notification/v1/public_key/test-kid": () => ({ status: 500, json: {} }),
    });
    const down = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: notificationBody,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    fakeEbay({
      ...tokenHandler,
      "GET /commerce/notification/v1/public_key/test-kid": () => ({ status: 404, json: {} }),
    });
    const unknown = await withEbayEnv(() =>
      t.action(internal.ebayNotifications.handle, {
        body: notificationBody,
        signatureHeader: header(notificationSignatureDer),
      }),
    );

    expect(down).toEqual({ status: 500 });
    expect(unknown).toEqual({ status: 412 });
    expect(await remaining(t)).toEqual([notificationUserId]);
  });
});
