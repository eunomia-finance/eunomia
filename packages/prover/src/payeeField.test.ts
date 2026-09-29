import { test } from "node:test";
import assert from "node:assert/strict";
import { payeeField, payeeFieldsSorted } from "./payeeField.js";

const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const SERVICE = "GDOMW4C36BUBBFJW3V4L22LUICOUKFVTPGOYU6UMZZ6D3ENEOCH4QCRT";
const SUPPLIER = "GAF74ROXHKLAW4JKHJQVYR3O27VTQJF7QA4GLWDBTZACWEPKMPCAVCEZ";

test("a payee field is deterministic and always inside the field", () => {
  assert.equal(payeeField(SERVICE), payeeField(SERVICE));
  assert.ok(payeeField(SERVICE) < R);
  assert.ok(payeeField(SERVICE) < 1n << 248n);
});

test("different addresses map to different fields", () => {
  assert.notEqual(payeeField(SERVICE), payeeField(SUPPLIER));
});

test("the tree order depends on the set, not on how it was listed", () => {
  assert.deepEqual(payeeFieldsSorted([SERVICE, SUPPLIER]), payeeFieldsSorted([SUPPLIER, SERVICE, SUPPLIER]));
});

test("anything that is not a G or C address is refused", () => {
  assert.throws(() => payeeField("service"));
  assert.throws(() => payeeField(SERVICE.toLowerCase()));
  assert.throws(() => payeeField(SERVICE.slice(0, 55)));
});
