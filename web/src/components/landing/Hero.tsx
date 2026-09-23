import { Suspense, lazy, useEffect, useState } from "react";
import { passkeyCapability, type PasskeyCapability } from "../../lib/passkeySupport";
import { useWalletAddress } from "../../lib/useWalletAddress";
import { errText } from "../../lib/wallet-errors";
import { TRACTION } from "./traction";
import Words from "./Words";
import { useTheme } from "./useTheme";
import EunomiaMark from "../EunomiaMark";

const WalletChip = lazy(() => import("../WalletChip"));

/** The brand name split where the curtain parts. Each half is pinned to the inner edge of its
 *  panel, so as the gap opens the two halves are carried off screen with it. */
const BRAND_START = "Eu";
const BRAND_END = "nomia";

const loaderChars = (word: string, keyBase: string) =>
  [...word].map((ch, i) => (
    <span className="lp__load-char" key={`${keyBase}-${i}`}>
      {ch}
    </span>
  ));

/** The opening screen — a full-height scene, not a padded band.
 *
 *  Structure follows animmaster `hero-1` (`Hero Animations/1`): a `100dvh` header, a centred
 *  loader that holds the brand name with a box growing out of its middle, and the real content
 *  laid out top (nav) to bottom (headline) underneath it.
 *
 *  The reference grows a photograph out of that box until it fills the viewport and keeps it as
 *  the hero's background. There is no artwork yet, so the box carries a flat `--green` panel
 *  and pulls away once the scene is set — when the imagery lands it goes inside this same box
 *  and simply stops retracting.
 *
 *  Still no product screenshot: a dashboard image here reads as a tool demo, not a company.
 *  The counter carries the evidence instead. */
export default function Hero({
  onCreate,
  onSignIn,
  onEnter,
  onWallet,
  onRecover,
}: {
  /** Registers the passkey and deploys — the recovery step that follows routes in. */
  onCreate: () => Promise<void>;
  /** Picks an existing passkey and opens the wallet behind it — no deploy, no code. */
  onSignIn: () => Promise<void>;
  /** Straight into the workspace — for a session this device already remembers. */
  onEnter: () => void;
  onWallet: () => void;
  /** Opens the paste-your-recovery-code flow. */
  onRecover: () => void;
}) {
  const { theme, toggle } = useTheme();
  const address = useWalletAddress();
  const [capability, setCapability] = useState<PasskeyCapability>("none");
  const [busy, setBusy] = useState<"create" | "signin" | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    void passkeyCapability(window).then(setCapability);
  }, []);

  const run = async (which: "create" | "signin", fn: () => Promise<void>, fallback: string) => {
    setErr("");
    setBusy(which);
    try {
      await fn();
    } catch (e) {
      setErr(errText(e) || fallback);
    } finally {
      setBusy(null);
    }
  };
  const startPasskey = () => run("create", onCreate, "Couldn't create your passkey. Try again.");
  const signIn = () => run("signin", onSignIn, "Couldn't open your wallet with that passkey.");

  return (
    <section className="lp__section lp__hero">
      {/* The opening curtain. Two cream panels meeting in the middle with the brand name
          straddling the seam; the gap between them opens onto the real hero underneath, so
          there is no separate splash to hand over from — the page is simply uncovered.
          Decorative: the same name sits in the nav for assistive tech. */}
      <div className="lp__curtain" aria-hidden="true">
        {/* The green fills the opening as it widens — the moment the first version got right.
            Once it owns the screen it lifts away, and the hero is underneath. */}
        <i className="lp__curtain-fill" />
        <div className="lp__curtain-half lp__curtain-half--l">
          <span className="lp__brand-start">{loaderChars(BRAND_START, "s")}</span>
        </div>
        <div className="lp__curtain-half lp__curtain-half--r">
          <span className="lp__brand-end">{loaderChars(BRAND_END, "e")}</span>
        </div>
      </div>

      <div className="lp__hero-top">
        <nav className="lp__nav">
          <span className="lp__nav-mask">
            <span className="lp__nav-link lp__nav-brand">
              <EunomiaMark size={17} />
              Eunomia
            </span>
          </span>

          {/* The page had no way to move around itself — six sections and no menu. */}
          <span className="lp__nav-mid">
            {[
              ["Proof", "#proof"],
              ["How it works", "#how"],
              ["Guarantees", "#guarantees"],
              ["Privacy", "#privacy"],
            ].map(([label, href]) => (
              <span className="lp__nav-mask" key={href}>
                <a className="lp__nav-link" href={href}>
                  {label}
                </a>
              </span>
            ))}
          </span>

          <span className="lp__nav-end">
            <span className="lp__nav-mask lp__nav-aux">
              <a className="lp__nav-link" href="/docs/">
                Docs
              </a>
            </span>
            <span className="lp__nav-mask lp__nav-aux">
              <a
                className="lp__nav-link"
                href="https://github.com/eunomia-finance/eunomia"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </span>
            <span className="lp__nav-mask">
              <button
                className="lp__nav-link lp__theme"
                onClick={(e) => toggle(e)}
                type="button"
                aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                title={theme === "dark" ? "Light" : "Dark"}
              >
                {theme === "dark" ? "☀" : "☾"}
              </button>
            </span>

            {/* Rides in with the nav links rather than sitting there through the whole scene. */}
            <span className="lp__nav-mask lp__nav-mask--chip">
              <span className="lp__nav-chip">
                <Suspense fallback={null}>
                  <WalletChip />
                </Suspense>
              </span>
            </span>
          </span>
        </nav>
      </div>

      <div className="lp__hero-bottom">
        <div className="lp__rule" />
        <h1>
          <Words text="You don't have to hand your agent the keys." mark="the keys" />
        </h1>

        {/* Each supporting block rides up out of its own box, the way `hero-1` closes: the
            reference lifts its header letters and nav links with `yPercent: 110 → 0` on
            `expo.out` rather than fading them in. */}
        <div className="lp__rise-box">
          <p className="lp__lede lp__rise">
            Give it a budget instead. The limits live in the contract — not in the prompt, and
            not in the model's good intentions.
          </p>
        </div>

        <div className="lp__rise-box">
          <div className="lp__actions lp__rise">
            {address ? (
              // This device remembers a session: the only sensible door is the one in.
              // The chip in the nav names the wallet; disconnecting there brings the
              // create / sign-in pair back.
              <button className="lp__cta" onClick={onEnter} type="button">
                Open your treasury
                <span className="lp__cta-hint">signed in with your passkey</span>
              </button>
            ) : (
              <>
                {/* Hidden entirely when WebAuthn is absent: the wallet path still works. */}
                {capability !== "none" && (
                  <button className="lp__cta" onClick={() => void startPasskey()} disabled={busy !== null}>
                    {busy === "create" ? "Creating…" : "Create your treasury with a passkey"}
                    <span className="lp__cta-hint">
                      {capability === "platform" ? "Fingerprint, face or PIN" : "Pair with your phone"}
                    </span>
                  </button>
                )}
                {/* The door back in for a returning user. One touch, no new wallet, no code. */}
                {capability !== "none" && (
                  <button
                    className="lp__cta lp__cta--ghost"
                    onClick={() => void signIn()}
                    disabled={busy !== null}
                    type="button"
                  >
                    {busy === "signin" ? "Opening…" : "Sign in with your passkey"}
                    <span className="lp__cta-hint">already made a treasury here</span>
                  </button>
                )}
                <button className="lp__cta lp__cta--ghost" onClick={onWallet} type="button">
                  I have a wallet
                </button>
              </>
            )}
          </div>
        </div>

        {err && (
          <p className="lp__k" style={{ color: "var(--red)", marginTop: 14 }}>
            {err}
          </p>
        )}

        {/* The quiet door back in for someone whose device — and passkey — is gone. */}
        {capability !== "none" && (
          <div className="lp__rise-box">
            <button className="lp__rise" style={recoverLink} onClick={onRecover} type="button">
              Lost your passkey? Restore access →
            </button>
          </div>
        )}

      </div>

      {/* Sits on the bottom edge of the scene, not stacked under the buttons. */}
      <div className="lp__hero-foot">
        {/* A real element rather than the counter's border-top, so it can be drawn open.
            This is `hero-1`'s box widening out — the reference grows it to `110vw`. */}
        <i className="lp__counter-rule" aria-hidden="true" />
        <div className="lp__rise-box">
          <div className="lp__counter lp__rise">
            <span>
              <b>{TRACTION.blocked}</b> spend attempts blocked
            </span>
            <span>
              <b>{TRACTION.treasuries}</b> treasuries created
            </span>
            <span>
              <b>{TRACTION.actions}</b> actions on-chain
            </span>
            {/* Every other number here is our own. This is the one someone else awarded — the
                only outside verification on the page, and the redesign had dropped it. */}
            <span className="lp__award">2nd place · BuildOn Stellar, IBW 2026 — Agentic Track</span>
          </div>
        </div>
      </div>
    </section>
  );
}

const recoverLink: React.CSSProperties = {
  background: "none", border: "none", padding: 0, marginTop: 12, cursor: "pointer",
  color: "var(--ink-2)", fontSize: 13, fontFamily: "inherit",
};
