// The page's score. One number drives everything: `s`, the scroll position in viewport
// heights. The WebGL scene and the DOM layers both read their cues from here, so a section
// can be retimed in one place and the two never drift apart.
//
// Pure functions only — no three, no DOM — so the cues are testable.

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** 0 before `a`, 1 after `b`, linear between. */
export const range = (s: number, a: number, b: number) => clamp((s - a) / (b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const eOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const eInOut = (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
export const eBack = (t: number) => {
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** Where each act starts, in viewport heights. */
export const ACT = {
  hero: 0,
  services: 0.9,
  rules: 4.6,
  proof: 8.2,
  next: 10.3,
  call: 11.5,
  end: 12.8,
} as const;

/** How tall the scroll track is, in vh. */
export const TRACK_VH = Math.round((ACT.end + 1) * 100);

export const SERVICE_COUNT = 4;
export const RULE_COUNT = 4;

/** Which act `s` is in, 0..5 — the rail's index. */
export function actIndex(s: number): number {
  if (s < ACT.services) return 0;
  if (s < ACT.rules) return 1;
  if (s < ACT.proof) return 2;
  if (s < ACT.next) return 3;
  if (s < ACT.call) return 4;
  return 5;
}

/** Scroll position (in viewport heights) that shows an act settled, for the nav's jumps. */
export const ACT_ANCHOR = [0, 1.55, 5.4, 8.75, 10.65, 12.6] as const;

export interface Cues {
  /** the wall's four states; they cross-fade */
  wallForest: number;
  wallMosaic: number;
  wallDeep: number;
  wallIvory: number;
  /** the page reads on ivory: the nav and the rail turn to ink */
  light: boolean;

  /** hero: the block of controls under the sentence */
  heroUi: number;
  /** the sentence turning into the section word, then leaving */
  wordMix: number;
  wordGray: number;
  wordBack: number;
  wordOut: number;

  /** the glass prism: how far along its roaming path, and how much of it is left */
  prismRoam: number;
  prismGone: number;

  /** services: a continuous card index (-1 → 4), eased so each card rests in the centre */
  card: number;
  /** the same journey, uneased — what the prism orbits on */
  cardLin: number;
  cardsOn: boolean;
  caption: number;

  /** rules: the liquid words and the four rule blocks */
  rulesOn: number;
  rulesWarp: number;
  rulesDim: number;
  rule: number[];
  /** which rule's word is in front of the camera, 0..3, resting on each as its block shows */
  ruleAt: number;

  /** the bar that carries the page from dark to ivory */
  barLen: number;
  barWid: number;
  barAlpha: number;

  /** proof: lines 0..n reveal one after another; `proofOut` wipes them */
  proof: number[];
  proofOut: number;
  refused: number;

  /** what is next: the ghost cards */
  next: number;

  /** the call: the mark lands, the lines draw, the controls arrive */
  markIn: number;
  callLines: number;
  callUi: number;
}

export function cues(s: number): Cues {
  const wallIvory = range(s, 8.05, 8.35) * (1 - range(s, 11.25, 11.6));
  const rulesOn = range(s, ACT.rules, ACT.rules + 0.4) * (1 - range(s, 7.5, 7.95));

  // The cards travel from one before the first to one past the last; within each step the
  // movement is squeezed into the middle 60%, so a card holds still while it is read.
  const lin = lerp(-1, SERVICE_COUNT, range(s, 0.95, 4.75));
  const fl = Math.floor(lin);
  const fr = lin - fl;
  const card = fl + eInOut(smooth(clamp((fr - 0.2) / 0.6)));

  const RULE_0 = 5.25;
  const RULE_STEP = 0.56;
  const rule = Array.from({ length: RULE_COUNT }, (_, i) => {
    const a0 = RULE_0 + i * RULE_STEP;
    return range(s, a0, a0 + 0.2) * (1 - range(s, a0 + 0.42, a0 + 0.54));
  });
  // The word turns to the next one in the gap between two blocks, and holds while one is read.
  const rl = clamp((s - RULE_0) / RULE_STEP, 0, RULE_COUNT - 1);
  const rfl = Math.floor(rl);
  const ruleAt = Math.min(RULE_COUNT - 1, rfl + eInOut(clamp((rl - rfl - 0.72) / 0.28)));

  // the eyebrow, the two headline lines, then the four rows
  const proofStarts = [8.4, 8.5, 8.62, 8.82, 8.96, 9.1, 9.24];
  return {
    wallForest: 1 - range(s, 0.35, 1.05) + range(s, 11.3, 11.7),
    wallMosaic: range(s, 0.55, 1.2) * (1 - range(s, 4.45, 4.95)),
    // the words leave before the bar arrives; the wall behind them stays until the bar has covered it
    wallDeep: range(s, ACT.rules, ACT.rules + 0.4) * (1 - range(s, 8.1, 8.35)),
    wallIvory,
    // the bar is ivory too, and reaches the top of the screen before the wall has turned
    light: wallIvory > 0.5 || (s > 7.86 && s < 8.3),

    heroUi: 1 - range(s, 0.25, 0.6),
    wordMix: eInOut(range(s, 0.35, 0.95)),
    wordGray: range(s, 0.6, 1.25) * 0.9,
    wordBack: eInOut(range(s, 0.9, 1.4)),
    wordOut: range(s, 4.2, 4.7),

    prismRoam: eInOut(range(s, 0.4, 1.3)),
    prismGone: eInOut(range(s, 4.35, 4.8)),

    card,
    cardLin: lin,
    cardsOn: s > 0.8 && s < 5.1,
    caption: range(s, 1.15, 1.35) * (1 - range(s, 4.25, 4.45)),

    rulesOn,
    rulesWarp: 1 - smooth(range(s, ACT.rules + 0.1, ACT.rules + 0.9)),
    rulesDim: range(s, 5.15, 5.5),
    rule,
    ruleAt,

    barLen: lerp(0, 0.34, eOut(range(s, 7.45, 7.7))) + eInOut(range(s, 7.7, 8.2)) * 1.6,
    barWid: lerp(0.004, 1.4, Math.pow(range(s, 7.7, 8.2), 2.2)),
    barAlpha: range(s, 7.45, 7.5) * (1 - range(s, 8.25, 8.45)),

    proof: proofStarts.map((a) => range(s, a, a + 0.26)),
    proofOut: range(s, 10.05, 10.25),
    refused: range(s, 8.35, 8.7) * (1 - range(s, 10.0, 10.2)),

    next: range(s, ACT.next, ACT.next + 0.3) * (1 - range(s, 11.15, 11.35)),

    markIn: range(s, 11.6, 12.15),
    callLines: range(s, 11.7, 12.3),
    callUi: range(s, 12.15, 12.5),
  };
}
