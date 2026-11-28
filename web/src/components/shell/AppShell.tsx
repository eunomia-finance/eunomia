// The product chrome: one top bar — brand, the five pages as a pill, language, treasury and
// wallet — and bottom tabs on phones. Pages render under it. The sidebar went with the
// 2026-11-28 redesign: the page needs its full width for three cards side by side.
import EunomiaMark from "../EunomiaMark";
import WalletChip from "../WalletChip";
import TreasurySwitcher from "./TreasurySwitcher";
import { APP_PAGES, type AppPage, type View } from "../../lib/routes";
import { setLang, tx, useLang } from "../../lib/i18n";
import { useTheme } from "../landing/useTheme";
import "./shell.css";
import "./ledger.css";

const ICON: Record<AppPage, string> = { overview: "◈", payments: "→", agent: "⚡", activity: "≡", settings: "⚙" };
const label = (p: AppPage): string =>
  ({
    overview: tx("Overview", "Genel bakış"),
    payments: tx("Payments", "Ödemeler"),
    agent: tx("Agent", "Ajan"),
    activity: tx("Activity", "Hareketler"),
    settings: tx("Settings", "Ayarlar"),
  })[p];

export default function AppShell({
  page,
  onGo,
  children,
}: {
  page: View;
  onGo: (v: View) => void;
  children: React.ReactNode;
}) {
  const lang = useLang();
  const { theme, toggle } = useTheme();
  return (
    <div className="shell">
      <header className="shell__top">
        <button className="shell__brand" onClick={() => onGo("landing")} type="button">
          <EunomiaMark size={17} />
          Eunomia
        </button>
        <nav className="shell__pill" aria-label={tx("Pages", "Sayfalar")}>
          {APP_PAGES.map((p) => (
            <button key={p} className={`shell__item${page === p ? " is-active" : ""}`} onClick={() => onGo(p)} type="button">
              {label(p)}
            </button>
          ))}
        </nav>
        <div className="shell__right">
          <div className="shell__lang" role="group" aria-label={tx("Language", "Dil")}>
            <button className={lang === "tr" ? "is-on" : ""} onClick={() => setLang("tr")} aria-pressed={lang === "tr"} type="button">TR</button>
            <button className={lang === "en" ? "is-on" : ""} onClick={() => setLang("en")} aria-pressed={lang === "en"} type="button">EN</button>
          </div>
          {/* The same switch the landing carries, with the same sweep: the new palette opens
              as a circle from where the button was pressed (useTheme). */}
          <button
            className="shell__theme"
            onClick={(e) => toggle({ clientX: e.clientX, clientY: e.clientY })}
            aria-label={theme === "dark" ? tx("Switch to the light theme", "Açık temaya geç") : tx("Switch to the dark theme", "Koyu temaya geç")}
            title={theme === "dark" ? tx("Light theme", "Açık tema") : tx("Dark theme", "Koyu tema")}
            type="button"
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <TreasurySwitcher onNew={() => onGo("overview")} />
          <WalletChip onWalletView={() => onGo("wallet")} />
        </div>
      </header>

      <main className="shell__content">{children}</main>

      <footer className="shell__foot">
        <span>{tx("Mainnet beta — real funds, capped deposits.", "Mainnet beta — gerçek para, sınırlı yatırım.")}</span>
        <a className="shell__docs" href="/docs/" target="_blank" rel="noreferrer">
          {tx("Docs", "Dokümanlar")} ↗
        </a>
      </footer>

      <nav className="shell__tabs">
        {APP_PAGES.map((p) => (
          <button key={p} className={`shell__tab${page === p ? " is-active" : ""}`} onClick={() => onGo(p)} type="button">
            <span className="shell__icon">{ICON[p]}</span>
            {label(p)}
          </button>
        ))}
      </nav>
    </div>
  );
}
