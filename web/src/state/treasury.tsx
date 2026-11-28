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
import { createTreasury, type TreasurySetup } from "../lib/createTreasury";
import {
  addPayee,
  adminWithdraw,
  fundTreasury,
  isValidContractId,
  isOwnedBy,
  isPayee,
  makeTreasury,
  pay,
  readLifecycle,
  readState,
  runsTreasuryCode,
  removePayee,
  revokeSession,
  setLimits,
  setPaused,
  setTaskBudget,
  setMonthlyLimit,
  setPayeeCap,
  type Lifecycle,
  type EunomiaState,
} from "../lib/userTreasury";
import { NETWORK_LABEL, shortAddr } from "../config";
import { getContractXlmBalance, getXlmBalance } from "../lib/funding";
import {
  agentAccountExists,
  CATALOG_PAYEES,
  createAgentAccount,
  OWNER_MIN_XLM,
  planAgentSetup,
  stepLabel,
  type SetupStep,
} from "../lib/agentSetup";
import { rememberPayee } from "../lib/payees";
import { connectErr, errText, sendErr } from "../lib/wallet-errors";
import { checkLimits, isValidPaymentDest, parseOptionalXlmAmount, parseXlmAmount } from "../lib/validate";
import { trackError, trackViolation } from "../lib/analytics";
import { logActivity } from "../lib/activity";
import { tokenCodeOf, tokenIdOf } from "../lib/token";
import { isValidAgentKey, registerAgentKey, sessionIsActive } from "../lib/session";
import { discoverTreasuries, registerTreasury } from "../lib/registry";
import { mergeTreasuries } from "../lib/treasuryList";
import { tx } from "../lib/i18n";
import { useToast } from "./toastContext";
import type { BudgetRequest } from "../lib/budgetRequestCodec";
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

  // The single-spender rule: while a session is active, payments must be signed by the
  // agent's key — the wallet's signature would be rejected on-chain.
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
      const [st, ours] = await Promise.all([readState(t), runsTreasuryCode(id)]);
      if (stale()) return;
      // The chain, not the registry, decides whose treasury this is — and the code it runs
      // decides whether its answer can be believed. This app adopts the newest registered
      // treasury on a fresh device, so without these checks one signature on a zero-value
      // "back up your treasury" call could hand a victim a treasury the attacker
      // administers, or a contract that only claims the victim does — and the victim would
      // fund it. Fails closed: unknown code or ownership is refused.
      const refusal = !ours
        ? tx("That contract isn't a Eunomia treasury, so it wasn't opened.", "Bu sözleşme bir Eunomia kasası değil, o yüzden açılmadı.")
        : !isOwnedBy(st, addr)
          ? tx("That treasury is administered by a different wallet, so it wasn't opened.", "Bu kasayı başka bir cüzdan yönetiyor, o yüzden açılmadı.")
          : null;
      if (refusal) {
        setState(null);
        setLifecycle(null);
        console.error("[treasury] refusing", id, ours ? `— admin is ${st.admin}, not ${addr}` : "— not the shipped treasury code");
        toast("error", refusal);
        // Refused is final, so it must not stay the active treasury: left in place it kept
        // every page on skeletons and blocked the owner's own treasury from being adopted.
        if (getTreasuryId(addr) === id) {
          clearTreasuryId(addr);
          setTreasuryIdState(getTreasuryId(addr));
          setLocalIds(listTreasuries(addr));
        }
        return;
      }
      setState(st);
      // One probe decides v3 vs legacy: pre-M2 treasuries have no get_session/is_paused.
      const lc = await readLifecycle(t);
      if (stale()) return;
      setLifecycle(lc);
      setLegacy(lc === null);
    } catch (e) {
      if (stale()) return;
      setState(null);
      setLifecycle(null);
      // The message below is deliberately vague; the reason is not. Without this, a client
      // that could not even build its source account looked identical to a treasury that
      // genuinely is not on chain.
      console.error("[treasury] could not read", id, e);
      toast(
        "error",
        tx(
          `Could not read this treasury — it may not exist on ${NETWORK_LABEL.toLowerCase()}.`,
          `Bu kasa okunamadı — ${NETWORK_LABEL.toLowerCase()} ağında olmayabilir.`,
        ),
      );
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
        toast(
          "success",
          tx(
            `Recovered your treasury from the on-chain registry ✓ (${shortAddr(latest)})`,
            `Kasan zincirdeki kayıttan geri geldi ✓ (${shortAddr(latest)})`,
          ),
        );
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

  const deploy = useCallback(
    async (daily: string, perTask: string, extra: DeployExtras = {}): Promise<ActionOutcome> => {
      if (!address) return fail(tx("Connect a wallet first.", "Önce bir cüzdan bağla."));
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
      if (payee && !isValidPaymentDest(payee)) return invalid(tx("That payee isn't a Stellar account address (G…).", "Bu alıcı bir Stellar hesap adresi değil (G…)."));
      const agentKey = (extra.agentKey ?? "").trim();
      let leash: TreasurySetup["leash"];
      if (agentKey) {
        if (!isValidAgentKey(agentKey)) {
          return invalid(
            tx(
              "That is not a Stellar public key (G…, 56 characters) — copy it from `eunomia-mcp init`.",
              "Bu bir Stellar adresi değil (G…, 56 karakter) — `eunomia-mcp init` komutunun yazdığı adresi kopyala.",
            ),
          );
        }
        const cap = parseXlmAmount(extra.capXlm ?? "", "Leash cap");
        if (!cap.ok) return invalid(cap.msg);
        const hours = Number(extra.hours ?? "");
        if (!Number.isFinite(hours) || hours <= 0) return invalid(tx("Enter how many hours the Leash lasts.", "Yetkinin kaç saat süreceğini gir."));
        if (cap.value > dailyLimit.value) return invalid(tx("The Leash cap can't be above the daily limit.", "Yetki tavanı günlük sınırı geçemez."));
        leash = { agent: agentKey, capXlm: cap.value, hours };
      }
      // Starting funds are not checked against the displayed balance on purpose: a smart
      // wallet's reading can lag a transfer by a ledger or two, and the chain refuses an
      // underfunded transfer anyway — atomically, so nothing half-created survives.
      // A USDC treasury opens empty: the wallet holds no USDC to move in, and the form does
      // not offer the field — whatever it still carries from an earlier choice is ignored.
      const code = extra.token ?? "XLM";
      const fund = parseOptionalXlmAmount(code === "USDC" ? "" : (extra.fundXlm ?? ""), "starting funds");
      if (!fund.ok) return invalid(fund.msg);
      setBusy("deploy");
      toast("info", tx("Creating your treasury — one confirmation in your wallet…", "Kasan oluşturuluyor — cüzdanında tek onay yeterli…"));
      try {
        // One signature: deploy + policy + payee + Leash + funding + registry, atomically.
        const id = await createTreasury(await executorFor(address), {
          token: tokenIdOf(code),
          dailyXlm: dailyLimit.value,
          perTaskXlm: perTaskLimit.value,
          payees: payee ? [payee] : [],
          leash,
          fundXlm: fund.value,
          register: true,
          salt: extra.salt,
        });
        setTreasuryId(address, id);
        setTreasuryIdState(id);
        setCreatingNew(false);
        syncLocalIds(address);
        setRegistryIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
        void logActivity({ walletAddress: address, treasuryId: id, action: "deploy" });
        void logActivity({ walletAddress: address, treasuryId: id, action: "register" });
        if (fund.value > 0) void logActivity({ walletAddress: address, treasuryId: id, action: "fund", amountXlm: fund.value });
        if (payee) void logActivity({ walletAddress: address, treasuryId: id, action: "whitelist" });
        if (leash) void logActivity({ walletAddress: address, treasuryId: id, action: "session_start" });
        if (fund.value > 0) void refreshWalletXlm(address);
        const parts = [
          fund.value > 0 ? tx(`funded with ${fund.value} XLM`, `${fund.value} XLM yatırıldı`) : null,
          payee ? tx("first payee approved", "ilk alıcı onaylandı") : null,
          leash ? tx("Leash started", "ajanın yetkisi başladı") : null,
          tx("backed up on Stellar", "Stellar'da yedeklendi"),
        ].filter(Boolean);
        const msg =
          tx("Treasury created ✓", "Kasa oluşturuldu ✓") +
          (parts.length ? " — " + parts.join(", ") : "") +
          tx(". One signature.", ". Tek imza.");
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
      if (!address) return fail(tx("Connect a wallet first.", "Önce bir cüzdan bağla."));
      const id = raw.trim();
      // An empty field is not a malformed ID — telling someone their blank input "doesn't look
      // like a contract ID" reads as if the page rejected something they never typed.
      if (!id) return invalid(tx("Paste your treasury ID to open it.", "Açmak için kasa ID'sini yapıştır."));
      if (!isValidContractId(id)) {
        return invalid(
          tx(
            "That doesn't look like a treasury contract ID — it starts with C and is 56 characters long.",
            "Bu bir kasa sözleşme ID'sine benzemiyor — C ile başlar, 56 karakterdir.",
          ),
        );
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
      if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
      // A deposit moves the treasury's own token, so the unit is the treasury's, never a
      // choice: XLM sent into a USDC treasury would sit there for good.
      const unit = tokenCodeOf(state?.token);
      const amt = parseXlmAmount(amount);
      if (!amt.ok) return invalid(amt.msg);
      setBusy("fund");
      toast("info", tx("Funding — confirm in your wallet…", "Para yatırılıyor — cüzdanında onayla…"));
      try {
        const hash = await fundTreasury(treasuryId, await executorFor(address), amt.value, unit);
        void logActivity({ walletAddress: address, treasuryId, action: "fund", txHash: hash, amountXlm: amt.value });
        toast("success", tx("Funded ✓", "Para yatırıldı ✓"), { hash });
        bump();
        await loadState(treasuryId, address);
        void refreshWalletXlm(address);
        return { ok: true, msg: tx("Funded ✓", "Para yatırıldı ✓"), hash };
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
      if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
      const p = payeeAddr.trim();
      if (!p) return invalid(tx("Enter a payee address.", "Bir alıcı adresi gir."));
      setBusy("whitelist");
      toast("info", tx("Approving payee — confirm in your wallet…", "Alıcı onaylanıyor — cüzdanında onayla…"));
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        await addPayee(t, p);
        void logActivity({ walletAddress: address, treasuryId, action: "whitelist" });
        const msg = tx(`Payee approved: ${shortAddr(p)}`, `Alıcı onaylandı: ${shortAddr(p)}`);
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
      if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
      setBusy("removePayee");
      toast("info", tx("Removing payee — confirm in your wallet…", "Alıcı kaldırılıyor — cüzdanında onayla…"));
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        await removePayee(t, payeeAddr.trim());
        const msg = tx(`Payee removed: ${shortAddr(payeeAddr)}`, `Alıcı kaldırıldı: ${shortAddr(payeeAddr)}`);
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
      if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
      const amt = parseXlmAmount(amount);
      if (!amt.ok) return invalid(amt.msg);
      // Single-spender rule: while the Leash is on, only the agent's key may pay.
      if (sessionActive) {
        return invalid(
          tx(
            "Your agent is on the Leash — revoke it (Agent page) to pay with your wallet.",
            "Ajanının yetkisi açık — cüzdanınla ödemek için yetkiyi iptal et (Ajan sayfası).",
          ),
        );
      }
      setBusy("spend");
      toast("info", tx("Sending payment — confirm in your wallet…", "Ödeme gönderiliyor — cüzdanında onayla…"));
      try {
        const res = await pay(makeTreasury(treasuryId, await executorFor(address)), BigInt(Date.now()), to.trim(), amt.value);
        if (res.ok) {
          void logActivity({ walletAddress: address, treasuryId, action: "pay", txHash: res.hash, amountXlm: amt.value });
          const msg = tx("Payment sent ✓", "Ödeme gönderildi ✓");
          toast("success", msg, { hash: res.hash });
          bump();
          await loadState(treasuryId, address);
          return { ok: true, msg, hash: res.hash };
        }
        trackViolation(treasuryId);
        void logActivity({ walletAddress: address, treasuryId, action: "reject", amountXlm: amt.value });
        const msg = tx(`Blocked by policy: ${res.errorMessage}`, `Kurallara takıldı, reddedildi: ${res.errorMessage}`);
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
    [address, treasuryId, sessionActive, bump, loadState, toast],
  );

  const startLeash = useCallback(
    async (cap: string, hours: string, agentPublicKey?: string): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
      const capV = parseXlmAmount(cap, "session cap");
      if (!capV.ok) return invalid(capV.msg);
      const hoursV = parseXlmAmount(hours, "duration");
      if (!hoursV.ok) return invalid(hoursV.msg);
      // The agent (eunomia-mcp) brings its own key: only the public half is registered,
      // nothing is generated or funded here.
      const externalKey = agentPublicKey?.trim() ?? "";
      if (!externalKey) {
        return invalid(
          tx(
            "Paste your agent's public key — run `eunomia-mcp init` on the agent's machine to get one.",
            "Ajanın adresini yapıştır — ajanın makinesinde `eunomia-mcp init` çalıştırınca çıkar.",
          ),
        );
      }
      if (!isValidAgentKey(externalKey)) {
        return invalid(
          tx(
            "That is not a Stellar public key (G…, 56 characters) — copy it from `eunomia-mcp init`.",
            "Bu bir Stellar adresi değil (G…, 56 karakter) — `eunomia-mcp init` komutunun yazdığı adresi kopyala.",
          ),
        );
      }
      setBusy("session");
      toast("info", tx("Authorising your agent's key — confirm in your wallet…", "Ajanın anahtarı yetkilendiriliyor — cüzdanında onayla…"));
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        const res = await registerAgentKey(t, externalKey, capV.value, hoursV.value);
        if (res.ok) {
          void logActivity({ walletAddress: address, treasuryId, action: "session_start", txHash: res.hash });
          const msg = tx(
            "Leash on ✓ — your agent can now pay within the cap, from its own machine.",
            "Yetki verildi ✓ — ajanın artık tavan içinde, kendi makinesinden ödeme yapabilir.",
          );
          toast("success", msg, { hash: res.hash });
          await loadState(treasuryId, address);
          return { ok: true, msg, hash: res.hash };
        }
        const msg = tx(`Blocked: ${res.errorMessage}`, `Reddedildi: ${res.errorMessage}`);
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

  // Everything an agent's key needs, from one button: its account, the two kinds of payee
  // approval and the Leash. Each missing piece is its own signature, taken in order; what is
  // already true is skipped, so a second press after a refused signature picks up where the
  // first stopped. `onSteps` receives the list every time a step changes state.
  const connectAgent = useCallback(
    async (
      cap: string,
      hours: string,
      agentPublicKey: string,
      opts: { catalog: boolean },
      onSteps: (steps: SetupStep[]) => void,
    ): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
      const capV = parseXlmAmount(cap, "session cap");
      if (!capV.ok) return invalid(capV.msg);
      const hoursV = parseXlmAmount(hours, "duration");
      if (!hoursV.ok) return invalid(hoursV.msg);
      const agent = agentPublicKey.trim();
      if (!agent) return invalid(tx("Paste your agent's public key — the command on this page prints it.", "Ajanın adresini yapıştır — bu sayfadaki komut onu yazdırır."));
      if (!isValidAgentKey(agent)) {
        return invalid(
          tx(
            "That is not a Stellar public key (G…, 56 characters) — copy it from what the command printed.",
            "Bu bir Stellar adresi değil (G…, 56 karakter) — komutun yazdığı adresi kopyala.",
          ),
        );
      }
      if (agent === address) return invalid(
          tx(
            "That is your own wallet's address — paste the key the command printed for the agent.",
            "Bu kendi cüzdanının adresi — komutun ajan için yazdığı adresi yapıştır.",
          ),
        );
      setBusy("session");
      let steps: SetupStep[] = [];
      const mark = (id: string, status: SetupStep["status"]) => {
        steps = steps.map((s) => (s.id === id ? { ...s, status } : s));
        onSteps(steps);
      };
      let current = "";
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        const ownerIsWallet = !isValidContractId(address);
        const [accountExists, agentIsPayee, catalog] = await Promise.all([
          agentAccountExists(agent),
          isPayee(t, agent),
          opts.catalog
            ? Promise.all(CATALOG_PAYEES.map(async (c) => ({ ...c, approved: await isPayee(t, c.address) })))
            : Promise.resolve([]),
        ]);
        steps = planAgentSetup({ agent, accountExists, ownerIsWallet, agentIsPayee, catalog });
        onSteps(steps);
        if (!accountExists && ownerIsWallet) {
          const xlm = await getXlmBalance(address);
          if (xlm === null || xlm < OWNER_MIN_XLM) {
            const msg = tx(
              `Your wallet needs about ${OWNER_MIN_XLM} XLM to open the agent's account — it holds ${(xlm ?? 0).toFixed(2)}.`,
              `Ajanın hesabını açmak için cüzdanında yaklaşık ${OWNER_MIN_XLM} XLM olmalı — şu an ${(xlm ?? 0).toFixed(2)} var.`,
            );
            toast("error", msg);
            return fail(msg);
          }
        }
        let leashHash: string | undefined;
        for (const step of steps) {
          if (step.status !== "todo") continue;
          current = step.id;
          mark(step.id, "signing");
          toast("info", tx(`${stepLabel(step)} — confirm in your wallet…`, `${stepLabel(step)} — cüzdanında onayla…`));
          if (step.kind === "account") {
            await createAgentAccount(address, agent);
          } else if (step.kind === "payee" && step.address) {
            await addPayee(t, step.address);
            rememberPayee(treasuryId, step.address);
            void logActivity({ walletAddress: address, treasuryId, action: "whitelist" });
          } else {
            const res = await registerAgentKey(t, agent, capV.value, hoursV.value);
            if (!res.ok) throw new Error(`Blocked: ${res.errorMessage}`);
            leashHash = res.hash;
            void logActivity({ walletAddress: address, treasuryId, action: "session_start", txHash: res.hash });
          }
          mark(step.id, "done");
        }
        bump();
        void refreshWalletXlm(address);
        await loadState(treasuryId, address);
        const waiting = steps.some((s) => s.status === "manual");
        const msg = waiting
          ? tx(
              "Leash on ✓ — the agent can pay as soon as its account holds some XLM.",
              "Yetki verildi ✓ — ajanın hesabına biraz XLM gelince ödeme yapabilir.",
            )
          : tx(
              "Agent connected ✓ — restart your AI client and ask it for something.",
              "Ajan bağlandı ✓ — yapay zekâ istemcini yeniden başlat, ajandan bir şey iste.",
            );
        toast("success", msg, leashHash ? { hash: leashHash } : undefined);
        return { ok: true, msg, hash: leashHash };
      } catch (e) {
        if (current) mark(current, "failed");
        // The thrown text keeps its English "Blocked:" prefix (matched here); it is shown translated.
        const blocked = e instanceof Error && e.message.startsWith("Blocked:");
        const raw = blocked ? tx("Blocked:", "Reddedildi:") + (e as Error).message.slice("Blocked:".length) : sendErr(e);
        const msg = `${/[.!?…]$/.test(raw.trim()) ? raw.trim() : `${raw.trim()}.`} ${tx("Press Connect agent again to continue from this step.", "Kaldığın yerden devam etmek için Ajanı bağla'ya yeniden bas.")}`;
        toast("error", msg);
        bump();
        return fail(msg);
      } finally {
        setBusy(null);
      }
    },
    [address, treasuryId, bump, loadState, refreshWalletXlm, toast],
  );

  // An agent's budget request (eunomia-mcp request_budget), approved with one signature. The
  // card that calls this has already checked the agent's signature and the treasury it names.
  const approveBudget = useCallback(
    async (r: BudgetRequest): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
      if (r.treasury !== treasuryId) return invalid(tx("This request is for a different treasury — open that one first.", "Bu istek başka bir kasa için — önce onu aç."));
      setBusy("session");
      toast("info", tx("Approving the agent's budget — confirm in your wallet…", "Ajanın bütçesi onaylanıyor — cüzdanında onayla…"));
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        const validUntil = BigInt(Math.floor(Date.now() / 1000) + r.hours * 3600);
        const res = await setTaskBudget(t, r.agent, validUntil, r.limit, r.payees);
        if (res.ok) {
          void logActivity({ walletAddress: address, treasuryId, action: "session_start", txHash: res.hash });
          const msg = tx(
            "Budget approved ✓ — the agent can pay inside it, only to the payees it named.",
            "Bütçe onaylandı ✓ — ajan bunun içinde, yalnız belirttiği alıcılara ödeme yapabilir.",
          );
          toast("success", msg, { hash: res.hash });
          await loadState(treasuryId, address);
          return { ok: true, msg, hash: res.hash };
        }
        const msg = tx(`Blocked: ${res.errorMessage}`, `Reddedildi: ${res.errorMessage}`);
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
    if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
    setBusy("revoke");
    toast("info", tx("Revoking the Leash — confirm in your wallet…", "Ajanın yetkisi iptal ediliyor — cüzdanında onayla…"));
    try {
      const t = makeTreasury(treasuryId, await executorFor(address));
      const res = await revokeSession(t);
      if (res.ok) {
        void logActivity({ walletAddress: address, treasuryId, action: "session_revoke", txHash: res.hash });
        const msg = tx("Leash revoked ✓ — your wallet is the spender again.", "Yetki iptal edildi ✓ — harcayan yine senin cüzdanın.");
        toast("success", msg, { hash: res.hash });
        await loadState(treasuryId, address);
        return { ok: true, msg, hash: res.hash };
      }
      const msg = tx(`Blocked: ${res.errorMessage}`, `Reddedildi: ${res.errorMessage}`);
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

  const togglePause = useCallback(async (): Promise<ActionOutcome> => {
    if (!address || !treasuryId || !lifecycle) return fail(tx("No treasury open.", "Açık kasa yok."));
    const next = !lifecycle.paused;
    setBusy("pause");
    toast(
      "info",
      next
        ? tx("Pausing — confirm in your wallet…", "Durduruluyor — cüzdanında onayla…")
        : tx("Resuming — confirm in your wallet…", "Devam ettiriliyor — cüzdanında onayla…"),
    );
    try {
      const t = makeTreasury(treasuryId, await executorFor(address));
      const res = await setPaused(t, next);
      if (res.ok) {
        void logActivity({ walletAddress: address, treasuryId, action: "pause" });
        const msg = next
          ? tx("Treasury paused — spending is frozen.", "Kasa durduruldu — harcama donduruldu.")
          : tx("Treasury resumed ✓", "Kasa devam ediyor ✓");
        toast("success", msg, { hash: res.hash });
        await loadState(treasuryId, address);
        return { ok: true, msg, hash: res.hash };
      }
      const msg = res.errorMessage ?? tx("Pause toggle failed.", "Durdurma / devam ettirme olmadı.");
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
      if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
      const amt = parseXlmAmount(amount);
      if (!amt.ok) return invalid(amt.msg);
      setBusy("withdraw");
      toast("info", tx("Withdrawing — confirm in your wallet…", "Para çekiliyor — cüzdanında onayla…"));
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        const res = await adminWithdraw(t, to.trim() || address, amt.value);
        if (res.ok) {
          void logActivity({ walletAddress: address, treasuryId, action: "withdraw", txHash: res.hash, amountXlm: amt.value });
          toast("success", tx("Withdrawn ✓", "Para çekildi ✓"), { hash: res.hash });
          bump();
          await loadState(treasuryId, address);
          void refreshWalletXlm(address);
          return { ok: true, msg: tx("Withdrawn ✓", "Para çekildi ✓"), hash: res.hash };
        }
        const msg = tx(`Blocked: ${res.errorMessage}`, `Reddedildi: ${res.errorMessage}`);
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
      if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
      const dailyLimit = parseXlmAmount(daily, "daily limit");
      if (!dailyLimit.ok) return invalid(dailyLimit.msg);
      const perTaskLimit = parseXlmAmount(perTask, "per-payment limit");
      if (!perTaskLimit.ok) return invalid(perTaskLimit.msg);
      const coherent = checkLimits(dailyLimit.value, perTaskLimit.value);
      if (!coherent.ok) return invalid(coherent.msg);
      setBusy("limits");
      toast("info", tx("Updating limits — confirm in your wallet…", "Sınırlar güncelleniyor — cüzdanında onayla…"));
      try {
        const t = makeTreasury(treasuryId, await executorFor(address));
        const res = await setLimits(t, dailyLimit.value, perTaskLimit.value);
        if (res.ok) {
          void logActivity({ walletAddress: address, treasuryId, action: "limits" });
          const msg = tx("Limits updated ✓ — effective immediately.", "Sınırlar güncellendi ✓ — hemen geçerli.");
          toast("success", msg, { hash: res.hash });
          await loadState(treasuryId, address);
          return { ok: true, msg, hash: res.hash };
        }
        const msg = tx(`Blocked: ${res.errorMessage}`, `Reddedildi: ${res.errorMessage}`);
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

  // v4: the monthly budget and per-payee monthly caps. Same shape as updateLimits.
  const updateMonthly = useCallback(
    async (limit: string): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
      const v = limit.trim() === "" || limit.trim() === "0" ? { ok: true as const, value: 0 } : parseXlmAmount(limit, "monthly limit");
      if (!v.ok) return invalid(v.msg);
      setBusy("monthly");
      toast("info", tx("Updating the monthly limit — confirm in your wallet…", "Aylık sınır güncelleniyor — cüzdanında onayla…"));
      try {
        const res = await setMonthlyLimit(makeTreasury(treasuryId, await executorFor(address)), v.value);
        if (res.ok) {
          void logActivity({ walletAddress: address, treasuryId, action: "limits" });
          const msg =
            v.value === 0
              ? tx("Monthly limit removed ✓", "Aylık sınır kaldırıldı ✓")
              : tx("Monthly limit set ✓ — counted from the start of this UTC month.", "Aylık sınır ayarlandı ✓ — bu UTC ayının başından itibaren sayılır.");
          toast("success", msg, { hash: res.hash });
          await loadState(treasuryId, address);
          return { ok: true, msg, hash: res.hash };
        }
        const msg = tx(`Blocked: ${res.errorMessage}`, `Reddedildi: ${res.errorMessage}`);
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

  const capPayee = useCallback(
    async (payee: string, cap: string): Promise<ActionOutcome> => {
      if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
      const p = payee.trim();
      if (!isValidPaymentDest(p)) return invalid(tx("That is not a Stellar address (G… or C…).", "Bu bir Stellar adresi değil (G… ya da C…)."));
      const v = cap.trim() === "" || cap.trim() === "0" ? { ok: true as const, value: 0 } : parseXlmAmount(cap, "payee cap");
      if (!v.ok) return invalid(v.msg);
      setBusy("monthly");
      toast("info", tx("Setting the payee's monthly cap — confirm in your wallet…", "Alıcının aylık tavanı ayarlanıyor — cüzdanında onayla…"));
      try {
        const res = await setPayeeCap(makeTreasury(treasuryId, await executorFor(address)), p, v.value);
        if (res.ok) {
          void logActivity({ walletAddress: address, treasuryId, action: "limits" });
          const msg =
            v.value === 0
              ? tx("Payee cap removed ✓", "Alıcı tavanı kaldırıldı ✓")
              : tx(
                  `Cap set ✓ — ${shortAddr(p)} can receive at most that per month.`,
                  `Tavan ayarlandı ✓ — ${shortAddr(p)} ayda en fazla bu kadar alabilir.`,
                );
          toast("success", msg, { hash: res.hash });
          await loadState(treasuryId, address);
          return { ok: true, msg, hash: res.hash };
        }
        const msg = tx(`Blocked: ${res.errorMessage}`, `Reddedildi: ${res.errorMessage}`);
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
    if (!address || !treasuryId) return fail(tx("No treasury open.", "Açık kasa yok."));
    setBusy("register");
    toast("info", tx("Backing up on Stellar — confirm in your wallet…", "Stellar'da yedekleniyor — cüzdanında onayla…"));
    try {
      await registerTreasury(await executorFor(address), treasuryId);
      setRegistryIds((ids) => (ids.includes(treasuryId) ? ids : [...ids, treasuryId]));
      void logActivity({ walletAddress: address, treasuryId, action: "register" });
      const msg = tx("Backed up on Stellar ✓ — open it from any device.", "Stellar'da yedeklendi ✓ — her cihazdan açabilirsin.");
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
    walletXlm,
    loading,
    busy,
    refreshKey,
    treasuries,
    refresh,
    connect,
    deploy,
    openExisting,
    fund,
    whitelist,
    removePayeeAddr,
    spend,
    startLeash,
    connectAgent,
    revokeLeash,
    approveBudget,
    togglePause,
    withdraw,
    updateLimits,
    updateMonthly,
    capPayee,
    registerActive,
    switchTreasury,
    forgetTreasury,
    creatingNew,
    startNewTreasury: () => setCreatingNew(true),
    cancelNewTreasury: () => setCreatingNew(false),
  };

  return <TreasuryContext.Provider value={value}>{children}</TreasuryContext.Provider>;
}
