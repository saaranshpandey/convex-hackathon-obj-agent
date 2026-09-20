import { afterEach, describe, expect, it } from "vitest";
import { getEbayEnv, getEbayMode } from "../../convex/ebay";

afterEach(() => {
  delete process.env.EBAY_MODE;
});

describe("getEbayMode", () => {
  it("defaults to mock so an unset mode can never block the demo", () => {
    expect(getEbayMode()).toBe("mock");
    process.env.EBAY_MODE = "nonsense";
    expect(getEbayMode()).toBe("mock");
  });

  it("reads sandbox and production, ignoring case and spaces", () => {
    process.env.EBAY_MODE = " Sandbox ";
    expect(getEbayMode()).toBe("sandbox");
    process.env.EBAY_MODE = "PRODUCTION";
    expect(getEbayMode()).toBe("production");
  });
});

describe("getEbayEnv", () => {
  it("is null in demo mode and the mode itself otherwise", () => {
    expect(getEbayEnv()).toBeNull();
    process.env.EBAY_MODE = "sandbox";
    expect(getEbayEnv()).toBe("sandbox");
    process.env.EBAY_MODE = "production";
    expect(getEbayEnv()).toBe("production");
  });
});
