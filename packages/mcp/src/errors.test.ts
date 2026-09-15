import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { contractCodeFromMessage, reasonFromCode, reasonFromErrorName, reasonsFromDiagnostics } from "./errors.js";

test("contractCodeFromMessage reads the host's Error(Contract, #N) out of any message", () => {
  assert.equal(contractCodeFromMessage('Transaction simulation failed: "HostError: Error(Contract, #3)\n..."'), 3);
  assert.equal(contractCodeFromMessage("Error(Contract, 10)"), 10);
  assert.equal(contractCodeFromMessage("Error(Auth, InvalidAction)"), null);
});

test("reasonFromCode / reasonFromErrorName use the binding's names", () => {
  assert.deepEqual(reasonFromCode(3), { code: 3, name: "ExceedsTaskLimit", detail: "amount exceeds the per-payment cap" });
  assert.equal(reasonFromCode(99).name, "ContractError99");
  assert.equal(reasonFromErrorName("PayeeNotWhitelisted")?.code, 2);
  assert.equal(reasonFromErrorName("Nope"), null);
});

function diag(topics: xdr.ScVal[]): xdr.DiagnosticEvent {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: null,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({ topics, data: nativeToScVal("escalating error to panic") }),
      ),
    }),
  });
}

test("reasonsFromDiagnostics collects contract error codes once each and ignores the rest", () => {
  const events = [
    diag([nativeToScVal("error", { type: "symbol" }), xdr.ScVal.scvError(xdr.ScError.sceContract(3))]),
    diag([nativeToScVal("error", { type: "symbol" }), xdr.ScVal.scvError(xdr.ScError.sceContract(3))]),
    diag([nativeToScVal("fn_call", { type: "symbol" }), nativeToScVal("pay", { type: "symbol" })]),
    diag([xdr.ScVal.scvError(xdr.ScError.sceAuth(xdr.ScErrorCode.scecInvalidAction()))]),
  ];
  assert.deepEqual(reasonsFromDiagnostics(events).map((r) => r.code), [3]);
  assert.deepEqual(reasonsFromDiagnostics(undefined), []);
});
