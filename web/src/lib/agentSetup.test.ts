import { describe, expect, it, vi } from "vitest";

vi.mock("./walletKit", () => ({ kit: { signTransaction: vi.fn() } }));

import { agentAccountExists, CATALOG_PAYEES, catalogLabel, planAgentSetup } from "./agentSetup";

const AGENT = "GB5U2NZOBZFQMY3HPSMRNVER2YM5XCXSLTRB52HM3MTUQ7EIQFP7VPMI";
const catalog = (approved: boolean) => CATALOG_PAYEES.map((c) => ({ ...c, approved }));

describe("planAgentSetup", () => {
  it("a fresh key gets everything, in the order it is signed", () => {
    const steps = planAgentSetup({ agent: AGENT, accountExists: false, ownerIsWallet: true, agentIsPayee: false, catalog: catalog(false) });
    expect(steps.map((s) => s.kind)).toEqual(["account", "payee", "payee", "payee", "leash"]);
    expect(steps.every((s) => s.status === "todo")).toBe(true);
    expect(steps[1].address).toBe(AGENT);
    expect(steps.slice(2, 4).map((s) => s.address)).toEqual(CATALOG_PAYEES.map((c) => c.address));
  });

  it("what is already true is skipped, so a second press resumes", () => {
    const steps = planAgentSetup({ agent: AGENT, accountExists: true, ownerIsWallet: true, agentIsPayee: true, catalog: catalog(true) });
    expect(steps.map((s) => s.id)).toEqual(["leash"]);
  });

  it("the catalog is approved only when the owner asked for it", () => {
    const steps = planAgentSetup({ agent: AGENT, accountExists: true, ownerIsWallet: true, agentIsPayee: false, catalog: [] });
    expect(steps.map((s) => s.id)).toEqual([`payee:${AGENT}`, "leash"]);
  });

  it("a passkey owner is told to send the XLM — the step is not signed here", () => {
    const steps = planAgentSetup({ agent: AGENT, accountExists: false, ownerIsWallet: false, agentIsPayee: true, catalog: [] });
    expect(steps[0]).toMatchObject({ kind: "account", status: "manual" });
    expect(steps[0].label).toContain("GB5U…VPMI");
    expect(steps[1].id).toBe("leash");
  });
});

describe("agentAccountExists", () => {
  const answering = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;

  it("404 is no, 200 is yes, anything else is unknown — never a guess", async () => {
    expect(await agentAccountExists(AGENT, answering(404))).toBe(false);
    expect(await agentAccountExists(AGENT, answering(200))).toBe(true);
    await expect(agentAccountExists(AGENT, answering(503))).rejects.toThrow(/could not check/);
  });
});

it("catalog addresses are well-formed and labelled", () => {
  for (const c of CATALOG_PAYEES) {
    expect(c.address).toMatch(/^G[A-Z2-7]{55}$/);
    expect(catalogLabel(c.address)).toBe(c.label);
  }
  expect(catalogLabel(AGENT)).toBeNull();
});
