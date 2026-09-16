// Vercel serverless function: fee sponsorship for passkey users.
//
// A smart wallet holds no XLM, so somebody else has to source the transaction. This endpoint
// does that — and nothing more. Authorisation stays with the user: the auth entries are signed
// by their passkey and bound to their wallet's address, so the account paying the fee has no
// say over what the transaction may do. In an open-source repo this URL is public, so every
// request is admitted only after the server decodes what the call actually is. A caller-
// supplied "this goes to contract X" claim is never trusted.
//
// This used to forward to OpenZeppelin Channels. It cannot: passkey-kit signs Protocol 27
// address-bound credentials and the Channels plugin runs stellar-sdk 14.6.1, which fails to
// parse them. See src/lib/relaySubmit.ts for the measurement.
import { Keypair, rpc, xdr } from "@stellar/stellar-sdk";
// Explicit .js extensions — see the note in api/faucet.ts.
import process from "node:process";
import { classifyHostFunction, hostFunctionFromEnvelope } from "../src/lib/hostFunction.js";
import { allowedWasmHashes, isRelayAllowed } from "../src/lib/relayGuard.js";
import { submitEnvelope, submitHostFunction } from "../src/lib/relaySubmit.js";
import { TREASURY_FACTORY_ID } from "../src/lib/treasuryWasm.js";

// Invisible characters smuggled into an env value have bitten this project twice (a BOM in
// the Supabase key, a BOM+CRLF in the WalletConnect id) — both times the symptom was a silent
// failure far from the cause. Strip anything non-printable before use; .trim() alone misses
// zero-width characters.
const clean = (v: string | undefined): string => (v ?? "").replace(/[^\x20-\x7E]/g, "").trim();

const csv = (v: string | undefined): string[] =>
  clean(v).split(",").map((s) => s.trim()).filter(Boolean);

// The native XLM SAC on testnet. This is not configuration: a treasury holds XLM, and both
// funding one and paying out of it are SAC calls, so a passkey session cannot do anything at
// all unless the relay admits it. Widening the gate this far is deliberate and bounded — the
// transfer's `from` is the user's own wallet and only their passkey can authorise it, so the
// worst a stranger can do is spend our testnet fee on moving their own funds.
const NATIVE_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
// The factory is admitted by address for the same reason: a passkey user's one-signature
// setup is a call on it, and the treasury it deploys inside that call runs our wasm.
const ALLOWED_CONTRACTS = [...csv(process.env.RELAY_ALLOWED_CONTRACTS), NATIVE_SAC, TREASURY_FACTORY_ID];
// Includes the treasury wasm this build deploys whether or not the env names it — the two
// drifted once already and silently broke every passkey sign-up. See allowedWasmHashes.
const ALLOWED_WASM = allowedWasmHashes(clean(process.env.RELAY_ALLOWED_WASM));
const RPC_URL = clean(process.env.RELAY_RPC_URL) || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The wasm a deployed contract runs, or null when it isn't on chain. */
async function readWasmHash(contractId: string): Promise<string | null> {
  const server = new rpc.Server(RPC_URL);
  const entry = await server.getContractData(
    contractId,
    xdr.ScVal.scvLedgerKeyContractInstance(),
    rpc.Durability.Persistent,
  );
  const executable = entry.val.contractData().val().instance().executable();
  if (executable.switch().name !== "contractExecutableWasm") return null;
  return executable.wasmHash().toString("hex");
}

/** Decide whether this call may spend our fee quota. Fails closed. */
async function admit(func: string): Promise<boolean> {
  const call = classifyHostFunction(func);
  if (call.kind === "invoke") {
    return isRelayAllowed(call.contractId, {
      contracts: ALLOWED_CONTRACTS,
      wasmHashes: ALLOWED_WASM,
      readWasmHash,
    });
  }
  if (call.kind === "deploy") {
    const seen = call.wasmHash.toLowerCase();
    return ALLOWED_WASM.some((h) => h.toLowerCase() === seen);
  }
  return false; // raw wasm uploads and anything unrecognised
}

// Named HTTP methods rather than `export default` — see the note in api/faucet.ts.
async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // The same throwaway testnet key the faucet uses. It pays fees and holds nothing of the
  // user's. Both endpoints sourcing from one account means two simultaneous requests can
  // collide on its sequence number; at this traffic that is a retry, not a design.
  const secret = clean(process.env.DISPENSER_SECRET);
  let keypair: Keypair | null = null;
  try {
    if (secret) keypair = Keypair.fromSecret(secret);
  } catch {
    keypair = null;
  }
  if (!keypair) return json({ error: "Relay is not configured." }, 503);

  let body: { func?: unknown; auth?: unknown; xdr?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const { func, auth, xdr: envelope } = body;

  // Two shapes reach the relay. Treasury calls arrive decoded (func + auth entries), while
  // passkey-kit's wallet deployment arrives as a fully signed envelope. Both go through the
  // same admission gate — the envelope's host function is read out of it first.
  const isFuncCall =
    typeof func === "string" && Array.isArray(auth) && auth.every((a) => typeof a === "string");
  const isEnvelope = typeof envelope === "string" && envelope.length > 0;
  if (!isFuncCall && !isEnvelope) return json({ error: "Malformed request." }, 400);

  const gated = isFuncCall ? (func as string) : hostFunctionFromEnvelope(envelope as string);
  if (!gated || !(await admit(gated))) return json({ error: "Not allowed." }, 403);

  const deps = {
    server: new rpc.Server(RPC_URL),
    keypair,
    networkPassphrase: NETWORK_PASSPHRASE,
  };

  try {
    const result = isFuncCall
      ? await submitHostFunction(
          deps,
          xdr.HostFunction.fromXDR(func as string, "base64"),
          (auth as string[]).map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64")),
        )
      : await submitEnvelope(deps, envelope as string);
    return json({ hash: result.hash, status: result.status }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("relay failed:", msg);
    return json({ error: "Relay failed." }, 502);
  }
}

export const GET = handler;
export const POST = handler;
