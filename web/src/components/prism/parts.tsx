// The pieces both layouts of the landing page share — the moving one (PrismStage) and the
// still one (PrismStatic): the door into the app, the command an owner runs, the proof rows.
import { useState } from "react";
import { EXPLORER, LISTED_CONTRACTS } from "../../config";
import { getLang, setLang, useLang } from "../../lib/i18n";
import { useWalletAddress } from "../../lib/useWalletAddress";
import { CLIENTS, MCP_VERSION, initCommand, type ClientId, type LandingContent } from "./content";

/** The one door into the app. Which wallet, a passkey or a new treasury is decided inside —
 *  the landing page used to ask all of that up front, with four buttons. */
export function OpenButton({ c, onEnter, className = "pz-btn pz-btn--gold" }: { c: LandingContent; onEnter: () => void; className?: string }) {
  const address = useWalletAddress();
  return (
    <button className={className} onClick={onEnter} type="button">
      {address ? c.nav.openConnected : c.nav.open}
      <span aria-hidden="true">→</span>
    </button>
  );
}

export function LangToggle() {
  const lang = useLang();
  return (
    <span className="pz-lang" role="group" aria-label="Language">
      {(["tr", "en"] as const).map((l) => (
        <button key={l} className={lang === l ? "is-on" : ""} aria-pressed={lang === l} onClick={() => setLang(l)} type="button">
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

/** The command that connects an agent, per AI client. The treasury's address is a gap here on
 *  purpose: it exists only once a treasury is open, and the Agent page fills it in. */
export function CommandBox({ c }: { c: LandingContent }) {
  const [client, setClient] = useState<ClientId>("claude-code");
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(initCommand(client, getLang() === "tr" ? "<KASA_ADRESI>" : "<TREASURY_ID>"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="pz-cmd">
      <div className="pz-cmd__tabs" role="tablist">
        {CLIENTS.map((k) => (
          <button key={k.id} role="tab" aria-selected={client === k.id} className={client === k.id ? "is-on" : ""} onClick={() => setClient(k.id)} type="button">
            {k.label}
          </button>
        ))}
      </div>
      <div className="pz-cmd__line">
        <code>
          <i>$</i> npx -y eunomia-mcp@{MCP_VERSION} init --treasury <b>{c.hero.treasuryGap}</b> --client {client}
        </code>
        <button className="pz-cmd__copy" onClick={copy} type="button">
          {copied ? c.hero.copied : c.hero.copy}
        </button>
      </div>
      <div className="pz-cmd__note">{c.hero.commandNote}</div>
    </div>
  );
}

/** The refused payment, drawn the way the mark is: solid up to what was paid, an upright line
 *  where the cap stood, and only an outline for what was asked — it ran past the line, so none
 *  of it went out. To scale: 720 units to the USDC. */
export function RefusalMeter({ c }: { c: LandingContent }) {
  const m = c.proof.meter;
  const x = (usdc: number) => usdc * 720;
  return (
    <svg className="pz-meter" viewBox="0 0 400 168" role="img" aria-label={`${m.paid} · ${m.cap} · ${m.asked} · ${m.verdict}`}>
      <rect x={0} y={62} width={x(0.3)} height={40} fill="currentColor" />
      <rect x={x(0.3) + 0.75} y={62.75} width={x(0.2) - 1.5} height={38.5} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="5 4" />
      <line x1={x(0.35)} y1={34} x2={x(0.35)} y2={128} stroke="currentColor" strokeWidth={1.5} />
      <text x={0} y={52}>{m.paid}</text>
      <text x={x(0.35)} y={24} textAnchor="middle">{m.cap}</text>
      <text x={x(0.5)} y={52} textAnchor="end">{m.asked}</text>
      <text x={0} y={150}>{m.sum}</text>
      <text x={0} y={166} className="pz-meter__v">{m.verdict}</text>
    </svg>
  );
}

export function FooterLinks({ c }: { c: LandingContent }) {
  return (
    <div className="pz-foot">
      <div className="pz-foot__cols">
        <div>
          <span className="pz-foot__h">{c.call.product}</span>
          <a href="/docs/">{c.nav.docs}</a>
          <a href="/docs/contracts">{c.proof.contract}</a>
        </div>
        <div>
          <span className="pz-foot__h">{c.call.resources}</span>
          <a href={c.links.repo} target="_blank" rel="noreferrer">GitHub ↗</a>
          <a href={c.links.security} target="_blank" rel="noreferrer">Security ↗</a>
          <a href={c.links.changelog} target="_blank" rel="noreferrer">Changelog ↗</a>
        </div>
        <div>
          <span className="pz-foot__h">{c.call.onChain}</span>
          {LISTED_CONTRACTS.map((k) => (
            <a key={k.id} href={`${EXPLORER}/contract/${k.id}`} target="_blank" rel="noreferrer" title={k.id}>
              {k.label} ↗
            </a>
          ))}
        </div>
      </div>
      <div className="pz-foot__line">
        <span>{c.call.line}</span>
        <span>{c.call.by}</span>
      </div>
    </div>
  );
}
