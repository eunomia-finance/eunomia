import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fileCache, type KnownPayeeCache } from "./cache.js";
import { resolveCredential, type Credential } from "./credential.js";
import { homeDir, resolveNetwork, type NetworkConfig } from "./network.js";
import { fileExceptionStore, filePurchaseLog, type ExceptionStore, type PurchaseLog } from "./store.js";
import { registerSpendTools } from "./spendTools.js";
import { registerTools } from "./tools.js";
import { toStroops } from "./format.js";
import { VERSION } from "./version.js";

export const SERVER_NAME = "eunomia-mcp";
export const SERVER_VERSION = VERSION;

export interface ServerContext {
  net: NetworkConfig;
  /** null until EUNOMIA_TREASURY is set — tools then explain how, instead of crashing */
  treasuryId: string | null;
  credential: Credential | null;
  cache: KnownPayeeCache;
  /** exception requests this agent filed (bookmarks; the chain is the truth) */
  exceptions: ExceptionStore;
  /** what call_service bought (absent in tests that do not buy) */
  purchases?: PurchaseLog;
  /** where the owner approves things — budget requests link here */
  appUrl?: string;
  /** unix seconds; injectable for tests */
  now?: () => number;
  /** The most one call_service may pay, in stroops. The operator's, from EUNOMIA_MAX_PRICE:
   *  the model sets `maxPrice` per call and cannot go above this. Left out, call.ts applies
   *  its default. */
  maxCallPrice?: bigint;
  /** The hosts call_service may call, from EUNOMIA_SERVICE_HOSTS. null = any host (the
   *  operator opted out with "*"); left out, the service catalog's host only. */
  serviceHosts?: string[] | null;
  /** Payments signed and handed to a service that never reported a settlement: service →
   *  the unix second until which it can still collect. Kept for the life of the process. */
  unsettled?: Map<string, number>;
}

/** EUNOMIA_MAX_PRICE as stroops, or undefined when unset. A value that is not a positive
 *  amount stops the server: a typo in a limit must not read as "no limit". */
export function maxCallPriceFromEnv(env: NodeJS.ProcessEnv): bigint | undefined {
  const raw = env.EUNOMIA_MAX_PRICE?.trim();
  if (!raw) return undefined;
  let stroops: bigint;
  try {
    stroops = toStroops(raw);
  } catch {
    throw new Error(`EUNOMIA_MAX_PRICE is not an amount: "${raw}" — use a decimal in the treasury's token, e.g. 0.25`);
  }
  if (stroops <= 0n) throw new Error("EUNOMIA_MAX_PRICE must be above zero");
  return stroops;
}

/** EUNOMIA_SERVICE_HOSTS: a comma-separated list of host names, or "*" for any host. Unset
 *  leaves the default (the catalog's host) to call.ts. */
export function serviceHostsFromEnv(env: NodeJS.ProcessEnv): string[] | null | undefined {
  const raw = env.EUNOMIA_SERVICE_HOSTS?.trim();
  if (!raw) return undefined;
  if (raw === "*") return null;
  const hosts = raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  for (const h of hosts) {
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h)) {
      throw new Error(`EUNOMIA_SERVICE_HOSTS has an entry that is not a host name: "${h}" — list hosts like api.example.com, or "*" for any`);
    }
  }
  return hosts;
}

export function contextFromEnv(env: NodeJS.ProcessEnv): ServerContext {
  const net = resolveNetwork(env);
  const home = homeDir(env);
  const treasuryId = env.EUNOMIA_TREASURY?.trim() || null;
  const maxCallPrice = maxCallPriceFromEnv(env);
  const serviceHosts = serviceHostsFromEnv(env);
  return {
    net,
    treasuryId,
    credential: treasuryId ? resolveCredential(env, home, net.name, treasuryId) : null,
    cache: fileCache(join(home, net.name)),
    exceptions: fileExceptionStore(join(home, net.name)),
    purchases: filePurchaseLog(join(home, net.name)),
    appUrl: env.EUNOMIA_APP_URL?.trim() || "https://eunomia.finance",
    ...(maxCallPrice !== undefined ? { maxCallPrice } : {}),
    ...(serviceHosts !== undefined ? { serviceHosts } : {}),
    unsettled: new Map(),
  };
}

export function createServer(ctx: ServerContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, ctx);
  registerSpendTools(server, ctx);
  return server;
}
