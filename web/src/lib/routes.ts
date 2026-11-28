// Hash <-> view mapping for the app shell. Views live in the URL hash so refresh and
// back/forward keep the current page; legacy hashes (pre-shell #workspace links shared
// in docs and chats) keep working via the redirect table.
export type AppPage = "overview" | "payments" | "agent" | "activity" | "settings";
export type View = AppPage | "landing" | "wallet";

export const APP_PAGES = ["overview", "payments", "agent", "activity", "settings"] as const;
const STANDALONE = ["wallet"] as const;
// #dashboard was the guided testnet demo; links to it land on the product now.
const LEGACY: Record<string, View> = { workspace: "overview", dashboard: "overview" };

export function viewFromHash(hash: string): View {
  const h = hash.replace(/^#/, "");
  if (h in LEGACY) return LEGACY[h];
  if ((APP_PAGES as readonly string[]).includes(h)) return h as AppPage;
  if ((STANDALONE as readonly string[]).includes(h)) return h as View;
  return "landing";
}

export function hashForView(v: View): string {
  return v === "landing" ? "" : v;
}

export function isAppPage(v: View): v is AppPage {
  return (APP_PAGES as readonly string[]).includes(v);
}
