// Spawns the built server exactly as an MCP client would, lists the tools and drives them
// against the live testnet treasury, printing each JSON answer. This is the evidence run.
//
//   EUNOMIA_TREASURY=C… npm run smoke              read tools only (Week 1)
//   SMOKE_WRITE=1 …                               + pay / request_exception / check_exception (Week 2)
//   SMOKE_WRITE=1 SMOKE_EXC_ID=<id> …             second half: after the owner resolved a request
//
//   SMOKE_PAYEE=G…        whitelisted payee for the in-policy payment (default: the demo `service` key)
//   SMOKE_PAY_AMOUNT=2.5  in-policy amount · SMOKE_OVER_AMOUNT=15  over the per-payment cap
//   SMOKE_EXC_TO=G…       a payee that is NOT whitelisted (default: the demo `supplier` key)
//   SMOKE_EXC_AMOUNT=1    amount of the exception request
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

const PAYEE = process.env.SMOKE_PAYEE ?? "GDOMW4C36BUBBFJW3V4L22LUICOUKFVTPGOYU6UMZZ6D3ENEOCH4QCRT";
const EXC_TO = process.env.SMOKE_EXC_TO ?? "GAF74ROXHKLAW4JKHJQVYR3O27VTQJF7QA4GLWDBTZACWEPKMPCAVCEZ";
const EXC_AMOUNT = process.env.SMOKE_EXC_AMOUNT ?? "1";
const write = process.env.SMOKE_WRITE === "1";

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "serve"], env });
const client = new Client({ name: "eunomia-smoke", version: "0.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text ?? "";
  console.log(`\n== ${name} ${JSON.stringify(args)} (${Date.now() - t0} ms${r.isError ? ", ERROR" : ""}) ==\n${text}`);
  return (r.structuredContent as Record<string, unknown>) ?? {};
}

if (process.env.SMOKE_EXC_ID) {
  // The owner has (hopefully) resolved the request: it should read as approved, the
  // payment should go through, and pay() should close the entry behind it.
  await call("check_exception", { id: process.env.SMOKE_EXC_ID });
  await call("pay", { to: EXC_TO, amount: EXC_AMOUNT, taskId: 402 });
  await call("check_exception", { id: process.env.SMOKE_EXC_ID });
} else {
  await call("check_budget", { amount: process.env.SMOKE_PAY_AMOUNT ?? "2.5" });
  await call("list_allowed_payees", {});
  await call("check_payee", { address: PAYEE });
  if (write) {
    await call("pay", { to: PAYEE, amount: process.env.SMOKE_PAY_AMOUNT ?? "2.5", taskId: 402 });
    await call("pay", { to: PAYEE, amount: process.env.SMOKE_OVER_AMOUNT ?? "15", taskId: 402 });
    await call("pay", { to: EXC_TO, amount: EXC_AMOUNT, taskId: 402 });
    const req = await call("request_exception", { to: EXC_TO, amount: EXC_AMOUNT, taskId: 402 });
    if (typeof req.id === "string") await call("check_exception", { id: req.id });
  }
}
await client.close();
