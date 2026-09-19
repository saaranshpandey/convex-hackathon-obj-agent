import { describe, expect, it } from "vitest";
import { extractAddress, senderMatchesOwner } from "../../convex/agentMail/sender";

describe("extractAddress", () => {
  it("returns a bare address lowercased", () => {
    expect(extractAddress("Owner@Example.com")).toBe("owner@example.com");
  });

  it("pulls the address out of a display-name form", () => {
    expect(extractAddress("Jane Doe <Jane@Example.com>")).toBe("jane@example.com");
  });
});

describe("senderMatchesOwner", () => {
  it("accepts the owner's address in any case or display-name form", () => {
    expect(senderMatchesOwner("Jane <JANE@example.com>", "jane@example.com")).toBe(true);
  });

  it("rejects a different sender", () => {
    expect(senderMatchesOwner("mallory@example.com", "jane@example.com")).toBe(false);
  });

  it("allows a reply whose sender the webhook did not include", () => {
    expect(senderMatchesOwner(undefined, "jane@example.com")).toBe(true);
  });

  it("rejects a reply when the owner has no email on file", () => {
    expect(senderMatchesOwner("jane@example.com", null)).toBe(false);
  });
});
