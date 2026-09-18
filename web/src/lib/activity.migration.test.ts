// The database refuses any `action` outside its CHECK allowlist, and logging is best-effort,
// so a verb the code emits but the migration forgot vanishes without a trace — which is
// exactly how every Leash-era row was lost between July and September 2026. This test
// reads the migration that owns the allowlist and asserts every verb the code can emit
// is in it. Adding an ActivityAction now fails here, not in production.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIVITY_ACTIONS } from "./activity";

const MIGRATION = resolve(__dirname, "../../../supabase/migrations/0005_activity_action_verbs.sql");

function allowedVerbs(sql: string): string[] {
  const m = sql.match(/activity_action_allowed check \(action in \(([\s\S]*?)\)\)/i);
  if (!m) throw new Error("allowlist not found in migration");
  return Array.from(m[1].matchAll(/'([a-z_]+)'/g), (x) => x[1]);
}

describe("activity action allowlist", () => {
  const verbs = allowedVerbs(readFileSync(MIGRATION, "utf8"));

  it("covers every verb the code emits", () => {
    for (const a of ACTIVITY_ACTIONS) expect(verbs, `migration is missing '${a}'`).toContain(a);
  });

  it("has no verb the code never emits", () => {
    for (const v of verbs) expect(ACTIVITY_ACTIONS as readonly string[], `code never logs '${v}'`).toContain(v);
  });
});
