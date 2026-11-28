// The Leash: hand the treasury to an autonomous agent on a time-bound, spend-capped session
// key the agent holds itself. An active Leash is the one ivory panel on this page — live cap,
// countdown, revoke. Inactive, the page connects one: a command for the agent's machine, the
// key it prints, and one button that does everything the key needs. The single-spender rule
// lives in the provider.
import { useEffect, useRef, useState } from "react";
import BudgetRequestCard from "../components/BudgetRequestCard";
import ExceptionRequests from "../components/ExceptionRequests";
import { EXPLORER, fmtXlm, shortAddr } from "../config";
import { CATALOG_PAYEES, stepLabel, type SetupStep } from "../lib/agentSetup";
import { tx, useLang } from "../lib/i18n";
import { useNow } from "../lib/useNow";
import { useTreasury } from "../state/useTreasury";

/** The AI clients `eunomia-mcp init --client` can set up by itself. */
const CLIENTS = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "cursor", label: "Cursor" },
] as const;
type ClientId = (typeof CLIENTS)[number]["id"];

const STEP_MARK: Record<SetupStep["status"], string> = { todo: "○", signing: "…", done: "✓", failed: "✕", manual: "!" };

export default function Agent() {
  useLang();
  const t = useTreasury();
  const [cap, setCap] = useState("25");
  // A month, not a day: an agent that worked today should still work tomorrow without the
  // owner signing again. The cap and the treasury's own limits are what bound it.
  const [hours, setHours] = useState("720");
  const [agentKey, setAgentKey] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [client, setClient] = useState<ClientId>("claude-code");
  const [catalog, setCatalog] = useState(true);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  // A budget request link (eunomia-mcp request_budget) lands here with its fields in the query.
  const [hasRequest, setHasRequest] = useState(() => new URLSearchParams(window.location.search).has("sig"));

  const initCommand = `npx -y eunomia-mcp@0.3.5 init --treasury ${t.treasuryId ?? "<treasury id>"} --client ${client}`;
  const copyInit = () => {
    void navigator.clipboard?.writeText(initCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const session = t.lifecycle?.session ?? null;
  const active = t.sessionActive && session;
  const now = useNow(!!active);

  // Auto-refresh once the session lapses so the UI flips itself. Once per expiry: the clock
  // keeps ticking while the read is in flight, and every tick used to start another one.
  const refreshedFor = useRef<bigint | null>(null);
  const { refresh } = t;
  useEffect(() => {
    if (!active || !session) return;
    if (refreshedFor.current === session.valid_until) return;
    if (Number(session.valid_until) * 1000 < now) {
      refreshedFor.current = session.valid_until;
      void refresh({ markLoading: false });
    }
  }, [active, session, now, refresh]);

  const doConnect = async () => {
    setErr("");
    const res = await t.connectAgent(cap, hours, agentKey, { catalog }, setSteps);
    if (!res.ok) setErr(res.msg);
  };

  if (t.legacy) {
    return (
      <div className="page">
        <div className="page__main">
          <section className="panel panel--pad">
            <div className="eyebrow">Leash</div>
            <div className="panel__note">
              {tx(
                "This is an early treasury — Leash sessions arrived later. Create a fresh treasury from the switcher to use the agent features; your funds are safe, and Settings shows the exit path.",
                "Bu eski bir kasa — ajan yetkisi sonradan geldi. Ajan özellikleri için üstteki menüden yeni bir kasa aç; paran güvende, çıkış yolu Ayarlar'da.",
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  const left = session ? (session.limit > session.spent ? session.limit - session.spent : 0n) : 0n;
  const taskPayees = t.lifecycle?.v4?.sessionPayees ?? [];
  const pct = session && session.limit > 0n ? Math.min(100, Number((session.spent * 10000n) / session.limit) / 100) : 0;

  const command = (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label={tx("Your AI client", "Kullandığın program")}>
        {CLIENTS.map((c) => (
          <button key={c.id} className={`chip${client === c.id ? " is-on" : ""}`} onClick={() => setClient(c.id)} aria-pressed={client === c.id} type="button">
            {c.label}
          </button>
        ))}
      </div>
      {/* The whole command, with this treasury's id and the client in it: `init` refuses to
          run without an id, and it sets the client up by itself only when told which one. */}
      <span className="code" style={{ marginTop: 6 }}>{initCommand}</span>
      <div>
        <button className="linkbtn" onClick={copyInit} type="button" aria-live="polite">
          {copied ? tx("copied", "kopyalandı") : tx("copy command", "komutu kopyala")}
        </button>
      </div>
    </>
  );

  return (
    <div className="page">
      <div className="page__main">
        {/* A builder connected an agent to a treasury that held nothing and only found out when
            the agent said so. The page that connects the agent is where to say it first. */}
        {t.state && t.state.balance === 0n && (
          <div className="notice">
            <span>
              {tx(
                "Your treasury is empty. Add funds on Overview first — the agent pays from that balance.",
                "Kasan boş. Önce Genel bakış sayfasından para yatır — ajan o bakiyeden öder.",
              )}
            </span>
          </div>
        )}
        {hasRequest && <BudgetRequestCard onDone={() => setHasRequest(false)} />}
        {active && session ? (
          <section className="verdict">
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <div className="eyebrow">
                {tx("Agent connected · may spend for", "Ajan bağlı · yetkisi")} {countdown(Number(session.valid_until) * 1000 - now)}
                {tx("", " daha açık")}
              </div>
              <div className="verdict__line">
                <span className="verdict__amount">{fmtXlm(left)} {t.tokenCode}</span>
                <span className="verdict__arrow">{tx(`left of ${fmtXlm(session.limit)}`, `kaldı · toplam ${fmtXlm(session.limit)}`)}</span>
              </div>
              <div className="bar bar--thin"><div className="bar__fill" style={{ width: `${pct}%` }} /></div>
              <div className="verdict__why">
                <span className="num">{shortAddr(session.agent)}</span>
                {" · "}
                {tx(
                  "your agent pays without asking; every payment is still checked against your rules on Stellar.",
                  "ajanın sana sormadan öder; her ödeme yine de Stellar'daki kurallarından geçer.",
                )}
              </div>
              {taskPayees.length > 0 && (
                <div className="verdict__why">
                  {tx("Task budget · may pay only", "Görev bütçesi · yalnız şunlara ödeyebilir:")} {taskPayees.map((p) => shortAddr(p)).join(", ")}
                </div>
              )}
            </div>
            <div className="verdict__side">
              <a className="verdict__tx" href={`${EXPLORER}/account/${session.agent}`} target="_blank" rel="noreferrer">
                {tx("agent account", "ajanın hesabı")} ↗
              </a>
              <button className="btn btn--inv" onClick={() => void t.revokeLeash()} disabled={!!t.busy} type="button">
                {t.busy === "revoke" ? tx("Revoking…", "İptal ediliyor…") : tx("Revoke the agent", "Ajanın yetkisini iptal et")}
              </button>
            </div>
          </section>
        ) : (
          <section className="panel panel--pad">
            <div className="eyebrow">{tx("Agent", "Ajan")}</div>
            <div className="panel__title">{tx("Connect your agent.", "Ajanını bağla.")}</div>
            <div className="panel__note">
              {tx(
                "Three things: run one command, paste what it prints, press one button. After that the agent pays on its own — no popups — and every payment is still checked against your rules. Revoke any time.",
                "Üç iş: bir komut çalıştır, yazdığını yapıştır, bir düğmeye bas. Sonrasında ajan kendisi öder — onay penceresi yok — ve her ödeme yine kurallarından geçer. İstediğin an iptal edersin.",
              )}
            </div>

            <div className="steps" style={{ marginTop: 6 }}>
              <div className="step">
                <span className="step__n">1</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, marginBottom: 6 }}>
                    {tx(
                      "Pick your AI client. Then open a terminal on that computer (on Windows: Start → PowerShell), paste this and press Enter. Not in the Claude chat — in the terminal.",
                      "Kullandığın programı seç. Sonra o bilgisayarda terminali aç (Windows'ta: Başlat → PowerShell), bunu yapıştır ve Enter'a bas. Claude'un sohbetine değil — terminale.",
                    )}
                  </div>
                  {command}
                  <div className="panel__note" style={{ marginTop: 6 }}>
                    {tx(
                      "It needs Node.js (nodejs.org). If you chose Claude Desktop, quit it completely first — it overwrites its settings when it closes.",
                      "Node.js gerekir (nodejs.org). Claude Desktop'ı seçtiysen önce onu tamamen kapat — kapanırken ayarlarının üstüne yazıyor.",
                    )}
                  </div>
                </div>
              </div>
              <div className="step">
                <span className="step__n">2</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <label className="lab">
                    <span style={{ fontSize: 13.5 }}>
                      {tx("Paste the agent public key the command printed.", "Komutun yazdığı “Agent public key” adresini yapıştır.")}
                    </span>
                    <input
                      className="field field--mono"
                      aria-label={tx("Agent public key", "Ajan adresi")}
                      placeholder={tx("G… — the line that starts with “Agent public key”", "G… — “Agent public key” ile başlayan satır")}
                      spellCheck={false}
                      value={agentKey}
                      onChange={(e) => setAgentKey(e.target.value)}
                    />
                  </label>
                </div>
              </div>
              <div className="step">
                <span className="step__n">3</span>
                <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 13.5 }}>
                    {tx("Set how much it may spend and for how long, then connect it.", "Ne kadar ve ne süreyle harcayabileceğini belirle, sonra bağla.")}
                  </div>
                  <div className="two">
                    <label className="lab">
                      <span className="eyebrow">{tx(`At most (${t.tokenCode})`, `En fazla (${t.tokenCode})`)}</span>
                      <input className="field field--mono" inputMode="decimal" aria-label={tx(`Session spending cap in ${t.tokenCode}`, `Harcama tavanı (${t.tokenCode})`)} value={cap} onChange={(e) => setCap(e.target.value)} />
                    </label>
                    <label className="lab">
                      <span className="eyebrow">{tx("Hours (720 = 30 days)", "Saat (720 = 30 gün)")}</span>
                      <input className="field field--mono" inputMode="decimal" aria-label={tx("Session duration in hours", "Yetki süresi (saat)")} value={hours} onChange={(e) => setHours(e.target.value)} />
                    </label>
                  </div>
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, cursor: "pointer" }}>
                    <input type="checkbox" checked={catalog} onChange={(e) => setCatalog(e.target.checked)} style={{ marginTop: 3 }} />
                    <span>
                      {tx(
                        "Let it buy from the service catalog (web reading, search, images, Stellar data).",
                        "Servis kataloğundan alışveriş yapabilsin (sayfa okuma, arama, görsel, Stellar verisi).",
                      )}
                      <span className="panel__note" style={{ display: "block" }}>
                        {tx(
                          `Approves the catalog's ${CATALOG_PAYEES.length} settlement addresses as payees: ${CATALOG_PAYEES.map((c) => shortAddr(c.address)).join(", ")}. Remove them on Payments any time.`,
                          `Kataloğun ${CATALOG_PAYEES.length} ödeme adresini alıcı olarak onaylar: ${CATALOG_PAYEES.map((c) => shortAddr(c.address)).join(", ")}. Ödemeler sayfasından istediğin an çıkarırsın.`,
                        )}
                      </span>
                    </span>
                  </label>
                  <div>
                    <button className="btn btn--gold" onClick={() => void doConnect()} disabled={!!t.busy} type="button">
                      {t.busy === "session" ? tx("Connecting…", "Bağlanıyor…") : tx("Connect agent", "Ajanı bağla")}
                    </button>
                  </div>
                  <div className="panel__note">
                    {tx(
                      "Your wallet asks you to sign a few times in a row — once for each line that appears below. The agent's secret never leaves its machine.",
                      "Cüzdanın art arda birkaç imza ister — aşağıda çıkan her satır için bir tane. Ajanın gizli anahtarı kendi bilgisayarından çıkmaz.",
                    )}
                  </div>
                  {steps.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} aria-live="polite">
                      {steps.map((s) => (
                        <div
                          key={s.id}
                          style={{
                            display: "flex",
                            gap: 8,
                            fontSize: 13.5,
                            color: s.status === "failed" ? "var(--red)" : s.status === "todo" ? "var(--ink-2)" : "var(--ink)",
                          }}
                        >
                          <span className="num" style={{ width: 14, flex: "none", textAlign: "center" }}>{STEP_MARK[s.status]}</span>
                          <span>
                            {stepLabel(s)}
                            {s.status === "signing" ? tx(" — waiting for your signature", " — imzan bekleniyor") : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {err && <div className="err">{err}</div>}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Requests the agent filed on its own account (eunomia-mcp request_exception). They
            belong under the Leash they came from, on the page where the owner resolves them. */}
        {session && <ExceptionRequests agent={session.agent} />}
      </div>

      {/* A Leash hands an agent the ability to spend without asking. The rules that still
          bound it belong on the same screen as that decision, not one page away. */}
      <div className="page__side">
        <section className="panel panel--pad">
          <div className="eyebrow">{tx("Your rules still apply", "Kuralların geçerli kalır")}</div>
          {t.state ? (
            <>
              <div className="panel__kv"><span>{tx("Per day, at most", "Günde en fazla")}</span><span className="num">{fmtXlm(t.state.dailyLimit)} {t.tokenCode}</span></div>
              <div className="panel__kv"><span>{tx("Per payment, at most", "Tek ödemede en fazla")}</span><span className="num">{fmtXlm(t.state.perTaskLimit)} {t.tokenCode}</span></div>
              {t.lifecycle?.v4 && t.lifecycle.v4.monthlyLimit > 0n && (
                <div className="panel__kv"><span>{tx("Per month, at most", "Ayda en fazla")}</span><span className="num">{fmtXlm(t.lifecycle.v4.monthlyLimit)} {t.tokenCode}</span></div>
              )}
              <div className="panel__kv"><span>{tx("Payees", "Alıcılar")}</span><span>{tx("approved list only", "yalnız onayladıkların")}</span></div>
              <div className="panel__kv"><span>{tx("Revoke", "İptal")}</span><span>{tx("instant, from here", "anında, buradan")}</span></div>
              <div className="panel__note">
                {tx(
                  "Connecting an agent lets it sign without a popup. It lifts nothing — every payment is checked on Stellar.",
                  "Ajanı bağlamak ona onay penceresi olmadan imza attırır. Hiçbir kuralı kaldırmaz — her ödeme Stellar'da denetlenir.",
                )}
              </div>
            </>
          ) : (
            <div className="shell__skel" style={{ height: 80 }} />
          )}
        </section>

        {active ? (
          <section className="panel panel--pad">
            <div className="eyebrow">{tx("Same agent, another client or a new release", "Aynı ajan, başka program ya da yeni sürüm")}</div>
            <div className="panel__note" style={{ marginBottom: 6 }}>
              {tx(
                "Run the command again in a terminal on the agent's machine. It keeps the agent's key, so nothing here has to be signed again.",
                "Komutu ajanın bilgisayarındaki terminalde yeniden çalıştır. Ajanın anahtarını korur; burada yeniden imza gerekmez.",
              )}
            </div>
            {command}
          </section>
        ) : (
          <section className="panel panel--pad">
            <div className="eyebrow">{tx("Then", "Sonra")}</div>
            <div className="panel__note">
              {tx(
                "Restart your AI client and ask it for something — “read this page and summarise it”, “make an image of…”. It finds a service in the catalog, pays for it from the treasury inside your rules, and tells you what it paid. A refusal comes back with the reason.",
                "Programı kapatıp aç ve ajandan bir şey iste — “şu sayfayı oku ve özetle”, “şunun görselini üret”. Katalogdan bir servis bulur, kurallarının içinde kasadan öder ve ne ödediğini söyler. Reddedilirse sebebiyle döner.",
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function countdown(ms: number): string {
  if (ms <= 0) return tx("expired", "süresi doldu");
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return tx(`${d} d ${h} h`, `${d} gün ${h} sa`);
  if (h > 0) return tx(`${h} h ${m} m`, `${h} sa ${m} dk`);
  return tx(`${m} m ${s % 60} s`, `${m} dk ${s % 60} sn`);
}
