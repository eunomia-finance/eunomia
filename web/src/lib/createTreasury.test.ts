import { describe, expect, it } from "vitest";
import { factorySetupArgs, freshSalt, predictTreasuryId } from "./createTreasury";
import { XLM_SAC } from "./userTreasury";

describe("predictTreasuryId", () => {
  it("names the address the factory really deployed to", () => {
    // A real pair from testnet (2026-09-18): the factory was called with this salt and
    // answered with this treasury. If the prediction ever drifts, an agent connected during
    // setup gets a key for a treasury that does not exist.
    const salt = Buffer.from("6bf1c83c814accb8517f129469bdc6ebaf4878d978cf8d484b6f3a832398014f", "hex");
    expect(predictTreasuryId(salt)).toBe("CBALSDCSLU5VAWG4ZD5EXDUAYXDFTC3ADNXRBJOAQFVC77PW3H6J5XZZ");
  });

  it("depends on the salt, the factory and the network — and on nothing else", () => {
    const salt = freshSalt();
    const here = predictTreasuryId(salt);
    expect(predictTreasuryId(salt)).toBe(here);
    expect(predictTreasuryId(freshSalt())).not.toBe(here);
    expect(predictTreasuryId(salt, "CBEPVXK6BN2FZ3IYHV5KQUGROFHNBWBYHKHRZ5U3O7UWGIOPFOFE4ZE7")).not.toBe(here);
    expect(predictTreasuryId(salt, undefined, "Public Global Stellar Network ; September 2015")).not.toBe(here);
  });
});

const OWNER = "CAZTJX3ZOVELKZQKUN75G6TIKEOY7YCOQMXTPJZBMAIKWNG2XO47QTKD";
const PAYEE = "GDOMW4C36BUBBFJW3V4L22LUICOUKFVTPGOYU6UMZZ6D3ENEOCH4QCRT";
const AGENT = "GB4GJNEZ6KLZNU3TE2CHQFNPOEQL5SHPQ246OMRZRLKVVQNLZCDX2QXZ";
const salt = Buffer.alloc(32, 7);

describe("factorySetupArgs", () => {
  it("maps XLM amounts to stroops and the Leash to a one-entry list with an absolute expiry", () => {
    const s = factorySetupArgs(
      OWNER,
      { dailyXlm: 100, perTaskXlm: 10, payees: [PAYEE], leash: { agent: AGENT, capXlm: 30, hours: 24 }, fundXlm: 20, register: true },
      1_800_000_000,
      salt,
    );
    expect(s.owner).toBe(OWNER);
    expect(s.token).toBe(XLM_SAC);
    expect(s.daily_limit).toBe(1_000_000_000n);
    expect(s.per_task_limit).toBe(100_000_000n);
    expect(s.payees).toEqual([PAYEE]);
    expect(s.leash).toEqual([{ agent: AGENT, valid_until: 1_800_086_400n, limit: 300_000_000n }]);
    expect(s.fund).toBe(200_000_000n);
    expect(s.register).toBe(true);
    expect(s.salt).toBe(salt);
  });

  it("leaves the optional parts empty when not asked for", () => {
    const s = factorySetupArgs(OWNER, { dailyXlm: 50, perTaskXlm: 10, payees: [], fundXlm: 0, register: false }, 1, salt);
    expect(s.leash).toEqual([]);
    expect(s.payees).toEqual([]);
    expect(s.fund).toBe(0n);
    expect(s.register).toBe(false);
  });

  it("rounds fractional hours to whole seconds", () => {
    const s = factorySetupArgs(OWNER, { dailyXlm: 50, perTaskXlm: 10, payees: [], leash: { agent: AGENT, capXlm: 1, hours: 0.5 }, fundXlm: 0, register: false }, 1000, salt);
    expect(s.leash[0].valid_until).toBe(2800n);
  });
});
