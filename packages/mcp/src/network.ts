import { homedir } from "node:os";
import { join } from "node:path";
import type { NetworkName } from "./format.js";

export interface NetworkConfig {
  name: NetworkName;
  passphrase: string;
  rpcUrl: string;
  /** testnet only — the session key is the fee-paying tx source and must exist */
  friendbot?: string;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: "testnet",
    passphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
    friendbot: "https://friendbot.stellar.org",
  },
  // No public mainnet RPC is assumed: the operator names one.
  pubnet: {
    name: "pubnet",
    passphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: "",
  },
};

/** EUNOMIA_NETWORK (testnet | pubnet, default testnet) + optional EUNOMIA_RPC_URL. */
export function resolveNetwork(env: NodeJS.ProcessEnv): NetworkConfig {
  const name = (env.EUNOMIA_NETWORK?.trim() || "testnet") as NetworkName;
  const base = NETWORKS[name];
  if (!base) throw new Error(`Unknown EUNOMIA_NETWORK "${name}" — use testnet or pubnet`);
  const rpcUrl = env.EUNOMIA_RPC_URL?.trim() || base.rpcUrl;
  if (!rpcUrl) throw new Error(`EUNOMIA_RPC_URL is required on ${name}`);
  return { ...base, rpcUrl };
}

/** Where credentials and caches live: EUNOMIA_HOME or ~/.eunomia. */
export const homeDir = (env: NodeJS.ProcessEnv): string =>
  env.EUNOMIA_HOME?.trim() || join(homedir(), ".eunomia");
