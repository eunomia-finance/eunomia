// The agent spending by itself, where the owner can watch it happen. Everything else on
// this page describes the arrangement; this performs it — three real transactions in a row,
// none of them signed by the owner. Steps report as each lands, so a refusal reads as the
// contract's answer rather than as the app having failed.
import { useState } from "react";
import { EXPLORER } from "../config";
import { initialLoop, type LoopStep, type LoopStepStatus } from "../lib/agentLoop";
import { useTreasury } from "../state/useTreasury";

const MARK: Partial<Record<LoopStepStatus, { cls: string; text: string }>> = {
  done: { cls: "pill pill--ok", text: "done" },
  refused: { cls: "pill pill--no", text: "refused" },
  failed: { cls: "pill pill--no", text: "stopped" },
};

export default function AgentLoop() {
  const t = useTreasury();
  const [steps, setSteps] = useState<LoopStep[]>(initialLoop);
  const [ran, setRan] = useState(false);
  const [err, setErr] = useState("");

  const running = t.busy === "loop";

  const run = async () => {
    setErr("");
    setRan(true);
    const res = await t.runAgentLoop(setSteps);
    if (!res.ok) setErr(res.msg);
  };

  return (
    <section className="panel panel--pad">
      <div className="panel__head">
        <div className="eyebrow">The agent, on its own</div>
        {ran && !running && !err && <span className="pill pill--ok">ran</span>}
      </div>
      <div className="panel__title">Watch it spend without you.</div>
      <div className="panel__note">
        Three payments in a row, signed by the Leash key on this device — you won't be asked to approve
        anything. The second one is meant to fail: that is your rules working.
      </div>

      <div className="steps" style={{ marginTop: 4 }}>
        {steps.map((s, i) => {
          const mark = MARK[s.status];
          return (
            <div className="step" key={s.key}>
              <span className="step__n">{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div className="rowline" style={{ gap: 10 }}>
                  <span style={{ fontSize: 13.5 }}>{s.title}</span>
                  {s.status === "running" ? (
                    <span className="pill pill--rule">working…</span>
                  ) : mark ? (
                    <span className={mark.cls}>{mark.text}</span>
                  ) : null}
                </div>
                {s.detail && (
                  <div className="ledger__when" style={{ marginTop: 4 }}>
                    {s.detail}
                  </div>
                )}
                {s.hash && (
                  <a className="linkbtn" href={`${EXPLORER}/tx/${s.hash}`} target="_blank" rel="noreferrer">
                    tx ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn--lg" onClick={() => void run()} disabled={!!t.busy} type="button">
          {running ? "The agent is working…" : ran ? "Run it again" : "Run the agent"}
        </button>
        {/* The single payment the page used to offer — kept for a quick check, out of the
            way of the loop that actually shows the product. */}
        <button className="linkbtn" onClick={() => void t.runAutonomousTask()} disabled={!!t.busy} type="button">
          {t.busy === "task" ? "paying…" : "just one payment"}
        </button>
      </div>
      {err && <div className="err">{err}</div>}
    </section>
  );
}
