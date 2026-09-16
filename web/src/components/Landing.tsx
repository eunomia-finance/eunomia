// Landing — the marketing surface.
//
// Rewritten from the technical page that preceded it. That version opened with "muxed
// sub-addresses", "Groth16/BN254" and "ERC-8004"; none of those words appear here any more.
// They were not deleted, they moved to /docs — this page carries what they achieve.
//
// Design tokens and the contrast measurements behind them: web/docs/design/palette-preview.html
import "./landing.css";
import { useState } from "react";
import { connectPasskey } from "../lib/walletKit";
import { useReveal } from "./landing/useReveal";
import Hero from "./landing/Hero";
import Proof from "./landing/Proof";
import HowItWorks from "./landing/HowItWorks";
import Guarantees from "./landing/Guarantees";
import Privacy from "./landing/Privacy";
import FinalCta from "./landing/FinalCta";
import Footer from "./landing/Footer";
import RecoverySetup from "./landing/RecoverySetup";
import RecoveryRestore from "./landing/RecoveryRestore";

export default function Landing({
  onEnter,
  onWallet,
}: {
  /** After a passkey session exists, go straight to the workspace. */
  onEnter: () => void;
  /** The "I have a wallet" path — opens the existing wallet modal flow. */
  onWallet: () => void;
}) {
  useReveal();

  // Creating a wallet no longer routes straight in: the recovery step sits between
  // "deployed" and "you're in", and it is the one that fires onEnter.
  const [recoveryFor, setRecoveryFor] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const createPasskey = async () => {
    const address = await connectPasskey("create");
    setRecoveryFor(address);
  };

  // Signing in reaches an existing wallet: its recovery code was minted when it was
  // created, so there is nothing to show — straight into the workspace.
  const signInPasskey = async () => {
    await connectPasskey("connect");
    onEnter();
  };

  return (
    // `lp--pending` hides the reveal targets from the first paint; useReveal either animates
    // them in or removes the class outright. See landing.css for why it is not a media query.
    <div className="lp lp--pending">
      {/* The wallet chip now lives in the hero's nav — the scene owns the top of the page. */}
      <Hero
        onCreate={createPasskey}
        onSignIn={signInPasskey}
        onEnter={onEnter}
        onWallet={onWallet}
        onRecover={() => setRestoreOpen(true)}
      />
      <Proof />
      <HowItWorks />
      <Guarantees />
      <Privacy />
      <FinalCta onCreate={createPasskey} />
      <Footer />

      {recoveryFor && (
        <RecoverySetup address={recoveryFor} onDone={onEnter} />
      )}
      {restoreOpen && (
        <RecoveryRestore onDone={onEnter} onClose={() => setRestoreOpen(false)} />
      )}
    </div>
  );
}
