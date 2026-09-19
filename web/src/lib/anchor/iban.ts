// A Turkish IBAN, checked the way a bank would before it accepts a transfer: shape, then the
// ISO 13616 mod-97 checksum. A mistyped IBAN is the one error in a withdrawal that nothing
// on-chain can catch — the USDC is gone and the lira goes to the wrong account, or nowhere.

/** "TR33 0006 1005 1978 6457 8413 26" -> "TR330006100519786457841326" */
export const normalizeIban = (raw: string): string => raw.replace(/\s+/g, "").toUpperCase();

export function isValidTrIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^TR\d{24}$/.test(iban)) return false;
  // Move the country code and check digits to the end, letters become 10..35, then mod 97.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}
