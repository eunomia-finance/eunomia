#![no_std]
//! Eunomia Agent Treasury
//!
//! A non-custodial treasury that lets a business delegate spending to an AI agent
//! while the *contract* — not the model's good behaviour — enforces hard limits.
//! Every payment is checked against a policy (payee whitelist, per-task limit,
//! rolling 24h limit) and rejected on-chain if it violates the policy. Spend is
//! accounted per task so each agent payment is automatically attributable.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, BytesN, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    InvalidAmount = 1,
    PayeeNotWhitelisted = 2,
    ExceedsTaskLimit = 3,
    ExceedsDailyLimit = 4,
    BelowReputationThreshold = 5,
    InsufficientFreeBalance = 6,
    EscrowNotFound = 7,
    DeadlineNotReached = 8,
    Paused = 9,
    ExceedsSessionLimit = 10,
    InvalidLimits = 11,
    InvalidDeadline = 12,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    /// Owner of the funds; the only one who can change the policy.
    pub admin: Address,
    /// The root agent allowed to trigger payments when no session is active.
    pub agent: Address,
    /// SEP-41 / SAC token the treasury holds and spends (e.g. USDC).
    pub token: Address,
    /// Max total spend allowed inside any rolling 24-hour window.
    pub daily_limit: i128,
    /// Max spend allowed in a SINGLE payment (a per-PAYMENT cap, checked per call).
    /// `TaskSpent` accumulates spend per `task_id` for attribution only — it is NOT
    /// capped against this limit, so several sub-cap payments to the same task_id are
    /// allowed; the real cumulative bound is the rolling 24h `daily_limit`.
    pub per_task_limit: i128,
}

/// A time-bound, spend-capped agent credential. While a session is active
/// (`now < valid_until`) it is the ONLY spender — the root agent is replaced,
/// not complemented, so authorisation stays unambiguous and auditable. When it
/// expires or is revoked, spending falls back to `Config.agent`.
#[contracttype]
#[derive(Clone)]
pub struct Session {
    pub agent: Address,
    pub valid_until: u64,
    pub limit: i128,
    pub spent: i128,
}

/// An outcome-bound payment: `amount` is reserved (locked) in the treasury for
/// `payee` against `task_id`, releasable on approval or refundable after `deadline`
/// (UNIX seconds). The funds never leave until release — refund just unlocks them.
#[contracttype]
#[derive(Clone)]
pub struct Escrow {
    pub payee: Address,
    pub amount: i128,
    pub task_id: u64,
    pub deadline: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Payee(Address),
    /// Spend bucketed per hour (`timestamp / 3600`) — the rolling 24h window sums
    /// the last 24 buckets. Old buckets are simply never read again; persistent
    /// min-TTL far exceeds 24h, so an in-window bucket can never be archived.
    HourSpent(u64),
    TaskSpent(u64),
    RepRegistry,
    MinReputation,
    /// Poseidon Merkle root over the payee set a compliance proof is checked against.
    /// Owner-declared (the whitelist itself is not enumerable on-chain), so the proof
    /// asserts membership in *this* treasury's published payee set rather than one the
    /// prover picked.
    WhitelistRoot,
    EscrowEntry(u64),
    NextEscrowId,
    Locked,
    Session,
    Paused,
}

/// Minimal reputation-oracle interface Eunomia reads to authorize a *non-whitelisted*
/// payee by its earned trust. Targets an ERC-8004-style reputation registry
/// (e.g. stellar-8004). `reputation_of` returns an opaque, monotonic score where
/// a higher value means more trustworthy.
#[contractclient(name = "ReputationClient")]
pub trait ReputationOracle {
    fn reputation_of(env: Env, agent: Address) -> i128;
}

const SECONDS_PER_HOUR: u64 = 3_600;
const WINDOW_HOURS: u64 = 24;
const SECONDS_PER_DAY: u64 = 86_400;
// Ledgers close ~every 5s. Escrow entries get their TTL extended past the deadline so a
// far-future escrow can never be archived while `Locked` still counts it (which would
// strand the funds: unreadable entry, permanently inflated lock).
const LEDGERS_PER_WEEK: u32 = 120_960;
const MAX_TTL_LEDGERS: u32 = 3_110_400; // ≈ 6 months of 5s ledgers (order of the network cap)
// Instance storage (Config, Session, Locked, NextEscrowId, reputation policy, Paused) holds
// the treasury's core policy. A low-activity treasury — e.g. one that only ever calls `pay`,
// which writes to persistent buckets — would never otherwise bump its instance TTL, so it
// could be archived and demand a RestoreFootprint before it works again. Every mutation
// extends the instance TTL to keep the contract callable; cheap (a near-no-op once already
// extended). Closes audit finding C3.
const INSTANCE_TTL_THRESHOLD: u32 = LEDGERS_PER_WEEK; // extend once < ~1 week of TTL remains…
const INSTANCE_TTL_EXTEND_TO: u32 = 4 * LEDGERS_PER_WEEK; // …back up to ~1 month

/// How many payments the compliance circuit can attest to in one period.
///
/// This is not a treasury parameter — it is the batch size the circuit is compiled with
/// (`params[0]` in `circuits/circuits.json`) and it decides what a period's spend may be
/// at most: the circuit caps every slot at `per_task_limit` and forces the batch to equal
/// the period's on-chain total exactly. A daily limit above `MAX_BATCH * per_task_limit`
/// therefore lets the agent spend a day that no proof can cover — and since the verifier
/// only asks periods to move forward, that day would drop out of the attestation record
/// silently. The policy is refused instead, so capacity and enforcement cannot disagree.
///
/// Raising it means recompiling the circuit, a new trusted setup, and a new verifier.
pub const MAX_BATCH: i128 = 16;

#[contract]
pub struct Treasury;

#[contractimpl]
impl Treasury {
    /// Atomic init at deploy time (no front-runnable `initialize`).
    /// Limits are validated here so a treasury can never exist with a policy
    /// that contradicts itself (e.g. per-task above daily).
    pub fn __constructor(
        env: Env,
        admin: Address,
        agent: Address,
        token: Address,
        daily_limit: i128,
        per_task_limit: i128,
    ) {
        if !Self::limits_are_coherent(daily_limit, per_task_limit) {
            panic_with_error!(&env, Error::InvalidLimits);
        }
        let cfg = Config {
            admin,
            agent,
            token,
            daily_limit,
            per_task_limit,
        };
        env.storage().instance().set(&DataKey::Config, &cfg);
        Self::bump_instance(&env);
    }

    /// Whitelist a payee. Admin-only.
    pub fn add_payee(env: Env, payee: Address) {
        let cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::bump_instance(&env);
        env.storage()
            .persistent()
            .set(&DataKey::Payee(payee.clone()), &true);
        env.events().publish((symbol_short!("payee_add"),), payee);
    }

    /// Remove a payee from the whitelist. Admin-only.
    pub fn remove_payee(env: Env, payee: Address) {
        let cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::bump_instance(&env);
        env.storage()
            .persistent()
            .remove(&DataKey::Payee(payee.clone()));
        env.events().publish((symbol_short!("payee_rm"),), payee);
    }

    /// Set (or update) the reputation gate. Admin-only. With `min_reputation > 0`,
    /// a payee that is NOT on the whitelist can still be paid when its score from
    /// `registry` is >= `min_reputation` — turning the static allowlist into an
    /// earned-trust gate. Set `min_reputation = 0` to disable (whitelist-only).
    pub fn set_reputation_policy(env: Env, registry: Address, min_reputation: i128) {
        let cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::bump_instance(&env);
        env.storage()
            .instance()
            .set(&DataKey::RepRegistry, &registry);
        env.storage()
            .instance()
            .set(&DataKey::MinReputation, &min_reputation);
        env.events()
            .publish((symbol_short!("rep_gate"),), (registry, min_reputation));
    }

    /// Publish the Merkle root of the payee set that compliance proofs are checked
    /// against. Admin-only: the root IS the owner's policy statement, so an agent that
    /// could write it would be choosing the payee set its own proof is verified against.
    ///
    /// The root is not derived from `DataKey::Payee` — the whitelist is a key-per-payee
    /// map with no on-chain enumeration, and the circuit's Poseidon hash has no host
    /// implementation to rebuild it with. The owner computes it off-chain and anchors it
    /// here; the event makes every change auditable.
    pub fn set_whitelist_root(env: Env, root: BytesN<32>) {
        let cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::bump_instance(&env);
        env.storage().instance().set(&DataKey::WhitelistRoot, &root);
        env.events().publish((symbol_short!("wl_root"),), root);
    }

    /// The active reputation gate, if any: `(registry, min_reputation)`.
    pub fn get_reputation_policy(env: Env) -> Option<(Address, i128)> {
        let registry: Option<Address> = env.storage().instance().get(&DataKey::RepRegistry);
        let min = env
            .storage()
            .instance()
            .get(&DataKey::MinReputation)
            .unwrap_or(0_i128);
        registry.map(|r| (r, min))
    }

    // ---- session: time-bound, spend-capped agent credential ------------------

    /// Delegate spending to a session agent. Admin-only. While the session is
    /// active it is the only spender (see `Session`); setting a new session
    /// overwrites the old one and resets its spent counter (rotation).
    pub fn set_session(
        env: Env,
        agent: Address,
        valid_until: u64,
        limit: i128,
    ) -> Result<(), Error> {
        let cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::bump_instance(&env);
        if limit <= 0 || valid_until <= env.ledger().timestamp() {
            return Err(Error::InvalidLimits);
        }
        let session = Session {
            agent: agent.clone(),
            valid_until,
            limit,
            spent: 0,
        };
        env.storage().instance().set(&DataKey::Session, &session);
        env.events()
            .publish((symbol_short!("session"),), (agent, valid_until, limit));
        Ok(())
    }

    /// Instantly revoke the session — spending falls back to the root agent.
    /// Admin-only; deliberately works while paused (incident response).
    pub fn revoke_session(env: Env) {
        let cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::bump_instance(&env);
        env.storage().instance().remove(&DataKey::Session);
        env.events().publish((symbol_short!("revoked"),), ());
    }

    /// The stored session, if any — including an expired one (callers compare
    /// `valid_until` to now; the contract itself ignores expired sessions).
    pub fn get_session(env: Env) -> Option<Session> {
        env.storage().instance().get(&DataKey::Session)
    }

    // ---- lifecycle -----------------------------------------------------------

    /// Freeze/unfreeze spending (pay, create_escrow, release_escrow). Admin-only.
    /// Exit paths — refund_escrow, admin_withdraw, and every admin setter — keep
    /// working while paused, so an incident can always be unwound.
    pub fn set_paused(env: Env, paused: bool) {
        let cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::bump_instance(&env);
        env.storage().instance().set(&DataKey::Paused, &paused);
        env.events().publish((symbol_short!("paused"),), paused);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    /// Owner reclaims free (unlocked) funds with their own signature. Deliberately
    /// exempt from pause, the payee gate, and the rolling window: those bound
    /// *delegated* agent spending, and the exit path must work exactly when limits
    /// are exhausted or spending is frozen. Escrow-locked funds stay locked (the
    /// commitment to payees survives; refund is the escape hatch for those).
    pub fn admin_withdraw(env: Env, to: Address, amount: i128) -> Result<(), Error> {
        let cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::bump_instance(&env);
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let locked = Self::locked(env.clone());
        if Self::balance(env.clone()) - locked < amount {
            return Err(Error::InsufficientFreeBalance);
        }
        token::TokenClient::new(&env, &cfg.token).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );
        env.events()
            .publish((symbol_short!("withdrawn"),), (to, amount));
        Ok(())
    }

    /// Update the spending limits, effective immediately. Admin-only. If the new
    /// daily limit is below what the window already holds, spending resumes once
    /// the window drains — that is the intended behaviour.
    pub fn set_limits(env: Env, daily_limit: i128, per_task_limit: i128) -> Result<(), Error> {
        let mut cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::bump_instance(&env);
        if !Self::limits_are_coherent(daily_limit, per_task_limit) {
            return Err(Error::InvalidLimits);
        }
        cfg.daily_limit = daily_limit;
        cfg.per_task_limit = per_task_limit;
        env.storage().instance().set(&DataKey::Config, &cfg);
        env.events()
            .publish((symbol_short!("limits"),), (daily_limit, per_task_limit));
        Ok(())
    }

    /// Rotate the root agent (the fallback spender when no session is active).
    /// Admin-only — the recovery path if the root agent key is lost or leaked.
    pub fn set_agent(env: Env, agent: Address) {
        let mut cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::bump_instance(&env);
        cfg.agent = agent.clone();
        env.storage().instance().set(&DataKey::Config, &cfg);
        env.events().publish((symbol_short!("agent"),), agent);
    }

    // ---- spending ------------------------------------------------------------

    /// The agent asks the treasury to pay `amount` to `to` for `task_id`.
    /// The contract enforces the policy and rejects any violation on-chain.
    /// Only the free (unlocked) balance is spendable — funds reserved by open
    /// escrows cannot be paid out directly.
    pub fn pay(env: Env, task_id: u64, to: Address, amount: i128) -> Result<(), Error> {
        let cfg = Self::cfg(&env);
        Self::spender(&env, &cfg).require_auth();
        Self::require_not_paused(&env)?;
        Self::bump_instance(&env);

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // ---- POLICY GATE ----------------------------------------------------
        // Payee must be on the manual whitelist OR (opt-in) earn a high-enough
        // reputation score from the configured ERC-8004 registry. Default: whitelist only.
        Self::payee_allowed(&env, &to)?;
        if amount > cfg.per_task_limit {
            return Err(Error::ExceedsTaskLimit);
        }
        let session = Self::active_session(&env);
        if let Some(ref s) = session {
            if s.spent + amount > s.limit {
                return Err(Error::ExceedsSessionLimit);
            }
        }
        let spent_window = Self::rolling_spent(&env);
        if spent_window + amount > cfg.daily_limit {
            return Err(Error::ExceedsDailyLimit);
        }
        let locked = Self::locked(env.clone());
        if Self::balance(env.clone()) - locked < amount {
            return Err(Error::InsufficientFreeBalance);
        }
        // ---------------------------------------------------------------------

        // ---- EFFECTS: record the spend BEFORE moving funds (checks-effects-interactions).
        // per-hour buckets enforce the rolling window; per-task is the attribution ledger.
        Self::record_window_spend(&env, amount);
        let task_spent = Self::task_spent(env.clone(), task_id);
        env.storage()
            .persistent()
            .set(&DataKey::TaskSpent(task_id), &(task_spent + amount));
        if let Some(mut s) = session {
            s.spent += amount;
            env.storage().instance().set(&DataKey::Session, &s);
        }

        // ---- INTERACTION: move the treasury's own balance out last. If the transfer
        // panics, the whole tx reverts and the accounting above is rolled back atomically.
        token::TokenClient::new(&env, &cfg.token).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );

        env.events()
            .publish((symbol_short!("paid"), task_id), (to, amount));
        Ok(())
    }

    // ---- views -------------------------------------------------------------

    pub fn get_config(env: Env) -> Config {
        Self::cfg(&env)
    }

    pub fn is_payee(env: Env, payee: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Payee(payee))
            .unwrap_or(false)
    }

    /// Cumulative spend recorded against `task_id` — an attribution ledger, not a cap.
    /// (The per-call limit is `Config.per_task_limit`; the cumulative bound is the daily window.)
    pub fn task_spent(env: Env, task_id: u64) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TaskSpent(task_id))
            .unwrap_or(0)
    }

    /// Total agent-moved value inside the closed UTC day `period_id`
    /// (`period_id = timestamp / 86400`) — the figure a compliance proof commits to.
    ///
    /// Deliberately NOT `day_spent`: the rolling window answers "how much allowance is
    /// left right now" and changes every hour, so a proof could never bind to it. This
    /// sums the 24 fixed buckets of one calendar day, giving a value that is final once
    /// the day closes and reads identically forever after.
    ///
    /// "Moved" includes escrow commitments, not just settled payments — `create_escrow`
    /// charges the same buckets, because locking the balance is the agent exercising its
    /// budget whether or not the funds ever leave.
    ///
    /// 24 persistent reads, one fewer than `rolling_spent` already performs per spend.
    pub fn period_spent(env: Env, period_id: u64) -> i128 {
        let first_hour = period_id * (SECONDS_PER_DAY / SECONDS_PER_HOUR);
        let mut total = 0_i128;
        let mut h = first_hour;
        while h < first_hour + (SECONDS_PER_DAY / SECONDS_PER_HOUR) {
            let bucket: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::HourSpent(h))
                .unwrap_or(0);
            total += bucket;
            h += 1;
        }
        total
    }

    /// The payee-set Merkle root this treasury publishes, or `None` if the owner never
    /// declared one (in which case no compliance proof can be checked against it).
    pub fn whitelist_root(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::WhitelistRoot)
    }

    /// Spend inside the rolling 24-hour window (the "daily" allowance).
    pub fn day_spent(env: Env) -> i128 {
        Self::rolling_spent(&env)
    }

    pub fn balance(env: Env) -> i128 {
        let cfg = Self::cfg(&env);
        token::TokenClient::new(&env, &cfg.token).balance(&env.current_contract_address())
    }

    // ---- escrow: outcome-bound payments ------------------------------------

    /// Agent reserves `amount` for `payee` against a future-delivered task. The funds
    /// stay in the treasury (locked, not transferred) until released on approval or
    /// refunded after `deadline`. Subject to the same payee gate + per-task limit +
    /// session cap as a direct payment; the rolling window is charged here, at
    /// commitment time (see the reasoning inline below).
    pub fn create_escrow(
        env: Env,
        task_id: u64,
        payee: Address,
        amount: i128,
        deadline: u64,
    ) -> Result<u64, Error> {
        let cfg = Self::cfg(&env);
        Self::spender(&env, &cfg).require_auth();
        Self::require_not_paused(&env)?;
        Self::bump_instance(&env);

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let now = env.ledger().timestamp();
        if deadline <= now {
            return Err(Error::InvalidDeadline);
        }
        Self::payee_allowed(&env, &payee)?;
        if amount > cfg.per_task_limit {
            return Err(Error::ExceedsTaskLimit);
        }
        // The session cap charges at commitment time — it bounds what a leaked
        // session key can commit, not just what has already left the treasury.
        let session = Self::active_session(&env);
        if let Some(ref s) = session {
            if s.spent + amount > s.limit {
                return Err(Error::ExceedsSessionLimit);
            }
        }
        // The rolling window charges here for the same reason. Enforcing it only at
        // release bounded what the agent could SETTLE while leaving what it could
        // COMMIT unbounded: an agent on a 100/day limit could lock an entire balance
        // in open escrows with day_spent() reading 0, and admin_withdraw only reaches
        // the free balance — so the owner lost access to their own funds without a
        // single unit being spent. The daily limit is now the ceiling on agent-moved
        // value, committed or settled.
        let spent_window = Self::rolling_spent(&env);
        if spent_window + amount > cfg.daily_limit {
            return Err(Error::ExceedsDailyLimit);
        }
        let locked = Self::locked(env.clone());
        if Self::balance(env.clone()) - locked < amount {
            return Err(Error::InsufficientFreeBalance);
        }

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextEscrowId)
            .unwrap_or(0);
        let escrow = Escrow {
            payee: payee.clone(),
            amount,
            task_id,
            deadline,
        };
        env.storage()
            .persistent()
            .set(&DataKey::EscrowEntry(id), &escrow);
        // Keep the entry alive comfortably past its deadline (see TTL constants above) —
        // otherwise `Locked` (instance) could outlive an archived entry and strand funds.
        let ttl = (((deadline - now) / 5) + LEDGERS_PER_WEEK as u64).min(MAX_TTL_LEDGERS as u64) as u32;
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::EscrowEntry(id), ttl, ttl);
        env.storage().instance().set(&DataKey::NextEscrowId, &(id + 1));
        env.storage().instance().set(&DataKey::Locked, &(locked + amount));
        Self::record_window_spend(&env, amount);
        if let Some(mut s) = session {
            s.spent += amount;
            env.storage().instance().set(&DataKey::Session, &s);
        }

        env.events()
            .publish((symbol_short!("escrowed"), id), (payee, amount));
        Ok(id)
    }

    /// Admin (the owner / hirer) approves delivery → release the locked funds to the
    /// payee. The rolling window was already charged when the escrow was created, so
    /// release does not check or charge it again; the spend is accounted per task
    /// exactly like a direct `pay`.
    pub fn release_escrow(env: Env, id: u64) -> Result<(), Error> {
        let cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::require_not_paused(&env)?;
        Self::bump_instance(&env);
        let escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowEntry(id))
            .ok_or(Error::EscrowNotFound)?;

        // No window check or charge here: `create_escrow` already spent this amount
        // against the rolling window when the agent committed it. Charging again
        // would consume the allowance twice for one escrow, and would let a stale
        // commitment block an unrelated payment on the day it finally settles.

        // EFFECTS before INTERACTION (checks-effects-interactions): record the
        // attribution, drop the escrow, release the lock, then move funds out last.
        let task_spent = Self::task_spent(env.clone(), escrow.task_id);
        env.storage()
            .persistent()
            .set(&DataKey::TaskSpent(escrow.task_id), &(task_spent + escrow.amount));
        env.storage().persistent().remove(&DataKey::EscrowEntry(id));
        env.storage()
            .instance()
            .set(&DataKey::Locked, &(Self::locked(env.clone()) - escrow.amount));

        token::TokenClient::new(&env, &cfg.token).transfer(
            &env.current_contract_address(),
            &escrow.payee,
            &escrow.amount,
        );
        env.events()
            .publish((symbol_short!("released"), id), (escrow.payee, escrow.amount));
        Ok(())
    }

    /// After the deadline, the agent reclaims an undelivered escrow — the lock is
    /// released back to the treasury's free balance. No transfer, no spend recorded,
    /// and the session budget is NOT restored (conservative: the cap bounds what a
    /// session may commit). Deliberately works while paused (exit path).
    pub fn refund_escrow(env: Env, id: u64) -> Result<(), Error> {
        let cfg = Self::cfg(&env);
        Self::spender(&env, &cfg).require_auth();
        Self::bump_instance(&env);
        let escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowEntry(id))
            .ok_or(Error::EscrowNotFound)?;

        if env.ledger().timestamp() < escrow.deadline {
            return Err(Error::DeadlineNotReached);
        }
        env.storage().persistent().remove(&DataKey::EscrowEntry(id));
        env.storage()
            .instance()
            .set(&DataKey::Locked, &(Self::locked(env.clone()) - escrow.amount));

        env.events()
            .publish((symbol_short!("refunded"), id), (escrow.payee, escrow.amount));
        Ok(())
    }

    /// Admin unilaterally cancels an open escrow — the lock returns to the free
    /// balance, nothing is paid, no deadline needed. This is the incident-response
    /// path: a compromised agent could otherwise tie up the whole treasury in
    /// escrows it alone can refund. Deliberately works while paused (exit path);
    /// the session budget is NOT restored (consistent with refund).
    pub fn admin_cancel_escrow(env: Env, id: u64) -> Result<(), Error> {
        let cfg = Self::cfg(&env);
        cfg.admin.require_auth();
        Self::bump_instance(&env);
        let escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowEntry(id))
            .ok_or(Error::EscrowNotFound)?;

        env.storage().persistent().remove(&DataKey::EscrowEntry(id));
        env.storage()
            .instance()
            .set(&DataKey::Locked, &(Self::locked(env.clone()) - escrow.amount));

        env.events()
            .publish((symbol_short!("cancelled"), id), (escrow.payee, escrow.amount));
        Ok(())
    }

    pub fn get_escrow(env: Env, id: u64) -> Option<Escrow> {
        env.storage().persistent().get(&DataKey::EscrowEntry(id))
    }

    /// Total funds currently reserved by open escrows (treasury balance minus this
    /// is the spendable free balance).
    pub fn locked(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Locked).unwrap_or(0)
    }
}

// Non-exported helpers (separate impl block so they are not part of the ABI).
impl Treasury {
    fn cfg(env: &Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    /// Extend the instance storage TTL so the treasury's core policy can't be archived out
    /// from under a low-activity treasury. Called by every mutation. Closes audit finding C3.
    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    /// The session, only while it is actually active (`now < valid_until`).
    fn active_session(env: &Env) -> Option<Session> {
        let s: Option<Session> = env.storage().instance().get(&DataKey::Session);
        match s {
            Some(sess) if env.ledger().timestamp() < sess.valid_until => Some(sess),
            _ => None,
        }
    }

    /// Who may spend right now: the active session agent, else the root agent.
    fn spender(env: &Env, cfg: &Config) -> Address {
        match Self::active_session(env) {
            Some(s) => s.agent,
            None => cfg.agent.clone(),
        }
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if Self::is_paused(env.clone()) {
            Err(Error::Paused)
        } else {
            Ok(())
        }
    }

    /// Sum of the trailing hourly buckets — the rolling window. ~25 persistent
    /// reads per spend; fits comfortably inside the per-tx entry limits (verified
    /// live), and a bucket inside the window can never be archived (see DataKey).
    ///
    /// 25 buckets, not 24, and that is the whole point: spend is charged to the
    /// bucket of the hour it LANDS in, so a spend at second 3599 of hour N sits in
    /// bucket N. Summing `[N-23 ..= N]` dropped it at the start of hour N+24, i.e.
    /// after 23h00m01s — enough for a compromised agent to spend 2x the daily limit
    /// inside one wall-clock day. Summing `[N-24 ..= N]` holds every spend for
    /// 24-25h instead: never less than the advertised day, only ever more.
    fn rolling_spent(env: &Env) -> i128 {
        let now_hour = env.ledger().timestamp() / SECONDS_PER_HOUR;
        let start = now_hour.saturating_sub(WINDOW_HOURS);
        let mut total = 0_i128;
        let mut h = start;
        while h <= now_hour {
            let bucket: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::HourSpent(h))
                .unwrap_or(0);
            total += bucket;
            h += 1;
        }
        total
    }

    fn record_window_spend(env: &Env, amount: i128) {
        let hour = env.ledger().timestamp() / SECONDS_PER_HOUR;
        let bucket: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::HourSpent(hour))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::HourSpent(hour), &(bucket + amount));
    }

    /// Whether a policy is one the whole system can honour — the single gate used by both
    /// the constructor and `set_limits`, so a treasury cannot be walked past it later.
    ///
    /// Beyond the obvious (positive, per-task not above daily), the daily limit must stay
    /// within what the compliance circuit can attest to; see `MAX_BATCH`. The product
    /// cannot overflow: callers are bounded by the verifier's 64-bit range check on
    /// `per_task_limit`, and 16 * 2^64 is far inside i128.
    fn limits_are_coherent(daily_limit: i128, per_task_limit: i128) -> bool {
        daily_limit > 0
            && per_task_limit > 0
            && per_task_limit <= daily_limit
            && daily_limit <= MAX_BATCH.saturating_mul(per_task_limit)
    }

    /// Whitelist OR earned-reputation gate. See `set_reputation_policy`.
    fn payee_allowed(env: &Env, to: &Address) -> Result<(), Error> {
        if Self::is_payee(env.clone(), to.clone()) {
            return Ok(());
        }
        let registry: Option<Address> = env.storage().instance().get(&DataKey::RepRegistry);
        let min: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinReputation)
            .unwrap_or(0);
        match registry {
            Some(reg) if min > 0 => {
                let score = ReputationClient::new(env, &reg).reputation_of(to);
                if score >= min {
                    Ok(())
                } else {
                    Err(Error::BelowReputationThreshold)
                }
            }
            _ => Err(Error::PayeeNotWhitelisted),
        }
    }
}

mod test;
