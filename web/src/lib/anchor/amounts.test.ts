import { describe, it, expect } from "vitest";
import { decimalToStroops, stroopsToDecimal } from "./amounts";

describe("decimalToStroops", () => {
  it("converts the anchor's seven-place amounts exactly", () => {
    expect(decimalToStroops("2.0396090")).toBe(20_396_090n);
    expect(decimalToStroops("10.1980454")).toBe(101_980_454n);
  });

  it("pads short fractions and whole numbers", () => {
    expect(decimalToStroops("1.5")).toBe(15_000_000n);
    expect(decimalToStroops("300")).toBe(3_000_000_000n);
    expect(decimalToStroops("0.0000001")).toBe(1n);
  });

  it("does not drift where a float would", () => {
    // Number("0.1") + Number("0.2") style drift is the reason this is not Math.round(x * 1e7).
    expect(decimalToStroops("4.35")).toBe(43_500_000n);
    expect(decimalToStroops("1.1")).toBe(11_000_000n);
  });

  it("accepts trailing zeros past the seventh place, refuses real digits there", () => {
    expect(decimalToStroops("1.50000000")).toBe(15_000_000n);
    expect(() => decimalToStroops("1.00000001")).toThrow(/finer/);
  });

  it("refuses anything that is not a plain non-negative decimal", () => {
    for (const bad of ["", "-1", "1e3", "1,5", "abc", ".5", "1."]) {
      expect(() => decimalToStroops(bad)).toThrow(/not an amount/);
    }
  });
});

describe("stroopsToDecimal", () => {
  it("always writes seven places", () => {
    expect(stroopsToDecimal(20_396_090n)).toBe("2.0396090");
    expect(stroopsToDecimal(1n)).toBe("0.0000001");
    expect(stroopsToDecimal(0n)).toBe("0.0000000");
    expect(stroopsToDecimal(3_000_000_000n)).toBe("300.0000000");
  });

  it("round-trips", () => {
    for (const s of ["2.0396090", "0.0000001", "72.8100000"]) {
      expect(stroopsToDecimal(decimalToStroops(s))).toBe(s);
    }
  });

  it("refuses a negative amount", () => {
    expect(() => stroopsToDecimal(-1n)).toThrow();
  });
});
