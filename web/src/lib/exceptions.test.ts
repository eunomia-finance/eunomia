import { describe, expect, it } from "vitest";
import { encodeExceptionPayload, exceptionEntryName } from "./exceptionCodec";
import { exceptionStatus, fetchAgentExceptions, ownerActionFor, parseAccountData } from "./exceptions";

const T = "CDVCLLGGMV6MJSJZYCPJI36BG6SGKSWVD44PORHVVFRBTSACEABBYNJ2";
const G = "GAF74ROXHKLAW4JKHJQVYR3O27VTQJF7QA4GLWDBTZACWEPKMPCAVCEZ";
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const state = {
  balance: 200_000_000n,
  daySpent: 0n,
  dailyLimit: 1_000_000_000n,
  perTaskLimit: 100_000_000n,
  admin: "GA",
  agent: "GB",
  token: "C",
};
const lifecycle = {
  paused: false,
  session: { agent: "GB", valid_until: 4_000_000_000n, limit: 300_000_000n, spent: 0n },
};

describe("parseAccountData", () => {
  it("decodes only this treasury's entries, newest first, skipping junk", () => {
    const older = encodeExceptionPayload({ payee: G, amount: 10_000_000n, taskId: 0n, reasonCodes: [2], requestedAt: 100 });
    const newer = encodeExceptionPayload({ payee: G, amount: 150_000_000n, taskId: 1n, reasonCodes: [3], requestedAt: 200 });
    const out = parseAccountData(
      {
        [exceptionEntryName(T, 100_000)]: b64(older),
        [exceptionEntryName(T, 200_000)]: b64(newer),
        [exceptionEntryName("CAAAAAAA" + T.slice(8), 300_000)]: b64(newer),
        "eunomia.x.CDVCLLGG.junk": "AAAA",
        unrelated: "AAAA",
      },
      T,
    );
    expect(out.map((r) => r.requestedAt)).toEqual([200, 100]);
    expect(out[0].reasonCodes).toEqual([3]);
    expect(out[0].payee).toBe(G);
    expect(out[0].id).toBe(`CDVCLLGG.${(200_000).toString(36)}`);
  });
});

describe("fetchAgentExceptions", () => {
  it("reads Horizon's data map and treats a missing account as no requests", async () => {
    const payload = encodeExceptionPayload({ payee: G, amount: 1n, taskId: 0n, reasonCodes: [2], requestedAt: 5 });
    const okFetch = (async () =>
      new Response(JSON.stringify({ data: { [exceptionEntryName(T, 1)]: b64(payload) } }), { status: 200 })) as typeof fetch;
    expect((await fetchAgentExceptions("GAGENT", T, okFetch)).length).toBe(1);
    const missing = (async () => new Response("", { status: 404 })) as typeof fetch;
    expect(await fetchAgentExceptions("GAGENT", T, missing)).toEqual([]);
    const broken = (async () => new Response("", { status: 500 })) as typeof fetch;
    await expect(fetchAgentExceptions("GAGENT", T, broken)).rejects.toThrow(/Horizon/);
  });
});

describe("exceptionStatus", () => {
  const req = { id: "x", name: "n", payee: G, amount: 150_000_000n, taskId: 0n, reasonCodes: [3], requestedAt: 1 };
  it("is pending while the chain would still refuse", () => {
    expect(exceptionStatus(req, state, lifecycle, true, 10)).toBe("pending");
  });
  it("resolves once limits, payee, pause and Leash all allow it", () => {
    const wider = { ...state, perTaskLimit: 200_000_000n };
    expect(exceptionStatus(req, wider, lifecycle, true, 10)).toBe("resolved");
    expect(exceptionStatus(req, wider, lifecycle, false, 10)).toBe("pending");
    expect(exceptionStatus(req, wider, { ...lifecycle, paused: true }, true, 10)).toBe("pending");
    const tightLeash = { ...lifecycle, session: { ...lifecycle.session, limit: 100_000_000n } };
    expect(exceptionStatus(req, wider, tightLeash, true, 10)).toBe("pending");
    // an expired Leash no longer binds
    expect(exceptionStatus(req, wider, tightLeash, true, 5_000_000_000)).toBe("resolved");
  });
});

describe("ownerActionFor", () => {
  it("maps codes to dashboard actions", () => {
    expect(ownerActionFor(2).kind).toBe("whitelist");
    expect(ownerActionFor(3).kind).toBe("limits");
    expect(ownerActionFor(10).kind).toBe("leash");
    expect(ownerActionFor(9).kind).toBe("pause");
    expect(ownerActionFor(6).kind).toBe("fund");
    expect(ownerActionFor(7).kind).toBe("none");
  });
});
