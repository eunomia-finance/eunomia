// Treasury settings: identity (full ID + registry status with catch-up registration), live
// limit updates, and the owner exits (pause / withdraw — the paths that keep working even
// while paused). The exits sit in a red-framed panel apart from day-to-day edits.
import { useState } from "react";
import { EXPLORER, fmtXlm, shortAddr } from "../config";
import { useTreasury } from "../state/useTreasury";
import { tx, useLang } from "../lib/i18n";

export default function Settings() {
  useLang();
  const t = useTreasury();
  const treasuryId = t.treasuryId as string;
  const registered = t.treasuries.find((x) => x.id === treasuryId)?.registered ?? false;

  const [copied, setCopied] = useState(false);
  const [newDaily, setNewDaily] = useState("");
  const [newPerTask, setNewPerTask] = useState("");
  const [limitsErr, setLimitsErr] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawErr, setWithdrawErr] = useState("");

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(treasuryId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions) — the explorer link still exposes the full id.
    }
  };

  const doLimits = async () => {
    setLimitsErr("");
    const res = await t.updateLimits(newDaily, newPerTask);
    if (res.ok) {
      setNewDaily("");
      setNewPerTask("");
    } else if (res.validation) setLimitsErr(res.msg);
  };

  const v4 = t.lifecycle?.v4 ?? null;
  const [newMonthly, setNewMonthly] = useState("");
  const [capWho, setCapWho] = useState("");
  const [capAmt, setCapAmt] = useState("");
  const [monthErr, setMonthErr] = useState("");

  const doMonthly = async () => {
    setMonthErr("");
    const res = await t.updateMonthly(newMonthly);
    if (res.ok) setNewMonthly("");
    else if (res.validation) setMonthErr(res.msg);
  };

  const doCap = async () => {
    setMonthErr("");
    const res = await t.capPayee(capWho, capAmt);
    if (res.ok) {
      setCapWho("");
      setCapAmt("");
    } else if (res.validation) setMonthErr(res.msg);
  };

  const doWithdraw = async () => {
    setWithdrawErr("");
    const res = await t.withdraw(withdrawTo, withdrawAmt);
    if (res.ok) setWithdrawAmt("");
    else if (res.validation) setWithdrawErr(res.msg);
  };

  return (
    <div className="page">
      <div className="page__main">
        {/* ---- treasury identity ---- */}
        <section className="panel panel--pad">
          <div className="panel__head">
            <div className="eyebrow">{tx("Treasury", "Kasa")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="chip" onClick={copyId} type="button">{copied ? tx("Copied ✓", "Kopyalandı ✓") : tx("Copy ID", "ID'yi kopyala")}</button>
              <a className="chip" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }} href={`${EXPLORER}/contract/${treasuryId}`} target="_blank" rel="noreferrer">
                {tx("Explorer", "Gezgin")} ↗
              </a>
            </div>
          </div>
          <span className="code">{treasuryId}</span>
          <div className="panel__kv"><span>{tx("Owner", "Sahip")}</span><span className="num">{t.address ? shortAddr(t.address) : "—"}</span></div>
          <div className="panel__kv">
            <span>{tx("Backed up on Stellar", "Stellar'da yedekli")}</span>
            {registered ? <span className="pill pill--ok">{tx("yes", "evet")}</span> : <span className="pill pill--no">{tx("no", "hayır")}</span>}
          </div>
          {!registered && (
            <div className="rowline">
              <span className="err">{tx("This device's storage is the only key to this treasury. Save the ID, or back it up now.", "Bu kasanın tek anahtarı bu cihazın deposu. ID'yi kaydet ya da şimdi yedekle.")}</span>
              <button className="btn" onClick={() => void t.registerActive()} disabled={!!t.busy} type="button">
                {t.busy === "register" ? tx("Backing up…", "Yedekleniyor…") : tx("Back up on Stellar", "Stellar'da yedekle")}
              </button>
            </div>
          )}
          {registered && <div className="panel__note">{tx("Open it from any device by signing in with the same wallet or passkey.", "Aynı cüzdan ya da passkey ile girip her cihazdan açabilirsin.")}</div>}
        </section>

        {/* ---- limits ---- */}
        <section className="panel panel--pad">
          <div className="eyebrow">{tx("Limits", "Sınırlar")}</div>
          {t.state && (
            <>
              <div className="panel__kv"><span>{tx("Per day", "Günlük")}</span><span className="num">{fmtXlm(t.state.dailyLimit)} {t.tokenCode}</span></div>
              <div className="panel__kv"><span>{tx("Per payment", "Ödeme başı")}</span><span className="num">{fmtXlm(t.state.perTaskLimit)} {t.tokenCode}</span></div>
            </>
          )}
          <div className="two" style={{ marginTop: 6 }}>
            <label className="lab">
              <span className="eyebrow">{tx("New daily limit", "Yeni günlük sınır")} ({t.tokenCode})</span>
              <input
                className="field field--mono"
                inputMode="decimal"
                aria-label={tx(`New daily limit in ${t.tokenCode}`, `Yeni günlük sınır, ${t.tokenCode}`)}
                placeholder={t.state ? fmtXlm(t.state.dailyLimit) : ""}
                value={newDaily}
                onChange={(e) => setNewDaily(e.target.value)}
              />
            </label>
            <label className="lab">
              <span className="eyebrow">{tx("New per-payment limit", "Yeni ödeme başı sınır")} ({t.tokenCode})</span>
              <input
                className="field field--mono"
                inputMode="decimal"
                aria-label={tx(`New per-payment limit in ${t.tokenCode}`, `Yeni ödeme başı sınır, ${t.tokenCode}`)}
                placeholder={t.state ? fmtXlm(t.state.perTaskLimit) : ""}
                value={newPerTask}
                onChange={(e) => setNewPerTask(e.target.value)}
              />
            </label>
          </div>
          <div className="rowline">
            <span className="panel__note">
              {t.legacy
                ? tx("This is an early treasury — limit updates need a fresh treasury.", "Bu eski bir kasa — sınırı değiştirmek için yeni kasa gerekir.")
                : tx("Effective immediately, enforced on Stellar.", "Hemen geçerli olur, Stellar'da uygulanır.")}
            </span>
            <button className="btn" onClick={() => void doLimits()} disabled={!!t.busy || t.legacy} type="button">
              {t.busy === "limits" ? tx("Updating…", "Güncelleniyor…") : tx("Update limits", "Sınırları güncelle")}
            </button>
          </div>
          {limitsErr && <div className="err">{limitsErr}</div>}
        </section>

        {/* ---- v4: the month, and individual payees ---- */}
        {v4 && (
          <section className="panel panel--pad">
            <div className="eyebrow">{tx("Per month", "Aylık")}</div>
            <div className="panel__kv">
              <span>{tx("This month, at most", "Bu ay en fazla")}</span>
              <span className="num">{v4.monthlyLimit > 0n ? `${fmtXlm(v4.monthlyLimit)} ${t.tokenCode}` : tx("no monthly limit", "aylık sınır yok")}</span>
            </div>
            <div className="panel__kv"><span>{tx("Moved this month", "Bu ay çıkan")}</span><span className="num">{fmtXlm(v4.monthSpent)} {t.tokenCode}</span></div>
            {v4.depositCap > 0n && (
              <div className="panel__kv"><span>{tx("Deposit cap (beta, fixed)", "Yatırma tavanı (beta, sabit)")}</span><span className="num">{fmtXlm(v4.depositCap)} {t.tokenCode}</span></div>
            )}
            <div className="rowline">
              <input
                className="field field--mono"
                style={{ flex: 1 }}
                inputMode="decimal"
                aria-label={tx(`Monthly limit in ${t.tokenCode}`, `Aylık sınır, ${t.tokenCode}`)}
                placeholder={tx(`Monthly limit (${t.tokenCode}) — 0 removes it`, `Aylık sınır (${t.tokenCode}) — 0 kaldırır`)}
                value={newMonthly}
                onChange={(e) => setNewMonthly(e.target.value)}
              />
              <button className="btn" onClick={() => void doMonthly()} disabled={!!t.busy} type="button">
                {t.busy === "monthly" && newMonthly ? tx("Saving…", "Kaydediliyor…") : tx("Set monthly limit", "Aylık sınırı koy")}
              </button>
            </div>
            <div className="eyebrow" style={{ marginTop: 8 }}>{tx("Cap one payee per month", "Bir alıcıya aylık tavan koy")}</div>
            <input
              className="field field--mono"
              aria-label={tx("Payee to cap", "Tavan konacak alıcı")}
              placeholder={tx("Payee address (G… or C…)", "Alıcı adresi (G… ya da C…)")}
              spellCheck={false}
              value={capWho}
              onChange={(e) => setCapWho(e.target.value)}
            />
            <div className="rowline">
              <input
                className="field field--mono"
                style={{ flex: 1 }}
                inputMode="decimal"
                aria-label={tx(`Payee monthly cap in ${t.tokenCode}`, `Alıcı aylık tavanı, ${t.tokenCode}`)}
                placeholder={tx(`Monthly cap (${t.tokenCode}) — 0 removes it`, `Aylık tavan (${t.tokenCode}) — 0 kaldırır`)}
                value={capAmt}
                onChange={(e) => setCapAmt(e.target.value)}
              />
              <button className="btn" onClick={() => void doCap()} disabled={!!t.busy} type="button">
                {t.busy === "monthly" && capAmt ? tx("Saving…", "Kaydediliyor…") : tx("Set cap", "Tavanı koy")}
              </button>
            </div>
            <div className="panel__note">
              {tx(
                "Months are UTC calendar months. A cap narrows what an approved payee can receive; it does not approve anyone. Cap your agent's own address to bound what it can hold outside the treasury.",
                "Aylar UTC takvim ayıdır. Tavan, onaylı bir alıcının alabileceğini daraltır; kimseyi onaylamaz. Ajanının kasa dışında tutabileceğini sınırlamak için kendi adresine tavan koy.",
              )}
            </div>
            {monthErr && <div className="err">{monthErr}</div>}
          </section>
        )}
      </div>

      {/* The exit paths sit apart from the settings you change day to day — pausing and
          withdrawing are not edits, they are ways out. */}
      <div className="page__side">
        <section className="panel panel--pad panel--exit">
          <div className="eyebrow" style={{ color: "var(--red)" }}>{tx("Owner exits", "Sahibin çıkış yolları")}</div>
          {t.legacy ? (
            <div className="panel__note">
              {tx(
                "This early treasury has no withdraw of its own. To move funds out: approve your own wallet as a payee (Payments), then pay yourself within the limits",
                "Bu eski kasanın kendi çekme yolu yok. Parayı çıkarmak için: kendi cüzdanını alıcı olarak onayla (Ödemeler), sonra sınırlar içinde kendine öde",
              )}
              {t.state
                ? tx(
                    ` (≤ ${fmtXlm(t.state.perTaskLimit)} ${t.tokenCode} per payment · ≤ ${fmtXlm(t.state.dailyLimit)} ${t.tokenCode} per day)`,
                    ` (ödeme başı ≤ ${fmtXlm(t.state.perTaskLimit)} ${t.tokenCode} · günlük ≤ ${fmtXlm(t.state.dailyLimit)} ${t.tokenCode})`,
                  )
                : ""}
              .{" "}
              {tx(
                "Or create a fresh treasury from the switcher — pause, withdraw and the Leash all live there.",
                "Ya da değiştiriciden yeni bir kasa aç — durdurma, çekme ve ajanın yetkisi orada.",
              )}
            </div>
          ) : (
            <>
              <div className="rowline">
                <span className="panel__note">
                  {t.lifecycle?.paused
                    ? tx("Spending is frozen — every payment is refused. Withdraw still works.", "Harcama donduruldu — her ödeme reddedilir. Çekme yine çalışır.")
                    : tx("Freeze every payment at once. Withdraw keeps working.", "Tüm ödemeleri bir anda durdur. Çekme çalışmaya devam eder.")}
                </span>
                <button className="btn btn--danger" onClick={() => void t.togglePause()} disabled={!!t.busy} type="button">
                  {t.busy === "pause" ? tx("Working…", "Yapılıyor…") : t.lifecycle?.paused ? tx("Resume spending", "Harcamayı devam ettir") : tx("Pause spending", "Harcamayı durdur")}
                </button>
              </div>
              <div className="eyebrow" style={{ marginTop: 8 }}>{tx("Withdraw · works while paused", "Çek · durdurulmuşken de çalışır")}</div>
              <input
                className="field field--mono"
                placeholder={tx(`To (default: your wallet ${t.address ? shortAddr(t.address) : ""})`, `Kime (varsayılan: cüzdanın ${t.address ? shortAddr(t.address) : ""})`)}
                aria-label={tx("Withdraw destination address", "Çekilecek adres")}
                spellCheck={false}
                value={withdrawTo}
                onChange={(e) => setWithdrawTo(e.target.value)}
              />
              <div className="rowline">
                <input
                  className="field field--mono"
                  style={{ flex: 1 }}
                  inputMode="decimal"
                  placeholder={tx(`Amount (${t.tokenCode})`, `Tutar (${t.tokenCode})`)}
                  aria-label={tx(`Withdraw amount in ${t.tokenCode}`, `Çekilecek tutar, ${t.tokenCode}`)}
                  value={withdrawAmt}
                  onChange={(e) => setWithdrawAmt(e.target.value)}
                />
                <button className="btn btn--danger" onClick={() => void doWithdraw()} disabled={!!t.busy} type="button">
                  {t.busy === "withdraw" ? tx("Withdrawing…", "Çekiliyor…") : tx("Withdraw", "Çek")}
                </button>
              </div>
              {t.tokenCode === "USDC" && (
                <div className="panel__note">
                  {tx(
                    "A G… account can receive USDC only after it trusts the issuer; without that trustline Stellar refuses the withdrawal. A passkey wallet (C…) needs nothing.",
                    "G… hesap USDC'yi ancak ihraççıya güvendikten sonra alabilir; trustline yoksa Stellar çekmeyi reddeder. Passkey cüzdanı (C…) için bir şey gerekmez.",
                  )}
                </div>
              )}
              {withdrawErr && <div className="err">{withdrawErr}</div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
