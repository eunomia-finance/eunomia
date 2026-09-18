import { describe, it, expect } from "vitest";
import { Asset, Networks } from "@stellar/stellar-sdk";
import { ANCHOR_USDC, tokenCodeOf, tokenIdOf } from "./token";
import { XLM_SAC } from "./userTreasury";

describe("token", () => {
  it("pins ANCHOR_USDC to the contract the anchor's issuer derives", () => {
    // The issuer is the one tr-mock-anchor.fly.dev publishes in its stellar.toml. If the
    // anchor ever changes issuers, this fails before a treasury is created over dead money.
    const usdc = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    expect(usdc.contractId(Networks.TESTNET)).toBe(ANCHOR_USDC);
  });

  it("pins XLM_SAC to the native asset's contract", () => {
    expect(Asset.native().contractId(Networks.TESTNET)).toBe(XLM_SAC);
  });

  it("labels a treasury by the token it holds", () => {
    expect(tokenCodeOf(ANCHOR_USDC)).toBe("USDC");
    expect(tokenCodeOf(XLM_SAC)).toBe("XLM");
  });

  it("reads an unknown or missing token as XLM — what every early treasury is", () => {
    expect(tokenCodeOf(undefined)).toBe("XLM");
    expect(tokenCodeOf(null)).toBe("XLM");
    expect(tokenCodeOf("CDCEHPK4OJXVRA4JV7N56GR5SRD5KGGZ55BDSHKODGR72Y4KGS6A3Y2W")).toBe("XLM");
  });

  it("round-trips code and id", () => {
    expect(tokenCodeOf(tokenIdOf("USDC"))).toBe("USDC");
    expect(tokenCodeOf(tokenIdOf("XLM"))).toBe("XLM");
  });
});
