import { Suspense, lazy, useEffect, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Background from "./components/Background";
import Landing from "./components/Landing";
import FeedbackButton from "./components/FeedbackButton";
import { logFunnel } from "./lib/funnel";
import { hashForView, isLandingAnchor, viewFromHash, type View } from "./lib/routes";
import { ToastProvider } from "./state/toast";
import { TreasuryProvider } from "./state/treasury";

// Heavy views (they pull in the large @stellar/stellar-sdk) are code-split so the
// landing loads fast — stellar-sdk only downloads when you open them.
// Recover from a stale lazy chunk after a deploy: an old cached index.html requests a
// chunk hash that no longer exists (404) → instead of a black screen, reload once to
// fetch the fresh index + correct chunks.
const RELOAD_AT = "prism_chunk_reload_at";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any-prop passthrough: lazy() must accept components with any prop shape
function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().catch(() => {
      // Reload once to fetch a fresh index, but not more than once per 10s (loop guard).
      const last = Number(sessionStorage.getItem(RELOAD_AT) || "0");
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(RELOAD_AT, String(Date.now()));
        window.location.reload();
      }
      return new Promise<{ default: T }>(() => {}); // never resolves; the page is reloading
    }),
  );
}
// The shell pulls in the wallet kit (via WalletChip) — lazy keeps the landing bundle light.
const AppShell = lazyWithReload(() => import("./components/shell/AppShell"));
const ShellRouter = lazyWithReload(() => import("./components/shell/ShellRouter"));

// Keep the address bar canonical: legacy hashes (#workspace) and unknown ones rewrite
// to what actually rendered, so a copied link always reproduces the same view.
function normalizeHash(v: View) {
  const want = hashForView(v);
  if (window.location.hash.slice(1) !== want) {
    window.history.replaceState(null, "", want ? `#${want}` : window.location.pathname + window.location.search);
  }
}

export default function App() {
  const [view, setView] = useState<View>(() => viewFromHash(window.location.hash));

  // One page_view per visit (device-tagged) — the top of the funnel, so connect-clicks
  // and deploys can be read as a fraction of who actually arrived.
  useEffect(() => {
    logFunnel({ event: "page_view" });
    if (!isLandingAnchor(window.location.hash)) normalizeHash(viewFromHash(window.location.hash));
  }, []);

  useEffect(() => {
    const onHash = () => {
      // #proof / #how / … are landing sections, not routes — let the browser do its anchor
      // jump instead of erasing the hash and scrolling back to the top.
      if (isLandingAnchor(window.location.hash)) return;
      const v = viewFromHash(window.location.hash);
      normalizeHash(v);
      setView(v);
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (v: View) => {
    window.location.hash = hashForView(v); // hashchange drives setView
    setView(v); // and set directly so "#" edge cases (landing) still switch
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  return (
    <>
      <Background />

      <AnimatePresence mode="wait">
        {view === "landing" ? (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.4, ease: [0.2, 0.7, 0.3, 1] }}
          >
            <Landing onEnter={() => go("overview")} onWallet={() => go("wallet")} />
          </motion.div>
        ) : (
          // One key for the whole app — the shell persists across page switches; only
          // the page content inside cross-fades.
          <motion.div
            key="app"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <ToastProvider>
              <TreasuryProvider>
                <Suspense fallback={null}>
                  {/* No per-page AnimatePresence here: a lazily-loaded page that suspends
                      mid-enter gets stuck at the animation's initial opacity (blank page on
                      first visit). Pages that want load motion own it (Overview's stagger). */}
                  <AppShell page={view} onGo={go}>
                    <ShellRouter view={view} onGo={go} />
                  </AppShell>
                </Suspense>
              </TreasuryProvider>
            </ToastProvider>
          </motion.div>
        )}
      </AnimatePresence>
      <FeedbackButton />
    </>
  );
}
