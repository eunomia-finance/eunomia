// The mark: an epsilon — the E of Εὐνομία, and in mathematics the name for a small allowed
// amount — whose waist runs out into a line. A payment rides the line to a circle that an
// upright limit cuts in two: the slice inside the limit is solid, the budget the agent was
// given; beyond it only the outline is left, the wallet it cannot reach.
//
// Drawn in `currentColor`, so it takes the colour of the text beside it in either theme. The
// shapes come from lib/mark.ts; this file only decides which drawing a size gets.
import { MARK_RATIO, MARK_VIEWBOX, SHORT_RATIO, SHORT_VIEWBOX, hairlineFor, markShapes, shortShapes } from "../lib/mark";

interface Props {
  /** Rendered height in pixels. The full mark is 2.2 times as wide, the short one about square. */
  size?: number;
  /** `short`: the epsilon and the payment alone — where the whole mark does not fit. */
  variant?: "full" | "short";
  className?: string;
}

export default function EunomiaMark({ size = 26, variant = "full", className }: Props) {
  const hl = hairlineFor(size);
  const full = variant === "full";
  const whole = full ? markShapes(hl) : null;
  const shapes = whole ?? shortShapes(hl);
  const limit = whole?.limit;
  return (
    <svg
      className={className}
      width={Math.round(size * (full ? MARK_RATIO : SHORT_RATIO))}
      height={size}
      viewBox={full ? MARK_VIEWBOX : SHORT_VIEWBOX}
      fill="currentColor"
      aria-hidden="true"
    >
      {shapes.paths.map((d) => (
        <path key={d} d={d} />
      ))}
      {shapes.discs.map((c) => (
        <circle key={`${c.cx}:${c.cy}`} cx={c.cx} cy={c.cy} r={c.r} />
      ))}
      {limit && <rect x={limit.x} y={limit.y} width={limit.width} height={limit.height} />}
    </svg>
  );
}
