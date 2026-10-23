/** Confidential mode, as a promise rather than a mechanism.
 *
 *  Deliberate vocabulary ban on this page: "zero-knowledge", "Groth16", "BN254" and
 *  "Sealed Receipt" all live in the docs now. A finance lead does not buy a proof system;
 *  they buy not showing their suppliers and margins to competitors. */
export default function Privacy() {
  if (__EUNOMIA_NETWORK__ !== "testnet") return null;

  return (
    <section className="lp__section lp__divide lp__privacy" id="privacy">
      <div className="lp__in">
        <h2 className="lp__reveal--head">Prove you followed the rules — without showing the numbers.</h2>
        <p className="lp__lede lp__reveal">
          On a public chain every payment is readable: what you spend, who you pay, what your
          margin is. Confidential mode keeps those private while still proving to anyone that
          each payment stayed inside your policy.
        </p>

        <div className="lp__cards">
          <div className="lp__card lp__reveal">
            <div className="lp__k">Amount</div>
            <div className="lp__v">•••••</div>
            <div className="lp__k" style={{ marginTop: 12 }}>hidden</div>
          </div>
          <div className="lp__card lp__reveal">
            <div className="lp__k">Recipient</div>
            <div className="lp__v">•••••</div>
            <div className="lp__k" style={{ marginTop: 12 }}>hidden</div>
          </div>
          <div className="lp__card lp__card--ok lp__reveal">
            <div className="lp__k">Within policy</div>
            <div className="lp__v">Proven</div>
            <div className="lp__k" style={{ marginTop: 12 }}>checked on-chain</div>
          </div>
        </div>

        <p className="lp__k lp__reveal" style={{ marginTop: 26 }}>
          <a className="lp__link" href="/docs/zk">
            How the proof works →
          </a>
        </p>
      </div>
    </section>
  );
}
