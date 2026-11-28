// The pre-treasury experience: a connect gate for visitors, then one screen that creates
// the treasury with its rules and starting funds in a single signature (treasury factory).
// The two optional pieces — a first payee, an agent on a Leash — stay folded until asked
// for, so a first-time owner sees three numbers and one button; opening an existing
// treasury by id is a single quiet line under the form.
import { useEffect, useState } from "react";
import { useTreasury } from "../state/useTreasury";
import { freshSalt, predictTreasuryId } from "../lib/createTreasury";
import { needsFunding, MIN_XLM } from "../lib/funding";
import { tx, useLang } from "../lib/i18n";
import { passkeyCapability, type PasskeyCapability } from "../lib/passkeySupport";
import RecoverySetup from "../components/RecoverySetup";
import RecoveryRestore from "../components/RecoveryRestore";
import type { TokenCode } from "../lib/token";
import { errText } from "../lib/wallet-errors";
import { connectPasskey } from "../lib/walletKit";
import { shortAddr } from "../config";

export default function Setup() {
  useLang();
  const t = useTreasury();
  const [daily, setDaily] = useState("50");
  const [perTask, setPerTask] = useState("10");
  const [payee, setPayee] = useState("");
  const [agentKey, setAgentKey] = useState("");
  const [cap, setCap] = useState("25");
  const [hours, setHours] = useState("24");
  const [fundXlm, setFundXlm] = useState("20");
  // What the treasury holds is fixed at creation. USDC first: it is what an agent pays in, and
  // the one a passkey owner can fill without ever needing XLM — the relay pays the fees.
  const [token, setToken] = useState<TokenCode>("USDC");
  // The salt decides the treasury's address, so it is drawn when the form opens, not at the
  // moment of signing: an agent connected below needs that address before it exists.
  const [salt, setSalt] = useState(freshSalt);
  const initCommand = `npx -y eunomia-mcp@0.3.5 init --treasury ${predictTreasuryId(salt)}`;
  const [copied, setCopied] = useState(false);
  const copyInit = () => {
    void navigator.clipboard?.writeText(initCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const [existing, setExisting] = useState("");
  const [err, setErr] = useState("");
  const [openErr, setOpenErr] = useState("");
  // The optional parts are folded; opening one reveals its fields, closing one clears them
  // so nothing hidden is ever sent.
  const [withPayee, setWithPayee] = useState(false);
  const [withAgent, setWithAgent] = useState(false);
  const [openExisting, setOpenExisting] = useState(false);
  // The gate also has to let a passkey user back in: someone who lands on #overview with
  // no session (new browser, cleared storage) must not be funnelled into a wallet modal.
  const [passkeyKind, setPasskeyKind] = useState<PasskeyCapability>("none");
  const passkeys = passkeyKind !== "none";
  const [signingIn, setSigningIn] = useState(false);
  const [signInErr, setSignInErr] = useState("");
  useEffect(() => {
    void passkeyCapability(window).then(setPasskeyKind);
  }, []);

  // The landing page used to carry four doors (create with a passkey, sign in with one, "I
  // have a wallet", restore) and builders stalled in front of them. It has one door now, and
  // it leads here: this gate asks the one question that decides the rest — do you have a wallet.
  const [creating, setCreating] = useState(false);
  // A passkey wallet was just made: its recovery code has to be saved before anything else.
  const [recoveryFor, setRecoveryFor] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const createPasskey = async () => {
    setSignInErr("");
    setCreating(true);
    try {
      setRecoveryFor(await connectPasskey("create"));
    } catch (e) {
      setSignInErr(errText(e) || tx("Couldn't create your passkey. Try again.", "Passkey oluşturulamadı. Tekrar dene."));
    } finally {
      setCreating(false);
    }
  };
  // Rendered in both states of this page: creating a passkey wallet connects it, which
  // swaps the gate for the form underneath while the recovery step is still open.
  const dialogs = (
    <>
      {recoveryFor && <RecoverySetup address={recoveryFor} onDone={() => setRecoveryFor(null)} />}
      {restoreOpen && <RecoveryRestore onDone={() => setRestoreOpen(false)} onClose={() => setRestoreOpen(false)} />}
    </>
  );

  const signInPasskey = async () => {
    setSignInErr("");
    setSigningIn(true);
    try {
      // The provider follows the shared address store, so the treasury opens by itself.
      await connectPasskey("connect");
    } catch (e) {
      setSignInErr(errText(e) || tx("Couldn't open your wallet with that passkey.", "Bu passkey ile cüzdan açılamadı."));
    } finally {
      setSigningIn(false);
    }
  };

  const doDeploy = async () => {
    setErr("");
    const res = await t.deploy(daily, perTask, { payee, agentKey, capXlm: cap, hours, fundXlm, token, salt });
    if (!res.ok && res.validation) setErr(res.msg);
    // A failed attempt may still have reached the chain, and an address can be deployed to
    // only once. Draw a new one — unless an agent's key was already made for this one, in
    // which case the address is a promise and the retry has to keep it.
    if (!res.ok && !res.validation && !agentKey.trim()) setSalt(freshSalt());
  };

  const doOpen = () => {
    setOpenErr("");
    const res = t.openExisting(existing);
    if (!res.ok) setOpenErr(res.msg);
  };

  const togglePayee = () => {
    if (withPayee) setPayee("");
    setWithPayee((v) => !v);
  };
  const toggleAgent = () => {
    if (withAgent) setAgentKey("");
    setWithAgent((v) => !v);
  };

  // ---- connect gate -------------------------------------------------------------
  if (!t.address) {
    const waiting = t.busy === "connect" || signingIn || creating;
    return (
      <div className="gate">
        {dialogs}
        <h1 className="gate__title">{tx("Give your agent a budget — not your wallet.", "Ajanına cüzdanını değil, bütçe ver.")}</h1>
        <p className="gate__lede">
          {tx(
            "Set the rules once. Every payment is checked and enforced on Stellar — anything outside the rules is blocked, automatically.",
            "Kuralları bir kez koy. Her ödeme Stellar'da denetlenir — kuralların dışındaki her şey kendiliğinden reddedilir.",
          )}
        </p>

        <div className={`gate__doors${passkeys ? "" : " gate__doors--one"}`}>
          <section className="panel gate__door">
            <div className="eyebrow">{tx("I have a wallet", "Cüzdanım var")}</div>
            <p className="panel__note">
              {tx(
                "Freighter, Varial, Lobstr, xBull or a phone wallet. You sign with it; nothing moves without you.",
                "Freighter, Varial, Lobstr, xBull ya da telefondaki cüzdan. İmzayı onunla atarsın; sen onaylamadan hiçbir şey olmaz.",
              )}
            </p>
            <button className="btn btn--gold btn--lg" onClick={() => void t.connect()} disabled={waiting} type="button">
              {t.busy === "connect" ? tx("Connecting…", "Bağlanıyor…") : tx("Connect wallet", "Cüzdanı bağla")}
            </button>
          </section>

          {passkeys && (
            <section className="panel gate__door">
              <div className="eyebrow">{tx("I don't have a wallet", "Cüzdanım yok")}</div>
              <p className="panel__note">
                {passkeyKind === "platform"
                  ? tx(
                      "Your fingerprint, face or PIN opens one for you — a passkey. Nothing to install.",
                      "Parmak izin, yüzün ya da PIN'in senin için bir tane açar: passkey. Kurman gereken bir şey yok.",
                    )
                  : tx("A passkey opens one for you: pair with your phone. Nothing to install.", "Passkey senin için bir tane açar: telefonunla eşleştir. Kurman gereken bir şey yok.")}
              </p>
              <button className="btn btn--lg" onClick={() => void createPasskey()} disabled={waiting} type="button">
                {creating ? tx("Creating…", "Oluşturuluyor…") : tx("Start with a passkey", "Passkey ile başla")}
              </button>
            </section>
          )}
        </div>

        {/* The two ways back in for someone who already made a passkey treasury — quiet,
            because a first visit needs neither. */}
        {passkeys && (
          <div className="gate__back">
            <button className="linkbtn" onClick={() => void signInPasskey()} disabled={waiting} type="button">
              {signingIn ? tx("Opening…", "Açılıyor…") : tx("I already made a treasury with a passkey — sign in", "Daha önce passkey ile kasa açtım — gir")}
            </button>
            <button className="linkbtn" onClick={() => setRestoreOpen(true)} disabled={waiting} type="button">
              {tx("I lost my passkey — restore access", "Passkey'imi kaybettim — erişimi geri yükle")}
            </button>
          </div>
        )}
        {signInErr && <div className="err">{signInErr}</div>}
      </div>
    );
  }

  // ---- one-screen creation --------------------------------------------------------
  const payeeOn = withPayee && payee.trim() !== "";
  const agentOn = withAgent && agentKey.trim() !== "";
  const fundOn = token === "XLM" && Number(fundXlm) > 0;
  // A smart wallet never pays a fee — the relay does — so with a USDC treasury it needs no
  // XLM at all. Everyone else needs some: for fees, and for the starting funds of an XLM one.
  const wantsXlm = token === "XLM" || !t.address.startsWith("C");

  return (
    <div className="page">
      {dialogs}
      <div className="page__main">
        {t.creatingNew && t.treasuryId && (
          <div>
            <button className="linkbtn" onClick={t.cancelNewTreasury} type="button">
              ← {tx("Back to your current treasury", "Mevcut kasana dön")}
            </button>
          </div>
        )}

        {wantsXlm && t.walletXlm !== undefined && needsFunding(t.walletXlm) && (
          <div className="notice">
            <span>
              {t.walletXlm === null
                ? tx("Your wallet doesn't exist on Stellar mainnet yet (0 XLM). ", "Cüzdanın Stellar mainnet'te henüz yok (0 XLM). ")
                : tx(`Your wallet holds ${t.walletXlm.toFixed(2)} XLM. `, `Cüzdanında ${t.walletXlm.toFixed(2)} XLM var. `)}
              {tx(`You need ~${MIN_XLM} XLM to create and fund a treasury.`, `Kasa açıp doldurmak için yaklaşık ${MIN_XLM} XLM gerekir.`)}
            </span>
          </div>
        )}

        <section className="panel panel--pad">
          <div className="eyebrow">{tx("Step 1 of 4 · New treasury", "Adım 1 / 4 · Yeni kasa")}</div>
          <div className="panel__title">{tx("Set the rules once.", "Kuralları bir kez koy.")}</div>
          <div className="panel__note">
            {tx(
              "Your agent can never spend past the daily cap in any rolling 24 hours, and never more than the per-payment cap at once. Enforced on Stellar, not by promise.",
              "Ajanın 24 saat içinde günlük sınırı, tek seferde de ödeme başı sınırı asla aşamaz. Söz olarak değil, Stellar'da uygulanır.",
            )}
          </div>

          <div className="lab" style={{ marginTop: 6 }}>
            <span className="eyebrow">{tx("The treasury holds", "Kasa şunu tutar")}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label={tx("Treasury currency", "Kasanın para birimi")}>
              <button className={`chip${token === "USDC" ? " is-on" : ""}`} onClick={() => setToken("USDC")} aria-pressed={token === "USDC"} type="button">
                USDC
              </button>
              <button className={`chip${token === "XLM" ? " is-on" : ""}`} onClick={() => setToken("XLM")} aria-pressed={token === "XLM"} type="button">
                {tx("XLM · funded from your wallet", "XLM · cüzdanından doldurulur")}
              </button>
            </div>
          </div>

          <div className="two">
            <label className="lab">
              <span className="eyebrow">{tx(`Daily limit (${token})`, `Günlük sınır (${token})`)}</span>
              <input className="field field--mono" inputMode="decimal" aria-label={tx(`Daily limit in ${token}`, `Günlük sınır (${token})`)} value={daily} onChange={(e) => setDaily(e.target.value)} />
            </label>
            <label className="lab">
              <span className="eyebrow">{tx(`Per-payment limit (${token})`, `Ödeme başı sınır (${token})`)}</span>
              <input className="field field--mono" inputMode="decimal" aria-label={tx(`Per-payment limit in ${token}`, `Ödeme başı sınır (${token})`)} value={perTask} onChange={(e) => setPerTask(e.target.value)} />
            </label>
          </div>

          {token === "XLM" ? (
            <label className="lab">
              <span className="eyebrow">{tx("Starting funds (XLM)", "Başlangıç parası (XLM)")}</span>
              <input className="field field--mono" inputMode="decimal" aria-label={tx("Starting funds in XLM", "Başlangıç parası (XLM)")} value={fundXlm} onChange={(e) => setFundXlm(e.target.value)} />
              <span className="panel__note">
                {tx(
                  "Moved from your wallet into the treasury in the same signature. 0 opens it empty; you can add funds any time.",
                  "Aynı imzayla cüzdanından kasaya geçer. 0 yazarsan boş açılır; istediğin an para yatırırsın.",
                )}
              </span>
            </label>
          ) : (
            <div className="panel__note">
              {tx(
                "It opens empty. Right after, you deposit USDC into it from your wallet — that is step 2.",
                "Kasa boş açılır. Hemen ardından cüzdanından USDC yatırırsın — bu 2. adım.",
              )}
            </div>
          )}

          {/* the optional parts, folded */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <button className={`chip${withPayee ? " is-on" : ""}`} onClick={togglePayee} type="button" aria-expanded={withPayee}>
              {withPayee ? "− " : "+ "}{tx("Approve a payee now", "Şimdi bir alıcı onayla")}
            </button>
            <button className={`chip${withAgent ? " is-on" : ""}`} onClick={toggleAgent} type="button" aria-expanded={withAgent}>
              {withAgent ? "− " : "+ "}{tx("Connect an agent now", "Şimdi bir ajan bağla")}
            </button>
          </div>
          {!withPayee && !withAgent && (
            <div className="panel__note">
              {tx(
                "Both can wait: you connect the agent on the Agent page after the treasury is open.",
                "İkisi de bekleyebilir: ajanı, kasa açıldıktan sonra Ajan sayfasından bağlarsın.",
              )}
            </div>
          )}

          {withPayee && (
            <label className="lab">
              <span className="eyebrow">{tx("First approved payee", "İlk onaylı alıcı")}</span>
              <input
                className="field field--mono"
                aria-label={tx("First approved payee address", "İlk onaylı alıcının adresi")}
                placeholder={tx("G… — the treasury can pay this address; anyone else is refused", "G… — kasa bu adrese ödeyebilir; başkası reddedilir")}
                spellCheck={false}
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
              />
            </label>
          )}

          {withAgent && (
            <>
              {/* An agent's key is made for one treasury id, and this treasury has none yet —
                  so its address is fixed here, from the salt, before it exists. The command
                  below already carries it. */}
              <div className="lab">
                <span className="eyebrow">{tx("In a terminal on the agent's machine", "Ajanın bilgisayarındaki terminalde")}</span>
                <span className="code">{initCommand}</span>
                <div>
                  <button className="linkbtn" onClick={copyInit} type="button" aria-live="polite">
                    {copied ? tx("copied", "kopyalandı") : tx("copy command", "komutu kopyala")}
                  </button>
                </div>
                <span className="panel__note">
                  {tx(
                    "It makes the agent's key for this treasury — whose address is already settled, though it is not created yet — and prints the public half. The secret stays on that machine.",
                    "Bu kasa için ajanın anahtarını üretir — kasa henüz açılmadı ama adresi belli — ve açık yarısını yazar. Gizli anahtar o bilgisayarda kalır.",
                  )}
                </span>
              </div>
              <label className="lab">
                <span className="eyebrow">{tx("Agent public key", "Ajan adresi")}</span>
                <input
                  className="field field--mono"
                  aria-label={tx("Agent public key for the Leash", "Yetki verilecek ajan adresi")}
                  placeholder={tx("G… — the key that command prints", "G… — komutun yazdığı adres")}
                  spellCheck={false}
                  value={agentKey}
                  onChange={(e) => setAgentKey(e.target.value)}
                />
                <span className="panel__note">
                  {tx(
                    "The agent may spend with this signature: it pays on its own, up to the cap, until the deadline. Revoke any time.",
                    "Ajan bu imzayla harcama yetkisi alır: tavana kadar, süre dolana dek kendisi öder. İstediğin an iptal edersin.",
                  )}
                </span>
              </label>
              <div className="two">
                <label className="lab">
                  <span className="eyebrow">{tx(`At most (${token})`, `En fazla (${token})`)}</span>
                  <input className="field field--mono" inputMode="decimal" aria-label={tx(`Leash spending cap in ${token}`, `Harcama tavanı (${token})`)} value={cap} onChange={(e) => setCap(e.target.value)} />
                </label>
                <label className="lab">
                  <span className="eyebrow">{tx("Duration (hours)", "Süre (saat)")}</span>
                  <input className="field field--mono" inputMode="decimal" aria-label={tx("Leash duration in hours", "Yetki süresi (saat)")} value={hours} onChange={(e) => setHours(e.target.value)} />
                </label>
              </div>
            </>
          )}

          <div style={{ marginTop: 6 }}>
            <button className="btn btn--gold" onClick={() => void doDeploy()} disabled={!!t.busy} type="button">
              {t.busy === "deploy" ? tx("Creating…", "Açılıyor…") : tx("Create treasury", "Kasayı aç")}
            </button>
          </div>
          {err && <div className="err">{err}</div>}
        </section>

        {/* the quiet second path: a treasury this browser does not know about */}
        <div style={{ padding: "0 4px" }}>
          {!openExisting ? (
            <button className="linkbtn" onClick={() => setOpenExisting(true)} type="button">
              {tx("Have a treasury from another device or wallet? Open it by its id", "Başka cihazda ya da cüzdanda kasan mı var? Kimliğiyle aç")}
            </button>
          ) : (
            <section className="panel panel--pad">
              <div className="eyebrow">{tx("Open an existing treasury", "Var olan bir kasayı aç")}</div>
              <div className="rowline">
                <input
                  className="field field--mono"
                  style={{ flex: 1 }}
                  placeholder={tx("Treasury contract id (C…)", "Kasa kimliği (C…)")}
                  aria-label={tx("Existing treasury contract id", "Var olan kasanın kimliği")}
                  spellCheck={false}
                  autoFocus
                  value={existing}
                  onChange={(e) => {
                    setExisting(e.target.value);
                    // Clear the previous complaint as soon as the field is touched; leaving it up
                    // makes the page look like it is rejecting what is currently typed.
                    if (openErr) setOpenErr("");
                  }}
                />
                <button className="btn btn--ghost" onClick={doOpen} type="button">{tx("Open", "Aç")}</button>
              </div>
              {openErr && <div className="err">{openErr}</div>}
              <div className="panel__note">
                {tx(
                  "The id is on the Settings page of the device that created it. Treasuries backed up on Stellar open by themselves when you sign in with the same wallet or passkey.",
                  "Kimlik, kasayı açan cihazın Ayarlar sayfasında yazar. Stellar'da yedeklenen kasalar aynı cüzdan ya da passkey ile girince kendiliğinden açılır.",
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* What that single signature does. */}
      <div className="page__side">
        <section className="panel panel--pad is-contrast" style={{ border: "none" }}>
          <div className="eyebrow">{tx("One signature does all of this", "Tek imza bunların hepsini yapar")}</div>
          <ol style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, lineHeight: 1.5 }}>
            <li>
              {tx("Creates the treasury: at most ", "Kasayı açar: günde en fazla ")}
              <span className="num">{daily || "0"} {token}</span>
              {tx(" a day, ", ", ödeme başı ")}
              <span className="num">{perTask || "0"} {token}</span>
              {tx(" per payment.", ".")}
            </li>
            <li>
              {fundOn
                ? tx(`Moves ${fundXlm} XLM in from your wallet.`, `Cüzdanından ${fundXlm} XLM aktarır.`)
                : tx("Opens it empty; you add funds next.", "Boş açar; parayı sonraki adımda yatırırsın.")}
            </li>
            {payeeOn && <li>{tx(`Approves ${shortAddr(payee.trim())} as a payee.`, `${shortAddr(payee.trim())} adresini alıcı olarak onaylar.`)}</li>}
            {agentOn && (
              <li>
                {tx(
                  `Lets agent ${shortAddr(agentKey.trim())} spend up to ${cap || "0"} ${token} for ${hours || "0"} h.`,
                  `${shortAddr(agentKey.trim())} ajanına ${hours || "0"} saat boyunca ${cap || "0"} ${token}'ye kadar yetki verir.`,
                )}
              </li>
            )}
            <li>{tx("Backs the treasury up on Stellar, so you can open it from any device.", "Kasayı Stellar'da yedekler; her cihazdan açabilirsin.")}</li>
          </ol>
          <div className="panel__note">
            {tx("Nothing is created half-way: if any part is refused, nothing happens.", "Yarım iş kalmaz: bir parçası reddedilirse hiçbiri olmaz.")}
          </div>
        </section>
      </div>
    </div>
  );
}
