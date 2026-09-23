import { describe, expect, it } from "vitest";
import { hashForView, isAppPage, isLandingAnchor, viewFromHash } from "./routes";

describe("viewFromHash", () => {
  it("maps each app page", () => {
    for (const p of ["overview", "payments", "agent", "activity", "settings"])
      expect(viewFromHash(`#${p}`)).toBe(p);
  });
  it("redirects legacy #workspace to overview", () => {
    expect(viewFromHash("#workspace")).toBe("overview");
  });
  it("keeps dashboard and wallet as standalone views", () => {
    expect(viewFromHash("#dashboard")).toBe("dashboard");
    expect(viewFromHash("#wallet")).toBe("wallet");
  });
  it("falls back to landing on unknown or empty", () => {
    expect(viewFromHash("")).toBe("landing");
    expect(viewFromHash("#")).toBe("landing");
    expect(viewFromHash("#nope")).toBe("landing");
  });
  it("accepts hashes without the # prefix", () => {
    expect(viewFromHash("overview")).toBe("overview");
  });
});

describe("hashForView", () => {
  it("maps landing to the empty hash and pages to themselves", () => {
    expect(hashForView("landing")).toBe("");
    expect(hashForView("overview")).toBe("overview");
    expect(hashForView("dashboard")).toBe("dashboard");
  });
});

describe("isAppPage", () => {
  it("splits app pages from standalone views", () => {
    expect(isAppPage("overview")).toBe(true);
    expect(isAppPage("settings")).toBe(true);
    expect(isAppPage("dashboard")).toBe(false);
    expect(isAppPage("landing")).toBe(false);
  });
});

describe("isLandingAnchor", () => {
  it("recognises the landing section anchors", () => {
    expect(isLandingAnchor("#how")).toBe(true);
    // Every section the landing nav links to — a missing one made the router scroll back to
    // the top the moment it was clicked.
    for (const id of ["#proof", "#guarantees", "#privacy"]) expect(isLandingAnchor(id)).toBe(true);
    expect(isLandingAnchor("how")).toBe(true);
  });
  it("rejects routes, unknown hashes and the empty hash", () => {
    expect(isLandingAnchor("#overview")).toBe(false);
    expect(isLandingAnchor("#workspace")).toBe(false);
    expect(isLandingAnchor("#nope")).toBe(false);
    expect(isLandingAnchor("")).toBe(false);
    expect(isLandingAnchor("#")).toBe(false);
  });
});
