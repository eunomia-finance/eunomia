// The treasury WASM the app instantiates for every new user treasury.
//
// Deliberately dependency-free: both the browser bundle and the serverless relay import it,
// and the relay runs outside Vite, where anything reaching `import.meta.env` breaks.
//
// v3.5 (2026-08-07): refuses a daily limit above MAX_BATCH x per-payment limit. Above it
// the agent could spend a day the compliance circuit has no room to attest to, and since
// the verifier only asks periods to move forward, that day would drop out of the record
// silently. Carries v3.4's read-only surfaces (`period_spent`, `whitelist_root`) forward.
//
// Older treasuries keep running the code they were born with; contracts are immutable by
// design, so a treasury created with a policy past the ceiling stays that way.
export const TREASURY_WASM_HASH =
  "824472060b3abec7c6c64e8985fa5d0c5a39ea277fbb67eab3125a483d059641";

/** The treasury factory (testnet, 2026-09-16): one owner signature deploys a v3.5 treasury
 *  with its policy, payees, Leash, funding and registry entry (contracts/treasury_factory).
 *  Pinned to TREASURY_WASM_HASH and the registry at its own deploy; it has no admin. The
 *  relay admits it by address, so a passkey user's single call is sponsored like any other. */
export const TREASURY_FACTORY_ID = "CAWLFTQ4V3ZPUWRVL5RGXBBA7FMJ26EXW37GGKCGKOXO4TKABEHF2OMS";

/** Treasury code this app deployed in the past and must keep able to spend.
 *
 *  Contracts are immutable: a treasury created last week still runs last week's wasm, and
 *  its owner's funds are inside it. The relay decides what it will sponsor by wasm hash,
 *  so dropping an old hash when a new version ships does not deprecate it — it locks that
 *  owner out of their own treasury through the passkey path, which has no other way to
 *  pay a fee. Shipping v3.5 did exactly that to every v3.4 treasury for the minutes it
 *  took to notice.
 *
 *  Append here when the shipped hash moves; never replace. */
export const LEGACY_TREASURY_WASM_HASHES = [
  // v3.4 (2026-08-06) — period_spent + whitelist_root, the surfaces a proof binds to
  "b813a1e7a3d2ddb1013dbaa11a41dcc1fbed984a30cfef9023dc199b12131a72",
  // v3.1/v3.2 era — session keys, lifecycle, rolling window
  "475cfbe2ca79d7977c8e4d29438ae70b9d95a12cb2bfcd9fed4e4f7a26d798b2",
];
