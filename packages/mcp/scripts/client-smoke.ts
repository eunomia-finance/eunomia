// Spawns the built server exactly as an MCP client would, lists the tools, calls all
// three and prints their JSON. This is the Week-1 evidence run: read tools returning
// live treasury data through the MCP protocol, not through a direct import.
//
//   EUNOMIA_TREASURY=C… npm run smoke        (or: npm run smoke -- C…)
//   SMOKE_PAYEE=G…  the address check_payee asks about (default: the demo `service` key)
//   SMOKE_AMOUNT=1  the amount check_budget pre-flights
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const treasury = process.env.EUNOMIA_TREASURY ?? process.argv[2];
if (!treasury) {
  console.error("usage: EUNOMIA_TREASURY=C… npm run smoke   (or pass the treasury id as an argument)");
  process.exit(2);
}

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
env.EUNOMIA_TREASURY = treasury;

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "serve"], env });
const client = new Client({ name: "eunomia-smoke", version: "0.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const calls: Array<[string, Record<string, unknown>]> = [
  ["check_budget", { amount: process.env.SMOKE_AMOUNT ?? "1" }],
  ["list_allowed_payees", {}],
  ["check_payee", { address: process.env.SMOKE_PAYEE ?? "GDOMW4C36BUBBFJW3V4L22LUICOUKFVTPGOYU6UMZZ6D3ENEOCH4QCRT" }],
];
for (const [name, args] of calls) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text ?? "";
  console.log(`\n== ${name} (${Date.now() - t0} ms${r.isError ? ", ERROR" : ""}) ==\n${text}`);
}
await client.close();
