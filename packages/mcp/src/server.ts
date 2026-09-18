import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fileCache, type KnownPayeeCache } from "./cache.js";
import { resolveCredential, type Credential } from "./credential.js";
import { homeDir, resolveNetwork, type NetworkConfig } from "./network.js";
import { fileExceptionStore, type ExceptionStore } from "./store.js";
import { registerTools } from "./tools.js";

export const SERVER_NAME = "eunomia-mcp";
export const SERVER_VERSION = "0.2.1";

export interface ServerContext {
  net: NetworkConfig;
  /** null until EUNOMIA_TREASURY is set — tools then explain how, instead of crashing */
  treasuryId: string | null;
  credential: Credential | null;
  cache: KnownPayeeCache;
  /** exception requests this agent filed (bookmarks; the chain is the truth) */
  exceptions: ExceptionStore;
  /** unix seconds; injectable for tests */
  now?: () => number;
}

export function contextFromEnv(env: NodeJS.ProcessEnv): ServerContext {
  const net = resolveNetwork(env);
  const home = homeDir(env);
  const treasuryId = env.EUNOMIA_TREASURY?.trim() || null;
  return {
    net,
    treasuryId,
    credential: treasuryId ? resolveCredential(env, home, net.name, treasuryId) : null,
    cache: fileCache(join(home, net.name)),
    exceptions: fileExceptionStore(join(home, net.name)),
  };
}

export function createServer(ctx: ServerContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, ctx);
  return server;
}
