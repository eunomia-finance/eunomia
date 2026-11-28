// These tests assert the English sentences; the app language otherwise follows the machine locale.
import { resetLangForTest } from "./i18n";
resetLangForTest("en");

import { describe, it, expect } from "vitest";
import { checkLimits, MAX_BATCH } from "./validate";

describe("checkLimits", () => {
  it("accepts a policy the proof batch can exactly cover", () => {
    expect(checkLimits(MAX_BATCH * 10, 10)).toEqual({ ok: true });
  });

  it("still rejects a per-payment limit above the daily one", () => {
    const r = checkLimits(50, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.msg).toMatch(/can't exceed the daily limit/i);
  });

  it("rejects a daily limit no single proof could account for", () => {
    // The failure this guards is silent: the treasury would allow the spending, no proof
    // could cover the day, and the verifier only asks periods to move forward — so the
    // day would leave the attestation record without a trace.
    const r = checkLimits(MAX_BATCH * 10 + 1, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.msg).toMatch(/proved compliant/i);
  });

  it("names both ways out, with numbers the user can act on", () => {
    const r = checkLimits(1000, 10); // needs per-payment >= 63, or daily <= 160
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.msg).toContain("63");
      expect(r.msg).toContain("160");
    }
  });
});
