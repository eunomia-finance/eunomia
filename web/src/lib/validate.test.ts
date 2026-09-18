import { describe, it, expect } from "vitest";
import { parseOptionalXlmAmount, parseXlmAmount, isValidPaymentDest } from "./validate";

describe("parseXlmAmount", () => {
  it("accepts a positive number", () => {
    expect(parseXlmAmount("12.5")).toEqual({ ok: true, value: 12.5 });
  });
  it("trims surrounding whitespace", () => {
    expect(parseXlmAmount("  3 ")).toEqual({ ok: true, value: 3 });
  });
  it("rejects empty input", () => {
    expect(parseXlmAmount("")).toEqual({ ok: false, msg: "Enter an amount." });
  });
  it("rejects zero and negatives", () => {
    expect(parseXlmAmount("0").ok).toBe(false);
    expect(parseXlmAmount("-1").ok).toBe(false);
  });
  it("rejects non-numeric input", () => {
    expect(parseXlmAmount("abc").ok).toBe(false);
  });
  it("uses the given label in its message", () => {
    expect(parseXlmAmount("", "daily limit")).toEqual({ ok: false, msg: "Enter a daily limit." });
  });
});

describe("parseOptionalXlmAmount", () => {
  it("reads blank and zero as none — the form promises that 0 opens the treasury empty", () => {
    for (const none of ["", "  ", "0", "0.0", "0.0000000"]) {
      expect(parseOptionalXlmAmount(none, "starting funds")).toEqual({ ok: true, value: 0 });
    }
  });
  it("accepts a real amount", () => {
    expect(parseOptionalXlmAmount(" 20 ")).toEqual({ ok: true, value: 20 });
  });
  it("still rejects what is not an amount", () => {
    expect(parseOptionalXlmAmount("-5").ok).toBe(false);
    expect(parseOptionalXlmAmount("abc", "starting funds")).toEqual({
      ok: false,
      msg: "Enter a valid starting funds greater than zero.",
    });
  });
});

describe("isValidPaymentDest", () => {
  // A well-known valid testnet account (StrKey Ed25519 public key).
  const G = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
  it("accepts a valid G… account", () => {
    expect(isValidPaymentDest(G)).toBe(true);
  });
  it("rejects a contract C… address", () => {
    expect(isValidPaymentDest("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC")).toBe(false);
  });
  it("rejects empty and malformed input", () => {
    expect(isValidPaymentDest("")).toBe(false);
    expect(isValidPaymentDest("not-an-address")).toBe(false);
  });
});
