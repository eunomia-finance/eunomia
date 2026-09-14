#!/usr/bin/env node
// eunomia-mcp: `serve` (default — what an MCP client spawns), `init`, `status`, `config`.
// `serve` must never write to stdout except MCP frames; diagnostics go to stderr.
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { computeBudget } from "./budget.js";
import { createCredential, fundOnTestnet, isValidContractId, saveCredential } from "./credential.js";
import { homeDir, resolveNetwork } from "./network.js";
import { contextFromEnv, createServer, SERVER_VERSION } from "./server.js";
import { serializeBudget } from "./tools.js";
import { makeClient, readTreasury } from "./treasury.js";

const USAGE = `eunomia-mcp ${SERVER_VERSION} — connect an AI agent to a Eunomia treasury on Stellar

usage:
  eunomia-mcp [serve]                       run the MCP server on stdio (what Claude spawns)
  eunomia-mcp init --treasury <C…> [--network testnet|pubnet] [--force] [--skip-fund]
                                            create this agent's credential and print the key the owner authorises
  eunomia-mcp status [--treasury <C…>]      what this agent may spend right now (JSON)
  eunomia-mcp config [--client json|claude-code|claude-desktop] [--treasury <C…>]
                                            print the MCP client configuration for this treasury

env: EUNOMIA_TREASURY, EUNOMIA_NETWORK (default testnet), EUNOMIA_RPC_URL, EUNOMIA_HOME (~/.eunomia), EUNOMIA_AGENT_SECRET
`;

const { values: opts, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    treasury: { type: "string" },
    network: { type: "string" },
    client: { type: "string" },
    force: { type: "boolean", default: false },
    "skip-fund": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const command = positionals[0] ?? "serve";

/** env as the subcommands see it: --treasury / --network override the process env. */
function effectiveEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.treasury) env.EUNOMIA_TREASURY = opts.treasury;
  if (opts.network) env.EUNOMIA_NETWORK = opts.network;
  return env;
}

function requireTreasury(env: NodeJS.ProcessEnv): string {
  const id = env.EUNOMIA_TREASURY?.trim();
  if (!id) throw new Error("A treasury is required: pass --treasury <C…> or set EUNOMIA_TREASURY.");
  if (!isValidContractId(id)) throw new Error(`"${id}" is not a Stellar contract id (C…, 56 characters).`);
  return id;
}

function configSnippet(env: NodeJS.ProcessEnv, client: string): string {
  const treasury = requireTreasury(env);
  const network = resolveNetwork(env).name;
  const envBlock: Record<string, string> = { EUNOMIA_TREASURY: treasury, EUNOMIA_NETWORK: network };
  if (env.EUNOMIA_RPC_URL) envBlock.EUNOMIA_RPC_URL = env.EUNOMIA_RPC_URL;
  if (env.EUNOMIA_HOME) envBlock.EUNOMIA_HOME = env.EUNOMIA_HOME;
  switch (client) {
    case "claude-code": {
      const flags = Object.entries(envBlock).map(([k, v]) => `-e ${k}=${v}`).join(" ");
      return `claude mcp add eunomia ${flags} -- npx -y eunomia-mcp`;
    }
    case "claude-desktop":
    case "json":
      return JSON.stringify(
        { mcpServers: { eunomia: { command: "npx", args: ["-y", "eunomia-mcp"], env: envBlock } } },
        null,
        2,
      );
    default:
      throw new Error(`Unknown --client "${client}" — use json, claude-code or claude-desktop.`);
  }
}

async function serve(): Promise<void> {
  const ctx = contextFromEnv(process.env);
  if (!ctx.treasuryId) console.error("eunomia-mcp: EUNOMIA_TREASURY is not set — tools will explain how to configure one.");
  else if (!ctx.credential) console.error(`eunomia-mcp: no credential for ${ctx.treasuryId} — run \`eunomia-mcp init --treasury ${ctx.treasuryId}\`; read tools still work.`);
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
}

async function init(): Promise<void> {
  const env = effectiveEnv();
  const treasury = requireTreasury(env);
  const net = resolveNetwork(env);
  const home = homeDir(env);
  const cred = createCredential(net.name, treasury);
  const path = saveCredential(home, cred, { force: opts.force });
  let funded = "skipped (--skip-fund)";
  if (!opts["skip-fund"]) {
    try {
      await fundOnTestnet(net, cred.agentPublicKey);
      funded = "funded via friendbot";
    } catch (e) {
      funded = `NOT funded — ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  console.log(`Credential saved: ${path}`);
  console.log(`Agent public key: ${cred.agentPublicKey}   (${funded})`);
  console.log(`
Next, the treasury OWNER authorises this key (the secret stays on this machine):
  Eunomia dashboard → your treasury → Agent → paste the public key above, set a cap
  and a duration → Start Leash (signed with the owner's passkey or wallet).
  Revoke it from the same page at any time.

Then add the server to your MCP client:
${configSnippet(env, opts.client ?? "json")}

Check it: eunomia-mcp status --treasury ${treasury}
`);
}

async function status(): Promise<void> {
  const env = effectiveEnv();
  const ctx = contextFromEnv(env);
  const treasury = requireTreasury(env);
  const client = makeClient(ctx.net, treasury);
  const snap = await readTreasury(client, treasury);
  const budget = computeBudget(snap, ctx.credential?.agentPublicKey ?? null, Math.floor(Date.now() / 1000));
  console.log(JSON.stringify({ agentPublicKey: ctx.credential?.agentPublicKey ?? null, ...serializeBudget(budget, ctx.net.name) }, null, 2));
}

async function main(): Promise<void> {
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  switch (command) {
    case "serve":
      return serve();
    case "init":
      return init();
    case "status":
      return status();
    case "config":
      console.log(configSnippet(effectiveEnv(), opts.client ?? "json"));
      return;
    case "help":
      console.log(USAGE);
      return;
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

main().catch((e) => {
  console.error(`eunomia-mcp: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
