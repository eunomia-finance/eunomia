import { test } from "node:test";
import assert from "node:assert/strict";
import { unitFromSymbol } from "./unit.js";

test("a Stellar asset's contract names its code; the native one is spelled XLM", () => {
  // Both answers below are what the testnet contracts return to symbol() (read 2026-09-18):
  // USDC's asset contract CBIELTK6… says "USDC", the native one CDLZFC3S… says "native".
  assert.equal(unitFromSymbol("USDC"), "USDC");
  assert.equal(unitFromSymbol("native"), "XLM");
  assert.equal(unitFromSymbol(" EURC "), "EURC");
});

test("anything that is not a symbol is no unit at all — never a guess", () => {
  for (const bad of ["", "   ", undefined, null, 7, {}]) assert.equal(unitFromSymbol(bad), null);
});
