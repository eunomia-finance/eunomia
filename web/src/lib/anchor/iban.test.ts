import { describe, it, expect } from "vitest";
import { isValidTrIban, normalizeIban } from "./iban";

describe("isValidTrIban", () => {
  it("accepts a valid Turkish IBAN, with or without the spaces people type", () => {
    expect(isValidTrIban("TR330006100519786457841326")).toBe(true);
    expect(isValidTrIban("tr33 0006 1005 1978 6457 8413 26")).toBe(true);
  });

  it("catches a single mistyped digit — the checksum exists for exactly this", () => {
    expect(isValidTrIban("TR330006100519786457841327")).toBe(false);
    expect(isValidTrIban("TR340006100519786457841326")).toBe(false);
  });

  it("refuses the wrong shape: another country, too short, letters where digits belong", () => {
    expect(isValidTrIban("DE89370400440532013000")).toBe(false);
    expect(isValidTrIban("TR3300061005197864578413")).toBe(false);
    expect(isValidTrIban("TR33000610051978645784132X")).toBe(false);
    expect(isValidTrIban("")).toBe(false);
  });

  it("normalises to the form the anchor expects", () => {
    expect(normalizeIban(" tr33 0006 1005 1978 6457 8413 26 ")).toBe("TR330006100519786457841326");
  });
});
