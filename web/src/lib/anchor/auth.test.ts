import { describe, it, expect, vi } from "vitest";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  WebAuth,
} from "@stellar/stellar-sdk";
import { signIn } from "./auth";
import type { Anchor } from "./discover";

const server = Keypair.random();
const user = Keypair.random();

const anchor: Anchor = {
  homeDomain: "anchor.test",
  networkPassphrase: Networks.TESTNET,
  signingKey: server.publicKey(),
  webAuth: "https://anchor.test/auth",
  transfer: "https://anchor.test/sep6",
  kyc: "https://anchor.test/sep12",
  quote: "https://anchor.test/sep38",
  assetCode: "USDC",
  assetIssuer: Keypair.random().publicKey(),
};

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as Response;

const challengeFor = (account: string, signer = server, homeDomain = "anchor.test") =>
  WebAuth.buildChallengeTx(signer, account, homeDomain, 300, Networks.TESTNET, "anchor.test");

/** An anchor that serves `challenge` and answers the signed POST with a token. */
const anchorServing = (challenge: string) =>
  vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
    init?.method === "POST" ? res(200, { token: "jwt" }) : res(200, { transaction: challenge }),
  );

describe("signIn", () => {
  it("signs a valid challenge and returns the token", async () => {
    const fetchFn = anchorServing(challengeFor(user.publicKey()));
    expect(await signIn(anchor, user, fetchFn as typeof fetch)).toBe("jwt");

    const posted = JSON.parse(fetchFn.mock.calls[1][1]!.body as string) as { transaction: string };
    const tx = TransactionBuilder.fromXDR(posted.transaction, Networks.TESTNET);
    expect(WebAuth.verifyTxSignedBy(tx as never, user.publicKey())).toBe(true);
  });

  it("asks for a challenge for this account and this home domain", async () => {
    const fetchFn = anchorServing(challengeFor(user.publicKey()));
    await signIn(anchor, user, fetchFn as typeof fetch);
    const asked = new URL(fetchFn.mock.calls[0][0] as string);
    expect(asked.searchParams.get("account")).toBe(user.publicKey());
    expect(asked.searchParams.get("home_domain")).toBe("anchor.test");
  });

  it("refuses a challenge signed by a key the toml does not name", async () => {
    const impostor = Keypair.random();
    const fetchFn = anchorServing(challengeFor(user.publicKey(), impostor));
    await expect(signIn(anchor, user, fetchFn as typeof fetch)).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1); // nothing was signed, nothing was posted
  });

  it("refuses a challenge addressed to another account", async () => {
    const fetchFn = anchorServing(challengeFor(Keypair.random().publicKey()));
    await expect(signIn(anchor, user, fetchFn as typeof fetch)).rejects.toThrow(/different account/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses a challenge for another home domain", async () => {
    const fetchFn = anchorServing(challengeFor(user.publicKey(), server, "evil.test"));
    await expect(signIn(anchor, user, fetchFn as typeof fetch)).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses a real payment dressed up as a challenge", async () => {
    // The attack SEP-10 verification exists for: get the key to sign something submittable.
    const payment = new TransactionBuilder(new Account(user.publicKey(), "41"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({ destination: server.publicKey(), asset: Asset.native(), amount: "9000" }),
      )
      .setTimeout(300)
      .build();
    payment.sign(server);
    const fetchFn = anchorServing(payment.toXDR());
    await expect(signIn(anchor, user, fetchFn as typeof fetch)).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses a challenge for another network", async () => {
    const fetchFn = vi.fn(async () =>
      res(200, { transaction: challengeFor(user.publicKey()), network_passphrase: Networks.PUBLIC }),
    );
    await expect(signIn(anchor, user, fetchFn as typeof fetch)).rejects.toThrow(/different Stellar network/);
  });

  it("says so when the anchor returns no token", async () => {
    const fetchFn = vi.fn(async (_u: string | URL | Request, init?: RequestInit) =>
      init?.method === "POST" ? res(200, {}) : res(200, { transaction: challengeFor(user.publicKey()) }),
    );
    await expect(signIn(anchor, user, fetchFn as typeof fetch)).rejects.toThrow(/no token/);
  });
});
