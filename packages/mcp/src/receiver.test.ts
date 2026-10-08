import { test } from "node:test";
import assert from "node:assert/strict";
import { NETWORKS } from "./network.js";
import { assetFromSacName, lacksTrustline } from "./receiver.js";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const PAYEE = "GB4GJNEZ6KLZNU3TE2CHQFNPOEQL5SHPQ246OMRZRLKVVQNLZCDX2QXZ";
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

test("assetFromSacName reads a Stellar Asset Contract's name()", () => {
  assert.ok(assetFromSacName("native")?.isNative());
  const usdc = assetFromSacName(`USDC:${ISSUER}`);
  assert.equal(usdc?.getCode(), "USDC");
  assert.equal(usdc?.getIssuer(), ISSUER);
  assert.equal(assetFromSacName("My Token"), null);
  assert.equal(assetFromSacName(42), null);
});

// A fake RPC: simulateTransaction answers name(), getLedgerEntries answers the trustline read.
function server(name: string, trustlines: number) {
  const calls = { ledger: 0 };
  const s = {
    simulateTransaction: async () => ({
      // rpc.Api.isSimulationSuccess looks for these fields
      transactionData: {},
      events: [],
      minResourceFee: "0",
      _parsed: true,
      latestLedger: 1,
      result: { auth: [], retval: (await import("@stellar/stellar-sdk")).nativeToScVal(name) },
    }),
    getLedgerEntries: async () => {
      calls.ledger++;
      return { entries: Array.from({ length: trustlines }), latestLedger: 1 };
    },
  };
  return { s: s as never, calls };
}

test("a G… payee with no trustline for an issued token is reported", async () => {
  const { s } = server(`USDC:${ISSUER}`, 0);
  assert.equal(await lacksTrustline(NETWORKS.testnet, TOKEN, PAYEE, s), true);
});

test("contracts, the native token and the issuer itself are never flagged", async () => {
  const { s, calls } = server(`USDC:${ISSUER}`, 0);
  assert.equal(await lacksTrustline(NETWORKS.testnet, TOKEN, "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", s), false);
  assert.equal(await lacksTrustline(NETWORKS.testnet, TOKEN, ISSUER, s), false);
  assert.equal(calls.ledger, 0);
});

test("an RPC failure answers false — the contract keeps the final word", async () => {
  const s = {
    simulateTransaction: async () => {
      throw new Error("rpc down");
    },
  } as never;
  assert.equal(await lacksTrustline(NETWORKS.testnet, "CBADTOKEN", PAYEE, s), false);
});
