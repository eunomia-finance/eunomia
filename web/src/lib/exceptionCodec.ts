// An exception request lives on the agent's own Stellar account as a data entry: only the
// Leash key can write there, so the owner's dashboard needs no server to trust it, and the
// request carries a tx hash like everything else in this product. Data entries hold at most
// 64 bytes, hence a fixed binary layout. This file is copied verbatim into
// web/src/lib/exceptionCodec.ts (CI keeps the two byte-identical) — keep it browser-safe.
import { StrKey } from "@stellar/stellar-sdk";

export const EXCEPTION_PREFIX = "eunomia.x.";
export const EXCEPTION_VERSION = 1;
export const EXCEPTION_PAYLOAD_BYTES = 56;

// Layout (big-endian):
//   [0]      version
//   [1]      payee type — 0 = G (ed25519 account), 1 = C (contract)
//   [2..34)  payee, 32 raw bytes
//   [34..42) amount, u64 stroops
//   [42..50) task id, u64
//   [50..52) reason mask, u16 — bit N set = contract error code N
//   [52..56) requested at, u32 unix seconds

export interface ExceptionPayload {
  payee: string;
  /** stroops */
  amount: bigint;
  taskId: bigint;
  /** the treasury contract's error codes the pre-flight raised, ascending */
  reasonCodes: number[];
  /** unix seconds */
  requestedAt: number;
}

/** `eunomia.x.<first 8 of the treasury id>.<ms in base36>` — scoped per treasury,
 *  unique per request, well under the 64-byte name limit. */
export const exceptionEntryName = (treasuryId: string, requestedAtMs: number): string =>
  `${EXCEPTION_PREFIX}${treasuryId.slice(0, 8)}.${requestedAtMs.toString(36)}`;

export const exceptionIdOf = (name: string): string => name.slice(EXCEPTION_PREFIX.length);

export const isExceptionEntryFor = (name: string, treasuryId: string): boolean =>
  name.startsWith(`${EXCEPTION_PREFIX}${treasuryId.slice(0, 8)}.`);

export function encodeExceptionPayload(p: ExceptionPayload): Uint8Array {
  const out = new Uint8Array(EXCEPTION_PAYLOAD_BYTES);
  const view = new DataView(out.buffer);
  out[0] = EXCEPTION_VERSION;
  if (StrKey.isValidEd25519PublicKey(p.payee)) {
    out[1] = 0;
    out.set(StrKey.decodeEd25519PublicKey(p.payee), 2);
  } else if (StrKey.isValidContract(p.payee)) {
    out[1] = 1;
    out.set(StrKey.decodeContract(p.payee), 2);
  } else {
    throw new Error(`payee "${p.payee}" is not a Stellar G… or C… address`);
  }
  view.setBigUint64(34, p.amount);
  view.setBigUint64(42, p.taskId);
  let mask = 0;
  for (const c of p.reasonCodes) if (c >= 1 && c <= 15) mask |= 1 << c;
  view.setUint16(50, mask);
  view.setUint32(52, p.requestedAt);
  return out;
}

export function decodeExceptionPayload(bytes: Uint8Array): ExceptionPayload {
  if (bytes.length !== EXCEPTION_PAYLOAD_BYTES) {
    throw new Error(`exception payload length ${bytes.length}, expected ${EXCEPTION_PAYLOAD_BYTES}`);
  }
  if (bytes[0] !== EXCEPTION_VERSION) {
    throw new Error(`exception payload version ${bytes[0]}, expected ${EXCEPTION_VERSION}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const raw = Buffer.from(bytes.subarray(2, 34));
  const payee = bytes[1] === 1 ? StrKey.encodeContract(raw) : StrKey.encodeEd25519PublicKey(raw);
  const mask = view.getUint16(50);
  const reasonCodes: number[] = [];
  for (let c = 1; c <= 15; c++) if (mask & (1 << c)) reasonCodes.push(c);
  return {
    payee,
    amount: view.getBigUint64(34),
    taskId: view.getBigUint64(42),
    reasonCodes,
    requestedAt: view.getUint32(52),
  };
}
