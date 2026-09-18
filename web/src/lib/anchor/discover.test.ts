import { describe, it, expect } from "vitest";
import { discoverAnchor, stellarAsset } from "./discover";

const TESTNET = "Test SDF Network ; September 2015";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// The mock anchor's toml as served on 2026-09-18 (v2.7.0).
const toml = () => ({
  VERSION: "2.7.0",
  NETWORK_PASSPHRASE: TESTNET,
  SIGNING_KEY: "GDXYO6FJCNXZEWGXD54GT76FGFYLOLSOGSOJLNQ6WGHCGEQPO7NTE73M",
  WEB_AUTH_ENDPOINT: "https://tr-mock-anchor.fly.dev/auth",
  TRANSFER_SERVER: "https://tr-mock-anchor.fly.dev/sep6",
  KYC_SERVER: "https://tr-mock-anchor.fly.dev/sep12",
  ANCHOR_QUOTE_SERVER: "https://tr-mock-anchor.fly.dev/sep38",
  CURRENCIES: [{ code: "USDC", issuer: ISSUER, anchor_asset: "TRY" }],
});

const serving = (t: Record<string, unknown>) => async () => t;

describe("discoverAnchor", () => {
  it("reads every endpoint, the signing key and the issuer from the toml", async () => {
    const a = await discoverAnchor("tr-mock-anchor.fly.dev", "USDC", TESTNET, serving(toml()));
    expect(a).toMatchObject({
      homeDomain: "tr-mock-anchor.fly.dev",
      signingKey: "GDXYO6FJCNXZEWGXD54GT76FGFYLOLSOGSOJLNQ6WGHCGEQPO7NTE73M",
      webAuth: "https://tr-mock-anchor.fly.dev/auth",
      transfer: "https://tr-mock-anchor.fly.dev/sep6",
      kyc: "https://tr-mock-anchor.fly.dev/sep12",
      quote: "https://tr-mock-anchor.fly.dev/sep38",
      assetIssuer: ISSUER,
    });
    expect(stellarAsset(a)).toBe(`stellar:USDC:${ISSUER}`);
  });

  it("drops a trailing slash so paths join cleanly", async () => {
    const t = { ...toml(), TRANSFER_SERVER: "https://tr-mock-anchor.fly.dev/sep6/" };
    const a = await discoverAnchor("tr-mock-anchor.fly.dev", "USDC", TESTNET, serving(t));
    expect(a.transfer).toBe("https://tr-mock-anchor.fly.dev/sep6");
  });

  it("refuses an anchor on another network", async () => {
    const t = { ...toml(), NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015" };
    await expect(discoverAnchor("x.test", "USDC", TESTNET, serving(t))).rejects.toThrow(/different Stellar network/);
  });

  it("refuses an endpoint without https", async () => {
    const t = { ...toml(), WEB_AUTH_ENDPOINT: "http://tr-mock-anchor.fly.dev/auth" };
    await expect(discoverAnchor("x.test", "USDC", TESTNET, serving(t))).rejects.toThrow(/without https/);
  });

  it("names the missing key when the toml is incomplete", async () => {
    const t: Record<string, unknown> = toml();
    delete t.ANCHOR_QUOTE_SERVER;
    await expect(discoverAnchor("x.test", "USDC", TESTNET, serving(t))).rejects.toThrow(/ANCHOR_QUOTE_SERVER/);
  });

  it("refuses an anchor that does not ramp the asset", async () => {
    await expect(discoverAnchor("x.test", "EURC", TESTNET, serving(toml()))).rejects.toThrow(/does not ramp EURC/);
  });
});
