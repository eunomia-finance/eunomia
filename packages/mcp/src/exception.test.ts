import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import type { rpc } from "@stellar/stellar-sdk";
import { dataEntryKey, readExceptionEntry } from "./exception.js";
import { encodeExceptionPayload } from "./exceptionCodec.js";
import { NETWORKS } from "./network.js";

const G = "GAF74ROXHKLAW4JKHJQVYR3O27VTQJF7QA4GLWDBTZACWEPKMPCAVCEZ";

test("dataEntryKey addresses the agent account's data entry", () => {
  const kp = Keypair.random();
  const key = dataEntryKey(kp.publicKey(), "eunomia.x.CDVCLLGG.abc");
  assert.equal(key.switch().name, "data");
  assert.equal(key.data().dataName().toString(), "eunomia.x.CDVCLLGG.abc");
  assert.equal(key.data().accountId().ed25519().toString("hex"), kp.rawPublicKey().toString("hex"));
});

test("readExceptionEntry decodes the entry or returns null when absent", async () => {
  const kp = Keypair.random();
  const payload = { payee: G, amount: 10_000_000n, taskId: 0n, reasonCodes: [2], requestedAt: 1_757_900_000 };
  const entry = xdr.LedgerEntryData.data(
    new xdr.DataEntry({
      accountId: kp.xdrAccountId(),
      dataName: "n",
      dataValue: Buffer.from(encodeExceptionPayload(payload)),
      ext: new xdr.DataEntryExt(0),
    }),
  );
  const server = { getLedgerEntries: async () => ({ entries: [{ val: entry }] }) } as unknown as rpc.Server;
  assert.deepEqual(await readExceptionEntry(NETWORKS.testnet, kp.publicKey(), "n", { server }), payload);
  const empty = { getLedgerEntries: async () => ({ entries: [] }) } as unknown as rpc.Server;
  assert.equal(await readExceptionEntry(NETWORKS.testnet, kp.publicKey(), "n", { server: empty }), null);
});
