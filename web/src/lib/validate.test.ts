import { describe, it, expect } from "vitest";
import { parseOptionalXlmAmount, parseXlmAmount, isValidPaymentDest } from "./validate";

describe("parseXlmAmount", () => {
  it("accepts decimal points and commas, including one stroop", () => {
    expect(parseXlmAmount("12.5")).toEqual({ ok: true, value: 12.5 });
    expect(parseXlmAmount("12,5")).toEqual({ ok: true, value: 12.5 });
    expect(parseXlmAmount("0.0000001")).toEqual({ ok: true, value: 0.0000001 });
  });
  it("rejects ambiguous thousands-shaped decimal separators", () => {
    for (const input of ["1,000", "1.000"]) {
      expect(parseXlmAmount(input)).toEqual({
        ok: false,
        msg: `The value "${input}" is ambiguous; write 1000 for one thousand or 1.0 for one.`,
      });
    }
  });
  it("trims surrounding whitespace", () => {
    expect(parseXlmAmount("  3 ")).toEqual({ ok: true, value: 3 });
  });
  it("rejects values below one stroop and precision finer than seven decimals", () => {
    expect(parseXlmAmount("0.00000001")).toEqual({
      ok: false,
      msg: "Enter a valid amount greater than zero (up to 7 decimal places).",
    });
    expect(parseXlmAmount("1.00000001").ok).toBe(false);
  });
  it("rejects hexadecimal, exponent, and incomplete decimal forms", () => {
    for (const input of ["0x10", "1e3", ".5", "1.", "1,2.3"]) {
      expect(parseXlmAmount(input).ok).toBe(false);
    }
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
    for (const none of ["", "  ", "0", "0.0", "0.0000000", "0,0"]) {
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
      msg: "Enter a valid starting funds greater than zero (up to 7 decimal places).",
    });
  });
});

describe("isValidPaymentDest", () => {
  // A valid StrKey Ed25519 public key.
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
