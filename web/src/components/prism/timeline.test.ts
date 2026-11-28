import { describe, expect, it } from "vitest";
import { ACT, ACT_ANCHOR, RULE_COUNT, SERVICE_COUNT, TRACK_VH, actIndex, cues } from "./timeline";

const steps = (from: number, to: number, by = 0.01) => Array.from({ length: Math.round((to - from) / by) + 1 }, (_, i) => from + i * by);

describe("the page's score", () => {
  it("always has a wall: no stretch of the scroll shows the bare clear colour", () => {
    for (const s of steps(0, ACT.end)) {
      const c = cues(s);
      // the bar covers the screen while the wall behind it changes
      const covered = c.wallForest + c.wallMosaic + c.wallDeep + c.wallIvory + (c.barAlpha > 0.99 && c.barWid > 1 ? 1 : 0);
      expect(covered, `s=${s.toFixed(2)}`).toBeGreaterThan(0.2);
    }
  });

  it("is on ivory for the proof and for what is next, and nowhere else", () => {
    expect(cues(0).light).toBe(false);
    expect(cues(ACT_ANCHOR[1]).light).toBe(false);
    expect(cues(ACT_ANCHOR[2]).light).toBe(false);
    expect(cues(ACT_ANCHOR[3]).light).toBe(true);
    expect(cues(ACT_ANCHOR[4]).light).toBe(true);
    expect(cues(ACT_ANCHOR[5]).light).toBe(false);
  });

  it("rests every service card in the centre once", () => {
    const rested = new Set<number>();
    for (const s of steps(ACT.services, ACT.rules)) {
      const { card } = cues(s);
      if (Math.abs(card - Math.round(card)) < 1e-6) rested.add(Math.round(card));
    }
    for (let i = 0; i < SERVICE_COUNT; i++) expect(rested.has(i), `card ${i}`).toBe(true);
  });

  it("shows each rule's block alone, with its own word in front", () => {
    for (let i = 0; i < RULE_COUNT; i++) {
      const s = 5.25 + i * 0.56 + 0.3;
      const c = cues(s);
      expect(c.rule[i]).toBe(1);
      c.rule.forEach((v, k) => k !== i && expect(v).toBe(0));
      expect(c.ruleAt).toBeCloseTo(i, 5);
    }
  });

  it("puts every nav anchor inside the act it names, and the track holds the last one", () => {
    ACT_ANCHOR.forEach((s, i) => expect(actIndex(s)).toBe(i));
    expect(TRACK_VH / 100 - 1).toBeGreaterThanOrEqual(ACT_ANCHOR[ACT_ANCHOR.length - 1]);
  });

  it("has the call's controls and the mark on screen at the very end", () => {
    const c = cues(ACT.end);
    expect(c.markIn).toBe(1);
    expect(c.callUi).toBe(1);
  });
});
