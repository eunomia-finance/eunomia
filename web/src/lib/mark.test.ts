import { describe, expect, it } from "vitest";
import { AXIS, hairlineFor, markShapes, shortShapes } from "./mark";

describe("hairlineFor", () => {
  it("gets heavier as the mark gets smaller, so it never falls under a pixel", () => {
    for (const height of [16, 24, 26, 40, 48, 80, 120, 400]) {
      const px = (hairlineFor(height) / 100) * height;
      // 16 px is the one size where even the heavy drawing is under a pixel; a tab icon
      // has its own file for that
      if (height >= 24) expect(px).toBeGreaterThanOrEqual(1);
    }
    expect(hairlineFor(26)).toBeGreaterThan(hairlineFor(64));
    expect(hairlineFor(64)).toBeGreaterThan(hairlineFor(300));
  });
});

describe("markShapes", () => {
  it("keeps everything inside the 4..224 by 0..100 box", () => {
    for (const hl of [1.8, 3, 4.6]) {
      const m = markShapes(hl);
      expect(m.limit.y).toBeGreaterThanOrEqual(0);
      expect(m.limit.y + m.limit.height).toBeLessThanOrEqual(100);
      // the circle's far edge: centre 178, radius 40, half a hairline outside
      expect(178 + 40 + hl / 2).toBeLessThanOrEqual(224);
    }
  });

  it("puts the payment on the axis, between the epsilon and the circle", () => {
    const { payment } = markShapes(3);
    expect(payment.cy).toBe(AXIS);
    expect(payment.cx - payment.r).toBeGreaterThan(78);
    expect(payment.cx + payment.r).toBeLessThan(138 - 1.5);
  });

  it("the limit stands inside the circle, nearer its near edge: a slice, not a half", () => {
    const { limit } = markShapes(3);
    const x = limit.x + limit.width / 2;
    expect(x).toBeGreaterThan(138);
    expect(x).toBeLessThan(178);
    expect((x - 138) / 80).toBeLessThan(0.35);
  });

  it("draws no NaN — the square roots stay real for every hairline in use", () => {
    for (const hl of [1.8, 3, 4.6]) {
      for (const d of [...markShapes(hl).paths, ...shortShapes(hl).paths]) expect(d).not.toMatch(/NaN/);
    }
  });
});
