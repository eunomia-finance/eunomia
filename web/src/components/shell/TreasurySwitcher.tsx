// Topbar treasury selector: the merged local ∪ on-chain list, switchable without a
// reload. Registry entries are the recoverable ones; local-only rows say so. "Forget"
// only drops the device-local mapping — the contract itself lives on.
import { useEffect, useRef, useState } from "react";
import { shortAddr } from "../../config";
import { useTreasury } from "../../state/useTreasury";

// `onNew` moves the shell to a treasury-scoped view: the creation wizard only renders there,
// so "New treasury" pressed on Wallet or Activity would otherwise change nothing on screen.
export default function TreasurySwitcher({ onNew }: { onNew?: () => void }) {
  const { address, treasuryId, treasuries, switchTreasury, forgetTreasury, startNewTreasury } = useTreasury();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!address || !treasuryId) return <span />;

  return (
    <div className="tswitch" ref={ref}>
      <button className="tswitch__chip" onClick={() => setOpen((o) => !o)} type="button">
        ◇ {shortAddr(treasuryId)} <span className="tswitch__caret">▾</span>
      </button>
      {open && (
        <div className="tswitch__menu">
          {treasuries.map((t) => (
            <button
              key={t.id}
              className="tswitch__row"
              onClick={() => {
                setOpen(false);
                switchTreasury(t.id);
              }}
              type="button"
            >
              <span style={{ flex: 1 }}>{shortAddr(t.id)}</span>
              {!t.registered && <span className="is-unreg">not registered</span>}
              {t.id === treasuryId && <span className="is-current">✓</span>}
              <span
                className="tswitch__forget"
                role="button"
                tabIndex={0}
                title="Forget on this device only — the contract stays on-chain"
                onClick={(e) => {
                  e.stopPropagation();
                  forgetTreasury(t.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    forgetTreasury(t.id);
                  }
                }}
              >
                forget
              </span>
            </button>
          ))}
          <button
            className="tswitch__row tswitch__new"
            onClick={() => {
              setOpen(false);
              startNewTreasury();
              onNew?.();
            }}
            type="button"
          >
            ＋ New treasury
          </button>
        </div>
      )}
    </div>
  );
}
