// SEP-1. The whole handoff with an anchor is two values — a home domain and an asset code.
// Every endpoint, the signing key and the issuer are read from its stellar.toml, so moving
// from the testnet sandbox to a production SEP-6 anchor changes this file's input, not the
// integration.
import { StellarToml } from "@stellar/stellar-sdk";

/** The TRY <-> USDC sandbox the Pro Hackathon runs on. Testnet only. */
export const ANCHOR_HOME_DOMAIN = "tr-mock-anchor.fly.dev";

export interface Anchor {
  homeDomain: string;
  networkPassphrase: string;
  /** The key that signs SEP-10 challenges. A challenge from anyone else is refused. */
  signingKey: string;
  webAuth: string;
  transfer: string;
  kyc: string;
  quote: string;
  assetCode: string;
  assetIssuer: string;
}

type Toml = Record<string, unknown>;
export type TomlResolver = (homeDomain: string) => Promise<Toml>;

const ENDPOINTS = {
  webAuth: "WEB_AUTH_ENDPOINT",
  transfer: "TRANSFER_SERVER",
  kyc: "KYC_SERVER",
  quote: "ANCHOR_QUOTE_SERVER",
} as const;

/** Read an anchor's stellar.toml into the handful of values the ramp needs.
 *
 *  Refuses a toml for another network: a JWT or a deposit address from the wrong network is
 *  not a degraded experience, it is money sent somewhere it cannot be recovered from. */
export async function discoverAnchor(
  homeDomain: string,
  assetCode: string,
  networkPassphrase: string,
  resolve: TomlResolver = (d) => StellarToml.Resolver.resolve(d) as Promise<Toml>,
): Promise<Anchor> {
  const toml = await resolve(homeDomain);

  if (toml.NETWORK_PASSPHRASE !== networkPassphrase) {
    throw new Error(`${homeDomain} serves a different Stellar network than this app is on.`);
  }

  const text = (key: string): string => {
    const v = toml[key];
    if (typeof v !== "string" || !v) throw new Error(`${homeDomain} does not publish ${key}.`);
    return v;
  };
  const endpoint = (key: string): string => {
    const url = text(key);
    if (!url.startsWith("https://")) throw new Error(`${homeDomain} publishes ${key} without https.`);
    return url.replace(/\/+$/, "");
  };

  const currencies = Array.isArray(toml.CURRENCIES) ? (toml.CURRENCIES as Toml[]) : [];
  const asset = currencies.find((c) => c.code === assetCode);
  if (!asset || typeof asset.issuer !== "string") {
    throw new Error(`${homeDomain} does not ramp ${assetCode}.`);
  }

  return {
    homeDomain,
    networkPassphrase,
    signingKey: text("SIGNING_KEY"),
    webAuth: endpoint(ENDPOINTS.webAuth),
    transfer: endpoint(ENDPOINTS.transfer),
    kyc: endpoint(ENDPOINTS.kyc),
    quote: endpoint(ENDPOINTS.quote),
    assetCode,
    assetIssuer: asset.issuer,
  };
}

/** SEP-38 asset identifiers for the two sides of the ramp. */
export const FIAT_TRY = "iso4217:TRY";
export const stellarAsset = (a: Anchor): string => `stellar:${a.assetCode}:${a.assetIssuer}`;
