// The Leash: hand the treasury to an autonomous agent on a time-bound, spend-capped
// session key. Active state shows the live cap + countdown and the demo task button;
// inactive state explains the model and starts one. The single-spender rule and the
// "registered but unfunded key" recovery path live in the provider.
import { useEffect, useState } from "react";
import ExceptionRequests from "../components/ExceptionRequests";
import { fmtXlm, shortAddr } from "../config";
import { useNow } from "../lib/useNow";
import { useTreasury } from "../state/useTreasury";

export default function Agent() {
  const t = useTreasury();
  const [cap, setCap] = useState("25");
  const [hours, setHours] = useState("24");
  const [agentKey, setAgentKey] = useState("");
  const [err, setErr] = useState("");

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
      <div style={wrap}>
        <div style={card}>
          <div style={label}>Leash — agent session</div>
          <div style={body}>
            This is an early treasury — Leash sessions arrived later. Create a fresh
            treasury from the switcher to use the agent features; your funds are safe,
            and Settings shows the exit path.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__main">
      {active ? (
        <div style={{ ...card, borderColor: "var(--green)" }}>
          <div style={{ ...label, color: "var(--ink)" }}>⚡ Leash active</div>

          <div style={statGrid}>
            <div>
              <div style={label}>Agent</div>
              <div style={mono}>{shortAddr(session.agent)}</div>
            </div>
            <div>
              <div style={label}>Key</div>
              <div style={{ fontSize: 13, color: "var(--ink)" }}>
                {t.sessionSecret ? "on this device" : "external agent"}
              </div>
            </div>
          </div>

          <div style={{ ...label, marginTop: 16 }}>Session cap</div>
          <div style={barTrack}>
            <div
              style={{
                ...barFill,
                width: `${Math.min(100, (Number(session.spent) / Math.max(1, Number(session.limit))) * 100)}%`,
              }}
            />
          </div>
          <div style={body}>
            {fmtXlm(session.spent)} / {fmtXlm(session.limit)} XLM spent ·{" "}
            {fmtXlm(session.limit - session.spent)} XLM left
          </div>
          <div style={{ ...body, marginTop: 4 }}>expires in {countdown(Number(session.valid_until) * 1000 - now)}</div>

          {t.sessionSecret ? (
            <button
              style={{ ...primaryBtn, opacity: t.busy ? 0.6 : 1 }}
              onClick={() => void t.runAutonomousTask()}
              disabled={!!t.busy}
              type="button"
            >
              {t.busy === "task" ? "Agent paying…" : "Run autonomous task (1 XLM, no popup)"}
            </button>
          ) : (
            <div style={hint}>
              This Leash belongs to an external agent (eunomia-mcp) or another device. It pays
              from its own machine, within the cap above. Revoke it here at any time.
            </div>
          )}
          <button
            style={{ ...ghostBtn, opacity: t.busy ? 0.6 : 1 }}
            onClick={() => void t.revokeLeash()}
            disabled={!!t.busy}
            type="button"
          >
            {t.busy === "revoke" ? "Revoking…" : "Revoke Leash"}
          </button>
        </div>
      ) : (
        <div style={card}>
          <div style={label}>Leash — agent session</div>
          <div style={body}>
            Put your agent on a Leash: a spending cap and a time limit. It pays on its own —
            no popups — and every payment is still checked against your rules. Revoke any time.
          </div>
          <div style={fieldLabel}>Session cap (XLM)</div>
          <input
            style={input}
            inputMode="decimal"
            aria-label="Session spending cap in XLM"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
          <div style={fieldLabel}>Duration (hours)</div>
          <input
            style={input}
            inputMode="decimal"
            aria-label="Session duration in hours"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <div style={fieldLabel}>Agent public key (optional)</div>
          <input
            style={input}
            aria-label="External agent public key"
            placeholder="G… — printed by `eunomia-mcp init`"
            spellCheck={false}
            value={agentKey}
            onChange={(e) => setAgentKey(e.target.value)}
          />
          <div style={hint}>
            Leave empty to run the built-in demo agent on this device. Paste a key to authorise
            an external agent (Claude via eunomia-mcp) — its secret never leaves the agent's
            machine; you only sign the cap and the deadline.
          </div>
          <button
            style={{ ...primaryBtn, opacity: t.busy ? 0.6 : 1 }}
            onClick={() => void doStart()}
            disabled={!!t.busy}
            type="button"
          >
            {t.busy === "session" ? "Starting…" : agentKey.trim() ? "Authorise agent" : "Start Leash"}
          </button>
          {err && <div style={inlineErr}>{err}</div>}
        </div>
      )}
      {/* Requests the agent filed on its own account (eunomia-mcp request_exception). They
          belong under the Leash they came from, on the page where the owner resolves them. */}
      {session && <ExceptionRequests agent={session.agent} />}
      </div>

      {/* A Leash hands an agent the ability to spend without asking. The rules that still
          bound it belong on the same screen as that decision, not one page away. */}
      <div className="page__side">
        <div style={card}>
          <div style={label}>Your rules still apply</div>
          {t.state ? (
            <>
              <div style={body}>
                A Leash lets the agent sign without a popup. It does not lift anything —
                every payment is still checked on Stellar.
              </div>
              <ul style={ruleList}>
                <li>
                  <strong>{fmtXlm(t.state.dailyLimit)} XLM</strong> a day, at most
                </li>
                <li>
                  <strong>{fmtXlm(t.state.perTaskLimit)} XLM</strong> per payment, at most
                </li>
                <li>Approved payees only — anything else is refused</li>
                <li>Revocable instantly, from here</li>
              </ul>
            </>
          ) : (
            <div style={body}>Loading your treasury's rules…</div>
          )}
        </div>
      </div>
    </div>
  );
}

const ruleList: React.CSSProperties = {
  margin: "14px 0 0", padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 9,
  fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)",
};

function countdown(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

const wrap: React.CSSProperties = { maxWidth: 560, margin: "0 auto" };
const card: React.CSSProperties = {
  padding: 20, borderRadius: 14,
  background: "var(--surface)", border: "1px solid var(--line)",
};
const label: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-2)" };
const fieldLabel: React.CSSProperties = { ...label, marginTop: 12 };
const body: React.CSSProperties = { fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 8 };
const hint: React.CSSProperties = { marginTop: 12, fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 13.5, color: "var(--ink)", marginTop: 3 };
const statGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 };
const barTrack: React.CSSProperties = { height: 8, borderRadius: 100, background: "var(--line)", marginTop: 8, overflow: "hidden" };
const barFill: React.CSSProperties = { height: "100%", borderRadius: 100, background: "var(--green)", transition: "width .5s ease" };
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", marginTop: 8, padding: "11px 13px", borderRadius: 10,
  background: "var(--bg)", border: "1px solid var(--line)", color: "var(--ink)",
};
const primaryBtn: React.CSSProperties = {
  width: "100%", marginTop: 14, padding: "12px 16px", borderRadius: 11, border: "none", cursor: "pointer",
  background: "var(--ink)", color: "var(--bg)", fontWeight: 600, fontSize: 14.5, fontFamily: "inherit",
};
const ghostBtn: React.CSSProperties = {
  width: "100%", marginTop: 8, padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontFamily: "inherit",
  background: "transparent", border: "1px solid var(--line)", color: "var(--ink-2)",
};
const inlineErr: React.CSSProperties = { marginTop: 8, fontSize: 12.5, color: "var(--red)" };
