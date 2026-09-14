import { test } from "node:test";
import assert from "node:assert/strict";
import { reducePayeeEvents } from "./payees.js";

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
