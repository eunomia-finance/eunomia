import { homedir } from "node:os";
import { join } from "node:path";
import type { NetworkName } from "./format.js";

export interface NetworkConfig {
  name: NetworkName;
  passphrase: string;
  rpcUrl: string;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  // The app's own RPC proxy is the default: it forwards reads, simulations and already-signed
  // transactions, per-address rate-limited, and adds no authority. Requiring an RPC URL sent
  // every first-time user into an error before their first command worked.
  pubnet: {
    name: "pubnet",
    passphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: "https://eunomia.finance/api/rpc",
  },
};

/** Stellar mainnet, through EUNOMIA_RPC_URL when the operator names one. EUNOMIA_NETWORK may be
 *  left out; set, it has to say pubnet — a config written for another network fails here
 *  rather than signing against the wrong one. */
export function resolveNetwork(env: NodeJS.ProcessEnv): NetworkConfig {
  const name = (env.EUNOMIA_NETWORK?.trim() || "pubnet") as NetworkName;
  const base = NETWORKS[name];
  if (!base) throw new Error(`Unknown EUNOMIA_NETWORK "${name}" — eunomia-mcp runs on pubnet only`);
  const rpcUrl = env.EUNOMIA_RPC_URL?.trim() || base.rpcUrl;
  return { ...base, rpcUrl };
}

/** Where credentials and caches live: EUNOMIA_HOME or ~/.eunomia. */
export const homeDir = (env: NodeJS.ProcessEnv): string =>
  env.EUNOMIA_HOME?.trim() || join(homedir(), ".eunomia");
