import { describe, expect, it } from "vitest";
import { payeeLacksTrustline } from "./receivable";
import { ANCHOR_USDC_ISSUER } from "./token";

const PAYEE = "GB4GJNEZ6KLZNU3TE2CHQFNPOEQL5SHPQ246OMRZRLKVVQNLZCDX2QXZ";
const usdcLine = { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ANCHOR_USDC_ISSUER };

describe("payeeLacksTrustline", () => {
  it("flags a G… account that holds no USDC trustline", async () => {
    expect(await payeeLacksTrustline(PAYEE, "USDC", async () => ({ balances: [{ asset_type: "native" }] }))).toBe(true);
  });

  it("passes an account that trusts the anchor's issuer", async () => {
    expect(await payeeLacksTrustline(PAYEE, "USDC", async () => ({ balances: [{ asset_type: "native" }, usdcLine] }))).toBe(false);
  });

  it("does not accept USDC from another issuer as the same asset", async () => {
    const other = { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" };
    expect(await payeeLacksTrustline(PAYEE, "USDC", async () => ({ balances: [other] }))).toBe(true);
  });

  it("flags an account that does not exist", async () => {
    const missing = async () => {
      throw { response: { status: 404 } };
    };
    expect(await payeeLacksTrustline(PAYEE, "USDC", missing)).toBe(true);
  });

  it("never blocks on XLM, contracts, the issuer or a Horizon hiccup", async () => {
    const boom = async () => {
      throw new Error("network");
    };
    expect(await payeeLacksTrustline(PAYEE, "XLM", boom)).toBe(false);
    expect(await payeeLacksTrustline("CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA", "USDC", boom)).toBe(false);
    expect(await payeeLacksTrustline(ANCHOR_USDC_ISSUER, "USDC", boom)).toBe(false);
    expect(await payeeLacksTrustline(PAYEE, "USDC", boom)).toBe(false);
  });
});
