import { describe, expect, it } from "vitest";
import { waitForBalanceChange } from "./balanceWait";

const noSleep = async () => {};

describe("waitForBalanceChange", () => {
  it("keeps reading until the balance moves away from the previous value", async () => {
    const reads = [0, 0, 20];
    let calls = 0;
    const out = await waitForBalanceChange(async () => reads[calls++], 0, { attempts: 5, sleep: noSleep });
    expect(out).toBe(20);
    expect(calls).toBe(3);
  });

  it("treats an unknown previous balance as 'wait for anything positive'", async () => {
    const reads = [null, 0, 10];
    let calls = 0;
    const out = await waitForBalanceChange(async () => reads[calls++], null, { attempts: 5, sleep: noSleep });
    expect(out).toBe(10);
  });

  it("gives up after the attempts and returns the last reading", async () => {
    let calls = 0;
    const out = await waitForBalanceChange(async () => (calls++, 0), 0, { attempts: 3, sleep: noSleep });
    expect(out).toBe(0);
    expect(calls).toBe(3);
  });

  it("returns immediately when the first read already moved", async () => {
    let calls = 0;
    const out = await waitForBalanceChange(async () => (calls++, 7), 0, { attempts: 3, sleep: noSleep });
    expect(out).toBe(7);
    expect(calls).toBe(1);
  });
});
