// A treasury holds exactly one token, fixed when it is created. Two are offered: XLM, funded
// from the owner's wallet, and the anchor's USDC, funded with TRY through the anchor. Both
// are 7-decimal, so every amount in the app is the same arithmetic under a different label.
import { XLM_SAC } from "./userTreasury";

/** The Stellar Asset Contract of USDC:GBBD47IF…FLA5 on testnet — the asset the TRY anchor
 *  pays out. Derivable from the issuer (token.test.ts pins it to that derivation); written
 *  out so a label never has to wait for the anchor's stellar.toml. */
export const ANCHOR_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export type TokenCode = "XLM" | "USDC";

export const tokenIdOf = (code: TokenCode): string => (code === "USDC" ? ANCHOR_USDC : XLM_SAC);

/** The label for a treasury's token. Anything unrecognised reads as XLM, which is what every
 *  treasury was before the choice existed. */
export const tokenCodeOf = (tokenId: string | null | undefined): TokenCode =>
  tokenId === ANCHOR_USDC ? "USDC" : "XLM";
