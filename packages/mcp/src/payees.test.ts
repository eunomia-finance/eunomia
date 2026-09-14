import { test } from "node:test";
import assert from "node:assert/strict";
import { collectPayeeEvents, cursorLedger, reducePayeeEvents, type EventPage } from "./payees.js";

test("add then remove leaves the set empty; re-add restores", () => {
  assert.deepEqual(reducePayeeEvents([{ kind: "payee_add", payee: "GA" }, { kind: "payee_rm", payee: "GA" }]), []);
  assert.deepEqual(
    reducePayeeEvents([
      { kind: "payee_add", payee: "GA" },
      { kind: "payee_rm", payee: "GA" },
      { kind: "payee_add", payee: "GA" },
    ]),
    ["GA"],
  );
});

test("unrelated events are ignored, order preserved, duplicates collapsed", () => {
  assert.deepEqual(
    reducePayeeEvents([
      { kind: "paid" },
      { kind: "payee_add", payee: "GB" },
      { kind: "payee_add", payee: "GA" },
      { kind: "payee_add", payee: "GB" },
      { kind: "session", payee: "GZ" }, // wrong kind, must not be added
    ]),
    ["GB", "GA"],
  );
});

test("events without a payee are skipped", () => {
  assert.deepEqual(reducePayeeEvents([{ kind: "payee_add" }, { kind: "payee_rm" }]), []);
});

// A cursor whose ledger part is `ledger` (toid = ledger << 32, event index 0).
const cur = (ledger: number) => `${(BigInt(ledger) << 32n).toString().padStart(19, "0")}-0`;

test("cursorLedger reads the ledger out of a getEvents cursor", () => {
  assert.equal(cursorLedger("0020088708799660031-4294967295"), 4677266);
  assert.equal(cursorLedger(cur(12345)), 12345);
});

test("collectPayeeEvents keeps paging through empty slices until the cursor reaches the tip", async () => {
  const LATEST = 25_000;
  const pages: EventPage[] = [
    { events: [], cursor: cur(10_000), latestLedger: LATEST }, // empty slice, more to scan
    { events: [], cursor: cur(20_000), latestLedger: LATEST }, // still empty
    { events: [{ kind: "payee_add", payee: "GA" }], cursor: cur(LATEST), latestLedger: LATEST }, // tip reached
    { events: [{ kind: "payee_add", payee: "NEVER" }], cursor: cur(LATEST + 1), latestLedger: LATEST + 1 },
  ];
  const asked: Array<{ startLedger?: number; cursor?: string }> = [];
  let i = 0;
  const fetchPage = async (q: { startLedger?: number; cursor?: string }) => {
    asked.push(q);
    return pages[i++];
  };
  const r = await collectPayeeEvents(fetchPage, 100);
  assert.deepEqual(r.events, [{ kind: "payee_add", payee: "GA" }]);
  assert.equal(r.pages, 3);
  assert.deepEqual(asked[0], { startLedger: 100 });
  assert.deepEqual(asked[1], { cursor: cur(10_000) });
  assert.deepEqual(asked[2], { cursor: cur(20_000) });
});

test("collectPayeeEvents stops when a page carries no cursor", async () => {
  const r = await collectPayeeEvents(async () => ({ events: [{ kind: "payee_rm", payee: "GB" }], latestLedger: 7 }), 1);
  assert.deepEqual(r.events, [{ kind: "payee_rm", payee: "GB" }]);
  assert.equal(r.pages, 1);
});
