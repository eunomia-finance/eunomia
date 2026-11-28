import { EXPLORER, LISTED_CONTRACTS, NETWORK_LABEL } from "../../config";
import { TRACTION } from "./traction";
import EunomiaMark from "../EunomiaMark";

const REPO = "https://github.com/eunomia-finance/eunomia";

/** The footer carries the trust apparatus.
 *
 *  The redesign had cut this down to two links, which undercuts the page's own argument: a
 *  product that says "don't trust us, check the chain" has to say where to check. The contract
 *  addresses, the security policy and the people behind it are that. Technical vocabulary
 *  still stays out — an address is a destination, not jargon. */
const ON_CHAIN = LISTED_CONTRACTS;

export default function Footer() {
  return (
    <footer className="lp__footer">
      <div className="lp__in">
        <div className="lp__footer-top">
          <div>
            <strong className="lp__footer-brand">
              <EunomiaMark size={24} />
              Eunomia
            </strong>
            <p className="lp__footer-line">
              The safety layer for agent money — your rules live in the contract, not in the
              prompt.
            </p>
          </div>

          <div className="lp__footer-cols">
            <div>
              <div className="lp__footer-h">Product</div>
              <a className="lp__link" href="/docs/">
                Documentation
              </a>
              <a className="lp__link" href="#overview">
                Open the app
              </a>
            </div>

            <div>
              <div className="lp__footer-h">Resources</div>
              <a className="lp__link" href={REPO} target="_blank" rel="noreferrer">
                GitHub — MIT ↗
              </a>
              <a
                className="lp__link"
                href={`${REPO}/blob/main/SECURITY.md`}
                target="_blank"
                rel="noreferrer"
              >
                Security policy ↗
              </a>
              <a
                className="lp__link"
                href={`${REPO}/blob/main/ROADMAP.md`}
                target="_blank"
                rel="noreferrer"
              >
                Roadmap ↗
              </a>
              <a
                className="lp__link"
                href={`${REPO}/blob/main/CHANGELOG.md`}
                target="_blank"
                rel="noreferrer"
              >
                Changelog ↗
              </a>
            </div>

            <div>
              <div className="lp__footer-h">On-chain</div>
              {ON_CHAIN.map((c) => (
                <a
                  className="lp__link"
                  key={c.label}
                  href={`${EXPLORER}/contract/${c.id}`}
                  target="_blank"
                  rel="noreferrer"
                  title={c.id}
                >
                  {c.label} ↗
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="lp__footer-row" style={{ marginTop: 30 }}>
          <span className="lp__badge">Stellar {NETWORK_LABEL}</span>
          <span>Open source, every line readable — MIT.</span>
          {TRACTION && (
            <span>
              {TRACTION.treasuries} treasuries · {TRACTION.blocked} out-of-policy attempts stopped
              — all checkable above.
            </span>
          )}
        </div>

        <div className="lp__footer-row" style={{ marginTop: 14 }}>
          <span>Built by Bekir Erdem &amp; Seyit Ali Değirmen</span>
          <span>2nd place · BuildOn Stellar, IBW 2026 — Agentic Track</span>
        </div>
      </div>
    </footer>
  );
}
