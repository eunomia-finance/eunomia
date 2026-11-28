// The geometry of the mark, as numbers: an epsilon whose waist runs out into a line; a
// payment riding that line; and a circle the line reaches, cut by an upright limit. Inside
// the limit the circle is solid — the budget the agent was given. Beyond it only the outline
// remains — the rest of the wallet, which the agent's line does not reach.
//
// Everything is a filled shape on a 100-unit height (no strokes), so the mark scales to any
// size from one drawing. The one thing that does not scale is the hairline: at 26 px it would
// be half a pixel. `hairlineFor` picks a heavier one as the mark gets smaller.

/** The axis every element sits on: the epsilon's waist. */
export const AXIS = 50.5;

/** The full mark's box: x from 4 to 224, 100 high. */
export const MARK_VIEWBOX = "4 0 220 100";
export const MARK_RATIO = 2.2;

/** The short form — the epsilon, a stub of its line and the payment — for a square or a
 *  space too tight for the whole mark. */
export const SHORT_VIEWBOX = "5 0 92 100";
export const SHORT_RATIO = 0.92;

const CIRCLE_X = 178;
const CIRCLE_R = 40;
const LIMIT_X = 160;
const LINE_FROM = 77.5;

const n = (v: number) => Number(v.toFixed(3)).toString();

/** Hairline thickness, in the mark's units, for a mark drawn `height` pixels tall. */
export function hairlineFor(height: number): number {
  if (height >= 120) return 1.8;
  if (height >= 48) return 3;
  return 4.6;
}

/** The epsilon: two crescents, two ball terminals, and the spur that tapers into the line. */
export function epsilonPaths(hl: number): string[] {
  const a = AXIS - hl / 2;
  const b = AXIS + hl / 2;
  return [
    "M57.7 18A24 21 0 1 0 42.2 50.7L45.1 47.2A18 17.5 0 1 1 56.7 20Z",
    "M41.7 50.3A27 21 0 1 0 58.3 83.9L57.7 81.8A20.5 17.5 0 1 1 45.1 53.8Z",
    `M40.6 ${AXIS}L45.1 47.2Q58 ${n(a - 0.3)} 78 ${n(a)}L78 ${n(b)}Q58 ${n(b + 0.3)} 45.1 53.8Z`,
  ];
}

/** The epsilon's ball terminals. */
export const TERMINALS: readonly { cx: number; cy: number; r: number }[] = [
  { cx: 55.8, cy: 21.9, r: 4.8 },
  { cx: 56.2, cy: 80.2, r: 4.8 },
];

export interface MarkShapes {
  /** every path of the mark except the limit */
  paths: string[];
  /** every disc: the terminals and the payment on the line */
  discs: { cx: number; cy: number; r: number }[];
  /** the limit, as a rect — kept apart so it alone can take another colour */
  limit: { x: number; y: number; width: number; height: number };
  /** the payment, also in `discs`; named so a page can animate it */
  payment: { cx: number; cy: number; r: number };
}

/** The whole mark for a given hairline. */
export function markShapes(hl: number): MarkShapes {
  const ro = CIRCLE_R + hl / 2;
  const ri = CIRCLE_R - hl / 2;
  const dx = LIMIT_X - CIRCLE_X;
  const yo = Math.sqrt(ro * ro - dx * dx);
  const yi = Math.sqrt(ri * ri - dx * dx);
  const lineTo = CIRCLE_X - ro + 0.6;
  const payment = { cx: 106, cy: AXIS, r: hl > 4 ? 9.5 : 8.5 };
  return {
    paths: [
      ...epsilonPaths(hl),
      // the line, from where the spur has thinned to it, to the circle
      `M${LINE_FROM} ${n(AXIS - hl / 2)}H${n(lineTo)}V${n(AXIS + hl / 2)}H${LINE_FROM}Z`,
      // inside the limit: solid
      `M${LIMIT_X} ${n(AXIS - yo)}A${n(ro)} ${n(ro)} 0 0 0 ${LIMIT_X} ${n(AXIS + yo)}Z`,
      // beyond it: only the outline
      `M${LIMIT_X} ${n(AXIS - yo)}A${n(ro)} ${n(ro)} 0 1 1 ${LIMIT_X} ${n(AXIS + yo)}L${LIMIT_X} ${n(AXIS + yi)}A${n(ri)} ${n(ri)} 0 1 0 ${LIMIT_X} ${n(AXIS - yi)}Z`,
    ],
    discs: [...TERMINALS, payment],
    limit: { x: LIMIT_X - hl / 2, y: 3, width: hl, height: 95 },
    payment,
  };
}

/** The short form for a given hairline: epsilon, a stub of line, the payment at its end. */
export function shortShapes(hl: number): Pick<MarkShapes, "paths" | "discs" | "payment"> {
  const payment = { cx: 87, cy: AXIS, r: hl > 4 ? 9 : 8 };
  return {
    paths: [...epsilonPaths(hl), `M${LINE_FROM} ${n(AXIS - hl / 2)}H84V${n(AXIS + hl / 2)}H${LINE_FROM}Z`],
    discs: [...TERMINALS, payment],
    payment,
  };
}
