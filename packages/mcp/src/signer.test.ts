import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { rpc } from "@stellar/stellar-sdk";
import { agentKeypair, diagnosticsOf, pollTransaction } from "./signer.js";

test("agentKeypair derives the credential's public key", () => {
  const kp = Keypair.random();
  const cred = {
    version: 1 as const,
    network: "testnet" as const,
    treasuryId: "C",
    agentPublicKey: kp.publicKey(),
    agentSecret: kp.secret(),
    createdAt: "x",
  };
  assert.equal(agentKeypair(cred).publicKey(), kp.publicKey());
});

test("pollTransaction returns the first non-NOT_FOUND response and times out otherwise", async () => {
  const answers = [{ status: "NOT_FOUND" }, { status: "NOT_FOUND" }, { status: "SUCCESS", ledger: 7 }];
  const server = { getTransaction: async () => answers.shift() } as unknown as rpc.Server;
  const r = await pollTransaction(server, "h", { timeoutMs: 1000, intervalMs: 1, sleep: async () => {} });
  assert.equal(r.status, "SUCCESS");
  const stuck = { getTransaction: async () => ({ status: "NOT_FOUND" }) } as unknown as rpc.Server;
  await assert.rejects(
    pollTransaction(stuck, "h", { timeoutMs: 5, intervalMs: 1, sleep: async () => {} }),
    /not found after/,
  );
});

test("diagnosticsOf reads parsed events, nested events and base64 strings", () => {
  const ev = new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: null,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({ topics: [nativeToScVal("error", { type: "symbol" })], data: nativeToScVal(1) }),
      ),
    }),
  });
  const b64 = ev.toXDR("base64");
  assert.equal(diagnosticsOf({ diagnosticEventsXdr: [ev] }).length, 1);
  assert.equal(diagnosticsOf({ events: { diagnosticEventsXdr: [b64] } }).length, 1);
  assert.equal(diagnosticsOf({ diagnosticEventsXdr: [b64] })[0].toXDR("base64"), b64);
  assert.deepEqual(diagnosticsOf({}), []);
});
