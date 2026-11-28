import { describe, expect, it } from "vitest";
import { hashForView, isAppPage, viewFromHash } from "./routes";

describe("viewFromHash", () => {
  it("maps each app page", () => {
    for (const p of ["overview", "payments", "agent", "activity", "settings"])
      expect(viewFromHash(`#${p}`)).toBe(p);
  });
  it("redirects legacy #workspace to overview", () => {
    expect(viewFromHash("#workspace")).toBe("overview");
  });
  it("keeps wallet as a standalone view", () => {
    expect(viewFromHash("#wallet")).toBe("wallet");
  });
  it("sends the retired #dashboard demo link to the product", () => {
    expect(viewFromHash("#dashboard")).toBe("overview");
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
    expect(hashForView("wallet")).toBe("wallet");
  });
});

describe("isAppPage", () => {
  it("splits app pages from standalone views", () => {
    expect(isAppPage("overview")).toBe(true);
    expect(isAppPage("settings")).toBe(true);
    expect(isAppPage("wallet")).toBe(false);
    expect(isAppPage("landing")).toBe(false);
  });
});

