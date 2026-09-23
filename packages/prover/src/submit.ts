// Live submitter: send a compliance proof to the on-chain verifier (testnet).
// Wraps the stellar CLI so the deployer key stays in the OS keychain (never in code) —
// the programmatic, repeatable replacement for the one-off manual verify.
import { execFileSync } from "node:child_process";

export interface SubmitOptions {
  verifierId: string;
  /** The treasury the proof is about. The verifier reads its policy and period total
   *  from here, and requires the treasury admin's signature — so `source` must be it. */
  treasuryId: string;
  proof: Buffer; // 256 bytes
  publicSignals: Buffer; // 672 bytes (21 field elements)
  source?: string; // keychain identity, default zk-deployer
  network?: string; // default testnet
}

export interface SubmitResult {
  ok: boolean;
  output: string; // CLI stdout (tx hash + attested event) on success, trap reason on failure
}

/** Invoke verify(treasury, proof_bytes, public_bytes) on the deployed verifier. A policy
 *  that disagrees with the treasury, a total that does not match what it actually spent,
 *  an open or already-attested period — each traps on-chain and surfaces as { ok: false }. */
export function submitProof(opts: SubmitOptions): SubmitResult {
  const source = opts.source ?? "zk-deployer";
  const network = opts.network ?? "testnet";
  try {
    const output = execFileSync(
      "stellar",
      [
        "contract", "invoke",
        "--id", opts.verifierId,
        "--source", source,
        "--network", network,
        "--",
        "verify",
        "--treasury", opts.treasuryId,
        "--proof_bytes", opts.proof.toString("hex"),
        "--public_bytes", opts.publicSignals.toString("hex"),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, output };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    return { ok: false, output: String(err.stderr ?? err.message ?? e) };
  }
}
