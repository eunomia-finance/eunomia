// Level 2 — multi-wallet via StellarWalletsKit. The connect button opens a modal of
// wallet options (Freighter / xBull / Albedo / Lobstr / Rabet / Hana); then show the
// testnet XLM balance and send an XLM payment with success/failure + tx-hash feedback.
// Three error types are surfaced: wallet not installed, request rejected, insufficient
// balance. (Premium visual pass is a later phase with Gemini; this is the functional layer.)
import { useCallback, useEffect, useState } from "react";
import { Asset, BASE_FEE, Horizon, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { EXPLORER, HORIZON_URL, NETWORK_PASSPHRASE, shortAddr } from "../config";
import { connectErr, sendErr } from "../lib/wallet-errors";
import { kit, connect as kitConnect, disconnect as kitDisconnect } from "../lib/walletKit";
import { useWalletAddress } from "../lib/useWalletAddress";
import { getContractXlmBalance, getXlmBalance } from "../lib/funding";
import { isValidContractId } from "../lib/userTreasury";
import { isValidPaymentDest, parseXlmAmount } from "../lib/validate";

const server = new Horizon.Server(HORIZON_URL);

type Status = { kind: "idle" | "info" | "success" | "error"; msg: string; hash?: string };

export default function Wallet() {
  const address = useWalletAddress();
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle", msg: "" });
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [prevAddress, setPrevAddress] = useState(address);
  if (address !== prevAddress) {
    setPrevAddress(address);
    if (!address) {
      setBalance(null);
      setBalanceError(false);
      setDest("");
      setAmount("");
      setStatus({ kind: "idle", msg: "" });
    } else {
      setBalance(null);
      setBalanceError(false);
    }
  }

  const loadBalance = useCallback(async (addr: string) => {
    try {
      // getXlmBalance distinguishes an unfunded account (404 → null) from a network/Horizon
      // failure (throws) — so a transient RPC outage no longer masquerades as a "0" balance.
      // A passkey smart wallet (C…) has no Horizon account; its XLM lives in the SAC.
      const xlm = isValidContractId(addr) ? await getContractXlmBalance(addr) : await getXlmBalance(addr);
      setBalance(xlm ?? 0);
      // Clear a previous failure on success: the refresh button and the post-send reload
      // both call this with the SAME address, so the address-change reset above never fires
      // for them — without this the error state would stick until reconnect.
      setBalanceError(false);
    } catch {
      setBalanceError(true);
    }
  }, []);

  useEffect(() => {
    if (!address) return;
    void (async () => {
      await loadBalance(address);
    })();
  }, [address, loadBalance]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setStatus({ kind: "info", msg: "Choose a wallet…" });
    try {
      await kitConnect();
      setStatus({ kind: "idle", msg: "" });
      // Balance loads via the [address] effect — no need to fetch it a second time here.
    } catch (e) {
      setStatus({ kind: "error", msg: connectErr(e) });
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await kitDisconnect();
    setBalance(null);
    setBalanceError(false);
    setDest("");
    setAmount("");
    setStatus({ kind: "idle", msg: "" });
  }, []);

  const send = useCallback(async () => {
    if (!address) return;
    if (!isValidPaymentDest(dest)) {
      setStatus({ kind: "error", msg: "Enter a valid destination address (G… or M…)." });
      return;
    }
    const parsed = parseXlmAmount(amount);
    if (!parsed.ok) {
      setStatus({ kind: "error", msg: parsed.msg });
      return;
    }
    setBusy(true);
    setStatus({ kind: "info", msg: "Building transaction…" });
    try {
      const source = await server.loadAccount(address);
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.payment({ destination: dest.trim(), asset: Asset.native(), amount: amount.trim() }),
        )
        .setTimeout(180)
        .build();

      setStatus({ kind: "info", msg: "Awaiting wallet signature…" });
      const { signedTxXdr } = await kit.signTransaction(tx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
        address,
      });

      setStatus({ kind: "info", msg: "Submitting to testnet…" });
      const toSubmit = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
      const res = await server.submitTransaction(toSubmit);
      setStatus({ kind: "success", msg: "Payment sent — confirmed on testnet ✓", hash: res.hash });
      setAmount("");
      setDest("");
      await loadBalance(address);
    } catch (e) {
      setStatus({ kind: "error", msg: sendErr(e) });
    } finally {
      setBusy(false);
    }
  }, [address, dest, amount, loadBalance]);

  const statusColor =
    status.kind === "success" ? "var(--ink)" : status.kind === "error" ? "var(--red)" : "var(--ink-2)";

  return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={{ margin: 0, fontSize: 27, letterSpacing: "-0.02em", fontFamily: "'Questrial', system-ui, sans-serif", fontWeight: 500 }}>
          <span style={{ color: "var(--ink)" }}>◭</span> Wallet
        </h1>
        <p style={{ color: "var(--ink-2)", marginTop: 6, fontSize: 14 }}>
          Connect any Stellar wallet, view your testnet XLM balance, and send a payment.
        </p>

        {!address ? (
          <button
            style={{ ...primaryBtn, opacity: connecting ? 0.6 : 1 }}
            onClick={connect}
            disabled={connecting}
          >
            {connecting ? "Connecting…" : "Connect a wallet"}
          </button>
        ) : (
          <>
            <div style={row}>
              <div>
                <div style={label}>Connected</div>
                <div style={mono}>{shortAddr(address)}</div>
              </div>
              <button style={ghostBtn} onClick={disconnect}>
                Disconnect
              </button>
            </div>

            <div style={balanceBox}>
              <div style={label}>Balance</div>
              <div style={{ fontSize: 28, fontWeight: 600 }}>
                {balanceError
                  ? "—"
                  : balance === null
                    ? "…"
                    : `${balance.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM`}
              </div>
              {balanceError && (
                <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 4 }}>
                  Couldn't read your balance — tap refresh to retry.
                </div>
              )}
              <button style={linkBtn} onClick={() => loadBalance(address)} aria-label="Refresh balance">
                ↻ Refresh
              </button>
            </div>

            {isValidContractId(address) ? (
              // This form builds a classic payment with the wallet as source, which a smart
              // wallet cannot be — every attempt would fail.
              <p style={{ color: "var(--ink-2)", marginTop: 18, fontSize: 13.5 }}>
                This is a passkey wallet — it moves funds through your treasury, not from here.
              </p>
            ) : (
              <div style={{ marginTop: 18 }}>
                <div style={label}>Send XLM (testnet)</div>
                <input
                  style={input}
                  placeholder="Destination address (G…)"
                  aria-label="Destination address"
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                />
                <input
                  style={input}
                  placeholder="Amount (XLM)"
                  aria-label="Amount in XLM"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} onClick={send} disabled={busy}>
                  {busy ? "Sending…" : "Send payment"}
                </button>
              </div>
            )}
          </>
        )}

        {status.msg && (
          <div style={{ ...statusBox, color: statusColor, borderColor: statusColor + "44" }}>
            {status.msg}
            {status.hash && (
              <>
                {" "}
                <a style={{ color: statusColor }} href={`${EXPLORER}/tx/${status.hash}`} target="_blank" rel="noreferrer">
                  view tx ↗
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- minimal functional styling (premium re-design is a later phase with Gemini) ---
const wrap: React.CSSProperties = { minHeight: "100vh", display: "grid", placeItems: "center", padding: "84px 16px 24px" };
const card: React.CSSProperties = {
  width: "100%", maxWidth: 460, padding: 28, borderRadius: 18,
  background: "var(--surface)", border: "1px solid var(--line)",
  backdropFilter: "blur(12px)", color: "var(--ink)",
};
const label: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-2)" };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 14, marginTop: 2 };
const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 };
const balanceBox: React.CSSProperties = { marginTop: 16, padding: 16, borderRadius: 12, background: "var(--line)" };
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", marginTop: 8, padding: "11px 13px", borderRadius: 10,
  background: "var(--bg)", border: "1px solid var(--line)", color: "var(--ink)",
};
const primaryBtn: React.CSSProperties = {
  width: "100%", marginTop: 16, padding: "12px 16px", borderRadius: 11, border: "none", cursor: "pointer",
  background: "var(--ink)", color: "var(--bg)", fontWeight: 600, fontSize: 15,
};
const ghostBtn: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 9, cursor: "pointer", fontSize: 13,
  background: "transparent", border: "1px solid var(--line)", color: "var(--ink-2)",
};
const linkBtn: React.CSSProperties = { marginTop: 8, background: "none", border: "none", color: "var(--ink)", cursor: "pointer", fontSize: 13, padding: 0 };
const statusBox: React.CSSProperties = { marginTop: 18, padding: "10px 13px", borderRadius: 10, border: "1px solid", fontSize: 13.5, lineHeight: 1.4 };
