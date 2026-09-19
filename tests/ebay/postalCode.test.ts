import { describe, expect, it } from "vitest";
import { isValidPostalCode, locationKeyFor } from "../../convex/ebay/postalCode";

describe("isValidPostalCode", () => {
  it("accepts a 5-digit ZIP, a ZIP+4, and surrounding spaces", () => {
    expect(isValidPostalCode("94105")).toBe(true);
    expect(isValidPostalCode("94105-1234")).toBe(true);
    expect(isValidPostalCode(" 94105 ")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidPostalCode("9410")).toBe(false);
    expect(isValidPostalCode("abcde")).toBe(false);
    expect(isValidPostalCode("94105-12")).toBe(false);
    expect(isValidPostalCode("")).toBe(false);
  });
});

describe("locationKeyFor", () => {
  it("uses only the first five digits, so a ZIP+4 shares its ZIP's location", () => {
    expect(locationKeyFor("94105")).toBe("roomsale-94105");
    expect(locationKeyFor(" 94105-1234 ")).toBe("roomsale-94105");
  });
});
