import { test } from "node:test";
import assert from "node:assert/strict";
import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import { payArgs, sourceAccountAuth } from "./onchain.js";

const T = "CDVCLLGGMV6MJSJZYCPJI36BG6SGKSWVD44PORHVVFRBTSACEABBYNJ2";
const TO = "GDOMW4C36BUBBFJW3V4L22LUICOUKFVTPGOYU6UMZZ6D3ENEOCH4QCRT";

test("sourceAccountAuth binds the invoker's auth to exactly this call", () => {
  const args = payArgs({ to: TO, amount: 150_000_000n, taskId: 5n });
  const entry = sourceAccountAuth(T, "pay", args);
  assert.equal(entry.credentials().switch().name, "sorobanCredentialsSourceAccount");
  const fn = entry.rootInvocation().function().contractFn();
  assert.equal(Address.fromScAddress(fn.contractAddress()).toString(), T);
  assert.equal(fn.functionName().toString(), "pay");
  assert.deepEqual(
    fn.args().map((a) => scValToNative(a)),
    [5n, TO, 150_000_000n],
  );
  assert.equal(entry.rootInvocation().subInvocations().length, 0);
  // round-trips through XDR unchanged
  const b64 = entry.toXDR("base64");
  assert.equal(xdr.SorobanAuthorizationEntry.fromXDR(b64, "base64").toXDR("base64"), b64);
});
