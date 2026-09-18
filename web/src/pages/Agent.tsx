// The Leash: hand the treasury to an autonomous agent on a time-bound, spend-capped session
// key. An active Leash is the one dark panel on this page — live cap, countdown, the demo
// task, revoke. Inactive, the page explains the model and starts one. The single-spender
// rule and the "registered but unfunded key" recovery path live in the provider.
import { useEffect, useState } from "react";
import ExceptionRequests from "../components/ExceptionRequests";
import { EXPLORER, fmtXlm, shortAddr } from "../config";
import { useNow } from "../lib/useNow";
import { useTreasury } from "../state/useTreasury";

export default function Agent() {
  const t = useTreasury();
  const [cap, setCap] = useState("25");
  const [hours, setHours] = useState("24");
  const [agentKey, setAgentKey] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const initCommand = `npx -y eunomia-mcp init --treasury ${t.treasuryId ?? "<treasury id>"}`;
  const copyInit = () => {
    void navigator.clipboard?.writeText(initCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const session = t.lifecycle?.session ?? null;
  const active = t.sessionActive && session;
  const now = useNow(!!active);

  // Auto-refresh once the session lapses so the UI flips itself.
  useEffect(() => {
    if (!active || !session) return;
    if (Number(session.valid_until) * 1000 < Date.now()) void t.refresh({ markLoading: false });
  }, [active, session, now, t]);

  const doStart = async () => {
    setErr("");
    const res = await t.startLeash(cap, hours, agentKey);
    if (!res.ok && res.validation) setErr(res.msg);
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
  const pct = session && session.limit > 0n ? Math.min(100, Number((session.spent * 10000n) / session.limit) / 100) : 0;

  return (
    <div className="page">
      <div className="page__main">
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
                {t.sessionSecret ? "key on this device" : "external agent (eunomia-mcp)"} · pays without asking; every payment
                is still checked against your rules on Stellar.
              </div>
            </div>
            <div className="verdict__side">
              {t.sessionSecret ? (
                <button className="btn btn--inv" onClick={() => void t.runAutonomousTask()} disabled={!!t.busy} type="button">
                  {t.busy === "task" ? "Agent paying…" : `Run autonomous task (1 ${t.tokenCode}, no popup)`}
                </button>
              ) : (
                <a className="verdict__tx" href={`${EXPLORER}/account/${session.agent}`} target="_blank" rel="noreferrer">
                  agent account ↗
                </a>
              )}
              <button className="btn btn--inv" onClick={() => void t.revokeLeash()} disabled={!!t.busy} type="button">
                {t.busy === "revoke" ? "Revoking…" : "Revoke Leash"}
              </button>
            </div>
          </section>
        ) : (
          <section className="panel panel--pad">
            <div className="eyebrow">Leash</div>
            <div className="panel__title">Put your agent on a Leash.</div>
            <div className="panel__note">
              A spending cap and a time limit, signed once. The agent pays on its own — no popups — and every
              payment is still checked against your rules. Revoke any time.
            </div>
            <div className="two" style={{ marginTop: 6 }}>
              <label className="lab">
                <span className="eyebrow">Cap ({t.tokenCode})</span>
                <input className="field field--mono" inputMode="decimal" aria-label={`Session spending cap in ${t.tokenCode}`} value={cap} onChange={(e) => setCap(e.target.value)} />
              </label>
              <label className="lab">
                <span className="eyebrow">Hours</span>
                <input className="field field--mono" inputMode="decimal" aria-label="Session duration in hours" value={hours} onChange={(e) => setHours(e.target.value)} />
              </label>
            </div>
            <label className="lab">
              <span className="eyebrow">Agent public key (optional)</span>
              <input
                className="field field--mono"
                aria-label="External agent public key"
                placeholder="G… — printed by `eunomia-mcp init`"
                spellCheck={false}
                value={agentKey}
                onChange={(e) => setAgentKey(e.target.value)}
              />
            </label>
            <div className="panel__note">
              Leave empty to run the built-in demo agent on this device. Paste a key to authorise an external agent
              (Claude via eunomia-mcp) — its secret never leaves the agent's machine; you only sign the cap and the deadline.
            </div>
            <div>
              <button className="btn btn--lg" onClick={() => void doStart()} disabled={!!t.busy} type="button">
                {t.busy === "session" ? "Starting…" : agentKey.trim() ? "Authorise agent" : "Start Leash"}
              </button>
            </div>
            {err && <div className="err">{err}</div>}
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
              <div className="panel__kv"><span>Payees</span><span>approved list only</span></div>
              <div className="panel__kv"><span>Revoke</span><span>instant, from here</span></div>
              <div className="panel__note">A Leash lets the agent sign without a popup. It lifts nothing — every payment is checked on Stellar.</div>
            </>
          ) : (
            <div className="shell__skel" style={{ height: 80 }} />
          )}
        </section>

        <section className="panel panel--pad">
          <div className="eyebrow">Connect an external agent</div>
          <div className="steps">
            <div className="step">
              <span className="step__n">1</span>
              <div>
                <div style={{ fontSize: 13.5 }}>On the agent's machine, make its key. It prints the key and the MCP client config.</div>
                {/* The whole command, with this treasury's id in it: `init` refuses to run without
                    one, and an id typed by hand from another screen is how a first try fails. */}
                <span className="code" style={{ marginTop: 6 }}>{initCommand}</span>
                <div>
                  <button className="linkbtn" onClick={copyInit} type="button" aria-live="polite">
                    {copied ? "copied" : "copy command"}
                  </button>
                </div>
              </div>
            </div>
            <div className="step">
              <span className="step__n">2</span>
              <div style={{ fontSize: 13.5 }}>Paste the key here, set a cap and a deadline, sign once.</div>
            </div>
            <div className="step">
              <span className="step__n">3</span>
              <div style={{ fontSize: 13.5 }}>The agent pays from its own machine — inside these rules. Refusals come back with the reason.</div>
            </div>
          </div>
        </section>
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
