// These tests assert the English sentences; the app language otherwise follows the machine locale.
import { resetLangForTest } from "./i18n";
resetLangForTest("en");

import { describe, it, expect } from "vitest";
import {
  connectErr,
  CONTRACT_ERRORS,
  contractErr,
  depositErr,
  errText,
  isStaleSessionError,
  sendErr,
} from "./wallet-errors";

describe("errText", () => {
  it("returns an Error's message", () => {
    expect(errText(new Error("boom"))).toBe("boom");
  });
  it("extracts a plain SDK error object's message instead of [object Object]", () => {
    // StellarWalletsKit's authModal rejects with a plain object, not an Error — the
    // reason funnel detail was logging "[object Object]" until it used this helper.
    expect(errText({ message: "Modal closed" })).toBe("Modal closed");
    expect(errText({ message: "Modal closed" })).not.toBe("[object Object]");
  });
  it("returns a string error as-is", () => {
    expect(errText("plain string error")).toBe("plain string error");
  });
  it("returns empty (never [object Object]) for a message-less object", () => {
    expect(errText({})).toBe("");
  });
});

describe("connectErr", () => {
  it("maps a not-installed wallet", () => {
    expect(connectErr(new Error("Freighter is not installed"))).toMatch(/isn't installed/);
  });
  it("maps a user rejection / closed modal", () => {
    expect(connectErr(new Error("User rejected the request"))).toBe("Connection cancelled.");
  });
});

describe("sendErr", () => {
  it("maps insufficient balance (op_underfunded)", () => {
    const e = { response: { data: { extras: { result_codes: { operations: ["op_underfunded"] } } } } };
    expect(sendErr(e)).toMatch(/Insufficient balance/);
  });
  it("maps a signature rejection", () => {
    expect(sendErr(new Error("User declined to sign"))).toMatch(/Signature rejected/);
  });
  it("maps a not-yet-funded account (RPC getAccount)", () => {
    expect(sendErr(new Error("Account not found: GDPK…"))).toMatch(/no XLM yet/);
  });
  it("maps insufficient balance from a message (Soroban path)", () => {
    expect(sendErr(new Error("transaction simulation failed: insufficient balance"))).toMatch(
      /Insufficient balance/,
    );
  });
});

describe("contractErr", () => {
  it("maps every contract error code (1..12) to its friendly message", () => {
    for (const code of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(contractErr(`host error: Error(Contract, #${code})`)).toEqual({
        errorCode: code,
        errorMessage: CONTRACT_ERRORS[code],
      });
    }
  });
  it("reads the pause and session-cap rejections as guardrails, not failures", () => {
    expect(contractErr("Error(Contract, #9)")?.errorMessage).toMatch(/paused/i);
    expect(contractErr("Error(Contract, #10)")?.errorMessage).toMatch(/session/i);
  });
  it("surfaces the escrow-locked free-balance rejection (#6) in plain language", () => {
    expect(contractErr("Error(Contract, #6)")?.errorMessage).toMatch(/locked in open escrows/);
  });
  it("falls back to a generic message for an unknown code", () => {
    expect(contractErr("Error(Contract, #42)")).toEqual({
      errorCode: 42,
      errorMessage: "Contract error #42",
    });
  });
  it("returns null for non-contract failures so retry logic stays intact", () => {
    expect(contractErr("tx bad_seq")).toBeNull();
    expect(contractErr("")).toBeNull();
  });
  it("parses the variant without a # prefix", () => {
    expect(contractErr("Error(Contract, 5)")?.errorCode).toBe(5);
  });
});

// A deposit fails inside the token as often as inside the treasury, and the two number their
// errors independently: read as the treasury's, the SAC's short balance (#10) said "over the
// session's spending cap" to someone who was only funding.
describe("depositErr", () => {
  it("keeps the treasury's own deposit refusals", () => {
    expect(depositErr("Error(Contract, #16)", "USDC")).toBe(CONTRACT_ERRORS[16]);
    expect(depositErr("Error(Contract, #1)", "XLM")).toBe(CONTRACT_ERRORS[1]);
  });
  it("reads the token's codes as the token's", () => {
    expect(depositErr("HostError: Error(Contract, #10)", "XLM")).toBe("Your wallet doesn't hold that much XLM.");
    expect(depositErr("HostError: Error(Contract, #13)", "USDC")).toMatch(/needs a USDC trustline/);
    expect(depositErr("Error(Contract, #10)", "USDC")).not.toMatch(/session/i);
    expect(depositErr("Error(Contract, #6)", "USDC")).toMatch(/USDC token refused the deposit \(#6\)/);
  });
  it("leaves a non-contract failure to the caller", () => {
    expect(depositErr("tx bad_seq", "XLM")).toBeNull();
  });
});

// The wallet dropped the WalletConnect session, but the app kept signing against its
// topic. The raw @walletconnect/core text reached the toast verbatim (2026-07-28).
describe("isStaleSessionError", () => {
  it("recognises a deleted WalletConnect session", () => {
    expect(
      isStaleSessionError(
        new Error("Missing or invalid. Record was recently deleted - session: 7e677fb9caa3008f"),
      ),
    ).toBe(true);
  });

  it("recognises an expired session pairing", () => {
    expect(isStaleSessionError(new Error("No matching key. session topic doesn't exist: abc"))).toBe(true);
  });

  it("leaves a normal rejection alone", () => {
    expect(isStaleSessionError(new Error("User declined the request"))).toBe(false);
  });
});

describe("sendErr on a dead session", () => {
  it("tells the user to reconnect instead of printing the session topic", () => {
    const msg = sendErr(new Error("Missing or invalid. Record was recently deleted - session: 7e677fb9caa3008f"));
    expect(msg).toMatch(/wallet connection expired.*reconnect/i);
    expect(msg).not.toContain("7e677fb9");
  });
});

// The pay/leash paths prefix rejections with "Blocked by policy: ", so a message that also
// ends in "blocked by policy" read as "Blocked by policy: Over the per-task limit — blocked
// by policy." on screen (caught in a submission screenshot, 2026-07-28).
describe("policy rejection messages", () => {
  it("does not repeat the caller's 'Blocked by policy' prefix", () => {
    for (const code of [3, 4, 10]) {
      expect(CONTRACT_ERRORS[code].toLowerCase()).not.toContain("blocked by policy");
    }
  });

  it("still names what the limit was", () => {
    expect(CONTRACT_ERRORS[3]).toMatch(/per-task limit/i);
    expect(CONTRACT_ERRORS[4]).toMatch(/daily limit/i);
    expect(CONTRACT_ERRORS[10]).toMatch(/session/i);
  });
});
