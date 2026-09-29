// Check a compliance attestation yourself — no keys, no ZK tooling, one command:
//
//   npx tsx src/check-attestation.ts --tx <attestation tx hash>
//
// It reads the attestation transaction from the network, takes the proof and the public
// signals out of it, asks the on-chain verifier to run the pairing check on them again
// (`verify_proof`, simulated — nothing is signed or sent), and compares every public
// signal with what the treasury holds on-chain right now: its limits, its published payee
// root and the period's recorded total. What it prints is what the chain says, not what
// the prover claimed.
import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

const VERIFIER = "CD3TB3F4VQF2H56IQC4KV3YLA6QRIF272W5D6PK2SWVTYPXHS4NFDYZ3";
const RPC_URL = process.env.EUNOMIA_RPC_URL ?? "https://soroban-testnet.stellar.org";
const server = new rpc.Server(RPC_URL);
// Simulation needs a source account that exists; it signs nothing and pays nothing.
const SIM_SOURCE = "GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function call(contractId: string, fn: string, ...args: xdr.ScVal[]): Promise<unknown> {
  const tx = new TransactionBuilder(new Account(SIM_SOURCE, "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${fn} failed: ${sim.error}`);
  return scValToNative(sim.result!.retval);
}

const word = (b: Buffer, i: number) => BigInt("0x" + b.subarray(i * 32, i * 32 + 32).toString("hex"));

async function main() {
  const hash = arg("tx");
  if (!hash) throw new Error("usage: npx tsx src/check-attestation.ts --tx <attestation tx hash>");
  const ok = (label: string, pass: boolean, detail = "") => {
    console.log(`${pass ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
    if (!pass) process.exitCode = 1;
  };

  // ---- 1 · the transaction: a successful verify() on the Eunomia verifier ----
  const tx = await server.getTransaction(hash);
  if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`transaction ${hash}: ${tx.status} (the RPC keeps about 7 days; older ones: see stellar.expert)`);
  }
  const op = tx.envelopeXdr.v1().tx().operations()[0].body().invokeHostFunctionOp();
  const inv = op.hostFunction().invokeContract();
  const target = Address.fromScAddress(inv.contractAddress()).toString();
  const fn = inv.functionName().toString();
  ok("the transaction called verify() on the Eunomia verifier", target === VERIFIER && fn === "verify", `${target.slice(0, 8)}….${fn}`);
  const [treasuryVal, proofVal, publicVal] = inv.args();
  const treasury = Address.fromScVal(treasuryVal).toString();
  const proof = Buffer.from(proofVal.bytes());
  const pub = Buffer.from(publicVal.bytes());
  const attested = (tx.returnValue === undefined || tx.returnValue.switch().name === "scvVoid");
  ok("it succeeded (a verify() that fails reverts, so success means `attested` was emitted)", attested, `ledger ${tx.ledger}`);

  // ---- 2 · the pairing check, run again by the verifier contract itself ----
  const signals = Array.from({ length: pub.length / 32 }, (_, i) => word(pub, i));
  const proofStruct = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: nativeToScVal("a", { type: "symbol" }), val: nativeToScVal(proof.subarray(0, 64)) }),
    new xdr.ScMapEntry({ key: nativeToScVal("b", { type: "symbol" }), val: nativeToScVal(proof.subarray(64, 192)) }),
    new xdr.ScMapEntry({ key: nativeToScVal("c", { type: "symbol" }), val: nativeToScVal(proof.subarray(192, 256)) }),
  ]);
  const signalsVec = xdr.ScVal.scvVec(signals.map((s) => nativeToScVal(s, { type: "u256" })));
  const valid = await call(VERIFIER, "verify_proof", proofStruct, signalsVec);
  ok("the verifier re-runs the Groth16 pairing check on this proof: valid", valid === true);

  // ---- 3 · every public signal against the treasury's own state ----
  const [daily, perTask, root, period, spent] = signals;
  const cfg = (await call(treasury, "get_config")) as { daily_limit: bigint; per_task_limit: bigint };
  const onRoot = (await call(treasury, "whitelist_root")) as Buffer | null;
  const onSpent = (await call(treasury, "period_spent", nativeToScVal(period, { type: "u64" }))) as bigint;
  const last = (await call(VERIFIER, "last_period", Address.fromString(treasury).toScVal())) as bigint | null;
  ok("the proof's limits are the treasury's limits", daily === BigInt(cfg.daily_limit) && perTask === BigInt(cfg.per_task_limit),
    `daily ${daily}, per payment ${perTask}`);
  ok("the proof's payee root is the treasury's published root", onRoot !== null && root === BigInt("0x" + Buffer.from(onRoot).toString("hex")));
  ok("the proved total is what the treasury recorded for the period", spent === BigInt(onSpent), `period ${period} (UTC day), total ${spent} stroops`);
  ok("the verifier has recorded this period as attested", last !== null && BigInt(last) >= period, `last attested period ${last}`);

  console.log(process.exitCode ? "\nNOT attested" : `\nattested — treasury ${treasury}, period ${period}: every payment ≤ the per-payment cap, total ≤ the daily cap, every payee in the published root; amounts and payees not revealed`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
