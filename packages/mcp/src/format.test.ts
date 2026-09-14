import { test } from "node:test";
import assert from "node:assert/strict";
import { contractUrl, fromStroops, shortAddr, toStroops, txUrl } from "./format.js";

test("toStroops parses decimals with 7-digit precision", () => {
  assert.equal(toStroops("1"), 10_000_000n);
  assert.equal(toStroops("2.5"), 25_000_000n);
  assert.equal(toStroops("0.0000001"), 1n);
  assert.equal(toStroops("12.34567891"), 123_456_789n); // extra digits truncated, not rounded
  assert.equal(toStroops(" 3 "), 30_000_000n);
});

test("toStroops rejects garbage and negatives", () => {
  assert.throws(() => toStroops("abc"));
  assert.throws(() => toStroops("-1"));
  assert.throws(() => toStroops(""));
  assert.throws(() => toStroops("1e5"));
});

test("fromStroops renders whole + trimmed fraction", () => {
  assert.equal(fromStroops(10_000_000n), "1");
  assert.equal(fromStroops(25_000_000n), "2.5");
  assert.equal(fromStroops(1n), "0.0000001");
  assert.equal(fromStroops(0n), "0");
  assert.equal(fromStroops(-15_000_000n), "-1.5");
  assert.equal(fromStroops(123_456_789n, 2), "12.34");
});

test("urls + short address", () => {
  const h = "ab".repeat(32);
  assert.equal(txUrl("testnet", h), `https://stellar.expert/explorer/testnet/tx/${h}`);
  assert.equal(contractUrl("pubnet", "CABC"), "https://stellar.expert/explorer/public/contract/CABC");
  assert.equal(shortAddr("GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6"), "GDPK…NXP6");
  assert.equal(shortAddr("short"), "short");
});
