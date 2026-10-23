import { describe, expect, it } from "vitest";
import { isPrivacyVisible } from "./Privacy";
import { BLOCKED_TX } from "./Proof";

describe("landing claims", () => {
  it("shows the privacy section only on testnet", () => {
    expect(isPrivacyVisible("testnet")).toBe(true);
    expect(isPrivacyVisible("pubnet")).toBe(false);
  });

  it("links to a real Stellar transaction hash", () => {
    expect(BLOCKED_TX).toMatch(/^[0-9a-f]{64}$/);
  });
});
