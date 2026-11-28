// Shared wallet-connection chip — "Connect wallet" when disconnected; the address plus
// a copy / wallet-view / disconnect menu when connected. Used by both the app nav and
// the landing nav so the connection reads the same everywhere.
import { useContext, useEffect, useRef, useState } from "react";
import { shortAddr } from "../config";
import { tx, useLang } from "../lib/i18n";
import { connect as kitConnect, disconnect as kitDisconnect, wcConfigured } from "../lib/walletKit";
import { useWalletAddress } from "../lib/useWalletAddress";
import { currentDevice } from "../lib/funnel";
import { mobileWalletHint } from "../lib/walletDevice";
import { ToastContext } from "../state/toastContext";
import "./appnav.css";

export default function WalletChip({
  onWalletView,
  variant = "solid",
}: {
  onWalletView?: () => void;
  variant?: "solid" | "ghost";
}) {
  useLang();
  const address = useWalletAddress();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const walletRef = useRef<HTMLDivElement>(null);
  // Direct context read, not useToast(): the landing nav renders this chip outside
  // ToastProvider, where the hint is simply skipped.
  const toastApi = useContext(ToastContext);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (walletRef.current && !walletRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const connect = async () => {
    setConnecting(true);
    // On a phone the modal leads with WalletConnect (issue #9) — pairing happens in the
    // wallet app, and it must be on this build's network, so say that before the modal opens.
    if (currentDevice() === "mobile" && wcConfigured) {
      toastApi?.toast("info", mobileWalletHint());
    }
    try {
      await kitConnect();
    } catch {
      // User closed the wallet modal — nothing to surface here.
    } finally {
      setConnecting(false);
    }
  };

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the wallet view shows the address too.
    }
  };

  if (!address) {
    return (
      <button
        className={`anav__cta${variant === "ghost" ? " anav__cta--ghost" : ""}`}
        onClick={connect}
        disabled={connecting}
        type="button"
      >
        {connecting ? tx("Connecting…", "Bağlanıyor…") : tx("Connect wallet", "Cüzdanı bağla")}
      </button>
    );
  }

  return (
    <div className="anav__wallet" ref={walletRef}>
      <button className="anav__chip" onClick={() => setMenuOpen((o) => !o)} type="button">
        <i className="anav__dot" /> {shortAddr(address)}
      </button>
      {menuOpen && (
        <div className="anav__menu">
          <button onClick={copy} type="button">
            {copied ? tx("Copied ✓", "Kopyalandı ✓") : tx("Copy address", "Adresi kopyala")}
          </button>
          {onWalletView && (
            <button
              onClick={() => {
                setMenuOpen(false);
                onWalletView();
              }}
              type="button"
            >
              {tx("Wallet details", "Cüzdan ayrıntıları")}
            </button>
          )}
          <button
            onClick={() => {
              setMenuOpen(false);
              void kitDisconnect();
            }}
            type="button"
          >
            {tx("Disconnect", "Bağlantıyı kes")}
          </button>
        </div>
      )}
    </div>
  );
}
