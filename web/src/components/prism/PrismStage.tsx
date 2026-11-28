// The moving landing page: a WebGL scene (scene.ts) under layers of text that the scroll
// position turns on and off (timeline.ts). The layers are real DOM — headings, links, buttons —
// fixed over the canvas; the scene never carries anything a reader needs.
//
// This file is the only place the two meet: one frame loop reads the scroll, asks the
// timeline for cues, hands them to the scene and writes them onto the layers.
import { useEffect, useMemo, useRef } from "react";
import gsap from "gsap";
import Lenis from "lenis";
import { useLang } from "../../lib/i18n";
import { MARK_VIEWBOX, markShapes } from "../../lib/mark";
import EunomiaMark from "../EunomiaMark";
import { landingContent, sceneContent, type LandingContent } from "./content";
import { CommandBox, FooterLinks, LangToggle, OpenButton, RefusalMeter } from "./parts";
import { createPrismScene, type PrismScene } from "./scene";
import { ACT_ANCHOR, TRACK_VH, actIndex, clamp, cues, eOut, lerp, type Cues } from "./timeline";
import "./prism.css";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Opacity, a small rise, and out of the tab order when gone. */
function show(node: HTMLElement | null, v: number, dy = 14) {
  if (!node) return;
  node.style.opacity = v.toFixed(3);
  node.style.transform = `translateY(${((1 - v) * dy).toFixed(1)}px)`;
  node.style.visibility = v < 0.002 ? "hidden" : "visible";
}
/** A wipe: `inn` opens it from the left, `out` closes it from the left. */
function wipe(node: HTMLElement | null, inn: number, out = 0) {
  if (!node) return;
  node.style.clipPath = `inset(0 ${(100 - inn * 100).toFixed(1)}% 0 ${(out * 100).toFixed(1)}%)`;
}

export default function PrismStage({ onEnter }: { onEnter: () => void }) {
  const lang = useLang();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the content is rebuilt when the language changes
  const c = useMemo(() => landingContent(), [lang]);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<PrismScene | null>(null);
  const lenisRef = useRef<Lenis | null>(null);
  const contentRef = useRef<LandingContent>(c);
  const captionIdx = useRef(-1);
  /** set when the content changed: the frame loop's references to the layers may be old */
  const stale = useRef(false);

  /** Write a card's caption, letter by letter. */
  const setCaption = (i: number, force = false) => {
    const el = root.current;
    if (!el || (i === captionIdx.current && !force)) return;
    const first = captionIdx.current === -1;
    captionIdx.current = i;
    const card = contentRef.current.services.cards[i];
    const title = el.querySelector<HTMLElement>("[data-el=cap-title]");
    const sub = el.querySelector<HTMLElement>("[data-el=cap-sub]");
    const count = el.querySelector<HTMLElement>("[data-el=cap-count]");
    if (!title || !sub || !count) return;
    count.textContent = `${pad2(i + 1)} / ${pad2(contentRef.current.services.cards.length)}`;
    sub.textContent = contentRef.current.services.priceLine(card);
    title.replaceChildren(
      ...[...card.name].map((ch) => {
        const span = document.createElement("span");
        span.textContent = ch;
        return span;
      }),
    );
    if (first || force) return;
    [...title.children].forEach((node, k) =>
      node.animate([{ transform: "translateY(105%)" }, { transform: "translateY(-6%)", offset: 0.7 }, { transform: "translateY(0)" }], {
        duration: 520,
        delay: k * 17,
        easing: "cubic-bezier(.16,1,.3,1)",
        fill: "backwards",
      }),
    );
    sub.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 420, delay: 120, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
  };

  // The language changed: the scene redraws its textures, the caption its words.
  useEffect(() => {
    contentRef.current = c;
    stale.current = true;
    sceneRef.current?.setContent(sceneContent(c));
    if (captionIdx.current >= 0) setCaption(captionIdx.current, true);
  }, [c]);

  useEffect(() => {
    const el = root.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const q = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel);
    const qa = <T extends HTMLElement = HTMLElement>(sel: string) => [...el.querySelectorAll<T>(sel)];
    const debug = new URLSearchParams(window.location.search);

    let alive = true;
    let raf = 0;
    let scene: PrismScene | null = null;
    let introTl: gsap.core.Timeline | null = null;
    const lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
    lenisRef.current = lenis;
    lenis.stop();
    document.documentElement.classList.add("pz-locked");

    const collect = () => ({
      hero: qa("[data-el=hero]"),
      cap: q("[data-el=cap]"),
      more: q("[data-el=more]"),
      rail: q("[data-el=rail]"),
      railItems: qa("[data-el=rail] button"),
      rules: qa("[data-el=rule]"),
      proofBox: q("[data-el=proof]"),
      proofLines: qa("[data-el=proof-line]"),
      proofRows: qa("[data-el=proof-row]"),
      proofMeter: q("[data-el=proof-meter]"),
      stamp: qa("[data-el=stamp] span"),
      next: q("[data-el=next]"),
      call: q("[data-el=call]"),
      callUi: q("[data-el=call-ui]"),
      callLines: qa("[data-el=call-lines] i"),
      foot: q("[data-el=foot]"),
    });
    let layers = collect();

    const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
    const onMove = (e: PointerEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("pointermove", onMove);

    let vel = 0;
    let last = performance.now();
    let act = -1;
    const ui = { v: 0 }; // the hero controls wait for the intro

    const paint = (k: Cues, s: number) => {
      // another language can change how many letters the stamp has: look the layers up again
      if (stale.current) {
        stale.current = false;
        layers = collect();
        act = -1;
      }
      el.classList.toggle("is-light", k.light);
      layers.hero.forEach((n, i) => show(n, k.heroUi * ui.v, 10 + i * 4));
      show(layers.cap, k.caption);
      show(layers.more, k.caption, 6);
      if (k.caption > 0) setCaption(clamp(Math.round(k.card), 0, contentRef.current.services.cards.length - 1));
      // the rail steps aside for the hero's controls and for the call's, which stand where it does
      show(layers.rail, clamp((s - 0.8) / 0.3) * (1 - clamp((s - 11.4) / 0.3)), 0);
      const now = actIndex(s);
      if (now !== act) {
        act = now;
        layers.railItems.forEach((n, i) => n.classList.toggle("is-on", i === now));
      }
      layers.rules.forEach((n, i) => show(n, k.rule[i], 22));

      // proof: the two headline lines wipe in, then the rows; everything wipes out together
      if (layers.proofBox) layers.proofBox.style.visibility = k.proof[0] > 0 && k.proofOut < 1 ? "visible" : "hidden";
      layers.proofLines.forEach((n, i) => wipe(n, eOut(k.proof[i] ?? 0), k.proofOut));
      layers.proofRows.forEach((n, i) => show(n, eOut(k.proof[3 + i] ?? 0) * (1 - k.proofOut), 16));
      show(layers.proofMeter, eOut(k.proof[3]) * (1 - k.proofOut), 16);
      layers.stamp.forEach((n, i) => {
        n.style.opacity = clamp((k.refused * layers.stamp.length * 1.15 - i) / 1.5).toFixed(3);
      });

      show(layers.next, k.next, 18);

      if (layers.call) layers.call.style.visibility = k.markIn > 0 ? "visible" : "hidden";
      layers.callLines.forEach((n, i) => {
        n.style.transform = `scaleY(${eOut(clamp(k.callLines * 1.4 - i * 0.025)).toFixed(3)})`;
      });
      show(layers.callUi, k.callUi, 18);
      show(layers.foot, clamp(k.callUi * 1.5 - 0.5), 12);
    };

    const frame = (now: number) => {
      if (!alive) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      lenis.raf(now);
      const s = lenis.scroll / window.innerHeight;
      vel = lerp(vel, clamp(lenis.velocity / 40, -1, 1), 0.12);
      mouse.sx = lerp(mouse.sx, mouse.x, 0.05);
      mouse.sy = lerp(mouse.sy, mouse.y, 0.05);
      const k = cues(s);
      scene?.render(k, s, vel, { x: mouse.sx, y: mouse.sy }, dt);
      paint(k, s);
      raf = requestAnimationFrame(frame);
    };

    const onResize = () => scene?.resize();
    window.addEventListener("resize", onResize);

    const intro = () => {
      if (!scene) return;
      const loader = q("[data-el=loader]");
      const lines = loader ? [...loader.querySelectorAll<SVGGeometryElement>("path, circle, line")] : [];
      const arrive = qa("[data-arrive]");
      const open = () => {
        document.documentElement.classList.remove("pz-locked");
        lenis.start();
        gsap.to(arrive, { y: 0, opacity: 1, duration: 0.7, ease: "back.out(1.6)", stagger: 0.05 });
      };
      const jump = debug.get("s");
      if (jump !== null) {
        // a way to look at one moment of the page: ?s=5.4
        loader?.remove();
        cv.style.clipPath = "none";
        gsap.set(arrive, { y: 0, opacity: 1 });
        ui.v = 1;
        document.documentElement.classList.remove("pz-locked");
        lenis.start();
        requestAnimationFrame(() => lenis.scrollTo(Number(jump) * window.innerHeight, { immediate: true, force: true }));
        return;
      }
      lines.forEach((l) => {
        const len = l.getTotalLength();
        l.style.strokeDasharray = String(len);
        l.style.strokeDashoffset = String(len);
      });
      const pct = { v: 0 };
      const count = q("[data-el=pct]");
      const st = scene.state;
      Object.assign(st, { camZ: 2.35, ca: 0.04, bloom: 0.45, tint: 1 });
      const tl = gsap.timeline();
      introTl = tl;
      tl.to(lines, { strokeDashoffset: 0, duration: 1.1, ease: "power3.inOut", stagger: 0.06 }, 0)
        .to(pct, { v: 100, duration: 1.5, ease: "power2.inOut", onUpdate: () => count && (count.textContent = String(Math.round(pct.v)).padStart(3, "0")) }, 0)
        // the scene opens inside the mark's circle (the loader is laid out so that circle
        // is the middle of the screen)…
        .to(cv, { clipPath: "circle(10.5vmin at 50% 50%)", duration: 0.55, ease: "back.out(1.7)" }, 1.15)
        .to(st, { camZ: 3.1, duration: 0.55, ease: "expo.out" }, 1.15)
        // …and we fly out through it
        .to(cv, { clipPath: "circle(160vmax at 50% 50%)", duration: 1.1, ease: "expo.in" }, 1.75)
        .to(loader ? loader.querySelector("svg") : null, { scale: 5, opacity: 0, duration: 0.9, ease: "expo.in", transformOrigin: "79.1% 50.5%" }, 1.75)
        .to(count, { opacity: 0, duration: 0.25 }, 1.75)
        .to(st, { camZ: 10, duration: 1.7, ease: "expo.inOut" }, 1.75)
        .to(st, { ca: 0.0018, bloom: 0.3, duration: 1.6, ease: "expo.out" }, 2.35)
        .to(st, { tint: 0, duration: 1.2, ease: "power2.inOut" }, 1.9)
        .to(ui, { v: 1, duration: 0.6, ease: "expo.out" }, 2.75)
        .add(open, 2.7)
        .add(() => {
          loader?.remove();
          cv.style.clipPath = "none";
        }, 2.95);
      const hold = debug.get("t");
      if (hold !== null) tl.pause(Number(hold));
    };

    // The scene draws its words with the page's fonts; wait until they are there.
    void Promise.all([
      document.fonts.load('400 120px "Questrial"'),
      document.fonts.load('500 120px "Kalnia"'),
      document.fonts.load('500 60px "JetBrains Mono"'),
    ])
      .catch(() => undefined)
      .then(() => document.fonts.ready)
      .then(() => {
        if (!alive) return;
        scene = createPrismScene(cv, sceneContent(contentRef.current));
        sceneRef.current = scene;
        setCaption(0);
        last = performance.now();
        raf = requestAnimationFrame(frame);
        intro();
      });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      introTl?.kill();
      gsap.killTweensOf(qa("[data-arrive]"));
      lenis.destroy();
      lenisRef.current = null;
      document.documentElement.classList.remove("pz-locked");
      scene?.dispose();
      sceneRef.current = null;
    };
    // Mounted once: what changes later (the language) arrives through contentRef.
  }, []);

  const goTo = (act: number) => lenisRef.current?.scrollTo(ACT_ANCHOR[act] * window.innerHeight, { duration: 1.6 });

  const outline = useMemo(() => markShapes(1.8), []);

  return (
    <div className="pz" ref={root}>
      <canvas className="pz__gl" ref={canvas} aria-hidden="true" />
      <div className="pz__track" style={{ height: `${TRACK_VH}vh` }} />

      {/* the loader: the mark, drawn as lines, before the scene opens inside its circle */}
      <div className="pz__loader" data-el="loader" aria-hidden="true">
        <svg viewBox={MARK_VIEWBOX}>
          {outline.paths.map((d) => (
            <path key={d} d={d} />
          ))}
          {outline.discs.map((k) => (
            <circle key={`${k.cx}:${k.cy}`} cx={k.cx} cy={k.cy} r={k.r} />
          ))}
          <line x1="160" y1="3" x2="160" y2="98" />
        </svg>
        <div className="pz__count pz-mono">
          <span data-el="pct">000</span>%
        </div>
      </div>

      <header className="pz__top pz-fx">
        <button className="pz__brand" data-arrive onClick={() => goTo(0)} type="button" aria-label="Eunomia">
          <EunomiaMark size={26} />
          Eunomia
        </button>
        <nav className="pz__nav" aria-label="Sections">
          {[c.nav.services, c.nav.rules, c.nav.proof].map((label, i) => (
            // keyed by place, not by label: a language switch must keep these nodes — the frame
            // loop and the intro have written their state onto them
            <button key={i} data-arrive onClick={() => goTo(i + 1)} type="button">
              {label}
            </button>
          ))}
          <a data-arrive href="/docs/">
            {c.nav.docs}
          </a>
        </nav>
        <div className="pz__top-end">
          <span data-arrive>
            <LangToggle />
          </span>
          <span data-arrive>
            <OpenButton c={c} onEnter={onEnter} className="pz-btn pz-btn--gold pz-btn--sm" />
          </span>
        </div>
      </header>

      <div className="pz__rail pz-fx pz-mono" data-el="rail">
        {c.rail.map((label, i) => (
          <button key={i} onClick={() => goTo(i)} type="button">
            <i />
            {pad2(i + 1)} {label}
          </button>
        ))}
      </div>

      {/* The sentence itself is drawn in the scene, where the glass can bend it. */}
      <h1 className="pz-sr">{c.hero.sentence.join(" ")}</h1>

      <div className="pz__hero-a pz-fx" data-el="hero">
        <div className="pz__badges">
          <span className="pz-badge pz-badge--live">
            <i />
            {c.hero.live}
          </span>
          <span className="pz-badge">{c.hero.cap}</span>
        </div>
        <p className="pz__lede">{c.hero.lede}</p>
        <div className="pz__actions">
          <OpenButton c={c} onEnter={onEnter} />
          <a className="pz-btn pz-btn--line" href="/docs/">
            {c.hero.docs}
          </a>
        </div>
      </div>
      <div className="pz__hero-b pz-fx" data-el="hero">
        <CommandBox c={c} />
        <div className="pz__with pz-mono">
          <span>{c.hero.worksWith}</span>
          <b>Claude Code</b>
          <b>Claude Desktop</b>
          <b>Cursor</b>
        </div>
      </div>

      {/* services: the caption under the card in the centre */}
      <div className="pz__cap pz-fx" data-el="cap" aria-live="polite">
        <div className="pz__eyebrow pz-mono">
          <span className="pz__num">02</span>
          {c.services.eyebrow}
          <span data-el="cap-count" />
        </div>
        <h2 data-el="cap-title" />
        <div className="pz__cap-sub pz-mono" data-el="cap-sub" />
      </div>
      <div className="pz__more pz-fx pz-mono" data-el="more">
        {c.services.more}
      </div>

      {/* rules: one block at a time, while the words flow behind */}
      {c.rules.items.map((r, i) => (
        <div className="pz__rule pz-fx" data-el="rule" key={i}>
          <div className="pz__eyebrow pz-mono">
            <span className="pz__num">03</span>
            {c.rules.eyebrow}
            <span>
              {pad2(i + 1)} / {pad2(c.rules.items.length)}
            </span>
          </div>
          <h3>{r.title}</h3>
          <p>{r.body}</p>
        </div>
      ))}

      {/* proof: on ivory */}
      <div className="pz__proof pz-fx" data-el="proof">
        <div className="pz__eyebrow pz-mono" data-el="proof-line">
          <span className="pz__num">04</span>
          {c.proof.eyebrow}
        </div>
        <h2>
          {c.proof.headline.map((line, i) => (
            <span className="pz__lbl" data-el="proof-line" key={i}>
              {line}
            </span>
          ))}
        </h2>
        <div className="pz__rows">
          {c.proof.rows.map((r, i) => (
            <div className="pz__row" data-el="proof-row" key={i}>
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
        <div className="pz__meter" data-el="proof-meter">
          <RefusalMeter c={c} />
        </div>
        <div className="pz__stamp" data-el="stamp" aria-hidden="true">
          {[...c.proof.stamp].map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </div>
      </div>

      {/* next: named, and plainly not live */}
      <div className="pz__next pz-fx" data-el="next">
        <div className="pz__eyebrow pz-mono">
          <span className="pz__num">05</span>
          {c.next.eyebrow}
        </div>
        <h2>{c.next.title}</h2>
        <div className="pz__ghosts">
          {c.next.items.map((name, i) => (
            <div className="pz__ghost" key={i}>
              <span className="pz-mono">{c.next.soon}</span>
              <b>{name}</b>
            </div>
          ))}
        </div>
        <p>{c.next.note}</p>
      </div>

      {/* the call */}
      <div className="pz__call pz-fx" data-el="call">
        <div className="pz__vlines" data-el="call-lines" aria-hidden="true">
          {[4, 9, 10.5, 27, 31, 33, 44, 52, 58, 60.5, 64, 71, 83, 85, 88, 96].map((x) => (
            <i key={x} style={{ left: `${x}vw` }} />
          ))}
        </div>
        <div className="pz__call-ui" data-el="call-ui">
          <h2>{c.call.title}</h2>
          <p className="pz__lede">{c.call.lede}</p>
          <div className="pz__actions">
            <OpenButton c={c} onEnter={onEnter} />
            <a className="pz-btn pz-btn--line" href="/docs/">
              {c.call.docs}
            </a>
          </div>
        </div>
        <div className="pz__foot" data-el="foot">
          <FooterLinks c={c} />
        </div>
      </div>
    </div>
  );
}
