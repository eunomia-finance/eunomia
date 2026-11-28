// Mobile bottom sheet — replaces the "scroll the inline panel into view" workaround for
// forms that would otherwise land under the bottom tab bar. Sits above the tab bar
// (z 1000) and the switcher dropdown (z 1200); closes on backdrop tap or Escape.
import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { tx, useLang } from "../../lib/i18n";

const EASE = [0.2, 0.7, 0.3, 1] as const;

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useLang();
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            style={backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            style={sheet}
            initial={reduce ? { opacity: 0 } : { y: "100%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            <div style={grabber} />
            <div style={titleRow}>
              <span style={titleStyle}>{title}</span>
              <button style={closeBtn} onClick={onClose} type="button" aria-label={tx("Close", "Kapat")}>
                ✕
              </button>
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1300, background: "rgba(34,62,5,0.45)",
};
const sheet: React.CSSProperties = {
  position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1310,
  padding: "10px 16px calc(20px + env(safe-area-inset-bottom))",
  borderRadius: "18px 18px 0 0",
  background: "var(--surface)", borderTop: "1px solid var(--line)",
  boxShadow: "0 -18px 48px -12px rgba(34,62,5,0.28)",
};
const grabber: React.CSSProperties = {
  width: 40, height: 4, borderRadius: 100, margin: "0 auto 10px",
  background: "var(--line)",
};
const titleRow: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6,
};
const titleStyle: React.CSSProperties = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-2)",
};
const closeBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", color: "var(--ink-2)",
  fontSize: 14, padding: 4, fontFamily: "inherit",
};
