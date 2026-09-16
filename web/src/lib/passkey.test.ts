import { describe, it, expect, vi } from "vitest";
import { makePasskeyWallet, type PasskeyBackend } from "./passkey";

const CONTRACT = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
const KEY_ID = "AAECAwQFBgcICQoLDA0ODw";
const PUBKEY = new Uint8Array([4, 1, 2, 3]);
const RECOVERY_G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const RECOVERY_S = "SDR3TFQCTSRWKTC5S5SYRLZR7LEXDD3VJ3XPWXTEZBBRHPPHAAXPDPY7";

const backend = (over: Partial<PasskeyBackend> = {}): PasskeyBackend => ({
  createWallet: vi
    .fn()
    .mockResolvedValue({ contractId: CONTRACT, signedTx: "DEPLOY_XDR", keyId: KEY_ID }),
  connectWallet: vi.fn().mockResolvedValue({ contractId: CONTRACT, keyId: KEY_ID }),
  connected: vi.fn().mockReturnValue(false),
  sign: vi.fn().mockImplementation((tx) => Promise.resolve({ ...tx, signed: true })),
  signAuthEntry: vi.fn().mockImplementation((e) => Promise.resolve({ ...e, signed: true })),
  createKey: vi.fn().mockResolvedValue({ keyId: KEY_ID, publicKey: PUBKEY }),
  addEd25519Signer: vi.fn().mockResolvedValue({ signedAdd: true }),
  addSecp256r1Signer: vi.fn().mockResolvedValue({ signedRekey: true }),
  ...over,
});

describe("makePasskeyWallet", () => {
  it("registers a passkey and returns the wallet address, deploy transaction and key id", async () => {
    // createWallet does NOT submit — it hands back a signed deploy tx for the relay.
    // The key id comes back too: it is what lets a later session re-attach without a ceremony.
    const be = backend();
    const w = makePasskeyWallet(be, "Eunomia");

    await expect(w.create("bekir")).resolves.toEqual({
      contractId: CONTRACT,
      signedTx: "DEPLOY_XDR",
      keyId: KEY_ID,
    });
    expect(be.createWallet).toHaveBeenCalledWith("Eunomia", "bekir");
  });

  it("connects an existing wallet and returns its address", async () => {
    const be = backend();
    const w = makePasskeyWallet(be, "Eunomia");

    await expect(w.connect()).resolves.toEqual({ contractId: CONTRACT, keyId: KEY_ID });
  });

  it("connects a known key id directly, skipping the discovery ceremony", async () => {
    const be = backend();
    const w = makePasskeyWallet(be, "Eunomia");

    await w.connect(KEY_ID);

    expect(be.connectWallet).toHaveBeenCalledWith(KEY_ID, undefined);
  });

  it("passes an assembled transaction through the kit's signer", async () => {
    // The kit signs AssembledTransactions, not raw XDR strings — the wallet auth entries
    // are filled in place, which is why the object round-trips rather than a string.
    const be = backend();
    const w = makePasskeyWallet(be, "Eunomia");

    await expect(w.sign({ id: 1 })).resolves.toEqual({ id: 1, signed: true });
    expect(be.sign).toHaveBeenCalledWith({ id: 1 });
  });

  it("turns a dismissed OS prompt into something the user can act on", async () => {
    const be = backend({
      createWallet: vi.fn().mockRejectedValue(
        new Error("NotAllowedError: The operation either timed out or was not allowed"),
      ),
    });
    const w = makePasskeyWallet(be, "Eunomia");

    await expect(w.create("bekir")).rejects.toThrow(/cancelled/i);
    await expect(w.create("bekir")).rejects.not.toThrow(/NotAllowedError/);
  });

  it("signs a single auth entry", async () => {
    // Deploying a treasury is not a contract-client call, so there is no AssembledTransaction
    // to hand over — only the one auth entry simulation produced.
    const be = backend();
    const w = makePasskeyWallet(be, "Eunomia");

    await expect(w.signAuthEntry({ entry: 1 })).resolves.toEqual({ entry: 1, signed: true });
  });

  describe("ensureConnected", () => {
    // The regression this whole block guards: every call to executorFor() built a FRESH kit,
    // and a fresh kit holds no wallet. passkey-kit's sign() throws "A wallet must be connected"
    // in that state, which reached the user as "Couldn't use your passkey" — on treasury
    // creation and on every payment after it.
    it("re-attaches a kit that holds no wallet, using the stored key id", async () => {
      const be = backend({ connected: vi.fn().mockReturnValue(false) });
      const w = makePasskeyWallet(be, "Eunomia");

      await w.ensureConnected(KEY_ID);

      expect(be.connectWallet).toHaveBeenCalledWith(KEY_ID);
    });

    it("does nothing when the kit is already connected", async () => {
      const be = backend({ connected: vi.fn().mockReturnValue(true) });
      const w = makePasskeyWallet(be, "Eunomia");

      await w.ensureConnected(KEY_ID);

      expect(be.connectWallet).not.toHaveBeenCalled();
    });

    it("falls back to the discovery ceremony when no key id was stored", async () => {
      // A passkey created before key ids were persisted still has to be able to sign.
      const be = backend({ connected: vi.fn().mockReturnValue(false) });
      const w = makePasskeyWallet(be, "Eunomia");

      await w.ensureConnected(undefined);

      expect(be.connectWallet).toHaveBeenCalledWith(undefined);
    });
  });

  describe("recovery seam", () => {
    it("registers a bare passkey — no wallet deploy attached", async () => {
      const be = backend();
      const w = makePasskeyWallet(be, "Eunomia");

      await expect(w.createKey("bekir")).resolves.toEqual({
        keyId: KEY_ID,
        publicKey: PUBKEY,
      });
      expect(be.createKey).toHaveBeenCalledWith("Eunomia", "bekir");
    });

    it("adds the recovery signer scoped to the wallet contract alone", async () => {
      // The security property of the whole feature lives in this call: the limits
      // map must contain the wallet and nothing else, so a stolen recovery code
      // can re-key the wallet but never authorize a treasury call.
      const be = backend();
      const w = makePasskeyWallet(be, "Eunomia");

      await expect(w.addRecoverySigner(RECOVERY_G, CONTRACT)).resolves.toEqual({
        signedAdd: true,
      });
      expect(be.addEd25519Signer).toHaveBeenCalledWith(
        RECOVERY_G,
        new Map([[CONTRACT, undefined]]),
      );
    });

    it("re-keys the wallet with a fresh passkey signed by the recovery secret", async () => {
      const be = backend();
      const w = makePasskeyWallet(be, "Eunomia");

      await expect(
        w.addPasskeyFromRecovery(CONTRACT, KEY_ID, PUBKEY, RECOVERY_S),
      ).resolves.toEqual({ signedRekey: true });
      expect(be.addSecp256r1Signer).toHaveBeenCalledWith(CONTRACT, KEY_ID, PUBKEY, RECOVERY_S);
    });

    it("connects a recovered wallet by key id with the wallet as a lookup hint", async () => {
      // Address derivation works from the ORIGINAL passkey's key id; a recovered
      // wallet's new key id derives a different address, so the hint from the
      // recovery code is what lets connectWallet find the right contract.
      const be = backend();
      const w = makePasskeyWallet(be, "Eunomia");

      await w.connectRecovered(KEY_ID, CONTRACT);

      expect(be.connectWallet).toHaveBeenCalledWith(KEY_ID, expect.any(Function));
      const resolve = vi.mocked(be.connectWallet).mock.calls[0][1]!;
      expect(resolve(KEY_ID)).toBe(CONTRACT);
    });

    it("signs in with a device-remembered resolver so a recovered wallet is found again", async () => {
      const be = backend();
      const w = makePasskeyWallet(be, "Eunomia");
      const resolve = (k: string) => (k === KEY_ID ? CONTRACT : undefined);

      await w.connect(undefined, resolve);

      expect(be.connectWallet).toHaveBeenCalledWith(undefined, resolve);
    });

    it("humanises recovery-path failures like every other passkey step", async () => {
      const be = backend({
        createKey: vi
          .fn()
          .mockRejectedValue(new Error("NotAllowedError: The operation was not allowed")),
      });
      const w = makePasskeyWallet(be, "Eunomia");

      await expect(w.createKey("bekir")).rejects.toThrow(/cancelled/i);
      await expect(w.createKey("bekir")).rejects.not.toThrow(/NotAllowedError/);
    });
  });

  it("keeps a wallet-ownership failure distinct — that one is not a cancellation", async () => {
    // The kit verifies that the passkey really is a signer on the wallet it resolved;
    // telling the user "cancelled" there would send them in circles.
    const be = backend({
      connectWallet: vi.fn().mockRejectedValue(new Error("WalletOwnershipError: keyId is not a signer")),
    });
    const w = makePasskeyWallet(be, "Eunomia");

    await expect(w.connect()).rejects.toThrow(/couldn't open your wallet/i);
  });

  it("tells a signing-in user when the passkey has no wallet, instead of 'cancelled' or 'try again'", async () => {
    // The kit's WALLET_NOT_FOUND: the picked passkey derives nothing on-chain and no
    // device memory knows it — typically a passkey from another site or account.
    const be = backend({
      connectWallet: vi
        .fn()
        .mockRejectedValue(new Error("Could not resolve a wallet for the given passkey")),
    });
    const w = makePasskeyWallet(be, "Eunomia");

    await expect(w.connect()).rejects.toThrow(/no treasury wallet belongs to that passkey/i);
  });
});
