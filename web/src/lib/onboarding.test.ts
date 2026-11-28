import { describe, expect, it } from "vitest";
import { ownerJourney, setupProgress, type SetupInputs } from "./onboarding";

const base: SetupInputs = {
  connected: false,
  hasTreasury: false,
  balance: null,
  payeeCount: null,
  hasPaid: false,
};

describe("setupProgress", () => {
  it("starts a fresh visitor at connect", () => {
    const p = setupProgress(base);
    expect(p.next).toBe("connect");
    expect(p.complete).toBe(false);
    expect(p.steps.map((s) => s.step)).toEqual(["connect", "deploy", "fund", "whitelist", "pay"]);
  });

  it("moves to deploy once connected", () => {
    expect(setupProgress({ ...base, connected: true }).next).toBe("deploy");
  });

  it("does NOT count fund as done while the balance is still unknown", () => {
    const p = setupProgress({ ...base, connected: true, hasTreasury: true, balance: null });
    expect(p.next).toBe("fund");
  });

  it("moves to whitelist when funded but payee-less", () => {
    const p = setupProgress({ ...base, connected: true, hasTreasury: true, balance: 100n, payeeCount: 0 });
    expect(p.next).toBe("whitelist");
  });

  it("moves to pay with a payee whitelisted", () => {
    const p = setupProgress({
      ...base,
      connected: true,
      hasTreasury: true,
      balance: 100n,
      payeeCount: 1,
    });
    expect(p.next).toBe("pay");
  });

  it("completes when everything is done", () => {
    const p = setupProgress({
      connected: true,
      hasTreasury: true,
      balance: 1n,
      payeeCount: 2,
      hasPaid: true,
    });
    expect(p.complete).toBe(true);
    expect(p.next).toBeNull();
    expect(p.steps.every((s) => s.done)).toBe(true);
  });

  it("points at the FIRST unfinished step even when later ones are done", () => {
    // whitelisted before funding — next is still fund
    const p = setupProgress({ ...base, connected: true, hasTreasury: true, balance: 0n, payeeCount: 3 });
    expect(p.next).toBe("fund");
  });
});

describe("ownerJourney", () => {
  it("shows nothing until the balance is read", () => {
    expect(ownerJourney({ balance: null, agentOn: false, hasPaid: false })).toBeNull();
  });
  it("an empty treasury is told to fund, even with an agent connected", () => {
    const j = ownerJourney({ balance: 0n, agentOn: true, hasPaid: false });
    expect(j?.now).toBe("fund");
    expect(j?.steps.map((s) => s.done)).toEqual([true, false, true, false]);
  });
  it("funded without an agent → connect one; with one → ask it for something", () => {
    expect(ownerJourney({ balance: 5n, agentOn: false, hasPaid: false })?.now).toBe("agent");
    expect(ownerJourney({ balance: 5n, agentOn: true, hasPaid: false })?.now).toBe("ask");
  });
  it("complete once the agent has paid — and a spent-out treasury still counts as funded", () => {
    expect(ownerJourney({ balance: 0n, agentOn: true, hasPaid: true })).toMatchObject({ now: null, complete: true });
  });
  it("a Leash that ran out sends the owner back to the agent step", () => {
    expect(ownerJourney({ balance: 5n, agentOn: false, hasPaid: true })?.now).toBe("agent");
  });
});
