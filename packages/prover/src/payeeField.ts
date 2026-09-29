// A Stellar address -> the compliance circuit's payee field element.
//
// The circuit proves membership of Poseidon(payee) in the treasury's published root, so a
// payee has to become one BN254 field element, the same way for everyone who checks it.
// The mapping is deliberately boring: SHA-256 of the address as written (its StrKey), top
// 248 bits. 248 bits is always below the field modulus r (~2^253.6), so no value wraps and
// no two addresses can alias through a reduction; collisions are SHA-256 collisions.
//
// Anyone can rebuild a treasury's root from its payee addresses with this function alone —
// which is what turns the published root from a bare owner statement into a checkable one.
import { createHash } from "node:crypto";

const STRKEY = /^[GC][A-Z2-7]{55}$/;

export function payeeField(address: string): bigint {
  if (!STRKEY.test(address)) {
    throw new Error(`not a Stellar account (G…) or contract (C…) address: ${address}`);
  }
  const digest = createHash("sha256").update(address, "utf8").digest("hex");
  return BigInt("0x" + digest.slice(0, 62)); // 31 bytes = 248 bits
}

/** Payee fields in the order the tree is built: ascending, so the root depends only on the
 *  set of addresses, not on the order someone happened to list them in. */
export function payeeFieldsSorted(addresses: string[]): bigint[] {
  const fields = [...new Set(addresses)].map(payeeField);
  return fields.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
