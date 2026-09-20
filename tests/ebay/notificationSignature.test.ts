import { describe, expect, it } from "vitest";
import {
  challengeResponse,
  decodeSignatureHeader,
  readDeletedUserId,
  verifyEbaySignature,
} from "../../convex/ebay/notificationSignature";
import {
  handshakeHash,
  notificationBody,
  notificationPublicKeyPem,
  notificationSignatureDer,
  notificationUserId,
  otherPublicKeyPem,
} from "./notificationVector";

describe("challengeResponse", () => {
  it("is the SHA-256 hex of code + token + endpoint", async () => {
    expect(
      await challengeResponse("abc", "token123", "https://example.convex.site/ebay/account-deletion"),
    ).toBe(handshakeHash);
  });
});

describe("decodeSignatureHeader", () => {
  const header = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

  it("reads the key ID and signature from the base64 JSON header", () => {
    expect(
      decodeSignatureHeader(header({ alg: "ecdsa", kid: "k1", signature: "c2ln", digest: "SHA1" })),
    ).toEqual({ kid: "k1", signature: "c2ln" });
  });

  it("returns null for anything unusable", () => {
    expect(decodeSignatureHeader(undefined)).toBeNull();
    expect(decodeSignatureHeader(null)).toBeNull();
    expect(decodeSignatureHeader("")).toBeNull();
    expect(decodeSignatureHeader("not base64!!")).toBeNull();
    expect(decodeSignatureHeader(header({ alg: "ecdsa", signature: "c2ln" }))).toBeNull();
    expect(decodeSignatureHeader(header({ kid: "k1" }))).toBeNull();
  });
});

describe("verifyEbaySignature", () => {
  it("accepts a genuine eBay-style signature", async () => {
    expect(
      await verifyEbaySignature({
        publicKeyPem: notificationPublicKeyPem,
        body: notificationBody,
        signature: notificationSignatureDer,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", async () => {
    expect(
      await verifyEbaySignature({
        publicKeyPem: notificationPublicKeyPem,
        body: `${notificationBody} `,
        signature: notificationSignatureDer,
      }),
    ).toBe(false);
  });

  it("rejects a signature checked against a different key", async () => {
    expect(
      await verifyEbaySignature({
        publicKeyPem: otherPublicKeyPem,
        body: notificationBody,
        signature: notificationSignatureDer,
      }),
    ).toBe(false);
  });

  it("returns false, without throwing, for garbage input", async () => {
    expect(
      await verifyEbaySignature({ publicKeyPem: notificationPublicKeyPem, body: notificationBody, signature: "AAAA" }),
    ).toBe(false);
    expect(
      await verifyEbaySignature({ publicKeyPem: "not a key", body: notificationBody, signature: notificationSignatureDer }),
    ).toBe(false);
  });

  it("accepts a key with no line breaks, as eBay may return it", async () => {
    const oneLine = notificationPublicKeyPem.replace(/\n/g, "");
    expect(
      await verifyEbaySignature({ publicKeyPem: oneLine, body: notificationBody, signature: notificationSignatureDer }),
    ).toBe(true);
  });
});

describe("readDeletedUserId", () => {
  it("reads the eBay user ID from a deletion notification", () => {
    expect(readDeletedUserId(notificationBody)).toBe(notificationUserId);
  });

  it("ignores other topics, missing IDs and invalid JSON", () => {
    expect(readDeletedUserId(JSON.stringify({ metadata: { topic: "OTHER" }, notification: { data: { userId: "x" } } }))).toBeNull();
    expect(readDeletedUserId(JSON.stringify({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: { data: {} } }))).toBeNull();
    expect(readDeletedUserId("{not json")).toBeNull();
  });
});
