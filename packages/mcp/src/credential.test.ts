import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createCredential,
  credentialPath,
  fundOnTestnet,
  isValidContractId,
  loadCredential,
  resolveCredential,
  saveCredential,
} from "./credential.js";
import { NETWORKS } from "./network.js";

const T = "CBCBYWUMRD7L6GFTRJME232JUAEJ2B263N5O7MDGCMDFG4FI6GJ5JN36";
const tmp = () => mkdtempSync(join(tmpdir(), "eunomia-cred-"));

test("create → save → load round-trips and refuses to overwrite", () => {
  const home = tmp();
  const c = createCredential("testnet", T);
  assert.equal(c.version, 1);
  assert.equal(Keypair.fromSecret(c.agentSecret).publicKey(), c.agentPublicKey);
  const p = saveCredential(home, c);
  assert.equal(p, credentialPath(home, "testnet", T));
  assert.deepEqual(loadCredential(home, "testnet", T), c);
  assert.throws(() => saveCredential(home, createCredential("testnet", T)), /already exists/);
  const replaced = createCredential("testnet", T);
  saveCredential(home, replaced, { force: true });
  assert.deepEqual(loadCredential(home, "testnet", T), replaced);
  if (process.platform !== "win32") assert.equal(statSync(p).mode & 0o777, 0o600);
});

test("createCredential rejects a non-contract id before generating anything", () => {
  assert.throws(() => createCredential("testnet", "GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6"), /contract id/);
});

test("env secret wins over the file; nothing configured → null", () => {
  const home = tmp();
  saveCredential(home, createCredential("testnet", T));
  const kp = Keypair.random();
  const c = resolveCredential({ EUNOMIA_AGENT_SECRET: kp.secret() }, home, "testnet", T);
  assert.equal(c?.agentPublicKey, kp.publicKey());
  assert.equal(c?.createdAt, "env");
  assert.equal(resolveCredential({}, tmp(), "testnet", T), null);
  assert.throws(() => resolveCredential({ EUNOMIA_AGENT_SECRET: "SNOTASECRET" }, home, "testnet", T), /EUNOMIA_AGENT_SECRET/);
});

test("contract id validation", () => {
  assert.equal(isValidContractId(T), true);
  assert.equal(isValidContractId("GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6"), false);
  assert.equal(isValidContractId("nope"), false);
});

test("friendbot funding calls the network's friendbot and fails loudly", async () => {
  const calls: string[] = [];
  const ok = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  await fundOnTestnet(NETWORKS.testnet, "GABC", ok);
  assert.match(calls[0], /^https:\/\/friendbot\.stellar\.org\/\?addr=GABC$/);
  const bad = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  await assert.rejects(fundOnTestnet(NETWORKS.testnet, "GABC", bad), /friendbot/i);
  await assert.rejects(fundOnTestnet(NETWORKS.pubnet, "GABC", ok), /testnet/i);
});
