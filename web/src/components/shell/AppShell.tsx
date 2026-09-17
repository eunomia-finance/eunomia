// The product chrome: persistent sidebar (desktop) / bottom tabs (mobile) + a sticky
// topbar carrying the treasury switcher and the shared wallet chip. Pages render inside.
import WalletChip from "../WalletChip";
import TreasurySwitcher from "./TreasurySwitcher";
import { APP_PAGES, type AppPage, type View } from "../../lib/routes";
import "./shell.css";
import "./ledger.css";

const NAV: Record<AppPage, { label: string; icon: string }> = {
  overview: { label: "Overview", icon: "◈" },
  payments: { label: "Payments", icon: "→" },
  agent: { label: "Agent", icon: "⚡" },
  activity: { label: "Activity", icon: "≡" },
  settings: { label: "Settings", icon: "⚙" },
};

export default function AppShell({
  page,
  onGo,
  children,
}: {
  page: View;
  onGo: (v: View) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="shell__side">
        <button className="shell__brand" onClick={() => onGo("landing")} type="button">
          <span className="shell__glyph" /> Eunomia
        </button>
        <nav className="shell__nav">
          {APP_PAGES.map((p) => (
            <button
              key={p}
              className={`shell__item${page === p ? " is-active" : ""}`}
              onClick={() => onGo(p)}
              type="button"
            >
              <span className="shell__icon">{NAV[p].icon}</span> {NAV[p].label}
            </button>
          ))}
        </nav>
        <div className="shell__foot">
          <button
            className={`shell__demo${page === "dashboard" ? " is-active" : ""}`}
            onClick={() => onGo("dashboard")}
            type="button"
          >
            ▸ Guided demo
          </button>
          <div className="shell__testnet">⚠ Testnet — free test XLM, no real funds.</div>
          <a
            className="shell__docs"
            href="/docs/"
            target="_blank"
            rel="noreferrer"
          >
            Docs ↗
          </a>
        </div>
      </aside>

      <div className="shell__main">
        <header className="shell__top">
          <TreasurySwitcher />
          <WalletChip onWalletView={() => onGo("wallet")} />
        </header>
        <main className="shell__content">{children}</main>
      </div>

      <nav className="shell__tabs">
        {APP_PAGES.map((p) => (
          <button
            key={p}
            className={`shell__tab${page === p ? " is-active" : ""}`}
            onClick={() => onGo(p)}
            type="button"
          >
            <span className="shell__icon">{NAV[p].icon}</span>
            {NAV[p].label}
          </button>
        ))}
      </nav>
    </div>
  );
}
