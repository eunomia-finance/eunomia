// The landing page without the scene: the same six acts, the same words and facts, as an
// ordinary page that scrolls. For phones, for reduced motion, for a browser with no WebGL 2.
import { useMemo } from "react";
import { useLang } from "../../lib/i18n";
import EunomiaMark from "../EunomiaMark";
import { landingContent } from "./content";
import { CommandBox, FooterLinks, LangToggle, OpenButton, RefusalMeter } from "./parts";
import "./prism.css";

const pad2 = (n: number) => String(n).padStart(2, "0");

export default function PrismStatic({ onEnter }: { onEnter: () => void }) {
  const lang = useLang();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the content is rebuilt when the language changes
  const c = useMemo(() => landingContent(), [lang]);

  return (
    <div className="pzs">
      <header className="pzs__top">
        <span className="pz__brand">
          <EunomiaMark size={26} variant="short" className="pzs__mark-short" />
          <EunomiaMark size={26} className="pzs__mark-full" />
          Eunomia
        </span>
        <div className="pz__top-end">
          <LangToggle />
          <OpenButton c={c} onEnter={onEnter} className="pz-btn pz-btn--gold pz-btn--sm" />
        </div>
      </header>

      <section className="pzs__act pzs__hero">
        <div className="pz__badges">
          <span className="pz-badge pz-badge--live">
            <i />
            {c.hero.live}
          </span>
          <span className="pz-badge">{c.hero.cap}</span>
        </div>
        <h1>
          {c.hero.sentence.map((line) => (
            <span key={line}>{line} </span>
          ))}
        </h1>
        <p className="pz__lede">{c.hero.lede}</p>
        <div className="pz__actions">
          <OpenButton c={c} onEnter={onEnter} />
          <a className="pz-btn pz-btn--line" href="/docs/">
            {c.hero.docs}
          </a>
        </div>
        <div className="pzs__mark" aria-hidden="true">
          <EunomiaMark size={150} />
        </div>
        <CommandBox c={c} />
        <div className="pz__with pz-mono">
          <span>{c.hero.worksWith}</span>
          <b>Claude Code</b>
          <b>Claude Desktop</b>
          <b>Cursor</b>
        </div>
      </section>

      <section className="pzs__act">
        <div className="pz__eyebrow pz-mono">
          <span className="pz__num">02</span>
          {c.services.eyebrow}
        </div>
        <div className="pzs__cards">
          {c.services.cards.map((card, i) => (
            <div className="pzs__card" key={card.route}>
              <span className="pz-mono">
                {pad2(i + 1)} / {pad2(c.services.cards.length)} · {card.route}
              </span>
              <b>
                {card.price}
                <small>USDC · {c.services.perCall}</small>
              </b>
              <strong>{card.name}</strong>
            </div>
          ))}
        </div>
        <p className="pzs__note pz-mono">
          {c.services.source} · {c.services.more}
        </p>
      </section>

      <section className="pzs__act">
        <div className="pz__eyebrow pz-mono">
          <span className="pz__num">03</span>
          {c.rules.eyebrow}
        </div>
        <div className="pzs__rules">
          {c.rules.items.map((r) => (
            <div key={r.word}>
              <span className="pzs__word">{r.word}</span>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pzs__act pzs__act--ivory">
        <div className="pz__eyebrow pz-mono">
          <span className="pz__num">04</span>
          {c.proof.eyebrow}
        </div>
        <h2>{c.proof.headline.join(" ")}</h2>
        <RefusalMeter c={c} />
        <div className="pz__rows">
          {c.proof.rows.map((r) => (
            <div className="pz__row" key={r.label}>
              <span className="pz-mono">{r.label}</span>
              <p>
                {r.body}{" "}
                <a href={r.link.href} target="_blank" rel="noreferrer">
                  {r.link.text} ↗
                </a>
              </p>
            </div>
          ))}
        </div>

        <div className="pz__eyebrow pz-mono" style={{ marginTop: 56 }}>
          <span className="pz__num">05</span>
          {c.next.eyebrow}
        </div>
        <h2>{c.next.title}</h2>
        <div className="pz__ghosts">
          {c.next.items.map((name) => (
            <div className="pz__ghost" key={name}>
              <span className="pz-mono">{c.next.soon}</span>
              <b>{name}</b>
            </div>
          ))}
        </div>
        <p className="pzs__note">{c.next.note}</p>
      </section>

      <section className="pzs__act pzs__call">
        <h2>{c.call.title}</h2>
        <p className="pz__lede">{c.call.lede}</p>
        <div className="pz__actions">
          <OpenButton c={c} onEnter={onEnter} />
          <a className="pz-btn pz-btn--line" href="/docs/">
            {c.call.docs}
          </a>
        </div>
        <FooterLinks c={c} />
      </section>
    </div>
  );
}
