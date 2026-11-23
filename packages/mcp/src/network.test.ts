import { test } from "node:test";
import assert from "node:assert/strict";
import { homeDir, resolveNetwork } from "./network.js";

test("runs on mainnet, through the app's RPC unless the operator names one", () => {
  assert.equal(resolveNetwork({}).rpcUrl, "https://eunomia.finance/api/rpc");
  assert.equal(resolveNetwork({ EUNOMIA_RPC_URL: "  " }).rpcUrl, "https://eunomia.finance/api/rpc");
  const n = resolveNetwork({ EUNOMIA_RPC_URL: " https://rpc.example " });
  assert.equal(n.name, "pubnet");
  assert.equal(n.rpcUrl, "https://rpc.example");
  assert.equal(n.passphrase, "Public Global Stellar Network ; September 2015");
});

test("EUNOMIA_NETWORK may say pubnet, and nothing else", () => {
  assert.equal(resolveNetwork({ EUNOMIA_NETWORK: "pubnet", EUNOMIA_RPC_URL: "https://rpc.example" }).name, "pubnet");
  // A client config written for another network fails here rather than signing on mainnet.
  for (const name of ["testnet", "futurenet"]) {
    assert.throws(() => resolveNetwork({ EUNOMIA_NETWORK: name, EUNOMIA_RPC_URL: "https://rpc.example" }), /Unknown EUNOMIA_NETWORK/);
  }
});

test("EUNOMIA_HOME overrides ~/.eunomia", () => {
  assert.equal(homeDir({ EUNOMIA_HOME: "/x" }), "/x");
  assert.match(homeDir({}), /\.eunomia$/);
});
