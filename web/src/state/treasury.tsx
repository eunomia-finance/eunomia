// The single source of truth for the connected-user experience: wallet address, active
// treasury, on-chain state/lifecycle, and every treasury action — lifted out of the old
// Workspace so all shell pages read one context. Transaction progress/results surface as
// toasts; validation failures return `{ validation: true }` and render inline at the form.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connect as kitConnect, executorFor } from "../lib/walletKit";
import { useWalletAddress } from "../lib/useWalletAddress";
import {
  clearTreasuryId,
  getTreasuryId,
  listTreasuries,
  setActiveTreasury,
  setTreasuryId,
} from "../lib/treasuryStore";
import { waitForBalanceChange } from "../lib/balanceWait";
import { createTreasury, type TreasurySetup } from "../lib/createTreasury";
import {
  addPayee,
  adminWithdraw,
  fundTreasury,
  isValidContractId,
  isOwnedBy,
  makeTreasury,
  pay,
  readLifecycle,
  readState,
  removePayee,
  revokeSession,
  setLimits,
  setPaused,
  type Lifecycle,
  type EunomiaState,
} from "../lib/userTreasury";
import { ATTACKER, NETWORK_PASSPHRASE, RPC_URL, SERVICE, shortAddr } from "../config";
import {
  demoAmount,
  initialLoop,
  unitsOf,
  withStep,
  type LoopStep,
  type LoopStepKey,
} from "../lib/agentLoop";
import { loadPayeeBook } from "../lib/payees";
import { Client } from "../lib/treasuryClient";
import { fundWithFriendbot, getContractXlmBalance, getXlmBalance } from "../lib/funding";
import { connectErr, errText, sendErr } from "../lib/wallet-errors";
import { checkLimits, isValidPaymentDest, parseOptionalXlmAmount, parseXlmAmount } from "../lib/validate";
import { trackError, trackViolation } from "../lib/analytics";
import { logActivity } from "../lib/activity";
import { tokenCodeOf, tokenIdOf } from "../lib/token";
import {
  clearSessionSecret,
  createSession,
  isValidAgentKey,
  registerAgentKey,
  loadSessionSecret,
  sessionIsActive,
  sessionPay,
  sessionRequestException,
} from "../lib/session";
import { Keypair } from "@stellar/stellar-sdk";
import { discoverTreasuries, registerTreasury } from "../lib/registry";
import { testSignerAvailable } from "../lib/testSigner";
import { mergeTreasuries } from "../lib/treasuryList";
import { useToast } from "./toastContext";
import {
  TreasuryContext,
  type ActionOutcome,
  type Busy,
  type DeployExtras,
  type TreasuryContextValue,
} from "./treasuryContext";

const fail = (msg: string): ActionOutcome => ({ ok: false, msg });
const invalid = (msg: string): ActionOutcome => ({ ok: false, msg, validation: true });

export function TreasuryProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();

  const address = useWalletAddress();
  const [treasuryId, setTreasuryIdState] = useState<string | null>(
    () => (address ? getTreasuryId(address) : null),
  );
  const [state, setState] = useState<EunomiaState | null>(null);
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [sessionSecret, setSessionSecret] = useState<string | null>(null);
  const [walletXlm, setWalletXlm] = useState<number | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [registryIds, setRegistryIds] = useState<string[]>([]);
  const [creatingNew, setCreatingNew] = useState(false);
  const [localIds, setLocalIds] = useState<string[]>(() => (address ? listTreasuries(address) : []));

  const [prevAddress, setPrevAddress] = useState(address);
  if (address !== prevAddress) {
    setPrevAddress(address);
    setTreasuryIdState(address ? getTreasuryId(address) : null);
    setState(null);
    setLifecycle(null);
    setLegacy(false);
    setSessionSecret(null);
    setWalletXlm(undefined);
    setRegistryIds([]);
    setLocalIds(address ? listTreasuries(address) : []);
  }

  const loadKey = address && treasuryId ? `${address}:${treasuryId}:${refreshKey}` : "";
  const [trackedLoadKey, setTrackedLoadKey] = useState("");
  if (loadKey !== trackedLoadKey) {
    setTrackedLoadKey(loadKey);
    setLoading(!!loadKey);
  }

  // The single-spender rule: while a session is active, payments must be signed
  // by the session key — the wallet's signature would be rejected on-chain.
  const sessionActive = !legacy && sessionIsActive(lifecycle?.session ?? null);

  const treasuries = useMemo(() => mergeTreasuries(localIds, registryIds), [localIds, registryIds]);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Reads race: switch treasuries (or act, then refresh) while a slow read is in flight and
  // the older answer can land last, writing A's balance, limits and Leash key under B's id.
  // Only the most recent read may write.
  const loadSeq = useRef(0);
  const loadState = useCallback(async (id: string, addr: string, opts?: { markLoading?: boolean }) => {
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;
    if (opts?.markLoading !== false) setLoading(true);
    try {
      const t = makeTreasury(id, await executorFor(addr));
      const st = await readState(t);
      if (stale()) return;
      // The chain, not the registry, decides whose treasury this is. TreasuryRegistry
      // stores an unverified claim and this app adopts the newest one on a fresh
      // device, so without this check one signature on a zero-value "back up your
      // treasury" call could hand a victim a treasury the attacker administers — and
      // the victim would fund it. Fails closed: unknown ownership is refused.
      if (!isOwnedBy(st, addr)) {
        setState(null);
        setLifecycle(null);
        console.error("[treasury] refusing", id, "— admin is", st.admin, "not", addr);
        toast("error", "That treasury is administered by a different wallet, so it wasn't opened.");
        return;
      }
      setState(st);
      // One probe decides v3 vs legacy: pre-M2 treasuries have no get_session/is_paused.
      const lc = await readLifecycle(t);
      if (stale()) return;
      setLifecycle(lc);
      setLegacy(lc === null);
      setSessionSecret(loadSessionSecret(id));
    } catch (e) {
      if (stale()) return;
      setState(null);
      setLifecycle(null);
      // The message below is deliberately vague; the reason is not. Without this, a client
      // that could not even build its source account looked identical to a treasury that
      // genuinely is not on chain.
      console.error("[treasury] could not read", id, e);
      toast("error", "Could not read this treasury — it may not exist on testnet.");
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [toast]);

  const refreshWalletXlm = useCallback(async (addr: string) => {
    try {
      // A smart wallet holds its XLM in the SAC; Horizon has no account record for it and
      // answers a C-address with 400.
      setWalletXlm(
        isValidContractId(addr) ? await getContractXlmBalance(addr) : await getXlmBalance(addr),
      );
    } catch {
      setWalletXlm(undefined);
    }
  }, []);

  const syncLocalIds = useCallback((addr: string | null) => {
    setLocalIds(addr ? listTreasuries(addr) : []);
  }, []);

  // Stay in sync with the global connection (nav chip connect/disconnect). On ANY
  // address change, clear everything derived from the previous wallet — otherwise a
  // stale session key, balance, or treasury list can leak into the new context.
  // (Handled during render via prevAddress above.)

  useEffect(() => {
    if (!address || !treasuryId) return;
    void (async () => {
      await loadState(treasuryId, address, { markLoading: false });
    })();
  }, [address, treasuryId, trackedLoadKey, loadState]);

  useEffect(() => {
    if (!address) return;
    void (async () => {
      await refreshWalletXlm(address);
    })();
  }, [address, refreshWalletXlm]);

  // Registry discovery: fills the switcher and (on a fresh device with no localStorage
  // mapping) adopts the latest registered treasury — M2 cross-device recovery.
  // Adoption happens on the first discovery for an address only. The effect re-runs whenever
  // treasuryId changes, so without this "Forget" on the active treasury cleared the id and
  // the very next run adopted the same treasury straight back.
  const discoveredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!address) return;
    let alive = true;
    (async () => {
      const found = await discoverTreasuries(address);
      if (!alive) return;
      setRegistryIds(found);
      const firstDiscovery = discoveredFor.current !== address;
      discoveredFor.current = address;
      if (firstDiscovery && !treasuryId && !creatingNew && found.length > 0) {
        const latest = found[found.length - 1];
        setTreasuryId(address, latest);
        setTreasuryIdState(latest);
        syncLocalIds(address);
        toast("success", `Recovered your treasury from the on-chain registry ✓ (${shortAddr(latest)})`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [address, treasuryId, creatingNew, syncLocalIds, toast]);

  const refresh = useCallback(async (opts?: { markLoading?: boolean }) => {
    if (address && treasuryId) await loadState(treasuryId, address, opts);
    if (address) void refreshWalletXlm(address);
  }, [address, treasuryId, loadState, refreshWalletXlm]);

  // ---- actions ------------------------------------------------------------------

  const connect = useCallback(async () => {
    setBusy("connect");
    try {
      const addr = await kitConnect();
      setTreasuryIdState(getTreasuryId(addr));
      syncLocalIds(addr);
    } catch (e) {
      toast("error", connectErr(e));
    } finally {
      setBusy(null);
    }
  }, [syncLocalIds, toast]);

  const friendbot = useCallback(async (): Promise<ActionOutcome> => {
    if (!address) return fail("Connect a wallet first.");
    setBusy("friendbot");
    toast("info", "Requesting free testnet XLM…");
    try {
      const before = walletXlm ?? null;
      await fundWithFriendbot(address);
      // The dispenser answers when the transaction is accepted, not applied: read until
      // the balance actually moves, or the page keeps saying 0.00 XLM to a funded wallet.
      const after = await waitForBalanceChange(
        () => (isValidContractId(address) ? getContractXlmBalance(address) : getXlmBalance(address)),
        before,
      );
      setWalletXlm(after);
      const msg = "Wallet funded with testnet XLM ✓";
      toast("success", msg);
      return { ok: true, msg };
    } catch (e) {
      const msg = errText(e);
      toast("error", msg);
      return fail(msg);
    } finally {
      setBusy(null);
    }
  }, [address, walletXlm, toast]);

  const deploy = useCallback(
    async (daily: string, perTask: string, extra: DeployExtras = {}): Promise<ActionOutcome> => {
      if (!address) return fail("Connect a wallet first.");
      // Validate before the wallet popup — an empty/NaN field would otherwise reach
      // toStroops(NaN) and throw an opaque "must be a non-negative number".
      const dailyLimit = parseXlmAmount(daily, "daily limit");
      if (!dailyLimit.ok) return invalid(dailyLimit.msg);
      const perTaskLimit = parseXlmAmount(perTask, "per-payment limit");
      if (!perTaskLimit.ok) return invalid(perTaskLimit.msg);
      // The constructor rejects an incoherent policy on-chain — catch it here first so
      // the user gets a clear message instead of a failed deploy.
      const coherent = checkLimits(dailyLimit.value, perTaskLimit.value);
      if (!coherent.ok) return invalid(coherent.msg);
      const payee = (extra.payee ?? "").trim();
      if (payee && !isValidPaymentDest(payee)) return invalid("That payee isn't a Stellar account address (G…).");
      const agentKey = (extra.agentKey ?? "").trim();
      let leash: TreasurySetup["leash"];
      if (agentKey) {
        if (!isValidAgentKey(agentKey)) {
          return invalid("That is not a Stellar public key (G…, 56 characters) — copy it from `eunomia-mcp init`.");
        }
        const cap = parseXlmAmount(extra.capXlm ?? "", "Leash cap");
        if (!cap.ok) return invalid(cap.msg);
        const hours = Number(extra.hours ?? "");
        if (!Number.isFinite(hours) || hours <= 0) return invalid("Enter how many hours the Leash lasts.");
        if (cap.value > dailyLimit.value) return invalid("The Leash cap can't be above the daily limit.");
        leash = { agent: agentKey, capXlm: cap.value, hours };
      }
      // Starting funds are not checked against the displayed balance on purpose: a smart
      // wallet's reading can lag the faucet by a ledger or two, and the chain refuses an
      // underfunded transfer anyway — atomically, so nothing half-created survives.
      // A USDC treasury opens empty: the wallet holds no USDC to move in, and the form does
      // not offer the field — whatever it still carries from an earlier choice is ignored.
      const code = extra.token ?? "XLM";
      const fund = parseOptionalXlmAmount(code === "USDC" ? "" : (extra.fundXlm ?? ""), "starting funds");
      if (!fund.ok) return invalid(fund.msg);
      setBusy("deploy");
      toast("info", "Creating your treasury — one confirmation in your wallet…");
      try {
        // One signature: deploy + policy + payee + Leash + funding + registry, atomically.
        // E2E runs must never touch the registry — it feeds the user-count evidence, and
        // throwaway Playwright wallets were inflating it (docs/metrics/e2e-exclude.json).
        const register = !testSignerAvailable();
        const id = await createTreasury(await executorFor(address), {
          token: tokenIdOf(code),
          dailyXlm: dailyLimit.value,
          perTaskXlm: perTaskLimit.value,
          payees: payee ? [payee] : [],
          leash,
          fundXlm: fund.value,
          register,
          salt: extra.salt,
        });
        setTreasuryId(address, id);
        setTreasuryIdState(id);
        setCreatingNew(false);
        syncLocalIds(address);
        if (register) setRegistryIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
        void logActivity({ walletAddress: address, treasuryId: id, action: "deploy" });
        if (register) void logActivity({ walletAddress: address, treasuryId: id, action: "register" });
        if (fund.value > 0) void logActivity({ walletAddress: address, treasuryId: id, action: "fund", amountXlm: fund.value });
        if (payee) void logActivity({ walletAddress: address, treasuryId: id, action: "whitelist" });
        if (leash) void logActivity({ walletAddress: address, treasuryId: id, action: "session_start" });
        if (fund.value > 0) void refreshWalletXlm(address);
        const parts = [
          fund.value > 0 ? `funded with ${fund.value} XLM` : null,
          payee ? "first payee approved" : null,
          leash ? "Leash started" : null,
          register ? "backed up on Stellar" : null,
        ].filter(Boolean);
        const msg = `Treasury created ✓${parts.length ? " — " + parts.join(", ") : ""}. One signature.`;
        toast("success", msg);
        return { ok: true, msg };
      } catch (e) {
        const msg = sendErr(e);
        toast("error", msg);
        return fail(msg);
      } finally {
        setBusy(null);
      }
    },
    [address, refreshWalletXlm, syncLocalIds, toast],
  );

  const openExisting = useCallback(
    (raw: string): ActionOutcome => {
      if (!address) return fail("Connect a wallet first.");
      const id = raw.trim();
      // An empty field is not a malformed ID — telling someone their blank input "doesn't look
      // like a contract ID" reads as if the page rejected something they never typed.
      if (!id) return invalid("Paste your treasury ID to open it.");
      if (!isValidContractId(id)) {
        return invalid("That doesn't look like a treasury contract ID — it starts with C and is 56 characters long.");
      }
      setTreasuryId(address, id);
      setTreasuryIdState(id);
      setCreatingNew(false);
      syncLocalIds(address);
      return { ok: true, msg: "" };
    },
    [address, syncLocalIds],
  );

  const fund = useCallback(
    async (amount: string): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail("No treasury open.");
      // XLM sent into a USDC treasury would sit there for good: the contract pays out and
      // withdraws its own token only.
      if (tokenCodeOf(state?.token) !== "XLM") return invalid("This treasury holds USDC — add funds with TRY instead.");
      const amt = parseXlmAmount(amount);
      if (!amt.ok) return invalid(amt.msg);
      setBusy("fund");
      toast("info", "Funding — confirm in your wallet…");
      try {
        const hash = await fundTreasury(treasuryId, await executorFor(address), amt.value);
        void logActivity({ walletAddress: address, treasuryId, action: "fund", txHash: hash, amountXlm: amt.value });
        toast("success", "Funded ✓", { hash });
        bump();
        await loadState(treasuryId, address);
        void refreshWalletXlm(address);
        return { ok: true, msg: "Funded ✓", hash };
      } catch (e) {
        const msg = sendErr(e);
        toast("error", msg);
        return fail(msg);
      } finally {
        setBusy(null);
      }
    },
    [address, treasuryId, state?.token, bump, loadState, refreshWalletXlm, toast],
  );

  const whitelist = useCallback(
    async (payeeAddr: string): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail("No treasury open.");
      const p = payeeAddr.trim();
      if (!p) return invalid("Enter a payee address.");
      setBusy("whitelist");
      toast("info", "Approving payee — confirm in your wallet…");
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        await addPayee(t, p);
        void logActivity({ walletAddress: address, treasuryId, action: "whitelist" });
        const msg = `Payee approved: ${shortAddr(p)}`;
        toast("success", msg);
        bump();
        return { ok: true, msg };
      } catch (e) {
        const msg = sendErr(e);
        toast("error", msg);
        return fail(msg);
      } finally {
        setBusy(null);
      }
    },
    [address, treasuryId, bump, toast],
  );

  const removePayeeAddr = useCallback(
    async (payeeAddr: string): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail("No treasury open.");
      setBusy("removePayee");
      toast("info", "Removing payee — confirm in your wallet…");
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        await removePayee(t, payeeAddr.trim());
        const msg = `Payee removed: ${shortAddr(payeeAddr)}`;
        toast("success", msg);
        bump();
        return { ok: true, msg };
      } catch (e) {
        const msg = sendErr(e);
        toast("error", msg);
        return fail(msg);
      } finally {
        setBusy(null);
      }
    },
    [address, treasuryId, bump, toast],
  );

  const spend = useCallback(
    async (to: string, amount: string): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail("No treasury open.");
      const amt = parseXlmAmount(amount);
      if (!amt.ok) return invalid(amt.msg);
      if (sessionActive && !sessionSecret) {
        return invalid(
          "A Leash is active but its key isn't on this device — revoke it (Agent page) to spend with your wallet.",
        );
      }
      setBusy("spend");
      toast("info", sessionActive ? "Sending payment — the Leash signs, no popup…" : "Sending payment — confirm in your wallet…");
      try {
        // Single-spender rule: an active session's key signs instead of the wallet.
        const res =
          sessionActive && sessionSecret
            ? await sessionPay(treasuryId, sessionSecret, BigInt(Date.now()), to.trim(), amt.value)
            : await pay(
                makeTreasury(treasuryId, await executorFor(address)),
                BigInt(Date.now()),
                to.trim(),
                amt.value,
              );
        if (res.ok) {
          void logActivity({
            walletAddress: address,
            treasuryId,
            action: sessionActive ? "agent_pay" : "pay",
            txHash: res.hash,
            amountXlm: amt.value,
          });
          const msg = sessionActive
            ? "Payment sent ✓ — signed by the Leash, no wallet popup."
            : "Payment sent ✓";
          toast("success", msg, { hash: res.hash });
          bump();
          await loadState(treasuryId, address);
          return { ok: true, msg, hash: res.hash };
        }
        trackViolation(treasuryId);
        void logActivity({ walletAddress: address, treasuryId, action: "reject", amountXlm: amt.value });
        const msg = `Blocked by policy: ${res.errorMessage}`;
        toast("error", msg);
        await loadState(treasuryId, address);
        return fail(msg);
      } catch (e) {
        trackError(treasuryId, errText(e)); // raw message for monitoring; the classified one for the user
        const msg = sendErr(e);
        toast("error", msg);
        return fail(msg);
      } finally {
        setBusy(null);
      }
    },
    [address, treasuryId, sessionActive, sessionSecret, bump, loadState, toast],
  );

  const startLeash = useCallback(
    async (cap: string, hours: string, agentPublicKey?: string): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail("No treasury open.");
      const capV = parseXlmAmount(cap, "session cap");
      if (!capV.ok) return invalid(capV.msg);
      const hoursV = parseXlmAmount(hours, "duration");
      if (!hoursV.ok) return invalid(hoursV.msg);
      // An external agent (eunomia-mcp) brings its own key: only the public half is
      // registered, nothing is generated or funded here.
      const externalKey = agentPublicKey?.trim() ?? "";
      if (externalKey && !isValidAgentKey(externalKey)) {
        return invalid("That is not a Stellar public key (G…, 56 characters) — copy it from `eunomia-mcp init`.");
      }
      setBusy("session");
      toast(
        "info",
        externalKey
          ? "Authorising your agent's key — confirm in your wallet…"
          : "Starting the Leash session — confirm in your wallet…",
      );
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        if (externalKey) {
          const res = await registerAgentKey(t, treasuryId, externalKey, capV.value, hoursV.value);
          if (res.ok) {
            setSessionSecret(null);
            void logActivity({ walletAddress: address, treasuryId, action: "session_start", txHash: res.hash });
            const msg = "Leash on ✓ — your agent can now pay within the cap, from its own machine.";
            toast("success", msg, { hash: res.hash });
            await loadState(treasuryId, address);
            return { ok: true, msg, hash: res.hash };
          }
          const msg = `Blocked: ${res.errorMessage}`;
          toast("error", msg);
          return fail(msg);
        }
        const res = await createSession(t, treasuryId, capV.value, hoursV.value, (phase) =>
          toast(
            "info",
            phase === "registering"
              ? "Registering the Leash key — confirm in your wallet…"
              : "Funding the agent's key on testnet…",
          ),
        );
        if (res.ok) {
          setSessionSecret(loadSessionSecret(treasuryId));
          void logActivity({ walletAddress: address, treasuryId, action: "session_start", txHash: res.hash });
          const msg = "Leash on ✓ — the agent now pays without wallet popups.";
          toast("success", msg, { hash: res.hash });
          await loadState(treasuryId, address);
          return { ok: true, msg, hash: res.hash };
        }
        if (res.registered) {
          // Session is live on-chain but its key couldn't be funded. Load the saved secret
          // and refresh state so the UI matches the chain (active session + revoke control).
          setSessionSecret(loadSessionSecret(treasuryId));
          void logActivity({ walletAddress: address, treasuryId, action: "session_start" });
          const msg = res.errorMessage ?? "The Leash was registered but its key couldn't be funded — revoke it and start a new one.";
          toast("error", msg);
          await loadState(treasuryId, address);
          return fail(msg);
        }
        const msg = `Blocked: ${res.errorMessage}`;
        toast("error", msg);
        return fail(msg);
      } catch (e) {
        const msg = sendErr(e);
        toast("error", msg);
        return fail(msg);
      } finally {
        setBusy(null);
      }
    },
    [address, treasuryId, loadState, toast],
  );

  const revokeLeash = useCallback(async (): Promise<ActionOutcome> => {
    if (!address || !treasuryId) return fail("No treasury open.");
    setBusy("revoke");
    toast("info", "Revoking the Leash — confirm in your wallet…");
    try {
      const t = makeTreasury(treasuryId, await executorFor(address));
      const res = await revokeSession(t);
      if (res.ok) {
        clearSessionSecret(treasuryId);
        setSessionSecret(null);
        void logActivity({ walletAddress: address, treasuryId, action: "session_revoke", txHash: res.hash });
        const msg = "Leash revoked ✓ — your wallet is the spender again.";
        toast("success", msg, { hash: res.hash });
        await loadState(treasuryId, address);
        return { ok: true, msg, hash: res.hash };
      }
      const msg = `Blocked: ${res.errorMessage}`;
      toast("error", msg);
      return fail(msg);
    } catch (e) {
      const msg = sendErr(e);
      toast("error", msg);
      return fail(msg);
    } finally {
      setBusy(null);
    }
  }, [address, treasuryId, loadState, toast]);

  const runAutonomousTask = useCallback(
    async (to?: string): Promise<ActionOutcome> => {
      if (!address || !treasuryId || !sessionSecret) return fail("No active Leash key on this device.");
      const dest = (to ?? "").trim() || SERVICE;
      const unit = tokenCodeOf(state?.token);
      setBusy("task");
      toast("info", "Agent is paying autonomously — no wallet popup…");
      try {
        const res = await sessionPay(treasuryId, sessionSecret, BigInt(Date.now()), dest, 1);
        if (res.ok) {
          void logActivity({ walletAddress: address, treasuryId, action: "agent_pay", txHash: res.hash, amountXlm: 1 });
          const msg = `Agent paid 1 ${unit} to ${shortAddr(dest)} autonomously ✓ — the contract enforced the policy.`;
          toast("success", msg, { hash: res.hash });
          bump();
          await loadState(treasuryId, address);
          return { ok: true, msg, hash: res.hash };
        }
        trackViolation(treasuryId);
        void logActivity({ walletAddress: address, treasuryId, action: "reject", amountXlm: 1 });
        const msg = `Blocked by policy: ${res.errorMessage}`;
        toast("error", msg);
        await loadState(treasuryId, address);
        return fail(msg);
      } catch (e) {
        trackError(treasuryId, errText(e));
        const msg = sendErr(e);
        toast("error", msg);
        return fail(msg);
      } finally {
        setBusy(null);
      }
    },
    [address, treasuryId, sessionSecret, state?.token, bump, loadState, toast],
  );

  // The agent's own loop, the three steps in the order they matter: a payment the rules
  // allow, a payment they refuse, and the agent asking the owner to allow that one. Every
  // step is real — the refusal is the contract's, not a staged message, and the request
  // lands on the agent's own Stellar account, where the panel below reads it. The owner
  // signs nothing: that is the claim this button exists to perform.
  const runAgentLoop = useCallback(
    async (onStep: (steps: LoopStep[]) => void): Promise<ActionOutcome> => {
      if (!address || !treasuryId || !sessionSecret) return fail("No Leash key on this device — start one first.");
      if (!state) return fail("The treasury's rules haven't loaded yet — give it a moment.");
      const s = lifecycle?.session;
      const sessionLeft =
        s && sessionActive ? (s.limit > s.spent ? s.limit - s.spent : 0n) : null;
      const room = demoAmount({
        perTaskLimit: state.perTaskLimit,
        dailyLimit: state.dailyLimit,
        daySpent: state.daySpent,
        balance: state.balance,
        sessionLeft,
      });
      if (!room.ok) return fail(room.why);
      const amount = unitsOf(room.stroops);

      let steps = initialLoop();
      const push = (key: LoopStepKey, patch: Partial<LoopStep>) => {
        steps = withStep(steps, key, patch);
        onStep(steps);
      };
      onStep(steps);

      setBusy("loop");
      try {
        // 1. Someone the owner approved. Which one is the contract's answer, not this
        //    device's: the local payee book can hold an address that was never whitelisted
        //    or was removed since, and opening with a refused payment proves nothing.
        push("pay", { status: "running" });
        const payee = await firstApprovedPayee(treasuryId, [...loadPayeeBook(treasuryId), SERVICE]);
        if (!payee) {
          const msg = "Approve a payee first — the loop opens with a payment your rules allow.";
          push("pay", { status: "failed", detail: msg });
          toast("error", msg);
          return fail(msg);
        }
        const paid = await sessionPay(treasuryId, sessionSecret, BigInt(Date.now()), payee, amount);
        if (!paid.ok) {
          const msg = paid.errorMessage ?? "The agent's payment did not go through.";
          push("pay", { status: "failed", detail: msg });
          toast("error", msg);
          return fail(msg);
        }
        void logActivity({ walletAddress: address, treasuryId, action: "agent_pay", txHash: paid.hash, amountXlm: amount });
        push("pay", {
          status: "done",
          detail: `Paid ${amount} ${tokenCodeOf(state.token)} to ${shortAddr(payee)}. You signed nothing.`,
          hash: paid.hash,
        });

        // 2. Someone the owner never approved. Prefer the demo's known address so the
        //    ledger reads the same every time; if it has since been whitelisted, a fresh
        //    key is the one address that certainly isn't on the list.
        push("refused", { status: "running" });
        //    An unreadable answer counts as approved here: isApprovedPayee's "not approved"
        //    default is the safe side for choosing whom to pay, the wrong side for this.
        const attackerMayBeApproved = await readClient(treasuryId)
          .is_payee({ payee: ATTACKER })
          .then((r) => r.result, () => true);
        const stranger = attackerMayBeApproved ? Keypair.random().publicKey() : ATTACKER;
        const taskId = BigInt(Date.now());
        const tried = await sessionPay(treasuryId, sessionSecret, taskId, stranger, amount);
        if (tried.ok) {
          // The contract let it through — the rules are not what this page just claimed.
          const msg = "That payment went through. Check your approved payees: the loop expected a refusal.";
          push("refused", { status: "failed", detail: msg, hash: tried.hash });
          toast("error", msg);
          await loadState(treasuryId, address);
          return fail(msg);
        }
        trackViolation(treasuryId);
        void logActivity({ walletAddress: address, treasuryId, action: "reject", amountXlm: amount });
        const code = tried.errorCode ?? 2;
        push("refused", {
          status: "refused",
          detail: `${tried.errorMessage ?? "Refused by your rules."} ${shortAddr(stranger)} never got the money.`,
        });

        // 3. The agent's appeal. It writes the refusal onto its own account, where only
        //    its key can write; the owner resolves it on-chain in "Waiting for you".
        push("request", { status: "running" });
        const filed = await sessionRequestException(treasuryId, sessionSecret, {
          payee: stranger,
          amount: room.stroops,
          taskId,
          reasonCodes: [code],
          requestedAt: Math.floor(Date.now() / 1000),
        });
        if (!filed.ok) {
          const msg = filed.errorMessage ?? "The agent could not file its request.";
          push("request", { status: "failed", detail: msg });
          toast("error", msg);
          await loadState(treasuryId, address);
          return fail(msg);
        }
        push("request", {
          status: "done",
          detail: "Filed on the agent's own account — it's waiting for you below.",
          hash: filed.hash,
        });

        const msg = "The agent ran on its own ✓ — it paid, got refused, and asked you to allow the one it couldn't.";
        toast("success", msg, { hash: paid.hash });
        bump();
        await loadState(treasuryId, address);
        return { ok: true, msg, hash: paid.hash };
      } catch (e) {
        trackError(treasuryId, errText(e));
        const msg = sendErr(e);
        toast("error", msg);
        return fail(msg);
      } finally {
        setBusy(null);
      }
    },
    [address, treasuryId, sessionSecret, state, lifecycle, sessionActive, bump, loadState, toast],
  );

  const togglePause = useCallback(async (): Promise<ActionOutcome> => {
    if (!address || !treasuryId || !lifecycle) return fail("No treasury open.");
    const next = !lifecycle.paused;
    setBusy("pause");
    toast("info", `${next ? "Pausing" : "Resuming"} — confirm in your wallet…`);
    try {
      const t = makeTreasury(treasuryId, await executorFor(address));
      const res = await setPaused(t, next);
      if (res.ok) {
        void logActivity({ walletAddress: address, treasuryId, action: "pause" });
        const msg = next ? "Treasury paused — spending is frozen." : "Treasury resumed ✓";
        toast("success", msg, { hash: res.hash });
        await loadState(treasuryId, address);
        return { ok: true, msg, hash: res.hash };
      }
      const msg = res.errorMessage ?? "Pause toggle failed.";
      toast("error", msg);
      return fail(msg);
    } catch (e) {
      const msg = sendErr(e);
      toast("error", msg);
      return fail(msg);
    } finally {
      setBusy(null);
    }
  }, [address, treasuryId, lifecycle, loadState, toast]);

  const withdraw = useCallback(
    async (to: string, amount: string): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail("No treasury open.");
      const amt = parseXlmAmount(amount);
      if (!amt.ok) return invalid(amt.msg);
      setBusy("withdraw");
      toast("info", "Withdrawing — confirm in your wallet…");
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        const res = await adminWithdraw(t, to.trim() || address, amt.value);
        if (res.ok) {
          void logActivity({ walletAddress: address, treasuryId, action: "withdraw", txHash: res.hash, amountXlm: amt.value });
          toast("success", "Withdrawn ✓", { hash: res.hash });
          bump();
          await loadState(treasuryId, address);
          void refreshWalletXlm(address);
          return { ok: true, msg: "Withdrawn ✓", hash: res.hash };
        }
        const msg = `Blocked: ${res.errorMessage}`;
        toast("error", msg);
        return fail(msg);
      } catch (e) {
        const msg = sendErr(e);
        toast("error", msg);
        return fail(msg);
      } finally {
        setBusy(null);
      }
    },
    [address, treasuryId, bump, loadState, refreshWalletXlm, toast],
  );

  const updateLimits = useCallback(
    async (daily: string, perTask: string): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail("No treasury open.");
      const dailyLimit = parseXlmAmount(daily, "daily limit");
      if (!dailyLimit.ok) return invalid(dailyLimit.msg);
      const perTaskLimit = parseXlmAmount(perTask, "per-payment limit");
      if (!perTaskLimit.ok) return invalid(perTaskLimit.msg);
      const coherent = checkLimits(dailyLimit.value, perTaskLimit.value);
      if (!coherent.ok) return invalid(coherent.msg);
      setBusy("limits");
      toast("info", "Updating limits — confirm in your wallet…");
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        const res = await setLimits(t, dailyLimit.value, perTaskLimit.value);
        if (res.ok) {
          void logActivity({ walletAddress: address, treasuryId, action: "limits" });
          const msg = "Limits updated ✓ — effective immediately.";
          toast("success", msg, { hash: res.hash });
          await loadState(treasuryId, address);
          return { ok: true, msg, hash: res.hash };
        }
        const msg = `Blocked: ${res.errorMessage}`;
        toast("error", msg);
        return fail(msg);
      } catch (e) {
        const msg = sendErr(e);
        toast("error", msg);
        return fail(msg);
      } finally {
        setBusy(null);
      }
    },
    [address, treasuryId, loadState, toast],
  );

  // Catch-up registration for a treasury whose deploy-time registration was skipped.
  const registerActive = useCallback(async (): Promise<ActionOutcome> => {
    if (!address || !treasuryId) return fail("No treasury open.");
    setBusy("register");
    toast("info", "Backing up on Stellar — confirm in your wallet…");
    try {
      await registerTreasury(await executorFor(address), treasuryId);
      setRegistryIds((ids) => (ids.includes(treasuryId) ? ids : [...ids, treasuryId]));
      void logActivity({ walletAddress: address, treasuryId, action: "register" });
      const msg = "Backed up on Stellar ✓ — open it from any device.";
      toast("success", msg);
      return { ok: true, msg };
    } catch (e) {
      const msg = sendErr(e);
      toast("error", msg);
      return fail(msg);
    } finally {
      setBusy(null);
    }
  }, [address, treasuryId, toast]);

  const switchTreasury = useCallback(
    (id: string) => {
      if (!address || id === treasuryId) return;
      setCreatingNew(false);
      setTreasuryId(address, id); // adds if unknown (registry-only entries), sets active
      setTreasuryIdState(id);
      setState(null);
      setLifecycle(null);
      setLegacy(false);
      setSessionSecret(null);
      syncLocalIds(address);
      bump();
    },
    [address, treasuryId, syncLocalIds, bump],
  );

  // Forget is local-only (the contract lives on regardless). treasuryStore can only
  // drop the ACTIVE id, so forgetting another row briefly makes it active, drops it,
  // then restores the previous selection.
  const forgetTreasury = useCallback(
    (id: string) => {
      if (!address) return;
      const previous = treasuryId;
      if (id === previous) {
        clearTreasuryId(address);
        const next = getTreasuryId(address);
        setTreasuryIdState(next);
        setState(null);
        setLifecycle(null);
        setSessionSecret(null);
      } else {
        setActiveTreasury(address, id);
        clearTreasuryId(address);
        if (previous) setActiveTreasury(address, previous);
      }
      syncLocalIds(address);
    },
    [address, treasuryId, syncLocalIds],
  );

  const value: TreasuryContextValue = {
    address,
    treasuryId,
    state,
    tokenCode: tokenCodeOf(state?.token),
    lifecycle,
    legacy,
    sessionActive,
    sessionSecret,
    walletXlm,
    loading,
    busy,
    refreshKey,
    treasuries,
    refresh,
    connect,
    friendbot,
    deploy,
    openExisting,
    fund,
    whitelist,
    removePayeeAddr,
    spend,
    startLeash,
    revokeLeash,
    runAutonomousTask,
    runAgentLoop,
    togglePause,
    withdraw,
    updateLimits,
    registerActive,
    switchTreasury,
    forgetTreasury,
    creatingNew,
    startNewTreasury: () => setCreatingNew(true),
    cancelNewTreasury: () => setCreatingNew(false),
  };

  return <TreasuryContext.Provider value={value}>{children}</TreasuryContext.Provider>;
}

// ---- whom the agent loop pays -----------------------------------------------------
// Read-only client: whether an address is approved is the contract's answer, and asking
// it costs one simulation, not a signature.

const readClient = (treasuryId: string) =>
  new Client({ contractId: treasuryId, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL });

async function isApprovedPayee(treasuryId: string, addr: string): Promise<boolean> {
  try {
    return (await readClient(treasuryId).is_payee({ payee: addr })).result;
  } catch {
    return false; // unreadable — treat as not approved rather than pay into the dark
  }
}

/** The first candidate the contract calls approved, or null when none is. */
async function firstApprovedPayee(treasuryId: string, candidates: string[]): Promise<string | null> {
  for (const addr of new Set(candidates)) {
    if (await isApprovedPayee(treasuryId, addr)) return addr;
  }
  return null;
}
