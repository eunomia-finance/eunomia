// The Leash: hand the treasury to an autonomous agent on a time-bound, spend-capped session
// key the agent holds itself. An active Leash is the one dark panel on this page — live cap,
// countdown, revoke. Inactive, the page connects one: a command for the agent's machine, the
// key it prints, and one button that does everything the key needs. The single-spender rule
// lives in the provider.
import { useEffect, useRef, useState } from "react";
import BudgetRequestCard from "../components/BudgetRequestCard";
import ExceptionRequests from "../components/ExceptionRequests";
import { EXPLORER, fmtXlm, shortAddr } from "../config";
import { CATALOG_PAYEES, type SetupStep } from "../lib/agentSetup";
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
              This is an early treasury — Leash sessions arrived later. Create a fresh treasury from the
              switcher to use the agent features; your funds are safe, and Settings shows the exit path.
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Your AI client">
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
          {copied ? "copied" : "copy command"}
        </button>
      </div>
    </>
  );

  return (
    <div className="page">
      <div className="page__main">
        {hasRequest && <BudgetRequestCard onDone={() => setHasRequest(false)} />}
        {active && session ? (
          <section className="verdict">
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <div className="eyebrow">Leash · active · expires in {countdown(Number(session.valid_until) * 1000 - now)}</div>
              <div className="verdict__line">
                <span className="verdict__amount">{fmtXlm(left)} {t.tokenCode}</span>
                <span className="verdict__arrow">left of {fmtXlm(session.limit)}</span>
              </div>
              <div className="bar bar--thin"><div className="bar__fill" style={{ width: `${pct}%` }} /></div>
              <div className="verdict__why">
                <span className="num">{shortAddr(session.agent)}</span>
                {" · "}
                your agent (eunomia-mcp) · pays without asking; every payment
                is still checked against your rules on Stellar.
              </div>
              {taskPayees.length > 0 && (
                <div className="verdict__why">
                  Task budget · may pay only {taskPayees.map((p) => shortAddr(p)).join(", ")}
                </div>
              )}
            </div>
            <div className="verdict__side">
              <a className="verdict__tx" href={`${EXPLORER}/account/${session.agent}`} target="_blank" rel="noreferrer">
                agent account ↗
              </a>
              <button className="btn btn--inv" onClick={() => void t.revokeLeash()} disabled={!!t.busy} type="button">
                {t.busy === "revoke" ? "Revoking…" : "Revoke Leash"}
              </button>
            </div>
          </section>
        ) : (
          <section className="panel panel--pad">
            <div className="eyebrow">Leash</div>
            <div className="panel__title">Connect your agent.</div>
            <div className="panel__note">
              Three things: run one command, paste what it prints, press one button. After that the agent pays on
              its own — no popups — and every payment is still checked against your rules. Revoke any time.
            </div>

            <div className="steps" style={{ marginTop: 6 }}>
              <div className="step">
                <span className="step__n">1</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, marginBottom: 6 }}>Pick your AI client and run this in a terminal on the machine it runs on.</div>
                  {command}
                </div>
              </div>
              <div className="step">
                <span className="step__n">2</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <label className="lab">
                    <span style={{ fontSize: 13.5 }}>Paste the agent public key the command printed.</span>
                    <input
                      className="field field--mono"
                      aria-label="Agent public key"
                      placeholder="G… — the line that starts with “Agent public key”"
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
                  <div style={{ fontSize: 13.5 }}>Set how much it may spend and for how long, then connect it.</div>
                  <div className="two">
                    <label className="lab">
                      <span className="eyebrow">Cap ({t.tokenCode})</span>
                      <input className="field field--mono" inputMode="decimal" aria-label={`Session spending cap in ${t.tokenCode}`} value={cap} onChange={(e) => setCap(e.target.value)} />
                    </label>
                    <label className="lab">
                      <span className="eyebrow">Hours</span>
                      <input className="field field--mono" inputMode="decimal" aria-label="Session duration in hours" value={hours} onChange={(e) => setHours(e.target.value)} />
                    </label>
                  </div>
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, cursor: "pointer" }}>
                    <input type="checkbox" checked={catalog} onChange={(e) => setCatalog(e.target.checked)} style={{ marginTop: 3 }} />
                    <span>
                      Let it buy from the service catalog (web reading, search, images, Stellar data).
                      <span className="panel__note" style={{ display: "block" }}>
                        Approves the catalog's {CATALOG_PAYEES.length} settlement addresses as payees:{" "}
                        {CATALOG_PAYEES.map((c) => shortAddr(c.address)).join(", ")}. Remove them on Payments any time.
                      </span>
                    </span>
                  </label>
                  <div>
                    <button className="btn btn--lg" onClick={() => void doConnect()} disabled={!!t.busy} type="button">
                      {t.busy === "session" ? "Connecting…" : "Connect agent"}
                    </button>
                  </div>
                  <div className="panel__note">
                    Your wallet asks you to sign a few times in a row — once for each line that appears below. The
                    agent's secret never leaves its machine.
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
                          <span>{s.label}{s.status === "signing" ? " — waiting for your signature" : ""}</span>
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
          <div className="eyebrow">Your rules still apply</div>
          {t.state ? (
            <>
              <div className="panel__kv"><span>Per day, at most</span><span className="num">{fmtXlm(t.state.dailyLimit)} {t.tokenCode}</span></div>
              <div className="panel__kv"><span>Per payment, at most</span><span className="num">{fmtXlm(t.state.perTaskLimit)} {t.tokenCode}</span></div>
              {t.lifecycle?.v4 && t.lifecycle.v4.monthlyLimit > 0n && (
                <div className="panel__kv"><span>Per month, at most</span><span className="num">{fmtXlm(t.lifecycle.v4.monthlyLimit)} {t.tokenCode}</span></div>
              )}
              <div className="panel__kv"><span>Payees</span><span>approved list only</span></div>
              <div className="panel__kv"><span>Revoke</span><span>instant, from here</span></div>
              <div className="panel__note">A Leash lets the agent sign without a popup. It lifts nothing — every payment is checked on Stellar.</div>
            </>
          ) : (
            <div className="shell__skel" style={{ height: 80 }} />
          )}
        </section>

        {active ? (
          <section className="panel panel--pad">
            <div className="eyebrow">Same agent, another client or a new release</div>
            <div className="panel__note" style={{ marginBottom: 6 }}>
              Run the command again on the agent's machine. It keeps the agent's key, so nothing here has to be
              signed again.
            </div>
            {command}
          </section>
        ) : (
          <section className="panel panel--pad">
            <div className="eyebrow">Then</div>
            <div className="panel__note">
              Restart your AI client and ask it for something — “read this page and summarise it”, “make an image
              of…”. It finds a service in the catalog, pays for it from the treasury inside your rules, and tells
              you what it paid. A refusal comes back with the reason.
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function countdown(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
