// Exception requests the Leash agent filed (eunomia-mcp `request_exception`), read straight
// from the agent account on Horizon. The owner resolves one with the same on-chain actions
// the rest of the dashboard already has; a request shows as allowed only once the chain
// would accept the payment. Nothing here is approved off-chain.
//
// The payee in a request is whatever the agent wrote, and an agent can be talked into writing
// an address made to look like one the owner knows: same first four characters, same last
// four. Approving it is permanent — the address stays on the list for every later Leash. So
// the payee is shown whole, and the approve button stays off until the owner has pasted the
// address they mean to pay from their own source (fifth review, F3; the budget card does the
// same for an agent key it has not seen).
import { useEffect, useState } from "react";
import { EXPLORER, NETWORK_PASSPHRASE, RPC_URL, fmtXlm } from "../config";
import { exceptionStatus, fetchAgentExceptions, ownerActionFor, type ExceptionRequest } from "../lib/exceptions";
import { Client } from "../lib/treasuryClient";
import { useNow } from "../lib/useNow";
import { tx, useLang } from "../lib/i18n";
import { contractMsg } from "../lib/wallet-errors";
import { useTreasury } from "../state/useTreasury";

interface Row extends ExceptionRequest {
  payeeAllowed: boolean;
}

export default function ExceptionRequests({ agent }: { agent: string }) {
  useLang();
  const t = useTreasury();
  const treasuryId = t.treasuryId;
  // Rows and errors are tagged with the agent + treasury they were read for, so a switch
  // never shows the previous treasury's requests (with live action buttons) against the new one.
  const key = `${agent}:${treasuryId ?? ""}`;
  const [loaded, setLoaded] = useState<{ key: string; rows: Row[]; err: string }>({ key: "", rows: [], err: "" });
  const rows = loaded.key === key ? loaded.rows : [];
  const err = loaded.key === key ? loaded.err : "";
  // What the owner pasted to confirm each request's payee, by request id.
  const [pasted, setPasted] = useState<Record<string, string>>({});
  // A shared ticking clock (render-pure): the Leash cap stops binding the moment it expires.
  const nowSec = Math.floor(useNow(rows.length > 0) / 1000);

  useEffect(() => {
    if (!treasuryId) return;
    const readKey = `${agent}:${treasuryId}`;
    let cancelled = false;
    const client = new Client({ contractId: treasuryId, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL });
    (async () => {
      try {
        const reqs = await fetchAgentExceptions(agent, treasuryId);
        const withPayee = await Promise.all(
          reqs.map(async (r) => {
            let payeeAllowed = false;
            try {
              payeeAllowed = (await client.is_payee({ payee: r.payee })).result;
            } catch {
              /* unreadable → treated as not yet allowed */
            }
            return { ...r, payeeAllowed };
          }),
        );
        if (!cancelled) setLoaded({ key: readKey, rows: withPayee, err: "" });
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : tx("Could not read the agent's requests.", "Ajanın istekleri okunamadı.");
          // A failed refresh keeps the rows already read for this same treasury.
          setLoaded((prev) => ({ key: readKey, rows: prev.key === readKey ? prev.rows : [], err: msg }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, treasuryId, t.refreshKey]);

  if (!treasuryId || !t.state || (rows.length === 0 && !err)) return null;

  const pending = rows.filter((r) => exceptionStatus(r, t.state!, t.lifecycle, r.payeeAllowed, nowSec) !== "resolved").length;

  return (
    <section className="panel panel--pad">
      <div className="panel__head">
        <div className="eyebrow">{tx("Waiting for you", "Seni bekleyenler")}</div>
        {pending > 0 && <span className="pill pill--rule">{pending} {tx("pending", "bekliyor")}</span>}
      </div>
      <div className="panel__note">
        {tx(
          "Your agent asked to pay outside your rules. Each request sits on the agent's own Stellar account; resolving one is an on-chain change to your rules, and it counts as allowed only once Stellar would accept the payment.",
          "Ajanın kuralların dışında bir ödeme istedi. Her istek ajanın kendi Stellar hesabında durur. Birini çözmek kurallarda zincir üstünde bir değişiklik demek. Stellar ödemeyi kabul edene kadar ödendi sayılmaz.",
        )}
      </div>
      {err && <div className="err">{err}</div>}
      {rows.map((r) => {
        const status = exceptionStatus(r, t.state!, t.lifecycle, r.payeeAllowed, nowSec);
        // The reason codes are what blocked the payment when it was filed. Offer only an action
        // that still applies: "Resume" calls togglePause, which would pause a treasury that has
        // since been resumed, and approving an already-approved payee is a wasted signature.
        const primary = r.reasonCodes
          .map(ownerActionFor)
          .find(
            (a) =>
              a.kind !== "none" &&
              !(a.kind === "pause" && !t.lifecycle?.paused) &&
              !(a.kind === "whitelist" && r.payeeAllowed),
          );
        return (
          <div key={r.id} style={{ paddingTop: 12, borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="rowline">
              <span className="num" style={{ fontSize: 14 }}>
                {fmtXlm(r.amount)} {t.tokenCode}
              </span>
              <span className={status === "resolved" ? "pill pill--ok" : "pill pill--rule"}>
                {status === "resolved" ? tx("allowed now", "artık ödenebilir") : tx("pending", "bekliyor")}
              </span>
            </div>
            <div className="panel__kv">
              <span>{tx("To", "Alıcı")}</span>
              <a
                className="num"
                style={{ wordBreak: "break-all", textAlign: "right" }}
                href={`${EXPLORER}/account/${r.payee}`}
                target="_blank"
                rel="noreferrer"
              >
                {r.payee} ↗
              </a>
            </div>
            <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
              {r.reasonCodes.map((c) => (
                <li key={c}>{contractMsg(c) ?? tx(`Contract error #${c}`, `Kontrat hatası #${c}`)}</li>
              ))}
            </ul>
            <div className="ledger__when">
              {new Date(r.requestedAt * 1000).toLocaleString()} · {tx("task", "görev")} #{r.taskId.toString()} ·{" "}
              <a className="linkbtn" href={`${EXPLORER}/account/${agent}`} target="_blank" rel="noreferrer">{tx("agent account", "ajan hesabı")} ↗</a>
            </div>
            {status === "resolved" ? (
              <div className="panel__note">{tx("The agent can pay this now; it clears the request when it does.", "Ajan bunu şimdi ödeyebilir; ödeyince isteği kendisi kapatır.")}</div>
            ) : primary?.kind === "whitelist" ? (
              <>
                <label className="lab">
                  <span className="eyebrow">{tx("An address your treasury does not pay yet", "Kasanın henüz ödemediği bir adres")}</span>
                  <input
                    className="field field--mono"
                    aria-label={tx("The address you mean to pay", "Ödemek istediğin adres")}
                    placeholder={tx("Paste the address you mean to pay, from your own source", "Ödemek istediğin adresi kendi kaynağından yapıştır")}
                    spellCheck={false}
                    value={pasted[r.id] ?? ""}
                    onChange={(e) => setPasted((p) => ({ ...p, [r.id]: e.target.value }))}
                  />
                  <span className="panel__note">
                    {tx(
                      "Your agent wrote the address above, and approving it is permanent. Approve only when the address you got from the payee yourself matches it",
                      "Yukarıdaki adresi ajanın yazdı ve onayı kalıcı. Sadece alıcıdan kendin aldığın adresle aynıysa onayla",
                    )}
                    {(pasted[r.id] ?? "").trim() && (pasted[r.id] ?? "").trim() !== r.payee ? tx(" — this one does not.", " — bu uymuyor.") : "."}
                  </span>
                </label>
                <div>
                  <button
                    className="btn"
                    onClick={() => void t.whitelist(r.payee)}
                    disabled={!!t.busy || (pasted[r.id] ?? "").trim() !== r.payee}
                    type="button"
                  >
                    {t.busy === "whitelist" ? tx("Approving…", "Onaylanıyor…") : tx("Approve this payee", "Bu alıcıyı onayla")}
                  </button>
                </div>
              </>
            ) : primary?.kind === "pause" ? (
              <div>
                <button className="btn" onClick={() => void t.togglePause()} disabled={!!t.busy} type="button">
                  {t.busy === "pause" ? tx("Resuming…", "Devam ettiriliyor…") : tx("Resume treasury", "Kasayı devam ettir")}
                </button>
              </div>
            ) : primary ? (
              <div className="panel__note">{tx(`${primary.label}. Nothing else changes until you do.`, `${primary.label}. Sen yapana kadar başka bir şey değişmez.`)}</div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
