import { test } from "node:test";
import assert from "node:assert/strict";
import { homeDir, resolveNetwork } from "./network.js";

test("defaults to testnet with the public RPC and friendbot", () => {
  const n = resolveNetwork({});
  assert.equal(n.name, "testnet");
  assert.equal(n.rpcUrl, "https://soroban-testnet.stellar.org");
  assert.equal(n.passphrase, "Test SDF Network ; September 2015");
  assert.equal(n.friendbot, "https://friendbot.stellar.org");
});

test("EUNOMIA_RPC_URL overrides the preset RPC", () => {
  assert.equal(resolveNetwork({ EUNOMIA_RPC_URL: " https://rpc.example " }).rpcUrl, "https://rpc.example");
});

test("EUNOMIA_NETWORK=pubnet requires an explicit RPC and has no friendbot", () => {
  assert.throws(() => resolveNetwork({ EUNOMIA_NETWORK: "pubnet" }), /EUNOMIA_RPC_URL/);
  const n = resolveNetwork({ EUNOMIA_NETWORK: "pubnet", EUNOMIA_RPC_URL: "https://rpc.example" });
  assert.equal(n.rpcUrl, "https://rpc.example");
  assert.equal(n.passphrase, "Public Global Stellar Network ; September 2015");
  assert.equal(n.friendbot, undefined);
});

test("unknown network is rejected; EUNOMIA_HOME overrides ~/.eunomia", () => {
  assert.throws(() => resolveNetwork({ EUNOMIA_NETWORK: "futurenet" }), /Unknown EUNOMIA_NETWORK/);
  assert.equal(homeDir({ EUNOMIA_HOME: "/x" }), "/x");
  assert.match(homeDir({}), /\.eunomia$/);
});
