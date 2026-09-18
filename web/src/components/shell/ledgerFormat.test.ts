import { describe, it, expect } from "vitest";
import { inToken } from "./ledgerFormat";

describe("inToken", () => {
  it("leaves an XLM treasury's rows exactly as written", () => {
    const row = { id: "1", label: "Agent paid 1 XLM to GDOM…QCRT · task 7" };
    expect(inToken(row, "XLM")).toBe(row);
  });

  it("quotes a USDC treasury's amounts in USDC", () => {
    expect(inToken({ label: "Agent paid 1 XLM to GDOM…QCRT · task 7" }, "USDC").label).toBe(
      "Agent paid 1 USDC to GDOM…QCRT · task 7",
    );
    expect(inToken({ label: "GBMZ…GXX5 funded a treasury · 4.0792181 XLM" }, "USDC").label).toBe(
      "GBMZ…GXX5 funded a treasury · 4.0792181 USDC",
    );
  });

  it("touches amounts only — not the word on its own", () => {
    expect(inToken({ label: "Wallet funded with testnet XLM" }, "USDC").label).toBe("Wallet funded with testnet XLM");
  });

  it("keeps every other field of the row", () => {
    const row = { id: "sb-9", kind: "paid", label: "Payment · 2 XLM", txHash: "abc" };
    expect(inToken(row, "USDC")).toEqual({ ...row, label: "Payment · 2 USDC" });
  });
});
