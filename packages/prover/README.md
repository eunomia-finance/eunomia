# prover

Off-chain tooling for Eunomia's ZK compliance layer: turns snarkjs Groth16 output
into the byte layout the on-chain BN254 verifier expects, maps Stellar payees onto
the circuit's field, reads a period's real payments off the chain, and lets anyone
check an attestation.

| File | Role |
|---|---|
| `src/encode.ts` | snarkjs proof/public-signals JSON → Soroban raw bytes (proof 256B, publics 672B) |
| `src/salt.ts` | CSPRNG commitment salts (closes the hiding break a predictable salt would open) |
| `src/payeeField.ts` | a Stellar address → the circuit's payee field element (SHA-256 of the StrKey, top 248 bits) |
| `src/chain.ts` | a closed period's `paid` events — the batch a proof must account for |
| `src/submit.ts` | drives `stellar contract invoke verify(...)` via the CLI |
| `src/check-attestation.ts` | checks an attestation from its tx hash alone — no keys, no ZK tooling |
| `src/emit-fixtures.ts` | writes `proof.bin`/`public.bin` test fixtures from `circuits/build/…` output |

## Check an attestation

```bash
cd packages/prover && npm install
npx tsx src/check-attestation.ts --tx <attestation tx hash>
```

It reads the transaction, asks the on-chain verifier to re-run the Groth16 pairing check
on the proof inside it (`verify_proof`, simulated — nothing is signed or sent), and
compares every public signal with the treasury's own on-chain limits, payee root and
recorded period total. The public RPC keeps about 7 days of transactions.

## Close a period with a proof

```bash
cd circuits
npx tsx scripts/prove-and-submit.ts --treasury <C…> --payees <G…,G…> --source <admin identity> [--publish-root]
```

Rebuilds the payee root from real addresses (each confirmed with `is_payee`), reads
yesterday's `paid` events, checks they add up to `period_spent`, proves with snarkjs
(plain JavaScript — no WSL) and submits as the treasury's admin. Needs the ZK build
artifacts in `circuits/build/` (gitignored) and the `stellar` CLI.

`npm test` runs the salt and payee-field tests — self-contained, no network.
