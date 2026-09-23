// App-wide toast surface: tx progress/results appear top-right under the topbar, so a
// success in one page is visible from anywhere. Validation errors do NOT come here —
// they render inline next to the form that caused them (ActionOutcome.validation).
import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EXPLORER } from "../config";
import { ToastContext } from "./toastContext";
import { dismissDelay, dismissToast, pushToast, type ToastItem, type ToastKind } from "./toastQueue";
import { toastStyles } from "./toastStyles";
import { currentDevice } from "../lib/funnel";

const { stack, box, msg: msgStyle, closeBtn } = toastStyles;

// A phone shows far less than a laptop: four stacked toasts covered the controls under them.
const capFor = () => (currentDevice() === "mobile" ? 2 : 4);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => dismissToast(list, id));
  }, []);

  const toast = useCallback(
    (kind: ToastKind, msg: string, opts?: { hash?: string }) => {
      const id = nextId.current++;
      setItems((list) => pushToast(list, { kind, msg, hash: opts?.hash }, id, capFor()));
      setTimeout(() => dismiss(id), dismissDelay(kind));
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={stack} aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              data-toast-kind={t.kind}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="toast"
              style={box}
            >
              <span style={msgStyle}>{t.msg}</span>
              {t.hash && (
                <a
                  style={{ whiteSpace: "nowrap" }}
                  href={`${EXPLORER}/tx/${t.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  view tx ↗
                </a>
              )}
              <button style={closeBtn} onClick={() => dismiss(t.id)} type="button" aria-label="Dismiss">
                ✕
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

