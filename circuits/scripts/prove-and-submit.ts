// End-to-end live pipeline: close a treasury's period with an on-chain compliance proof.
//
// Nothing here is ours to choose. The limits come from the treasury; the payments are the
// treasury's own `paid` events for the period; their total must equal the treasury's
// `period_spent`; the payee root is rebuilt from real Stellar addresses, each of which the
// treasury confirms with `is_payee`. The verifier then re-reads the limits, the root and the
// total itself — a batch that does not match is refused on-chain.
//
//   npx tsx scripts/prove-and-submit.ts --treasury <C...> --payees <G...,G...>
//     [--period <N>]        UTC day number; default: yesterday (the last closed period)
//     [--source <identity>] stellar CLI key of the treasury's admin; default: zk-deployer
//     [--publish-root]      if the treasury's root differs, publish the rebuilt one first
//     [--force --payments <amount:G...,...>]
//                           prove a batch that contradicts the chain, to watch the
//                           verifier reject it
//
// Proving is plain JavaScript (snarkjs); only the stellar CLI is needed besides node.
import { execFileSync } from "node:child_process";
import { buildTree } from "../test/helpers.js";
import { proveCompliance, N, type CompliancePayment } from "./prove.js";
import { submitProof } from "../../packages/prover/src/submit.js";
import { payeeField, payeeFieldsSorted } from "../../packages/prover/src/payeeField.js";
import { hex32 } from "../../packages/prover/src/encode.js";
import { readPeriodPayments } from "../../packages/prover/src/chain.js";

// N=16 verifier (2026-08-07). Its predecessor CCZKA3K4… expects 13 public signals and
// cannot check a 16-slot batch — proofs from this build do not verify against it.
const VERIFIER = "CD3TB3F4VQF2H56IQC4KV3YLA6QRIF272W5D6PK2SWVTYPXHS4NFDYZ3";
const NETWORK = "testnet";
const RPC_URL = process.env.EUNOMIA_RPC_URL ?? "https://soroban-testnet.stellar.org";
const LEVELS = 8;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function invoke(source: string, id: string, fn: string, args: string[], send: boolean): string {
  return execFileSync(
    "stellar",
    ["contract", "invoke", "--id", id, "--source", source, "--network", NETWORK,
      ...(send ? [] : ["--send=no"]), "--", fn, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

/** The last line of a view call's output is its JSON result. */
const view = (source: string, id: string, fn: string, ...args: string[]) =>
  JSON.parse(invoke(source, id, fn, args, false).split("\n").pop()!);

async function main() {
  const treasury = arg("treasury");
  const payees = arg("payees")?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!treasury || !payees?.length) {
    throw new Error("usage: --treasury <C...> --payees <G...,G...> [--period N] [--source id] [--publish-root]");
  }
  const source = arg("source") ?? "zk-deployer";
  const period = Number(arg("period") ?? Math.floor(Date.now() / 1000 / 86_400) - 1);
  const force = process.argv.includes("--force");

  const cfg = view(source, treasury, "get_config");
  console.log(`treasury ${treasury}\n  daily=${cfg.daily_limit} perTask=${cfg.per_task_limit} admin=${cfg.admin}`);

  // ---- the payee root, rebuilt from real addresses the treasury itself confirms ----
  for (const p of payees) {
    if (view(source, treasury, "is_payee", "--payee", p) !== true) {
      throw new Error(`${p} is not an approved payee of this treasury — it cannot be in the root`);
    }
  }
  const whitelist = payeeFieldsSorted(payees);
  if (whitelist.length > 1 << LEVELS) throw new Error(`at most ${1 << LEVELS} payees fit the tree`);
  const root = hex32((await buildTree(whitelist, LEVELS)).root.toString());
  const onChainRoot = view(source, treasury, "whitelist_root");
  console.log(`  payees ${payees.length}, each confirmed with is_payee\n  root ${root}`);
  if (onChainRoot !== root) {
    if (!process.argv.includes("--publish-root")) {
      throw new Error(`the treasury publishes root ${onChainRoot}; rerun with --publish-root to anchor the rebuilt one`);
    }
    const out = invoke(source, treasury, "set_whitelist_root", ["--root", root], true);
    console.log(`  root published (set_whitelist_root)\n${out}`);
  }

  // ---- the period's real payments, from the treasury's own events ----
  const onChainSpent = BigInt(view(source, treasury, "period_spent", "--period_id", String(period)));
  let payments: CompliancePayment[];
  if (force) {
    payments = (arg("payments") ?? "").split(",").filter(Boolean).map((s) => {
      const [amount, to] = s.split(":");
      return { amount: BigInt(amount), payee: payeeField(to) };
    });
  } else {
    const paid = await readPeriodPayments(RPC_URL, treasury, period);
    for (const p of paid) {
      if (!payees.includes(p.to)) {
        throw new Error(`period ${period} paid ${p.to}, which is not in --payees — the proof could not place it in the root`);
      }
      console.log(`  paid ${p.amount} to ${p.to.slice(0, 6)}… task ${p.taskId}  tx ${p.txHash}`);
    }
    payments = paid.map((p) => ({ amount: p.amount, payee: payeeField(p.to) }));
  }
  if (payments.length > N) throw new Error(`${payments.length} payments; the circuit proves at most ${N} per period`);
  const batchTotal = payments.reduce((a, p) => a + p.amount, 0n);
  console.log(`  period ${period}: ${payments.length} payments, ${batchTotal} in events, ${onChainSpent} per period_spent`);
  if (!force && batchTotal !== onChainSpent) {
    throw new Error("the events do not add up to period_spent — refusing to prove a partial batch");
  }

  // With --force we prove what the batch says even though the chain disagrees, so the
  // rejection happens where it should: on-chain, not in this script.
  const res = await proveCompliance(
    {
      payments,
      whitelist,
      dailyLimit: BigInt(cfg.daily_limit),
      perTaskLimit: BigInt(cfg.per_task_limit),
      periodId: BigInt(period),
      periodSpent: force ? batchTotal : onChainSpent,
    },
    "live",
  );
  console.log(`proved: proof ${res.proof.length}B, public ${res.publicSignals.length}B (verified off-chain)`);

  const out = submitProof({
    verifierId: VERIFIER,
    treasuryId: treasury,
    proof: res.proof,
    publicSignals: res.publicSignals,
    source,
    network: NETWORK,
  });
  console.log(out.ok ? "ATTESTED ✅\n" + out.output : "REJECTED ❌\n" + out.output);
  // snarkjs leaves its curve worker threads running, which keeps node alive after the work
  // is done — the attestation landed on 2026-09-29 while this process never exited.
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
